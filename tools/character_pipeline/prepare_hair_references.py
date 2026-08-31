#!/usr/bin/env python3
"""Extract the complete hair silhouettes from the 4x4 kit reference sheet.

The source renders contain a neutral mannequin.  Passing that mannequin to a
single-image reconstructor produces a second head instead of a replaceable hair
asset, so this step keeps only the coloured/dark hair volume and its ties.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def hair_mask(rgba: Image.Image) -> Image.Image:
    pixels = np.asarray(rgba.convert("RGBA"), dtype=np.float32) / 255.0
    rgb = pixels[:, :, :3]
    subject = pixels[:, :, 3] > 0.08
    value = rgb.max(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    saturation = chroma / np.maximum(value, 1e-4)

    # All sixteen kit hairs are either substantially darker than the neutral
    # mannequin or much more saturated.  The deliberately strict seed prevents
    # the shaded cheek/neck of the mannequin becoming a second head.  Closing
    # and hole filling recover highlights inside the hair volume afterwards.
    candidate = subject & ((value < 0.52) | (saturation > 0.48))
    candidate = ndimage.binary_closing(candidate, iterations=2)
    candidate = ndimage.binary_opening(candidate, iterations=1)

    # Keep components belonging to the upper hair mass.  Ponytails, braids and
    # side locks remain because they connect to that mass after closing.
    labels, count = ndimage.label(candidate)
    retained = np.zeros_like(candidate)
    upper_limit = round(candidate.shape[0] * 0.38)
    min_area = max(24, candidate.size // 8000)
    for label in range(1, count + 1):
        component = labels == label
        area = int(component.sum())
        if area < min_area:
            continue
        ys = np.where(component)[0]
        if ys.min() <= upper_limit:
            retained |= component

    retained = ndimage.binary_closing(retained, iterations=2)
    # Fill only tiny highlight pinholes; a general hole fill would mistakenly
    # turn the mannequin's visible ears into part of ponytails and braids.
    filled = ndimage.binary_fill_holes(retained)
    holes = filled & ~retained
    retained |= holes & ((saturation > 0.38) | (value < 0.60))
    hole_labels, hole_count = ndimage.label(holes)
    for label in range(1, hole_count + 1):
        hole = hole_labels == label
        if int(hole.sum()) <= 72:
            retained |= hole
    alpha = Image.fromarray((retained * 255).astype(np.uint8), mode="L")
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.75))
    subject_alpha = rgba.getchannel("A")
    alpha_array = np.minimum(np.asarray(alpha), np.asarray(subject_alpha))
    return Image.fromarray(alpha_array.astype(np.uint8), mode="L")


def crop_visible(image: Image.Image, padding: int = 14) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError("Hair segmentation produced an empty image")
    left = max(0, int(xs.min()) - padding)
    top = max(0, int(ys.min()) - padding)
    right = min(image.width, int(xs.max()) + padding + 1)
    bottom = min(image.height, int(ys.max()) + padding + 1)
    return image.crop((left, top, right, bottom))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=4)
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGB")
    args.output.mkdir(parents=True, exist_ok=True)
    for row in range(args.rows):
        top = round(row * sheet.height / args.rows)
        bottom = round((row + 1) * sheet.height / args.rows)
        for column in range(args.columns):
            left = round(column * sheet.width / args.columns)
            right = round((column + 1) * sheet.width / args.columns)
            cell = sheet.crop((left, top, right, bottom))
            rgba = cell.convert("RGBA")
            rgba.putalpha(hair_mask(rgba))
            rgba = crop_visible(rgba)
            index = row * args.columns + column
            destination = args.output / f"view-{index:02d}.png"
            rgba.save(destination)
            coverage = (np.asarray(rgba.getchannel("A")) > 8).mean()
            print(f"{destination.name}: {rgba.width}x{rgba.height}, coverage={coverage:.3f}")


if __name__ == "__main__":
    main()

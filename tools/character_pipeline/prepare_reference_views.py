#!/usr/bin/env python3
"""Split a reference sheet and remove each cell's background with BiRefNet."""

from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


DEFAULT_BG_REMOVER = Path(
    "/home/ferney_oliveros/Escritorio/OLCAS HOLDING/PRODUCTOS/"
    "PLANETAKETO/_pipeline/bg_remove.py"
)


def load_cutout(path: Path):
    spec = importlib.util.spec_from_file_location("market_bg_remove", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load background remover: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.cutout


def keep_largest_component(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).copy()
    labels, count = ndimage.label(rgba[:, :, 3] > 24)
    if count <= 1:
        return image
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, count + 1))
    keep = int(np.argmax(sizes)) + 1
    rgba[:, :, 3] = np.where(labels == keep, rgba[:, :, 3], 0)
    ys, xs = np.where(rgba[:, :, 3] > 8)
    return Image.fromarray(rgba).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=2)
    parser.add_argument("--bg-remover", type=Path, default=DEFAULT_BG_REMOVER)
    parser.add_argument(
        "--trellis-removal",
        action="store_true",
        help="Keep the source background and let TRELLIS/U2Net remove it during generation",
    )
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGB")
    cutout = None if args.trellis_removal else load_cutout(args.bg_remover)
    args.output.mkdir(parents=True, exist_ok=True)
    for row in range(args.rows):
        top = round(row * sheet.height / args.rows)
        bottom = round((row + 1) * sheet.height / args.rows)
        for column in range(args.columns):
            left = round(column * sheet.width / args.columns)
            right = round((column + 1) * sheet.width / args.columns)
            cell = sheet.crop((left, top, right, bottom))
            index = row * args.columns + column
            destination = args.output / f"view-{index:02d}.png"
            if cutout is None:
                cell.save(destination)
                print(f"{destination.name}: {cell.width}x{cell.height}, background=trellis")
            else:
                rgba, fraction = cutout(cell, floor=0.04, edge_clean=True, min_island=180)
                rgba = keep_largest_component(rgba)
                rgba.save(destination)
                print(f"{destination.name}: {rgba.width}x{rgba.height}, alpha={fraction:.3f}")


if __name__ == "__main__":
    main()

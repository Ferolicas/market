#!/usr/bin/env python3
"""Bake PNG-sheet colours onto a Y-up mesh from eight orthographic views."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image


def normalize(mesh: trimesh.Trimesh, height: float) -> None:
    minimum, maximum = mesh.bounds
    mesh.apply_scale(height / (maximum[1] - minimum[1]))
    minimum, maximum = mesh.bounds
    center = (minimum + maximum) * 0.5
    mesh.apply_translation((-center[0], -minimum[1], -center[2]))


def sample_rgba(image: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    x = np.clip(u * (width - 1), 0, width - 1)
    y = np.clip(v * (height - 1), 0, height - 1)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.minimum(x0 + 1, width - 1)
    y1 = np.minimum(y0 + 1, height - 1)
    wx = (x - x0)[:, None]
    wy = (y - y0)[:, None]
    return (
        image[y0, x0] * (1 - wx) * (1 - wy)
        + image[y0, x1] * wx * (1 - wy)
        + image[y1, x0] * (1 - wx) * wy
        + image[y1, x1] * wx * wy
    )


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    """Convert authored PNG colours to glTF's required linear vertex-colour space."""
    return np.where(rgb <= 0.04045, rgb / 12.92, np.power((rgb + 0.055) / 1.055, 2.4))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("geometry", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--height", type=float, required=True)
    parser.add_argument("--front-override", type=Path)
    parser.add_argument(
        "--angles",
        default="0,45,90,135,180,225,270,315",
        help="Comma-separated camera azimuths matching the available view PNGs",
    )
    parser.add_argument(
        "--mirror-opposite-side",
        action="store_true",
        help="Mirror a lone -90/+90 side reference to paint the unseen opposite side",
    )
    parser.add_argument("--skin", default="#c98258")
    parser.add_argument("--bald", action="store_true")
    args = parser.parse_args()

    mesh = trimesh.load(args.geometry, force="mesh", process=False)
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(args.geometry)
    normalize(mesh, args.height)

    view_paths = sorted(args.views.glob("view-*.png"))
    angles_degrees = [float(value.strip()) for value in args.angles.split(",") if value.strip()]
    if len(view_paths) != len(angles_degrees):
        raise ValueError(
            f"Received {len(view_paths)} view PNGs but {len(angles_degrees)} camera angles"
        )
    source_images = [Image.open(path).convert("RGBA") for path in view_paths]
    if args.front_override:
        source_images[0] = Image.open(args.front_override).convert("RGBA")
    if args.mirror_opposite_side:
        side_index = next(
            (index for index, angle in enumerate(angles_degrees) if abs(abs(angle) - 90.0) < 0.1),
            None,
        )
        if side_index is None:
            raise ValueError("--mirror-opposite-side requires a -90 or +90 degree view")
        opposite_angle = -angles_degrees[side_index]
        if not any(abs(angle - opposite_angle) < 0.1 for angle in angles_degrees):
            source_images.append(source_images[side_index].transpose(Image.Transpose.FLIP_LEFT_RIGHT))
            angles_degrees.append(opposite_angle)

    images = [np.asarray(image, dtype=np.float32) / 255.0 for image in source_images]
    for image in images:
        image[..., :3] = srgb_to_linear(image[..., :3])

    angles = np.deg2rad(np.asarray(angles_degrees, dtype=np.float64))
    directions = np.stack((np.sin(angles), np.zeros_like(angles), np.cos(angles)), axis=1)
    rights = np.stack((np.cos(angles), np.zeros_like(angles), -np.sin(angles)), axis=1)
    vertices = mesh.vertices
    normals = mesh.vertex_normals
    facing = normals @ directions.T
    accumulated = np.zeros((len(vertices), 4), dtype=np.float64)
    accumulated_weight = np.zeros(len(vertices), dtype=np.float64)
    vertical_normalized = 1.0 - vertices[:, 1] / args.height
    for view_index, image in enumerate(images):
        direction = directions[view_index]
        ray_origins = vertices + direction * args.height * 3.0
        ray_directions = np.repeat((-direction)[None, :], len(vertices), axis=0)
        _, ray_indices, locations = mesh.ray.intersects_id(
            ray_origins, ray_directions, multiple_hits=False, return_locations=True
        )
        visible = np.zeros(len(vertices), dtype=bool)
        visible[ray_indices] = np.linalg.norm(locations - vertices[ray_indices], axis=1) < args.height * 0.0025

        horizontal_all = vertices @ rights[view_index]
        horizontal_min = horizontal_all.min()
        horizontal_span = max(1e-6, horizontal_all.max() - horizontal_min)
        horizontal_normalized = (horizontal_all - horizontal_min) / horizontal_span

        # The prepared PNGs intentionally retain a transparent safety margin.
        # Map the mesh silhouette into the actual alpha bounds instead of the
        # whole canvas; otherwise the texture is compressed and transparent
        # pixels are projected onto the head, hands and shoes.
        alpha = image[:, :, 3]
        foreground_y, foreground_x = np.where(alpha > 0.18)
        if len(foreground_x) == 0:
            raise ValueError(f"No alpha subject in {view_paths[min(view_index, len(view_paths) - 1)]}")
        image_height, image_width = image.shape[:2]
        left = foreground_x.min() / max(1, image_width - 1)
        right = foreground_x.max() / max(1, image_width - 1)
        top = foreground_y.min() / max(1, image_height - 1)
        bottom = foreground_y.max() / max(1, image_height - 1)
        horizontal = left + horizontal_normalized * (right - left)
        vertical = top + vertical_normalized * (bottom - top)
        sampled = sample_rgba(image, horizontal, vertical)
        usable = visible & (sampled[:, 3] > 0.18) & (facing[:, view_index] > 0.025)
        weight = np.where(usable, np.power(np.maximum(facing[:, view_index], 0.0), 4.0), 0.0)
        accumulated += sampled * weight[:, None]
        accumulated_weight += weight

    assigned = accumulated_weight > 1e-8
    colors = np.zeros((len(vertices), 4), dtype=np.float32)
    colors[assigned] = (accumulated[assigned] / accumulated_weight[assigned, None]).astype(np.float32)

    # Rare concave/unseen vertices receive the closest already painted colour.
    if not np.all(assigned):
        from scipy.spatial import cKDTree

        tree = cKDTree(vertices[assigned])
        _, nearest = tree.query(vertices[~assigned], workers=-1)
        colors[~assigned] = colors[assigned][nearest]

    if args.bald:
        skin_hex = args.skin.lstrip("#")
        skin = np.array([int(skin_hex[i : i + 2], 16) for i in (0, 2, 4)] + [255], dtype=np.float32) / 255.0
        scalp = (vertices[:, 1] > args.height * 0.91) | (
            (vertices[:, 1] > args.height * 0.84) & (vertices[:, 2] < 0.03)
        )
        colors[scalp] = skin

    rgba = np.clip(colors * 255.0, 0, 255).round().astype(np.uint8)
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=rgba)
    mesh.remove_unreferenced_vertices()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(args.output)
    print(f"Exported {args.output}: {len(mesh.vertices):,} vertices, {assigned.mean():.1%} direct coverage")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Project InstantMesh's multiview colour field onto a sharper TripoSG mesh."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree


def load_mesh(path: Path) -> trimesh.Trimesh:
    mesh = trimesh.load(path, force="mesh", process=False)
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(f"Expected a mesh at {path}")
    return mesh


def normalize_y_up(mesh: trimesh.Trimesh, height: float) -> None:
    minimum, maximum = mesh.bounds
    scale = height / (maximum[1] - minimum[1])
    mesh.apply_scale(scale)
    minimum, maximum = mesh.bounds
    center = (minimum + maximum) * 0.5
    mesh.apply_translation((-center[0], -minimum[1], -center[2]))


def orient_instantmesh(mesh: trimesh.Trimesh) -> None:
    # InstantMesh OBJ is Z-up and vertically inverted. After making it Y-up,
    # its canonical frontal view points along +X; Mini Market uses +Z.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, (0, 1, 0)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("geometry", type=Path, help="Sharp Y-up target GLB")
    parser.add_argument("colors", type=Path, help="InstantMesh vertex-colour OBJ")
    parser.add_argument("output", type=Path)
    parser.add_argument("--height", type=float, required=True)
    parser.add_argument("--neighbors", type=int, default=4)
    args = parser.parse_args()

    target = load_mesh(args.geometry)
    source = load_mesh(args.colors)
    if source.visual.kind != "vertex":
        raise ValueError(f"No vertex colours in {args.colors}")
    orient_instantmesh(source)
    normalize_y_up(target, args.height)
    normalize_y_up(source, args.height)

    tree = cKDTree(source.vertices)
    distances, indices = tree.query(target.vertices, k=args.neighbors, workers=-1)
    if args.neighbors == 1:
        colors = source.visual.vertex_colors[indices]
        mean_distance = float(np.mean(distances))
    else:
        weights = 1.0 / np.maximum(distances, 1e-5)
        weights /= weights.sum(axis=1, keepdims=True)
        source_colors = source.visual.vertex_colors[indices].astype(np.float32)
        colors = np.sum(source_colors * weights[..., None], axis=1).round().astype(np.uint8)
        mean_distance = float(np.mean(distances[:, 0]))

    target.visual = trimesh.visual.ColorVisuals(target, vertex_colors=colors)
    target.remove_unreferenced_vertices()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    target.export(args.output)
    print(
        f"Exported {args.output}: {len(target.vertices):,} vertices, "
        f"mean colour-source distance {mean_distance:.5f}"
    )


if __name__ == "__main__":
    main()

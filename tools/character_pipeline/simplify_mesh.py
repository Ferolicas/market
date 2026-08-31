#!/usr/bin/env python3
"""Create a rigging/production mesh while preserving a sculpt's silhouette."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pymeshlab
import trimesh


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--faces", type=int, default=120_000)
    args = parser.parse_args()

    if not args.input.is_file():
        raise FileNotFoundError(args.input)

    meshes = pymeshlab.MeshSet()
    meshes.load_new_mesh(str(args.input))
    before = meshes.current_mesh().face_number()
    if before > args.faces:
        meshes.apply_filter(
            "meshing_decimation_quadric_edge_collapse",
            targetfacenum=args.faces,
            qualitythr=0.55,
            preserveboundary=True,
            preservenormal=True,
            preservetopology=True,
            optimalplacement=True,
            qualityweight=True,
            autoclean=True,
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = meshes.current_mesh()
    simplified = trimesh.Trimesh(
        vertices=np.asarray(result.vertex_matrix(), dtype=np.float32),
        faces=np.ascontiguousarray(result.face_matrix()),
        vertex_normals=np.asarray(result.vertex_normal_matrix(), dtype=np.float32),
        process=False,
    )
    simplified.export(args.output)
    print(
        f"Simplified {args.input.name}: {before:,} -> {result.face_number():,} faces, "
        f"{result.vertex_number():,} vertices; exported {args.output}"
    )


if __name__ == "__main__":
    main()

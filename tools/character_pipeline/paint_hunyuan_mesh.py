#!/usr/bin/env python3
"""Texture an approved game mesh from the kit's ordered reference views."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import torch
import trimesh
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mesh", type=Path)
    parser.add_argument("views", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--hunyuan-root",
        type=Path,
        default=Path("/home/ferney_oliveros/ai-tools/Hunyuan3D-2"),
    )
    parser.add_argument("--model", default="tencent/Hunyuan3D-2")
    parser.add_argument("--subfolder", default="hunyuan3d-paint-v2-0-turbo")
    parser.add_argument("--cpu-offload", action="store_true")
    args = parser.parse_args()

    if not args.mesh.is_file():
        raise FileNotFoundError(args.mesh)
    view_paths = sorted(args.views.glob("view-*.png"))
    if not view_paths:
        raise FileNotFoundError(f"No view-*.png references in {args.views}")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the production texture pass")

    sys.path.insert(0, str(args.hunyuan_root.resolve()))
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

    print(f"Loading Hunyuan paint model {args.model}/{args.subfolder}", flush=True)
    pipeline = Hunyuan3DPaintPipeline.from_pretrained(
        args.model,
        subfolder=args.subfolder,
    )
    if args.cpu_offload:
        pipeline.enable_model_cpu_offload()

    mesh = trimesh.load(args.mesh, force="mesh", process=False)
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(f"Expected one mesh in {args.mesh}")
    references = [Image.open(path).convert("RGBA") for path in view_paths]
    print(
        f"Painting {args.mesh.name} from {len(references)} ordered kit views on "
        f"{torch.cuda.get_device_name(0)}",
        flush=True,
    )
    textured = pipeline(mesh, image=references)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    textured.export(args.output)
    print(f"Exported {args.output}", flush=True)


if __name__ == "__main__":
    main()

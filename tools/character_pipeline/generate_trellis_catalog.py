#!/usr/bin/env python3
"""Generate a catalog of textured assets while loading TRELLIS only once."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

os.environ.setdefault("ATTN_BACKEND", "xformers")
os.environ.setdefault("SPCONV_ALGO", "native")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

from trellis.pipelines import TrellisImageTo3DPipeline

from generate_trellis_multiview import generate_asset


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("references", type=Path, help="Directory containing view-00.png, view-01.png, ...")
    parser.add_argument("output", type=Path)
    parser.add_argument("--names", required=True, help="Comma-separated names in source order")
    parser.add_argument("--model", default="microsoft/TRELLIS-image-large")
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument("--simplify", type=float, default=0.95)
    parser.add_argument("--preview-frames", type=int, default=8)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()

    names = [name.strip() for name in args.names.split(",") if name.strip()]
    references = sorted(args.references.glob("view-*.png"))
    if len(names) != len(references):
        raise ValueError(f"Received {len(names)} names for {len(references)} references")

    args.output.mkdir(parents=True, exist_ok=True)
    pipeline = TrellisImageTo3DPipeline.from_pretrained(args.model)
    for index, (name, reference) in enumerate(zip(names, references, strict=True)):
        print(f"CATALOG {index + 1}/{len(names)}: {name}", flush=True)
        generate_asset(
            pipeline,
            [reference],
            args.output / f"{name}.glb",
            seed=args.seed + index,
            steps=args.steps,
            mode="stochastic",
            texture_size=args.texture_size,
            simplify=args.simplify,
            preview_frames=args.preview_frames,
            skip_glb=False,
        )


if __name__ == "__main__":
    main()

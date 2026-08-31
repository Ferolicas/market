#!/usr/bin/env python3
"""Generate an untextured reference blockout with the local TripoSG model.

The result is deliberately kept outside the shipping asset tree.  It is a
sculpting/retopology reference, never an animation-ready game character.

This runner uses TripoSG's standard scikit-image marching-cubes decoder.  It
does not use the optional non-commercial ``diso`` or FlashVDM decoders.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch
import trimesh


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="Square RGB reference image")
    parser.add_argument("output", type=Path, help="Destination .glb blockout")
    parser.add_argument(
        "--triposg-root",
        type=Path,
        default=Path("/home/ferney_oliveros/ai-tools/TripoSG"),
    )
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--guidance", type=float, default=7.0)
    parser.add_argument("--seed", type=int, default=20260830)
    parser.add_argument("--dense-depth", type=int, default=8)
    parser.add_argument("--hierarchical-depth", type=int, default=9)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    triposg_root = args.triposg_root.expanduser().resolve()
    weights = triposg_root / "pretrained_weights" / "TripoSG"
    if not args.input.is_file():
        raise FileNotFoundError(f"Missing input image: {args.input}")
    if not weights.is_dir():
        raise FileNotFoundError(f"Missing local TripoSG weights: {weights}")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this production blockout pass")

    sys.path.insert(0, str(triposg_root))
    sys.path.insert(0, str(triposg_root / "scripts"))
    from triposg.pipelines.pipeline_triposg import TripoSGPipeline
    from image_process import prepare_image

    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    # TripoSG is trained on a tightly framed subject over a neutral background.
    # Passing the square RGBA canvas straight through the DINO processor makes
    # small kit characters occupy only a fraction of the conditioning image
    # and noticeably degrades hands, shoes and facial proportions.  Reuse the
    # project's official alpha-aware preparation path; our references already
    # carry a high-quality BiRefNet mask, so no secondary RMBG network is
    # needed here.
    image = prepare_image(
        str(args.input),
        bg_color=np.array([1.0, 1.0, 1.0], dtype=np.float32),
        rmbg_net=None,
    )
    if not hasattr(image, "size"):
        raise RuntimeError(f"Could not prepare {args.input}: {image}")

    print(f"Loading TripoSG from {weights}", flush=True)
    pipeline = TripoSGPipeline.from_pretrained(str(weights))
    pipeline = pipeline.to(device="cuda", dtype=torch.float16)
    generator = torch.Generator(device="cuda").manual_seed(args.seed)

    print(
        f"Generating {args.steps} steps at octree "
        f"{args.dense_depth}/{args.hierarchical_depth}",
        flush=True,
    )
    result = pipeline(
        image=image,
        generator=generator,
        num_inference_steps=args.steps,
        guidance_scale=args.guidance,
        use_flash_decoder=False,
        dense_octree_depth=args.dense_depth,
        hierarchical_octree_depth=args.hierarchical_depth,
    )
    vertices, faces = result.samples[0]
    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float32),
        faces=np.ascontiguousarray(faces),
        process=False,
    )
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(args.output)
    print(
        f"Exported {args.output} "
        f"({len(mesh.vertices):,} vertices, {len(mesh.faces):,} faces)",
        flush=True,
    )


if __name__ == "__main__":
    main()

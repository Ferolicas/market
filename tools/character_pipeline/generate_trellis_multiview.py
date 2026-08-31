#!/usr/bin/env python3
"""Reconstruct a textured game asset from an ordered set of transparent views."""

from __future__ import annotations

import argparse
import gc
import os
from pathlib import Path

os.environ.setdefault("ATTN_BACKEND", "xformers")
os.environ.setdefault("SPCONV_ALGO", "native")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import imageio.v2 as imageio
import numpy as np
import torch
import trimesh
from PIL import Image
from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils, render_utils


def generate_asset(
    pipeline: TrellisImageTo3DPipeline,
    view_paths: list[Path],
    output: Path,
    *,
    seed: int,
    steps: int,
    mode: str,
    texture_size: int,
    simplify: float,
    preview_frames: int,
    skip_glb: bool,
) -> None:
    if not view_paths:
        raise ValueError("Expected at least one reference view")
    images = [Image.open(path).convert("RGBA") for path in view_paths]
    output.parent.mkdir(parents=True, exist_ok=True)

    run_options = {
        "seed": seed,
        "sparse_structure_sampler_params": {"steps": steps, "cfg_strength": 7.5},
        "slat_sampler_params": {"steps": steps, "cfg_strength": 3.0},
        "formats": ["mesh", "gaussian"],
    }
    outputs = (
        pipeline.run(images[0], **run_options)
        if len(images) == 1
        else pipeline.run_multi_image(images, mode=mode, **run_options)
    )
    gaussian = outputs["gaussian"][0]
    mesh = outputs["mesh"][0]

    gaussian.save_ply(output.with_suffix(".gaussian.ply"))
    raw = trimesh.Trimesh(
        vertices=mesh.vertices.detach().cpu().numpy(),
        faces=mesh.faces.detach().cpu().numpy(),
        process=False,
    )
    raw.export(output.with_suffix(".raw.glb"))

    frames = render_utils.render_video(
        gaussian,
        resolution=512,
        bg_color=(1, 1, 1),
        num_frames=preview_frames,
    )["color"]
    preview_path = output.with_suffix(".preview.mp4")
    imageio.mimsave(preview_path, frames, fps=8)
    for index, frame in enumerate(frames):
        Image.fromarray(np.asarray(frame)).save(
            output.with_name(f"{output.stem}.preview-{index:02d}.png")
        )

    if not skip_glb:
        textured = postprocessing_utils.to_glb(
            gaussian,
            mesh,
            simplify=simplify,
            fill_holes=False,
            texture_size=texture_size,
            verbose=True,
        )
        textured.export(output)

    del outputs, gaussian, mesh, raw, frames
    gc.collect()
    torch.cuda.empty_cache()
    print(f"Generated {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("views", type=Path, help="Directory containing view-00.png, view-01.png, ...")
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="microsoft/TRELLIS-image-large")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--mode", choices=("stochastic", "multidiffusion"), default="stochastic")
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument("--simplify", type=float, default=0.96)
    parser.add_argument("--preview-frames", type=int, default=16)
    parser.add_argument("--skip-glb", action="store_true")
    args = parser.parse_args()

    pipeline = TrellisImageTo3DPipeline.from_pretrained(args.model)
    generate_asset(
        pipeline,
        sorted(args.views.glob("view-*.png")),
        args.output,
        seed=args.seed,
        steps=args.steps,
        mode=args.mode,
        texture_size=args.texture_size,
        simplify=args.simplify,
        preview_frames=args.preview_frames,
        skip_glb=args.skip_glb,
    )


if __name__ == "__main__":
    main()

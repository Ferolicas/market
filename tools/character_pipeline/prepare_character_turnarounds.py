#!/usr/bin/env python3
"""Extract the four three-view owner identities from PERSONAJES.png.

The rows in the source art are intentionally packed and are not equal-height
grid cells; equal slicing cuts off feet and leaks the previous character into
the next reference.  These bounds follow the actual illustrated subjects.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from prepare_reference_views import DEFAULT_BG_REMOVER, keep_largest_component, load_cutout


ROW_BOUNDS = (
    ("adult-man", 0, 304),
    ("adult-woman", 304, 582),
    ("boy", 582, 814),
    ("girl", 814, 1024),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--remove-background", action="store_true")
    parser.add_argument("--bg-remover", type=Path, default=DEFAULT_BG_REMOVER)
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGB")
    if sheet.size != (1536, 1024):
        raise ValueError(f"Expected the 1536x1024 kit sheet, received {sheet.size}")

    cutout = load_cutout(args.bg_remover) if args.remove_background else None
    for name, top, bottom in ROW_BOUNDS:
        target = args.output / name
        target.mkdir(parents=True, exist_ok=True)
        for view in range(3):
            left = view * 512
            cell = sheet.crop((left, top, left + 512, bottom))
            destination = target / f"view-{view:02d}.png"
            if cutout is None:
                result = cell
            else:
                rgba, _ = cutout(cell, floor=0.04, edge_clean=True, min_island=180)
                subject = keep_largest_component(rgba)
                fit_scale = min(460 / subject.width, 460 / subject.height)
                subject = subject.resize(
                    (round(subject.width * fit_scale), round(subject.height * fit_scale)),
                    Image.Resampling.LANCZOS,
                )
                result = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
                result.alpha_composite(
                    subject,
                    ((512 - subject.width) // 2, (512 - subject.height) // 2),
                )
            result.save(destination)
            print(f"{name}/{destination.name}: {result.width}x{result.height}")


if __name__ == "__main__":
    main()

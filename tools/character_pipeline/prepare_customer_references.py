#!/usr/bin/env python3
"""Extract the clean neutral full-body reference from each customer sheet."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from prepare_reference_views import DEFAULT_BG_REMOVER, keep_largest_component, load_cutout


REFERENCE_BOXES = {
    1: (0, 0, 270, 320),
    2: (0, 0, 190, 390),
    3: (0, 0, 280, 370),
    4: (0, 0, 270, 340),
    5: (0, 0, 230, 345),
    6: (0, 0, 240, 330),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("kit", type=Path, help="Directory containing cliente1.png ... cliente6.png")
    parser.add_argument("output", type=Path)
    parser.add_argument("--remove-background", action="store_true")
    parser.add_argument("--bg-remover", type=Path, default=DEFAULT_BG_REMOVER)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    cutout = load_cutout(args.bg_remover) if args.remove_background else None
    for number, box in REFERENCE_BOXES.items():
        source = args.kit / f"cliente{number}.png"
        sheet = Image.open(source).convert("RGB")
        reference = sheet.crop(box)
        if cutout is not None:
            rgba, _ = cutout(reference, floor=0.04, edge_clean=True, min_island=180)
            subject = keep_largest_component(rgba)
            fit_scale = min(460 / subject.width, 460 / subject.height)
            subject = subject.resize(
                (round(subject.width * fit_scale), round(subject.height * fit_scale)),
                Image.Resampling.LANCZOS,
            )
            reference = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            reference.alpha_composite(
                subject,
                ((512 - subject.width) // 2, (512 - subject.height) // 2),
            )
        destination = args.output / f"view-{number - 1:02d}.png"
        reference.save(destination)
        print(f"{destination.name}: {reference.width}x{reference.height}")


if __name__ == "__main__":
    main()

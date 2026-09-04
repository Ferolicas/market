"""Rasterise the game's SVG icon set into sprites the Unity HUD can show.

Next draws its quick menu with sixteen stroke icons defined as SVG paths in
GameShell.tsx. The Unity client had no icons at all and fell back to three
letter captions -- INV, PED, EQ, $ -- which reads nothing like the same game.
The paths are the single source of truth, so they are rasterised here rather
than redrawn by hand: change the icon in Next and this reproduces it.
"""
from __future__ import annotations

import json, re, sys
from pathlib import Path

import cairosvg

SHELL = Path("src/components/game/GameShell.tsx")
OUT = Path("Unity/MiniMarketUnity/Assets/Resources/Icons")
SIZE = 128
STROKE = 1.9          # matches the .game-icon rule in globals.css
COLOUR = "#183B33"    # --ink; the HUD tints the sprite per state


def read_paths(source: Path) -> dict[str, list[str]]:
    text = source.read_text(encoding="utf-8")
    start = text.index("const GAME_ICON_PATHS")
    body = text[start:text.index("};", start)]
    icons: dict[str, list[str]] = {}
    # Match without consuming the trailing newline: doing so eats the next
    # entry's leading newline and silently yields every other icon.
    for name, raw in re.findall(r'^  (\w+): \[(.*?)\],$', body, re.M):
        icons[name] = re.findall(r'"([^"]+)"', raw)
    return icons


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    icons = read_paths(root / SHELL)
    if not icons:
        print(json.dumps({"error": "no se encontraron trazados"}))
        return 1
    out = root / OUT
    out.mkdir(parents=True, exist_ok=True)
    for name, paths in icons.items():
        d = "".join(f'<path d="{p}"/>' for p in paths)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
               f'width="{SIZE}" height="{SIZE}" fill="none" stroke="{COLOUR}" '
               f'stroke-width="{STROKE}" stroke-linecap="round" '
               f'stroke-linejoin="round">{d}</svg>')
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(out / f"{name}.png"),
                         output_width=SIZE, output_height=SIZE)
    print(json.dumps({"iconos": sorted(icons), "destino": str(out), "px": SIZE}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

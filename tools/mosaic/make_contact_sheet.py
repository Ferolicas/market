"""Build a review sheet: every object's reference cell beside what was produced."""
from __future__ import annotations

import json, sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def font(size):
    try:
        return ImageFont.truetype("/usr/share/fonts/liberation/LiberationSans-Bold.ttf", size)
    except Exception:
        return ImageFont.load_default()


def main() -> int:
    cells_dir = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    sheet = sys.argv[3]
    dest = Path(sys.argv[4])

    cells = json.loads((cells_dir / f"{sheet}_celdas.json").read_text())
    rows = []
    for c in cells:
        if "nombre" not in c:
            continue
        n = c["nombre"]
        res = out_dir / f"{n}.png"
        if not res.exists():
            continue
        rep = out_dir / f"{n}.json"
        info = json.loads(rep.read_text()) if rep.exists() else {}
        rows.append((n, cells_dir / f"{n}.png", res, info))

    if not rows:
        print(json.dumps({"hoja": sheet, "error": "sin resultados"}))
        return 1

    TH = 250
    cols = 3
    cw = TH * 2 + 14
    ch = TH + 34
    nrows = (len(rows) + cols - 1) // cols
    img = Image.new("RGB", (cols * cw, nrows * ch), (18, 19, 21))
    d = ImageDraw.Draw(img)
    f = font(15); fs = font(12)
    for i, (n, refp, resp, info) in enumerate(rows):
        a = Image.open(refp).convert("RGB"); b = Image.open(resp).convert("RGB")
        a.thumbnail((TH, TH), Image.LANCZOS); b.thumbnail((TH, TH), Image.LANCZOS)
        x = (i % cols) * cw; y = (i // cols) * ch
        img.paste(a, (x + (TH - a.width) // 2, y + 30 + (TH - a.height) // 2))
        img.paste(b, (x + TH + 14 + (TH - b.width) // 2, y + 30 + (TH - b.height) // 2))
        iou = info.get("iou")
        err = info.get("peor_error_srgb")
        susp = len(info.get("sospechosas", []))
        label = n.split("_")[-1]
        d.text((x + 4, y + 4), label, fill=(150, 230, 160), font=f)
        meta = []
        if iou is not None:
            meta.append(f"IoU {iou:.2f}")
        if err is not None:
            meta.append(f"err {err:.0f}")
        if susp:
            meta.append(f"{susp} dudosa(s)")
        d.text((x + 44, y + 6), "  ".join(meta),
               fill=(230, 170, 120) if susp else (140, 150, 160), font=fs)
    img.save(dest)
    print(json.dumps({"hoja": sheet, "objetos": len(rows), "salida": str(dest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

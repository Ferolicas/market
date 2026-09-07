"""Find the objects drawn on a kit sheet.

    python3 tools/kit/sheet_blobs.py <sheet.png> <blobs.json> [overlay.png] [min_area]

The sheet is objects on a flat grey ground with soft shadows. A pixel belongs to
an object when it is far from the ground colour, or clearly coloured, or
brighter than the ground; shadows are neutral and darker, so they stay out.
Blobs come out in reading order -- rows top to bottom, left to right -- which is
the numbering fit_camera.py expects, and the overlay writes that number on each.
"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw

sheet, out = sys.argv[1], sys.argv[2]
overlay = sys.argv[3] if len(sys.argv) > 3 else None
min_area = int(sys.argv[4]) if len(sys.argv) > 4 else 900

im = Image.open(sheet).convert("RGB")
a = np.asarray(im).astype(np.int16)
H, W, _ = a.shape
ring = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3),
                       a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
bg = np.median(ring, 0)
dist = np.abs(a - bg).sum(2)
croma = a.max(2) - a.min(2)
brillo = a.mean(2) - bg.mean()
mask = (dist > 60) | (croma > 26) | (brillo > 18)

# label by flood fill over runs: cheap and dependency free
lab = np.zeros((H, W), np.int32); n = 0
pila = []
for y0 in range(H):
    fila = np.flatnonzero(mask[y0] & (lab[y0] == 0))
    for x0 in fila:
        if lab[y0, x0]: continue
        n += 1; lab[y0, x0] = n; pila.append((y0, x0))
        while pila:
            y, x = pila.pop()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                v, u = y + dy, x + dx
                if 0 <= v < H and 0 <= u < W and mask[v, u] and not lab[v, u]:
                    lab[v, u] = n; pila.append((v, u))

blobs = []
for i in range(1, n + 1):
    ys, xs = np.nonzero(lab == i)
    if len(ys) < min_area: continue
    blobs.append({"x0": int(xs.min()), "y0": int(ys.min()), "x1": int(xs.max()), "y1": int(ys.max()),
                  "cx": float(xs.mean()), "cy": float(ys.mean()), "area": int(len(ys))})
# reading order: a new row whenever the box starts below the previous row's floor
blobs.sort(key=lambda b: (b["y0"], b["x0"]))
filas, fila, suelo = [], [], -1
for b in blobs:
    if fila and b["y0"] > suelo: filas.append(fila); fila = []
    fila.append(b); suelo = max(suelo, b["y1"]) if fila[:-1] else b["y1"]
if fila: filas.append(fila)
blobs = [b for f in filas for b in sorted(f, key=lambda b: b["x0"])]
json.dump({"sheet": sheet, "fondo": bg.tolist(), "blobs": blobs}, open(out, "w"), indent=1)
print("MANCHAS", len(blobs), "en", len(filas), "filas")
if overlay:
    d = ImageDraw.Draw(im)
    for i, b in enumerate(blobs):
        d.rectangle([b["x0"], b["y0"], b["x1"], b["y1"]], outline=(255, 0, 0), width=3)
        d.text((b["x0"] + 6, b["y0"] + 4), str(i), fill=(255, 0, 0))
    im.save(overlay)

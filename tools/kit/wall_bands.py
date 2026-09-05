"""Read a wall module's bands off the sheet as a vertical strip of its own pixels.

A wall's colour is bands by height: a dark cap, cream, a green stripe, a dark
base. Down each column of the front the bands sit at the same fractions to
half a percent, so the front is read column by column from the cap's top to
the base's foot, each row's median colour kept, and written as a tall strip
that is mapped onto the module by height. Perspective across the front is
measured, not assumed: the spread of the band fractions between columns.
"""
import sys
import numpy as np
from PIL import Image
sheet, x0, y0, x1, y1, xa, xb, out = sys.argv[1], *map(int, sys.argv[2:8]), sys.argv[8]
img = Image.open(sheet).convert("RGB"); crop = np.asarray(img.crop((x0, y0, x1, y1))).astype(float); H, W = crop.shape[:2]
ground = np.median(np.concatenate([crop[0], crop[-1]]), 0)
def cls(px):
    r, g, b = px; l = (r + g + b) / 3
    if abs(r - ground[0]) + abs(g - ground[1]) + abs(b - ground[2]) < 30: return "fondo"
    if g > r + 4 and g > b + 18 and 55 < l < 175: return "verde"
    if l < 95: return "oscuro"
    if r > 185 and r - b > 18: return "crema"
    return "otro"
spans = {}; profiles = []
for x in range(xa, xb, 2):
    seq = [cls(crop[y, x]) for y in range(H)]
    ys = [y for y in range(H) if seq[y] not in ("fondo", "otro")]
    if len(ys) < 20: continue
    top, bot = ys[0], ys[-1]
    # bands: first change points
    segs = []; st = top
    for y in range(top + 1, bot + 2):
        if y > bot or seq[y] != seq[st]:
            if y - st >= 3 and seq[st] != "otro": segs.append((seq[st], (st - top) / (bot - top), (y - top) / (bot - top)))
            st = y
    for nm, a, b in segs: spans.setdefault(nm, []).append((a, b))
    col = crop[top:bot + 1, x]
    profiles.append(np.array([col[int(t * (bot - top))] for t in np.linspace(0, 1, 1024)]))
for nm, sp in spans.items():
    a = np.array([s[0] for s in sp]); b = np.array([s[1] for s in sp])
    print(f"  {nm:7s} {np.median(a):.3f}-{np.median(b):.3f}  (dispersion entre columnas {a.std():.3f}/{b.std():.3f})")
strip = np.median(np.stack(profiles, 0), 0).astype(np.uint8)          # (1024, 3)
tex = np.repeat(strip[:, None, :], 16, axis=1)                          # 1024 x 16
Image.fromarray(tex).save(out)
print(f"tira {tex.shape[1]}x{tex.shape[0]} de {len(profiles)} columnas -> {out}")
for f in (0.03, 0.10, 0.13, 0.40, 0.74, 0.85, 0.96):
    c = strip[int(f * 1023)]; print(f"  v={f:.2f} #{c[0]:02X}{c[1]:02X}{c[2]:02X}")

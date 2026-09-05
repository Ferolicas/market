"""Lift a floor tile's top face out of the catalogue sheet, square on.

The sheet renders each tile in three-quarter view, so its top reads as a
rhombus. Its four corners are found by colour -- the face is lighter and warmer
than both the dark plinth under it and the grey ground behind -- and the crop is
then mapped corner to corner onto a square. What comes out is the designer's
own pixels, seen from above, ready to sit on the tile as a texture.
"""
import sys
import numpy as np
from PIL import Image

sheet, x0, y0, x1, y1, out, size = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6], int(sys.argv[7])
img = Image.open(sheet).convert("RGB")
crop = np.asarray(img.crop((x0, y0, x1, y1))).astype(int)

ground = np.median(np.concatenate([crop[0], crop[-1]]), 0)
lum = crop.mean(2)
# The face is the bright part: brighter than the ground and far above the plinth.
face = (lum > ground.mean() + 6) & (crop[:, :, 0] >= crop[:, :, 2])
ys, xs = np.nonzero(face)
if len(ys) < 500:
    raise SystemExit(f"cara no encontrada ({len(ys)} pixeles)")

# Seen in three-quarter view the face is a parallelogram standing on a corner,
# so its four corners are simply the leftmost, topmost, rightmost and lowest
# points of the mask. Extremes of x+y and x-y find the same point twice here.
print(f"  la cara ocupa x [{xs.min()},{xs.max()}]  y [{ys.min()},{ys.max()}] de un recorte de {crop.shape[1]}x{crop.shape[0]}")
corners = {
    "arriba":   (int(xs[np.argmin(ys)]), int(ys.min())),
    "derecha":  (int(xs.max()), int(ys[np.argmax(xs)])),
    "abajo":    (int(xs[np.argmax(ys)]), int(ys.max())),
    "izquierda":(int(xs.min()), int(ys[np.argmin(xs)])),
}
for k, v in corners.items():
    print(f"  esquina {k:10s} ({v[0]:4d},{v[1]:4d})")

quad = [corners["izquierda"], corners["arriba"], corners["derecha"], corners["abajo"]]
flat = [c for p in quad for c in p]
warped = img.crop((x0, y0, x1, y1)).transform((size, size), Image.QUAD, flat, Image.BICUBIC)
warped.save(out)
a = np.asarray(warped.convert("RGB")).astype(int)
print(f"  textura {size}x{size} -> {out}   color medio {tuple(a.reshape(-1,3).mean(0).round(0).astype(int))}")

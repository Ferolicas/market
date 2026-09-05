"""Second pass on a rectified tile face: take out the joints' residual lean.

After rectification each joint is within a percent of its fraction and nearly
straight, but "nearly" is what shows: a joint leaning by 0.008 of the tile is
five pixels on screen, and where two identical tiles meet, that lean turns
into a visible jog. With the face square on, every joint can now be traced
sub-pixel -- the darkest point per row, fitted to a line -- and an affine map
built that sends each line exactly onto its fraction, exactly axis-aligned.
"""
import sys
import numpy as np
from PIL import Image

src, out, nx, ny = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
img = np.asarray(Image.open(src).convert("RGB")).astype(float); size = img.shape[0]
lum = img.mean(2)

def trace(vertical, frac):
    """Points along one joint: darkest position per scanline within a window around frac."""
    pts = []
    win = int(size * 0.04)
    c = int(frac * size)
    for i in range(int(size * 0.10), int(size * 0.90)):
        seg = lum[i, c-win:c+win] if vertical else lum[c-win:c+win, i]
        seg = np.convolve(seg, np.ones(5)/5, mode="same")
        k = int(np.argmin(seg[3:-3])) + 3
        # parabolic sub-pixel
        y0, y1, y2 = seg[k-1], seg[k], seg[k+1]
        d = 0.5 * (y0 - y2) / (y0 - 2*y1 + y2) if (y0 - 2*y1 + y2) != 0 else 0.0
        pos = (c - win + k + d) / size
        pts.append((i / size, pos))
    pts = np.array(pts)
    # robust line fit: pos = a*t + b, two rounds dropping outliers
    t, p = pts[:, 0], pts[:, 1]
    for _ in range(2):
        A = np.stack([t, np.ones_like(t)], 1); a, b = np.linalg.lstsq(A, p, rcond=None)[0]
        res = p - (a*t + b); keep = np.abs(res) < 3 * np.std(res) + 1e-6
        t, p = t[keep], p[keep]
    return a, b            # pos(t) = a*t + b

tu = [k/(nx+1) for k in range(1, nx+1)]; tv = [k/(ny+1) for k in range(1, ny+1)]
V = [trace(True, f) for f in tu]     # vertical joints: x = a*y + b
Hh = [trace(False, f) for f in tv]   # horizontal joints: y = a*x + b
for f, (a, b) in zip(tu, V): print(f"  vertical en {f:.3f}: x = {b:.4f} + {a:+.4f}*y   (desvio {b + a*0.5 - f:+.4f}, inclinacion {a:+.4f})")
for f, (a, b) in zip(tv, Hh): print(f"  horizontal en {f:.3f}: y = {b:.4f} + {a:+.4f}*x   (desvio {b + a*0.5 - f:+.4f}, inclinacion {a:+.4f})")

# Joints of one family are not even parallel to each other after the first
# pass -- on the beige one vertical leans -0.0165 and the other +0.0005 -- and
# no affine map straightens two different leans. A homography does: each
# traced joint is sent onto its exact target line, sampled point by point,
# which is linear in the homography's entries. A single joint cannot fix the
# scale of its axis, so the image's own sides are pinned to 0 and 1 there.
def hom_from_lines(lines, ndims):
    A = []
    for (a, b, vertical, target) in lines:
        for t in np.linspace(0.1, 0.9, 30):
            x, y = (a*t + b, t) if vertical else (t, a*t + b)
            # target line: vertical -> x' = target ; horizontal -> y' = target
            # x' = (h0 p)/(h2 p) = target  ->  h0 p - target h2 p = 0
            if vertical: A.append([x, y, 1, 0, 0, 0, -target*x, -target*y, -target])
            else:        A.append([0, 0, 0, x, y, 1, -target*x, -target*y, -target])
    return A
rows = hom_from_lines([(a, b, True, f) for (a, b), f in zip(V, tu)] + [(a, b, False, f) for (a, b), f in zip(Hh, tv)], 2)
def pin(x, y, u, v):
    rows.append([x, y, 1, 0, 0, 0, -u*x, -u*y, -u]); rows.append([0, 0, 0, x, y, 1, -v*x, -v*y, -v])
if nx < 2: pin(0.0, 0.5, 0.0, 0.5); pin(1.0, 0.5, 1.0, 0.5)
if ny < 2: pin(0.5, 0.0, 0.5, 0.0); pin(0.5, 1.0, 0.5, 1.0)
_, _, vt = np.linalg.svd(np.array(rows)); Hm = vt[-1].reshape(3, 3); Hm /= Hm[2, 2]
Hi = np.linalg.inv(Hm)
uu, vv = np.meshgrid((np.arange(size)+.5)/size, (np.arange(size)+.5)/size)
q = np.stack([uu.ravel(), vv.ravel(), np.ones(size*size)], 1) @ Hi.T
p = q[:, :2] / q[:, 2:3]
xs = np.clip(p[:, 0]*size - .5, 0, size-1.001); ys = np.clip(p[:, 1]*size - .5, 0, size-1.001)
x0 = np.floor(xs).astype(int); y0 = np.floor(ys).astype(int); fx = (xs - x0)[:, None]; fy = (ys - y0)[:, None]
outimg = (img[y0, x0]*(1-fx)*(1-fy) + img[y0, x0+1]*fx*(1-fy) + img[y0+1, x0]*(1-fx)*fy + img[y0+1, x0+1]*fx*fy)
outimg = outimg.reshape(size, size, 3).astype(np.uint8)
Image.fromarray(outimg).save(out)
# verify
lum = outimg.astype(float).mean(2)
V2 = [trace(True, f) for f in tu]; H2 = [trace(False, f) for f in tv]
worst = max([abs(b + a*0.5 - f) for f,(a,b) in zip(tu,V2)] + [abs(b + a*0.5 - f) for f,(a,b) in zip(tv,H2)])
lean = max([abs(a) for a,b in V2] + [abs(a) for a,b in H2])
print(f"  tras la pasada: desvio max {worst:.4f}, inclinacion max {lean:.4f}  -> {out}")

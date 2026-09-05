"""Lift a floor tile's face off the catalogue sheet, square on, by its joints.

The sheet is an orthographic isometric render, so every joint of a family is
parallel to the rest and the face is an affine image of the tile, not a
projective one. The joints are the one thing on it that can be found exactly:
dark straight lines, two families, running edge to edge. Each family's
direction becomes an axis; where a family has two joints their spacing sets
that axis's scale, and where it has one the scale comes from how far the other
family's joints run, since they cross the whole face. The outline is never
used -- its corners are rounded and its mask drags in the kerb.

The check is on the output: each joint within half a percent of its fraction,
and straight from one side to the other.
"""
import sys, math
import numpy as np
from PIL import Image, ImageDraw

sheet, x0, y0, x1, y1 = sys.argv[1], *map(int, sys.argv[2:6])
out, size, nx, ny = sys.argv[6], int(sys.argv[7]), int(sys.argv[8]), int(sys.argv[9])
img = Image.open(sheet).convert("RGB")
crop = np.asarray(img.crop((x0, y0, x1, y1))).astype(float)
H, W = crop.shape[:2]
ground = np.median(np.concatenate([crop[0], crop[-1]]), 0)
lum = crop.mean(2); chroma = crop[:, :, 0] - crop[:, :, 2]
face = (lum > ground.mean() + 8) | (chroma > (ground[0] - ground[2]) + 14)
def shift_all(m, k, op):
    o = m.copy()
    for dy in range(-k, k+1):
        for dx in range(-k, k+1):
            o = op(o, np.roll(np.roll(m, dy, 0), dx, 1))
    return o
face = shift_all(shift_all(face, 3, np.logical_or), 3, np.logical_and)
inner = face
for _ in range(7):
    inner = inner & np.roll(inner, 1, 0) & np.roll(inner, -1, 0) & np.roll(inner, 1, 1) & np.roll(inner, -1, 1)
thr = np.percentile(lum[inner], 9)
jy, jx = np.nonzero(inner & (lum < thr))
J = np.stack([jx, jy], 1).astype(float)
print(f"cara {face.sum()} px, junta {len(J)} px")

# ---- two joint directions: the angles whose projection histogram peaks hardest
def peakiness(theta):
    n = np.array([math.cos(theta), math.sin(theta)]); d = J @ n
    h, _ = np.histogram(d, bins=int((d.max() - d.min()) / 1.5) + 1)
    return np.sort(h)[-3:].sum() / len(d)
angs = np.radians(np.arange(0, 180, 0.5)); sc = np.array([peakiness(t) for t in angs])
fams = []
for i in np.argsort(-sc):
    if all(min(abs(angs[i] - a), math.pi - abs(angs[i] - a)) > math.radians(30) for a in fams): fams.append(angs[i])
    if len(fams) == 2: break
def lines(theta, count):
    n = np.array([math.cos(theta), math.sin(theta)]); d = J @ n
    h, be = np.histogram(d, bins=int((d.max() - d.min()) / 1.5) + 1); h = np.convolve(h, np.ones(3) / 3, mode="same")
    peaks = []
    for i in np.argsort(-h):
        c = (be[i] + be[i+1]) / 2
        if all(abs(c - p) > (d.max() - d.min()) * 0.12 for p in peaks): peaks.append(c)
        if len(peaks) == count: break
    # refine: fit the pixels near each peak
    out = []
    for r in sorted(peaks):
        sel = J[np.abs(d - r) < 4]
        c = sel.mean(0); _, _, vt = np.linalg.svd(sel - c); dv = vt[0]
        nn = np.array([-dv[1], dv[0]]); nn /= np.linalg.norm(nn)
        if nn @ n < 0: nn = -nn
        out.append((nn, float(nn @ c), sel))
    return out
# which family has how many lines: try both assignments, keep the one whose peaks are cleanest
famA, famB = fams
LA = lines(famA, ny); LB = lines(famB, nx)       # A -> horizontal joints (v), B -> vertical joints (u)
alt_A = lines(famA, nx); alt_B = lines(famB, ny)
def clean(ls): return np.mean([len(s) for _, _, s in ls])
if nx != ny and clean(alt_A) + clean(alt_B) > clean(LA) + clean(LB):
    famA, famB = famB, famA; LA, LB = lines(famA, ny), lines(famB, nx)
nA = LA[0][0]; nB = LB[0][0]
# consistent normals per family
LA = [(nA, float(nA @ (s.mean(0))), s) for _, _, s in LA]; LB = [(nB, float(nB @ (s.mean(0))), s) for _, _, s in LB]
LA.sort(key=lambda t: t[1]); LB.sort(key=lambda t: t[1])

# ---- scale per axis: from joint spacing where there are two, else from the other family's joint length
def spacing_scale(L, count):    # pixels per unit of the axis
    return (L[-1][1] - L[0][1]) / ((count - 1) / (count + 1)) if count >= 2 else None
fy_, fx_ = np.nonzero(face); F = np.stack([fx_, fy_], 1).astype(float)
def extent_scale(Lother, n_axis):
    # How far the other family's joints run along this axis. The joint pixels
    # themselves stop short of the rim, so the face mask is walked instead:
    # its pixels within a hair of the line, end to end.
    ext = []
    for n, r, _ in Lother:
        band = F[np.abs(F @ n - r) < 2.5]
        p = band @ n_axis; ext.append(np.percentile(p, 99.5) - np.percentile(p, 0.5))
    return float(np.mean(ext))
sv = spacing_scale(LA, ny) or extent_scale(LB, nA)
su = spacing_scale(LB, nx) or extent_scale(LA, nB)
# origin: u = k/(nx+1) at the k-th B line; v likewise
u_of = lambda p: 1/(nx+1) + (nB @ p - LB[0][1]) / su
v_of = lambda p: 1/(ny+1) + (nA @ p - LA[0][1]) / sv
print(f"familias: v-normal ({nA[0]:+.3f},{nA[1]:+.3f}) {len(LA)} juntas, escala {sv:.1f} px/u;  u-normal ({nB[0]:+.3f},{nB[1]:+.3f}) {len(LB)} juntas, escala {su:.1f} px/u")

# ---- affine map p -> (u,v):  [u;v] = M p + t
M = np.array([nB / su, nA / sv]); t = np.array([1/(nx+1) - (nB @ np.zeros(2) + LB[0][1]) / su, 1/(ny+1) - LA[0][1] / sv])
# keep image handedness: if the map mirrors, flip u
if np.linalg.det(M) < 0:
    M[0] = -M[0]; t[0] = 1 - t[0]
Mi = np.linalg.inv(M)
uu, vv = np.meshgrid((np.arange(size) + .5) / size, (np.arange(size) + .5) / size)
q = np.stack([uu.ravel(), vv.ravel()], 0) - t[:, None]
p = Mi @ q
# Detection ran on the tight crop; sampling reads the whole sheet, so the
# face's far panels and rim are not cut off at the crop's edge.
full = np.asarray(img).astype(np.uint8)
xi = np.clip(np.round(p[0] + x0).astype(int), 0, full.shape[1] - 1)
yi = np.clip(np.round(p[1] + y0).astype(int), 0, full.shape[0] - 1)
outimg = full[yi, xi].reshape(size, size, 3)
Image.fromarray(outimg).save(out)

# ---- debug overlay
dbg = img.crop((x0, y0, x1, y1)).convert("RGB").resize((W*3, H*3)); dd = ImageDraw.Draw(dbg)
def draw(n, r, col):
    if abs(n[1]) > 1e-6: xs_ = [0, W]; ys_ = [(r - n[0]*x)/n[1] for x in xs_]
    else: ys_ = [0, H]; xs_ = [r/n[0]]*2
    dd.line([(xs_[0]*3, ys_[0]*3), (xs_[1]*3, ys_[1]*3)], fill=col, width=2)
for n, r, _ in LA: draw(n, r, (0, 90, 255))
for n, r, _ in LB: draw(n, r, (255, 0, 0))
for (u, v) in [(0,0),(1,0),(1,1),(0,1)]:
    pp = Mi @ (np.array([u, v]) - t); dd.ellipse([pp[0]*3-5, pp[1]*3-5, pp[0]*3+5, pp[1]*3+5], outline=(0,200,0), width=2)
dbg.save(out.replace(".png", "_debug.png"))

# ---- verify on the output
g = outimg.astype(float).mean(2)
def dips1(prof, n):
    prof = np.convolve(prof, np.ones(9)/9, mode="same"); lo, hi = int(len(prof)*.08), int(len(prof)*.92)
    pr = prof.copy(); pr[:lo] = 1e9; pr[hi:] = 1e9; idx = []
    for i in np.argsort(pr):
        if pr[i] >= 1e9: break
        if all(abs(i-j) > len(prof)*0.12 for j in idx): idx.append(i)
        if len(idx) == n: break
    return sorted(i/len(prof) for i in idx)
ju = dips1(g[int(size*.15):int(size*.85), :].mean(0), nx); jv = dips1(g[:, int(size*.15):int(size*.85)].mean(1), ny)
jl = dips1(g[:, int(size*.12):int(size*.45)].mean(1), ny); jr = dips1(g[:, int(size*.55):int(size*.88)].mean(1), ny)
jt = dips1(g[int(size*.12):int(size*.45), :].mean(0), nx); jb = dips1(g[int(size*.55):int(size*.88), :].mean(0), nx)
tu = [k/(nx+1) for k in range(1, nx+1)]; tv = [k/(ny+1) for k in range(1, ny+1)]
print(f"salida {size}: juntas u {['%.3f'%v for v in ju]} (obj {['%.3f'%v for v in tu]})  v {['%.3f'%v for v in jv]} (obj {['%.3f'%v for v in tv]})")
print(f"   rectitud: horizontales izq/der {['%+.3f'%(r-l) for l,r in zip(jl,jr)]}   verticales arriba/abajo {['%+.3f'%(b-t) for t,b in zip(jt,jb)]}")

"""Lift both floor tiles' faces off the catalogue sheet, square on.

The sheet is a perspective render: along either axis the beige's three panels
measure 0.28, 0.31 and 0.36 of the face, growing towards the camera. So the
face is a projective image of the tile, and the joints -- dark, straight,
exactly at thirds on the designer's tile -- pin it down. The beige has two
joints each way, whose four crossings fix its homography outright. The white
has one joint one way and two the other, which is not enough on its own; but
it stands on the same plane in the same render, so the beige's homography is
the camera, and the white's two crossings place it on that plane. Its width
comes from its own mesh, 0.1061 against a depth of 0.1478. No outline is used
anywhere: the corners are rounded and the mask drags in the kerb.
"""
import sys, math
import numpy as np
from PIL import Image

sheet = sys.argv[1]; out_b, out_w = sys.argv[2], sys.argv[3]; size = int(sys.argv[4])
BEIGE = (985, 65, 1295, 290); WHITE = (1288, 100, 1530, 275)
WHITE_ASPECT = 0.1061 / 0.1478            # width along its single joint's axis over depth
img = Image.open(sheet).convert("RGB"); full = np.asarray(img).astype(np.uint8)

def joint_pixels(box):
    x0, y0, x1, y1 = box
    crop = np.asarray(img.crop(box)).astype(float)
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
    # A joint is a thin dark valley with face on both sides. An edge -- face to
    # ground on the far side, rim to kerb on the near -- is a step, and the
    # darkest-pixels rule mistakes both for joints. The black-hat of the
    # luminance (its closing minus itself) answers only to valleys narrower
    # than the window, which is what a joint is and an edge is not.
    def maxf(a, k):
        o = a.copy()
        for dy in range(-k, k+1):
            for dx in range(-k, k+1):
                o = np.maximum(o, np.roll(np.roll(a, dy, 0), dx, 1))
        return o
    def minf(a, k):
        o = a.copy()
        for dy in range(-k, k+1):
            for dx in range(-k, k+1):
                o = np.minimum(o, np.roll(np.roll(a, dy, 0), dx, 1))
        return o
    blackhat = minf(maxf(lum, 4), 4) - lum
    resp = blackhat[inner]
    thr = max(np.percentile(resp, 92), 5.0)
    jy, jx = np.nonzero(inner & (blackhat > thr) & (lum > 110))
    return np.stack([jx + x0, jy + y0], 1).astype(float)      # sheet coordinates

def families(J):
    def peakiness(theta):
        n = np.array([math.cos(theta), math.sin(theta)]); d = J @ n
        h, _ = np.histogram(d, bins=int((d.max() - d.min()) / 1.5) + 1)
        return np.sort(h)[-3:].sum() / len(d)
    angs = np.radians(np.arange(0, 180, 0.5)); sc = np.array([peakiness(t) for t in angs])
    fams = []
    for i in np.argsort(-sc):
        if all(min(abs(angs[i] - a), math.pi - abs(angs[i] - a)) > math.radians(30) for a in fams): fams.append(angs[i])
        if len(fams) == 2: break
    return fams

def lines(J, theta, count):
    n = np.array([math.cos(theta), math.sin(theta)]); d = J @ n
    h, be = np.histogram(d, bins=int((d.max() - d.min()) / 1.5) + 1); h = np.convolve(h, np.ones(3)/3, mode="same")
    peaks = []
    for i in np.argsort(-h):
        c = (be[i] + be[i+1]) / 2
        if all(abs(c - p) > (d.max() - d.min()) * 0.12 for p in peaks): peaks.append(c)
        if len(peaks) == count: break
    out = []
    for r in sorted(peaks):
        sel = J[np.abs(d - r) < 4]
        c = sel.mean(0); _, _, vt = np.linalg.svd(sel - c); dv = vt[0]
        nn = np.array([-dv[1], dv[0]]); nn /= np.linalg.norm(nn)
        if nn @ n < 0: nn = -nn
        out.append((nn, float(nn @ c), len(sel)))
    return out

def inter(l1, l2):
    (n1, r1, _), (n2, r2, _) = l1, l2
    return np.linalg.solve(np.array([n1, n2]), np.array([r1, r2]))

def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([-x, -y, -1, 0, 0, 0, u*x, u*y, u]); A.append([0, 0, 0, -x, -y, -1, v*x, v*y, v])
    _, _, vt = np.linalg.svd(np.array(A)); Hm = vt[-1].reshape(3, 3); return Hm / Hm[2, 2]

def apply(Hm, pts):     # pts (N,2) -> (N,2)
    p = np.concatenate([pts, np.ones((len(pts), 1))], 1) @ Hm.T
    return p[:, :2] / p[:, 2:3]

def resample(map_uv_to_sheet, out):
    uu, vv = np.meshgrid((np.arange(size) + .5) / size, (np.arange(size) + .5) / size)
    q = np.stack([uu.ravel(), vv.ravel()], 1)
    p = map_uv_to_sheet(q)
    xi = np.clip(np.round(p[:, 0]).astype(int), 0, full.shape[1] - 1); yi = np.clip(np.round(p[:, 1]).astype(int), 0, full.shape[0] - 1)
    im = full[yi, xi].reshape(size, size, 3); Image.fromarray(im).save(out); return im

def verify(im, nx, ny, label):
    g = im.astype(float).mean(2)
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
    print(f"{label}: juntas u {['%.3f'%v for v in ju]} (obj {['%.3f'%v for v in tu]})  v {['%.3f'%v for v in jv]} (obj {['%.3f'%v for v in tv]})")
    print(f"   rectitud: horizontales izq/der {['%+.3f'%(r-l) for l,r in zip(jl,jr)]}   verticales arriba/abajo {['%+.3f'%(b-t) for t,b in zip(jt,jb)]}")

from PIL import ImageDraw
def overlay(box, Ls, crossings, path):
    x0, y0, x1, y1 = box
    dbg = img.crop(box).convert("RGB").resize(((x1-x0)*3, (y1-y0)*3)); dd = ImageDraw.Draw(dbg)
    for (n, r, sup), col in Ls:
        rr = r - n[0]*x0 - n[1]*y0
        if abs(n[1]) > 1e-6: xs_ = [0, x1-x0]; ys_ = [(rr - n[0]*x)/n[1] for x in xs_]
        else: ys_ = [0, y1-y0]; xs_ = [rr/n[0]]*2
        dd.line([(xs_[0]*3, ys_[0]*3), (xs_[1]*3, ys_[1]*3)], fill=col, width=2)
    for (px, py) in crossings:
        px -= x0; py -= y0; dd.ellipse([px*3-5, py*3-5, px*3+5, py*3+5], outline=(0, 200, 0), width=2)
    dbg.save(path)

# ---------- beige: four joint crossings -> homography
Jb = joint_pixels(BEIGE); fA, fB = families(Jb)
LA = lines(Jb, fA, 2); LB = lines(Jb, fB, 2)
print("beige familias:", [f"{math.degrees(a):.1f}" for a in (fA, fB)],
      " A:", [f"r={r:.1f} sup={s}" for _, r, s in LA], " B:", [f"r={r:.1f} sup={s}" for _, r, s in LB])
# family A lines -> v = 1/3, 2/3 ; family B lines -> u = 1/3, 2/3  (which is which is arbitrary for a 3x3)
src = []; dst = []
for i, la in enumerate(LA):
    for j, lb in enumerate(LB):
        src.append(inter(la, lb)); dst.append(((j+1)/3, (i+1)/3))
overlay(BEIGE, [(l, (0, 90, 255)) for l in LA] + [(l, (255, 0, 0)) for l in LB], src, out_b.replace(".png", "_debug.png"))
Hb = homography(np.array(src), np.array(dst))            # sheet px -> beige unit square
if np.linalg.det(Hb[:2, :2]) < 0:                        # keep handedness: no mirrored texture
    flip = np.array([[-1, 0, 1], [0, 1, 0], [0, 0, 1]], float); Hb = flip @ Hb
Hbi = np.linalg.inv(Hb)
print(f"beige: {len(src)} cruces; reproyeccion max {np.abs(apply(Hb, np.array(src)) - np.array(dst)).max():.5f}")
imb = resample(lambda q: apply(Hbi, q), out_b)
verify(imb, 2, 2, "beige")

# ---------- white: same camera, placed by its two crossings
Jw = joint_pixels(WHITE); gA, gB = families(Jw)
# the family with two lines is v (depth), the one with one line is u
c2A = lines(Jw, gA, 2); c1B = lines(Jw, gB, 1); c2B = lines(Jw, gB, 2); c1A = lines(Jw, gA, 1)
if c2A[0][2] + c2A[1][2] + c1B[0][2] >= c2B[0][2] + c2B[1][2] + c1A[0][2]:
    Lv, Lu = c2A, c1B
else:
    Lv, Lu = c2B, c1A
print("blanca familias:", [f"{math.degrees(a):.1f}" for a in (gA, gB)],
      " v:", [f"r={r:.1f} sup={s}" for _, r, s in Lv], " u:", [f"r={r:.1f} sup={s}" for _, r, s in Lu])
overlay(WHITE, [(l, (0, 90, 255)) for l in Lv] + [(l, (255, 0, 0)) for l in Lu],
        [inter(Lv[0], Lu[0]), inter(Lv[1], Lu[0])], out_w.replace(".png", "_debug.png"))
p1 = apply(Hb, np.array([inter(Lv[0], Lu[0])]))[0]      # on the ground plane, beige units: (u=1/2, v=1/3)
p2 = apply(Hb, np.array([inter(Lv[1], Lu[0])]))[0]      # (u=1/2, v=2/3)
ev = p2 - p1; depth = np.linalg.norm(ev) * 3.0; ev /= np.linalg.norm(ev)
eu = np.array([ev[1], -ev[0]]); width = depth * WHITE_ASPECT
# snap the axes to the beige's: the tiles sit square on the sheet, and the residual angle is measurement noise
ang = math.degrees(math.atan2(ev[1], ev[0]))
print(f"blanca: eje v a {ang:+.1f} grados del beige; fondo {depth:.3f} y ancho {width:.3f} en unidades del beige")
def white_uv_to_sheet(q):
    g = p1[None, :] + (q[:, 1:2] - 1/3) * depth * ev[None, :] + (q[:, 0:1] - 1/2) * width * eu[None, :]
    return apply(Hbi, g)
imw = resample(white_uv_to_sheet, out_w)
# the u axis sign is arbitrary from eu's construction: if the image came out mirrored against the beige, flip it
verify(imw, 1, 2, "blanca")

"""Project a kit sheet onto the parts of a Tripo mosaic.

    blender -b -P tools/kit/project_part.py -- <mosaic.glb> <sheet.png> <P.npy> <jobs.json> <outdir>

jobs.json is a list of {"parte": "tripo_part_N" | [several], "nombre": "AssetName",
"caras": 8000, "espejo": ""|"x"|"y"|"auto", "giro": 0, "margen": 6, "clases": 0}.
Every job writes <outdir>/<nombre>.glb with <outdir>/<nombre>.png embedded.

The sheet is the source: the mosaic was reconstructed from it. Every object on
the sheet was drawn with the same camera orientation, so each part gets its own
orthographic camera -- a viewing direction and a 2D map onto the sheet --
started from the global projective fit P (tools/kit/fit_camera.py) and refined
by silhouette against the part's own blob. Faces that camera sees take their
UVs at their projection, i.e. the sheet's own pixels; a face just behind the
seen surface (the scan's second layer) takes the same projection; the hidden
side of a symmetric piece is the seen side reflected; whatever remains borrows
the colour of the nearest seen face as a flat swatch. The mesh is welded,
decimated to the face budget, squared in yaw and re-centred; the texture is the
sheet crop (ground and shadow painted over with object colour) plus the swatch
strip, embedded in the GLB.
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, sheet, pfile, jobfile, outdir = argv[0], argv[1], argv[2], argv[3], argv[4]
jobs = json.load(open(jobfile))
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# ---------------------------------------------------------------- the sheet
img = bpy.data.images.load(sheet)
W, H = img.size
px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px)
sheet_rgb = (px.reshape(H, W, 4)[::-1, :, :3] * 255).round().astype(np.int16)   # rows top-down
bpy.data.images.remove(img)
ring = np.concatenate([sheet_rgb[:8].reshape(-1, 3), sheet_rgb[-8:].reshape(-1, 3),
                       sheet_rgb[:, :8].reshape(-1, 3), sheet_rgb[:, -8:].reshape(-1, 3)])
bg = np.median(ring, 0)
# Object against the grey ground: far from grey, or coloured, or brighter than
# the ground. Shadows are neutral and darker, and stay out.
# (A light grey object on the light grey ground differs by 40 or so; the
# shadows measured under the furniture stay below 30.)
objmask = ((np.abs(sheet_rgb - bg).sum(2) > 40) | ((sheet_rgb.max(2) - sheet_rgb.min(2)) > 12)
           | (sheet_rgb.mean(2) > bg.mean() + 12))

P0 = np.load(pfile)


def yaw_angle(V):
    """Turn (degrees about z) that squares the part: the minimum-area rectangle of its plan."""
    Q = np.unique(V[:, :2], axis=0); Q = Q[np.lexsort((Q[:, 1], Q[:, 0]))]
    def cross2(a, b): return a[0] * b[1] - a[1] * b[0]
    def half(pts):
        h = []
        for p in pts:
            while len(h) >= 2 and cross2(h[-1] - h[-2], p - h[-2]) <= 1e-12: h.pop()
            h.append(p)
        return h
    Hl = np.array(half(Q)[:-1] + half(Q[::-1])[:-1])
    best = (1e9, 0.0)
    for i in range(len(Hl)):
        e = Hl[(i + 1) % len(Hl)] - Hl[i]; a = math.atan2(e[1], e[0])
        c, s = math.cos(-a), math.sin(-a)
        X, Y = Hl[:, 0] * c - Hl[:, 1] * s, Hl[:, 0] * s + Hl[:, 1] * c
        ar = (X.max() - X.min()) * (Y.max() - Y.min())
        if ar < best[0]: best = (ar, a)
    deg = math.degrees(-best[1]) % 90
    if deg > 45: deg -= 90
    return deg


def basis(az, el):
    """Viewing direction d (camera towards object), image right r and image up u."""
    a, e = math.radians(az), math.radians(el)
    d = -np.array([math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)])
    r = np.cross(d, np.array([0.0, 0.0, 1.0])); r /= np.linalg.norm(r)
    u = np.cross(r, d)
    return d, r, u


def process(job):
    part, name = job["parte"], job["nombre"]
    budget = int(job.get("caras", 8000)); mirror = job.get("espejo", ""); extra_turn = float(job.get("giro", 0))
    margin = int(job.get("margen", 6))
    dst = os.path.join(outdir, name + ".glb"); tex_out = os.path.join(outdir, name + ".png")
    parts = part if isinstance(part, list) else [part]
    # work on copies: the mosaic's own objects stay untouched for later jobs
    bpy.ops.object.select_all(action="DESELECT")
    copies = []
    for pn in parts:
        o = bpy.data.objects[pn]; c = o.copy(); c.data = o.data.copy(); c.name = name + "_" + pn
        bpy.context.collection.objects.link(c); c.select_set(True); copies.append(c)
    keep = copies[0]
    bpy.context.view_layer.objects.active = keep
    if len(parts) > 1:
        bpy.ops.object.join()        # a scan cut one object into several parts
        keep = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    part = parts[0] if len(parts) == 1 else "+".join(parts)
    before = len(keep.data.polygons)

    # ---------------------------------------------------------------- clean + decimate
    # The scan is welded once; from that base the piece is built twice. Finding
    # the camera means rasterising the mesh a couple of hundred times, so it is
    # done on a light copy; the piece that ships keeps as many faces as its
    # budget allows, because collapsing a kit piece to a tenth of its faces is
    # what rounds its edges into a melted lump.
    mesh = keep.data
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(mesh); bm.free(); mesh.update()
    base_mesh = mesh.copy()

    def construye(presupuesto):
        keep.data = base_mesh.copy()
        m = keep.data
        if 0 < presupuesto < len(m.polygons):
            mod = keep.modifiers.new("d", "DECIMATE")
            mod.decimate_type = "COLLAPSE"; mod.ratio = presupuesto / len(m.polygons)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        m = keep.data
        b = bmesh.new(); b.from_mesh(m)
        bmesh.ops.triangulate(b, faces=b.faces)
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
        b.to_mesh(m); b.free(); m.update()
        n_v = len(m.vertices); Vv = np.empty(n_v * 3, np.float32); m.vertices.foreach_get("co", Vv)
        Vv = Vv.reshape(n_v, 3).astype(np.float64)
        n_f = len(m.polygons); ls = np.empty(n_f, np.int32); m.polygons.foreach_get("loop_start", ls)
        lo_ = np.empty(len(m.loops), np.int32); m.loops.foreach_get("vertex_index", lo_)
        return m, Vv, n_v, n_f, ls, lo_[ls[:, None] + np.arange(3)]

    ligera = int(job.get("caras_camara", 8000))
    mesh, V, nv, nf, LS, F = construye(min(ligera, budget) if budget else ligera)

    # ---------------------------------------------------------------- the camera
    # Start: the global projective fit, seen from this part -- its direction to
    # the camera centre, and the 2D map that best matches its projection.
    h = np.c_[V, np.ones(nv)] @ P0.T; uv0 = h[:, :2] / h[:, 2:3]
    if np.abs(P0[2, :3]).max() < 1e-9:
        # an affine sheet camera: one direction, normal to both image rows,
        # on the side the sheets are drawn from (in front of the objects, -y)
        cd = np.cross(P0[0, :3], P0[1, :3]); cd /= np.linalg.norm(cd)
        if cd[1] > 0: cd = -cd
    else:
        Cc = -np.linalg.solve(P0[:, :3], P0[:, 3])
        cd = Cc - V.mean(0); cd /= np.linalg.norm(cd)
    az0 = math.degrees(math.atan2(cd[0], -cd[1])); el0 = math.degrees(math.asin(max(-1, min(1, cd[2]))))
    if "az" in job: az0 = float(job["az"])
    if "el" in job: el0 = float(job["el"])
    fixed_dir = "az" in job or "el" in job
    def ortho(az, el):
        d, r, u = basis(az, el)
        return np.c_[V @ r, -(V @ u)], d
    q0, _ = ortho(az0, el0)
    Aq = np.c_[q0, np.ones(nv)]
    sol, *_ = np.linalg.lstsq(Aq, uv0, rcond=None)      # uv ~ q @ L + t
    L0, t0 = sol[:2].copy(), sol[2].copy()
    cen = uv0.mean(0)

    state = {"az": az0, "el": el0, "L": L0, "t": t0}
    def project(X, st=None):
        st = st or state
        d, r, u = basis(st["az"], st["el"])
        q = np.c_[X @ r, -(X @ u)]
        return q @ st["L"] + st["t"], X @ d

    x0 = max(0, int(uv0[:, 0].min()) - 40); x1 = min(W, int(uv0[:, 0].max()) + 41)
    y0 = max(0, int(uv0[:, 1].min()) - 40); y1 = min(H, int(uv0[:, 1].max()) + 41)

    def raster(uv, scale, depth=None):
        """Coverage (or id/depth buffers) of the triangles in window pixels at `scale`."""
        T = (uv[F] - (x0, y0)) * scale
        hh, ww = int((y1 - y0) * scale), int((x1 - x0) * scale)
        cov = np.zeros((hh, ww), bool)
        idb = np.full((hh, ww), -1, np.int32) if depth is not None else None
        zb = np.full((hh, ww), np.inf) if depth is not None else None
        Z = depth[F] if depth is not None else None
        for i in range(len(T)):
            a, b, c = T[i]
            bx0 = max(int(math.floor(min(a[0], b[0], c[0]))), 0); bx1 = min(int(math.ceil(max(a[0], b[0], c[0]))), ww - 1)
            by0 = max(int(math.floor(min(a[1], b[1], c[1]))), 0); by1 = min(int(math.ceil(max(a[1], b[1], c[1]))), hh - 1)
            if bx1 < bx0 or by1 < by0: continue
            dd = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(dd) < 1e-9: continue
            X, Y = np.meshgrid(np.arange(bx0, bx1 + 1) + 0.5, np.arange(by0, by1 + 1) + 0.5)
            l0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / dd
            l1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / dd
            l2 = 1 - l0 - l1
            inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            if depth is None:
                cov[by0:by1 + 1, bx0:bx1 + 1] |= inside
            else:
                zz = l0 * Z[i, 0] + l1 * Z[i, 1] + l2 * Z[i, 2]
                sub = zb[by0:by1 + 1, bx0:bx1 + 1]
                upd = inside & (zz < sub)
                sub[upd] = zz[upd]
                idb[by0:by1 + 1, bx0:bx1 + 1][upd] = i
        return cov if depth is None else (idb, zb)

    def shrink(mask, scale):
        k = int(round(1 / scale)); m = mask[:(mask.shape[0] // k) * k, :(mask.shape[1] // k) * k]
        return m.reshape(m.shape[0] // k, k, m.shape[1] // k, k).max((1, 3))

    # The part's own blob: whole pieces of the object mask that mostly overlap
    # the projection are the part's own; a piece that merges the part with a
    # neighbour on the sheet is kept only within reach of the projection.
    # The ground is not one grey across a sheet: the window's own outer ring
    # says what ground looks like here, and object is what stands out from it
    # by more than the ring's own spread (its 99th percentile plus a margin).
    wr = sheet_rgb[y0:y1, x0:x1]
    ringw = np.concatenate([wr[:6].reshape(-1, 3), wr[-6:].reshape(-1, 3), wr[:, :6].reshape(-1, 3), wr[:, -6:].reshape(-1, 3)])
    lbg = np.median(ringw, 0)
    rd = np.abs(ringw - lbg).sum(1); rc = ringw.max(1) - ringw.min(1); rl = ringw.mean(1) - lbg.mean()
    def robust(v, floor, margin):      # median + 5 MAD: a neighbour touching the ring cannot pull it up
        m = np.median(v); return max(floor, m + 5 * np.median(np.abs(v - m)) + margin)
    td = robust(rd, 40.0, 12); tc = robust(rc, 12.0, 5); tl = robust(rl, 12.0, 6)
    win = ((np.abs(wr - lbg).sum(2) > td) | ((wr.max(2) - wr.min(2)) > tc) | (wr.mean(2) > lbg.mean() + tl))
    uvs, _ = project(V)
    sil0 = raster(uvs, 1.0)
    grow = sil0.copy()
    for dy in (-3, 0, 3):
        for dx in (-3, 0, 3):
            grow |= np.roll(np.roll(sil0, dy, 0), dx, 1)
    near = sil0.copy()
    for _ in range(8):
        n2 = near.copy()
        for dy in (-3, 0, 3):
            for dx in (-3, 0, 3):
                n2 |= np.roll(np.roll(near, dy, 0), dx, 1)
        near = n2
    lab = np.zeros(win.shape, np.int32); ncomp = 0
    hh, ww = win.shape
    for yy in range(hh):
        for xx in range(ww):
            if win[yy, xx] and lab[yy, xx] == 0:
                ncomp += 1; stack = [(yy, xx)]; lab[yy, xx] = ncomp
                while stack:
                    cy, cx = stack.pop()
                    for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                        if 0 <= ny < hh and 0 <= nx < ww and win[ny, nx] and lab[ny, nx] == 0:
                            lab[ny, nx] = ncomp; stack.append((ny, nx))
    partmask = np.zeros(win.shape, bool)
    for i in range(1, ncomp + 1):
        comp = lab == i
        ov = (comp & grow).sum()
        if ov >= 0.3 * comp.sum():
            partmask |= comp
        elif ov > 0:
            partmask |= comp & near
    # Glass and pale panels read as ground: whatever ground the window's border
    # cannot reach lies inside the object and is filled in.
    reach = np.zeros(win.shape, bool)
    stack = [(yy, xx) for yy in range(hh) for xx in (0, ww - 1)] + [(yy, xx) for xx in range(ww) for yy in (0, hh - 1)]
    for yy, xx in stack:
        if not partmask[yy, xx]: reach[yy, xx] = True
    stack = [(yy, xx) for yy, xx in stack if reach[yy, xx]]
    while stack:
        cy, cx = stack.pop()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < hh and 0 <= nx < ww and not partmask[ny, nx] and not reach[ny, nx]:
                reach[ny, nx] = True; stack.append((ny, nx))
    partmask |= ~reach
    print(f"   mascara: umbrales {td:.0f}/{tc:.0f}/{tl:.0f}, objeto {100*win.mean():.1f}% de la ventana, pieza {100*partmask.mean():.1f}%, silueta inicial {100*sil0.mean():.1f}%, componentes {ncomp}")

    ref_half = shrink(partmask, 0.5)
    def iou(st):
        uv, _ = project(V, st)
        m = raster(uv, 0.5)
        ref = ref_half[:m.shape[0], :m.shape[1]]; m = m[:ref.shape[0], :ref.shape[1]]
        return (m & ref).sum() / max(1, (m | ref).sum())

    def unpack(p):
        # The kit is always drawn from above: an elevation at or below zero is
        # never the right camera, only a silhouette that happens to match.
        return {"az": p[0], "el": min(max(p[1], 4.0), 60.0),
                "L": L0 @ (np.eye(2) + p[2:6].reshape(2, 2)), "t": t0 + p[6:8]}
    plomada = np.array([[V[:, 0].mean(), V[:, 1].mean(), V[:, 2].max()],
                        [V[:, 0].mean(), V[:, 1].mean(), V[:, 2].min()]])
    def derecha(st):
        """True when the piece stands up on the sheet: its top projects above its base."""
        uv, _ = project(plomada, st)
        return uv[0, 1] < uv[1, 1]
    def mide(st):
        return iou(st) if derecha(st) else 0.0
    p_init = np.array([az0, el0 if el0 > 4 else 22.0, 0, 0, 0, 0, 0, 0], float)
    iou_start = iou(unpack(p_init))
    # first the silhouette's centroid onto the blob's: the global fit can be
    # tens of pixels off on an irregular piece
    ys_, xs_ = np.nonzero(sil0); ym_, xm_ = np.nonzero(partmask)
    if len(ys_) and len(ym_):
        p_init[6] += xm_.mean() - xs_.mean(); p_init[7] += ym_.mean() - ys_.mean()
    # coarse: the direction and the offset, then everything together. The
    # global fit's direction is the one that maps the mosaic's grid onto the
    # sheet, which for some mosaics is nowhere near the direction the objects
    # were drawn from, so the whole circle is swept before refining.
    best = (mide(unpack(p_init)), p_init)
    if not fixed_dir:
        for az_ in range(0, 360, 15):
            for el_ in (12, 22, 32, 42):
                p = p_init.copy(); p[0] = az_ - 180; p[1] = el_
                s_ = mide(unpack(p))
                if s_ > best[0]: best = (s_, p)
    for da in ((0,) if fixed_dir else (-12, -6, 0, 6, 12)):
        for de in ((0,) if fixed_dir else (-12, -6, 0, 6, 12)):
            p = best[1].copy(); p[0] += da; p[1] += de
            s_ = mide(unpack(p))
            if s_ > best[0]: best = (s_, p)
    for dx in range(-18, 19, 6):
        for dy in range(-18, 19, 6):
            p = best[1].copy(); p[6] += dx; p[7] += dy
            s_ = mide(unpack(p))
            if s_ > best[0]: best = (s_, p)
    def f(p): return -mide(unpack(p))
    n = 8; steps = [0.0 if fixed_dir else 3.0, 0.0 if fixed_dir else 3.0, 0.03, 0.02, 0.02, 0.03, 4.0, 4.0]
    simplex = [best[1]] + [best[1] + np.eye(n)[i] * steps[i] for i in range(n)]
    vals = [f(x) for x in simplex]
    for it in range(160):
        order = np.argsort(vals); simplex = [simplex[i] for i in order]; vals = [vals[i] for i in order]
        c = np.mean(simplex[:-1], 0)
        xr = c + (c - simplex[-1]); fr = f(xr)
        if fr < vals[0]:
            xe = c + 2 * (c - simplex[-1]); fe = f(xe)
            simplex[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            simplex[-1], vals[-1] = xr, fr
        else:
            xc = c + 0.5 * (simplex[-1] - c); fc = f(xc)
            if fc < vals[-1]:
                simplex[-1], vals[-1] = xc, fc
            else:
                for i in range(1, n + 1):
                    simplex[i] = simplex[0] + 0.5 * (simplex[i] - simplex[0]); vals[i] = f(simplex[i])
    i = int(np.argmin(vals)); state = unpack(simplex[i]); iou_end = -vals[i]
    if iou_end <= 0: state = unpack(best[1]); iou_end = best[0]

    if budget != nf:
        mesh, V, nv, nf, LS, F = construye(budget)

    SC = 2.0
    uvA, depth = project(V)
    d_view = basis(state["az"], state["el"])[0]
    idb, zb = raster(uvA, SC, depth)
    counts = np.bincount(idb[idb >= 0], minlength=nf)
    T = (uvA[F] - (x0, y0)) * SC
    area = 0.5 * np.abs((T[:, 1, 0] - T[:, 0, 0]) * (T[:, 2, 1] - T[:, 0, 1]) - (T[:, 2, 0] - T[:, 0, 0]) * (T[:, 1, 1] - T[:, 0, 1]))
    Ys, Xs = np.nonzero(idb >= 0)
    ids = idb[Ys, Xs]
    cols = sheet_rgb[np.minimum(y0 + (Ys / SC).astype(int), H - 1), np.minimum(x0 + (Xs / SC).astype(int), W - 1)]
    csum = np.zeros((nf, 3))
    for ch in range(3):
        csum[:, ch] = np.bincount(ids, weights=cols[:, ch], minlength=nf)
    facecol = csum / np.maximum(counts, 1)[:, None]
    er = partmask.copy()
    for dy in (-2, 0, 2):
        for dx in (-2, 0, 2):
            er &= np.roll(np.roll(partmask, dy, 0), dx, 1)
    cf = ((uvA[F].mean(1) - (x0, y0))).astype(int)
    inside = er[np.clip(cf[:, 1], 0, er.shape[0] - 1), np.clip(cf[:, 0], 0, er.shape[1] - 1)]
    # A face just behind the seen surface -- the scan's second layer, which
    # crosses the first and shows through from other angles -- gets the same
    # projection as the surface itself; only a face well behind is hidden.
    rng = depth.max() - depth.min()
    def zb_at(pts):
        return zb[np.clip(pts[:, 1].astype(int), 0, zb.shape[0] - 1), np.clip(pts[:, 0].astype(int), 0, zb.shape[1] - 1)]
    gaps = np.empty((nf, 4))
    for k in range(3):
        gaps[:, k] = depth[F[:, k]] - zb_at((uvA[F[:, k]] - (x0, y0)) * SC)
    gaps[:, 3] = depth[F].mean(1) - zb_at((uvA[F].mean(1) - (x0, y0)) * SC)
    nearby = (gaps[:, 3] <= 0.05 * rng) & (gaps[:, :3] <= 0.08 * rng).all(1)
    unhidden = (gaps <= 0.02 * rng).all(1)
    Nf = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    front = (Nf @ (-d_view)) > 0
    # A face nearly edge-on to the sheet's camera projects to a sliver: the
    # pixels under it are the silhouette's smear, not its own surface. Dressing
    # it from its own projection is what stretches a side of the piece into
    # streaks, so it is left to the reflections and to the wrap below.
    cosv = np.abs(Nf @ d_view) / np.maximum(np.linalg.norm(Nf, axis=1), 1e-12)
    # 0.08 is about four degrees from edge-on. Anything larger eats real
    # surfaces: a sheet drawn from 14 degrees up shows its shelf tops at 0.24,
    # and a threshold of 0.25 threw every shelf top away.
    grazing = cosv < float(job.get("canto", 0.08))
    visible = (nearby | (unhidden & front)) & inside & (area > 0.25) & ~grazing
    own = counts > 0
    cc = np.clip(cf, 0, None)
    facecol[~own] = sheet_rgb[np.minimum(y0 + cc[~own, 1], H - 1), np.minimum(x0 + cc[~own, 0], W - 1)]

    # Hidden faces take the colour of the nearest seen face across the surface.
    edge_faces = {}
    for i in range(nf):
        for k in range(3):
            a, b = F[i, k], F[i, (k + 1) % 3]
            edge_faces.setdefault((min(a, b), max(a, b)), []).append(i)
    adj = [[] for _ in range(nf)]
    for fs in edge_faces.values():
        for a in fs:
            for b in fs:
                if a != b: adj[a].append(b)
    source = np.full(nf, -1, np.int32)
    queue = [i for i in range(nf) if visible[i]]
    for i in queue: source[i] = i
    qi = 0
    while qi < len(queue):
        i = queue[qi]; qi += 1
        for j in adj[i]:
            if source[j] < 0:
                source[j] = source[i]; queue.append(j)
    meancol = facecol[visible].mean(0) if visible.any() else bg
    hidden = ~visible

    # A symmetric piece shows the camera one side only; the other side is that
    # side reflected. A hidden face whose reflection lies on seen surface --
    # at its corners and centre the reflected point's depth matches the
    # z-buffer, on pixels of seen faces -- takes its UVs at the reflection.
    mirrored = np.zeros(nf, bool); uvM = uvA.copy()
    def reflect(mirror):
        axes = [0] if mirror == "x" else [1] if mirror == "y" else [0, 1]
        ang = yaw_angle(V)          # reflect in the squared frame: the part may sit diagonally
        c_, s_ = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        Rz = np.array([[c_, -s_], [s_, c_]])
        Vr = V.copy(); Vr[:, :2] = V[:, :2] @ Rz.T
        for ax in axes: Vr[:, ax] = Vr[:, ax].min() + Vr[:, ax].max() - Vr[:, ax]
        Vm = Vr.copy(); Vm[:, :2] = Vr[:, :2] @ Rz
        uvm, dm = project(Vm)
        seen = np.zeros(idb.shape, bool); seen[idb >= 0] = visible[idb[idb >= 0]]
        # The scan is never symmetric to the millimetre: the centre has to land
        # on seen surface, the corners only two out of three.
        tol = 0.04 * rng
        cuenta = np.zeros(nf, int); centro = np.zeros(nf, bool)
        pts = [((uvm[F[:, k]] - (x0, y0)) * SC, dm[F[:, k]]) for k in range(3)] + [((uvm[F].mean(1) - (x0, y0)) * SC, dm[F].mean(1))]
        for j, (pk, dk) in enumerate(pts):
            yy = np.clip(pk[:, 1].astype(int), 0, seen.shape[0] - 1); xx = np.clip(pk[:, 0].astype(int), 0, seen.shape[1] - 1)
            bien = seen[yy, xx] & (np.abs(dk - zb[yy, xx]) <= tol)
            if j == 3: centro = bien
            else: cuenta += bien
        return hidden & centro & (cuenta >= 2), uvm
    # A piece squared in yaw has three symmetries to try, and each dresses what
    # the one before could not: left for right, front for back, and the half
    # turn. "auto" runs the three in that order.
    ejes = ("x", "y", "xy") if mirror == "auto" else ((mirror,) if mirror else ())
    usados = []
    for eje in ejes:
        nuevas, uvm = reflect(eje)
        nuevas &= hidden
        if not nuevas.any(): continue
        usados.append(f"{eje}:{nuevas.sum()}")
        uvM[F[nuevas].ravel()] = uvm[F[nuevas].ravel()]
        cm = np.clip((uvm[F[nuevas]].mean(1)).astype(int), 0, None)
        facecol[nuevas] = sheet_rgb[np.minimum(cm[:, 1], H - 1), np.minimum(cm[:, 0], W - 1)]
        mirrored |= nuevas; hidden = hidden & ~nuevas
    mirror = "+".join(usados) if usados else ""

    # Whatever no reflection reached takes its own projection, as long as it
    # falls on the piece: seen from behind, a face is dressed with the sheet's
    # pixels in front of it. Flat swatch colour is left for what is left over --
    # the scan's inner shells and the faces of canto.
    wrapped = np.zeros(nf, bool)
    # "envolver": 0 turns the wrap off, 1 uses the default depth window, and a
    # number is that window as a fraction of the piece's depth.
    envolver = float(job.get("envolver", 1))
    fondo = 0.12 if envolver == 1 else envolver
    if envolver > 0:
        cw = (uvA[F].mean(1) - (x0, y0)).astype(int)
        pm_h, pm_w = partmask.shape
        onpiece = partmask[np.clip(cw[:, 1], 0, pm_h - 1), np.clip(cw[:, 0], 0, pm_w - 1)]
        # Only the other face of the same sheet of material: what the pixel
        # shows has to lie right behind this face, not a metre of crates away.
        # Wrapping deep faces is what painted fruit down the plinth of the
        # seasonal stand.
        cerca = np.abs(gaps[:, 3]) <= fondo * rng
        wrapped = hidden & onpiece & cerca & ~grazing & (area > 0.25)
        hidden = hidden & ~wrapped
        cwc = np.clip(cw, 0, None)
        facecol[wrapped] = sheet_rgb[np.minimum(y0 + cwc[wrapped, 1], H - 1), np.minimum(x0 + cwc[wrapped, 0], W - 1)]
    # Hidden faces are coloured by diffusion from the seen ones across the
    # surface, neighbours weighted by how alike their normals are, so a hidden
    # top takes its colour from seen tops and a hidden side from seen sides.
    Nn = Nf / (np.linalg.norm(Nf, axis=1)[:, None] + 1e-12)
    pairs = np.array([(a, b) for a in range(nf) for b in adj[a]]) if nf else np.zeros((0, 2), int)
    wgt = np.maximum(0.05, (Nn[pairs[:, 0]] * Nn[pairs[:, 1]]).sum(1)) if len(pairs) else np.zeros(0)
    col = np.where(source[:, None] >= 0, facecol[np.maximum(source, 0)], meancol).astype(np.float64)
    fixed = visible | mirrored | wrapped
    col[fixed] = facecol[fixed]
    for _ in range(60):
        acc = np.zeros((nf, 3)); wsum = np.zeros(nf)
        np.add.at(acc, pairs[:, 0], col[pairs[:, 1]] * wgt[:, None]); np.add.at(wsum, pairs[:, 0], wgt)
        upd = (~fixed) & (wsum > 0)
        col[upd] = acc[upd] / wsum[upd][:, None]
    hidcol = (np.round(col / 6) * 6).clip(0, 255).astype(np.int16)

    # Edge agreement: how much of the sheet's edge strength lies under the
    # mesh's projected creases and silhouette (owner-normal or depth jumps
    # between neighbouring pixels), against the mean edge strength of the blob.
    Nu = Nf / (np.linalg.norm(Nf, axis=1)[:, None] + 1e-12)
    g = sheet_rgb[y0:y1, x0:x1].mean(2)
    E = np.zeros(g.shape); E[1:-1, 1:-1] = np.hypot(g[1:-1, 2:] - g[1:-1, :-2], g[2:, 1:-1] - g[:-2, 1:-1])
    Eb = E.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            Eb = np.maximum(Eb, np.roll(np.roll(E, dy, 0), dx, 1))
    own_n = np.where(idb[:, :, None] >= 0, Nu[np.maximum(idb, 0)], 0.0)
    own_z = np.where(idb >= 0, zb, np.nan)
    crease = np.zeros(idb.shape, bool)
    for dy, dx in ((0, 1), (1, 0)):
        a_ = own_n; b_ = np.roll(np.roll(own_n, dy, 0), dx, 1)
        za = own_z; zbn = np.roll(np.roll(own_z, dy, 0), dx, 1)
        both = (idb >= 0) & (np.roll(np.roll(idb, dy, 0), dx, 1) >= 0)
        crease |= both & (((a_ * b_).sum(2) < math.cos(math.radians(35))) | (np.abs(za - zbn) > 0.02 * rng))
        crease |= (idb >= 0) != (np.roll(np.roll(idb, dy, 0), dx, 1) >= 0)     # silhouette
    cr = crease.reshape(crease.shape[0] // 2 * 2, crease.shape[1] // 2 * 2)[::2, ::2] | crease[1::2, ::2][:crease.shape[0] // 2, :crease.shape[1] // 2] if False else crease[::2, ::2]
    cr = cr[:Eb.shape[0], :Eb.shape[1]]; Ebc = Eb[:cr.shape[0], :cr.shape[1]]
    pm_ = partmask[:cr.shape[0], :cr.shape[1]]
    edge_score = float(Ebc[cr & pm_].mean() / max(1e-6, Ebc[pm_].mean())) if (cr & pm_).any() else 0.0

    # Debug picture of the window: sheet, with seen faces green, mirrored blue, hidden red.
    dbg = sheet_rgb[y0:y1, x0:x1].astype(np.float64)
    dbg = np.kron(dbg, np.ones((int(SC), int(SC), 1)))[:idb.shape[0], :idb.shape[1]]
    cls = np.full(idb.shape, -1); m_ = idb >= 0
    cls[m_] = np.where(visible[idb[m_]], 0, np.where(mirrored[idb[m_]], 1, 2))
    for k, col in ((0, (60, 200, 60)), (1, (60, 90, 220)), (2, (220, 50, 50))):
        sel = cls == k; dbg[sel] = dbg[sel] * 0.45 + np.array(col) * 0.55
    dimg = bpy.data.images.new("dbg", dbg.shape[1], dbg.shape[0], alpha=False)
    fl = np.ones((dbg.shape[0], dbg.shape[1], 4), np.float32); fl[:, :, :3] = dbg[::-1] / 255.0
    dimg.pixels.foreach_set(fl.ravel()); dimg.filepath_raw = os.path.join(outdir, "_" + name + "_vis.png"); dimg.file_format = "PNG"; dimg.save()
    bpy.data.images.remove(dimg)

    # ---------------------------------------------------------------- the texture
    # The crop is the seen silhouette's box plus a margin; the swatch strip hangs below.
    sy, sx = np.nonzero(raster(uvA, 1.0))
    cx0 = max(0, x0 + sx.min() - margin); cx1 = min(W, x0 + sx.max() + margin + 1)
    cy0 = max(0, y0 + sy.min() - margin); cy1 = min(H, y0 + sy.max() + margin + 1)
    crop = sheet_rgb[cy0:cy1, cx0:cx1].astype(np.float64)
    # Outside the part the sheet shows ground and shadow; a rim vertex that lands a
    # pixel out would drag them onto the piece. The outside is painted over with
    # the nearest object colour, grown outwards ring by ring.
    filled = np.zeros(crop.shape[:2], bool)
    pw = partmask[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
    filled[:pw.shape[0], :pw.shape[1]] = pw
    for _ in range(max(crop.shape)):
        if filled.all(): break
        acc = np.zeros_like(crop); cnt = np.zeros(filled.shape)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            sh = np.roll(np.roll(filled, dy, 0), dx, 1); sc_ = np.roll(np.roll(crop, dy, 0), dx, 1)
            acc += sc_ * sh[:, :, None]; cnt += sh
        new = (~filled) & (cnt > 0)
        crop[new] = acc[new] / cnt[new][:, None]; filled |= new
    crop = crop.round().astype(np.int16)
    TW = cx1 - cx0; SW = 6
    keys = {}
    for i in np.nonzero(hidden)[0]:
        keys.setdefault(tuple(int(v) for v in hidcol[i]), len(keys))
    per_row = max(1, TW // SW); rows = (len(keys) + per_row - 1) // per_row
    strip = np.full((rows * SW, TW, 3), bg, np.int16)
    swatch_uv = {}
    for col, k in keys.items():
        r_, c_ = divmod(k, per_row)
        strip[r_ * SW:(r_ + 1) * SW, c_ * SW:(c_ + 1) * SW] = col
        swatch_uv[col] = (c_ * SW + SW / 2, crop.shape[0] + r_ * SW + SW / 2)
    tex = np.concatenate([crop, strip], 0) if rows else crop
    TH = tex.shape[0]
    im = bpy.data.images.new("tex", TW, TH, alpha=False)
    flat = np.ones((TH, TW, 4), np.float32); flat[:, :, :3] = tex[::-1] / 255.0
    im.pixels.foreach_set(flat.ravel())
    im.filepath_raw = tex_out; im.file_format = "PNG"; im.save()

    uvl = mesh.uv_layers.new(name="UVMap")
    uvdata = np.zeros((len(mesh.loops), 2), np.float32)
    for i in range(nf):
        for k in range(3):
            li = LS[i] + k
            if visible[i] or mirrored[i] or wrapped[i]:
                u, v = (uvM if mirrored[i] else uvA)[F[i, k]]
                uvdata[li] = ((u - cx0) / TW, 1 - (v - cy0) / TH)
            else:
                su, sv = swatch_uv[tuple(int(x) for x in hidcol[i])]
                uvdata[li] = (su / TW, 1 - sv / TH)
    uvl.data.foreach_set("uv", uvdata.ravel())

    mat = bpy.data.materials.new(os.path.basename(dst)[:-4])
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.8; bsdf.inputs["Metallic"].default_value = 0.0
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(tex_out); node.extension = "EXTEND"
    mat.node_tree.links.new(bsdf.inputs["Base Color"], node.outputs["Color"])
    mesh.materials.clear(); mesh.materials.append(mat)
    glass = np.zeros(nf, bool)
    if int(job.get("cristal", 0)):
        # Glass shows the ground through it: a seen face whose sheet colour is
        # the ground's grey (little chroma, near its brightness) is glass and
        # gets the same texture on a translucent material.
        gc = facecol.max(1) - facecol.min(1); gl = np.abs(facecol.mean(1) - bg.mean())
        glass = visible & (gc < 14) & (gl < 26)
        gmat = bpy.data.materials.new(os.path.basename(dst)[:-4] + "_cristal"); gmat.use_nodes = True
        gb = gmat.node_tree.nodes["Principled BSDF"]
        gb.inputs["Roughness"].default_value = 0.15; gb.inputs["Metallic"].default_value = 0.0
        gb.inputs["Alpha"].default_value = 0.35
        gnode = gmat.node_tree.nodes.new("ShaderNodeTexImage"); gnode.image = node.image; gnode.extension = "EXTEND"
        gmat.node_tree.links.new(gb.inputs["Base Color"], gnode.outputs["Color"])
        for attr, val in (("blend_method", "BLEND"), ("surface_render_method", "BLENDED"), ("show_transparent_back", False)):
            try: setattr(gmat, attr, val)
            except Exception: pass
        mesh.materials.append(gmat)
        for i in np.nonzero(glass)[0]:
            mesh.polygons[int(i)].material_index = 1

    # ---------------------------------------------------------------- square in yaw, re-centre
    deg = yaw_angle(V)
    mesh.transform(Matrix.Rotation(math.radians(deg + extra_turn), 4, "Z")); mesh.update()
    Vn = np.empty(nv * 3, np.float32); mesh.vertices.foreach_get("co", Vn); Vn = Vn.reshape(nv, 3)
    lo, hi = Vn.min(0), Vn.max(0)
    mesh.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))); mesh.update()

    for o in bpy.data.objects:
        o.hide_render = o is not keep
    bpy.ops.object.select_all(action="DESELECT"); keep.select_set(True)
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True)
    if int(job.get("clases", 0)):
        # the same mesh with every face painted by its class, to see which class shows where
        dup = keep.copy(); dup.data = keep.data.copy(); bpy.context.collection.objects.link(dup)
        dup.data.materials.clear()
        for nm, col in (("vista", (0.2, 0.75, 0.2)), ("espejada", (0.2, 0.3, 0.9)), ("oculta", (0.85, 0.2, 0.2)),
                        ("envuelta", (0.9, 0.75, 0.15))):
            mm = bpy.data.materials.new(nm); mm.diffuse_color = (*col, 1); mm.use_nodes = True
            mm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*col, 1)
            dup.data.materials.append(mm)
        for i in range(min(nf, len(dup.data.polygons))):
            dup.data.polygons[i].material_index = 0 if visible[i] else (1 if mirrored[i] else (3 if wrapped[i] else 2))
        bpy.ops.object.select_all(action="DESELECT"); dup.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(outdir, "_" + name + "_clases.glb"), export_format="GLB",
                                  use_selection=True, export_yup=True, export_apply=True)
        bpy.data.objects.remove(dup, do_unlink=True)

    # The camera direction, carried through the squaring turn, for a check render.
    # The mesh itself was turned by +deg in world space, so the direction the
    # camera had to it turns by +deg too (checked on the egg display: its sign
    # faces where this says).
    t = math.radians(deg + extra_turn)
    cdir = -d_view
    camdir = np.array([cdir[0] * math.cos(t) - cdir[1] * math.sin(t), cdir[0] * math.sin(t) + cdir[1] * math.cos(t), cdir[2]])
    el = math.degrees(math.asin(max(-1, min(1, camdir[2])))); az = math.degrees(math.atan2(camdir[0], -camdir[1]))
    size = hi - lo
    bpy.data.objects.remove(keep, do_unlink=True)
    print("PARTE " + json.dumps({"parte": part, "nombre": name, "caras": int(nf), "antes": int(before),
          "vistas": round(float(visible.mean()), 3), "espejadas": round(float(mirrored.mean()), 3),
          "envueltas": round(float(wrapped.mean()), 3), "sueltas": round(float(hidden.mean()), 3), "espejo": mirror,
          "iou_inicial": round(float(iou_start), 3), "iou_afinado": round(float(iou_end), 3), "bordes": round(edge_score, 3), "giro": round(deg + extra_turn, 2),
          "camara": [round(state["az"], 1), round(state["el"], 1)], "camara_inicial": [round(az0, 1), round(el0, 1)],
          "mide": [round(float(v), 4) for v in size], "textura": [int(TW), int(TH)], "muestras": len(keys), "cristal": int(glass.sum()),
          "az": round(az, 1), "el": round(el, 1), "recorte": [int(cx0), int(cy0), int(cx1), int(cy1)]}))


for job in jobs:
    process(job)
print("LOTE_FIN", len(jobs))

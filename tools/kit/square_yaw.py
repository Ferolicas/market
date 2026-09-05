"""Square a projected piece in yaw and re-centre it, keeping its texture.

    blender -b -P tools/kit/square_yaw.py -- <in.glb> <out.glb> [giro=deg] [solo_medir=1]

The plan outline's dominant edge direction (convex hull edges, weighted by
length, angles folded modulo 90) is the yaw to undo; the minimum-area
rectangle wanders by 45 degrees on a square plan. `giro` adds a manual turn.
"""
import bpy, sys, os, math
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
opts = dict(o.split("=", 1) for o in argv[2:])
extra = float(opts.get("giro", 0)); measure_only = opts.get("solo_medir", "0") == "1"
fixed = opts.get("giro_fijo", "0") == "1"      # apply `giro` alone, no estimate
symmetric = opts.get("simetria", "0") == "1"    # a left-right symmetric piece: its mirror axis becomes y
az_cam = float(opts["az"]) if "az" in opts else None   # camera azimuth (report) to pick the front

def hull(Q):
    Q = np.unique(Q, axis=0); Q = Q[np.lexsort((Q[:, 1], Q[:, 0]))]
    def cross2(a, b): return a[0] * b[1] - a[1] * b[0]
    def half(pts):
        h = []
        for p in pts:
            while len(h) >= 2 and cross2(h[-1] - h[-2], p - h[-2]) <= 1e-12: h.pop()
            h.append(p)
        return h
    return np.array(half(Q)[:-1] + half(Q[::-1])[:-1])

def yaw_minrect(H):
    best = (1e9, 0.0)
    for i in range(len(H)):
        e = H[(i + 1) % len(H)] - H[i]; a = math.atan2(e[1], e[0])
        c, s = math.cos(-a), math.sin(-a)
        X, Y = H[:, 0] * c - H[:, 1] * s, H[:, 0] * s + H[:, 1] * c
        ar = (X.max() - X.min()) * (Y.max() - Y.min())
        if ar < best[0]: best = (ar, a)
    d = math.degrees(-best[1]) % 90
    return d - 90 if d > 45 else d

def yaw_edges(H):
    """Dominant direction of the outline's edges, folded to (-45, 45]."""
    E = np.roll(H, -1, 0) - H
    L = np.hypot(E[:, 0], E[:, 1]); A = np.degrees(np.arctan2(E[:, 1], E[:, 0])) % 90
    hist = np.zeros(90)
    for a, l in zip(A, L):
        for k in (-1, 0, 1): hist[int(a + k) % 90] += l * (1.0 if k == 0 else 0.5)
    peak = int(np.argmax(hist))
    d = ((A - peak + 45) % 90) - 45
    sel = np.abs(d) <= 4
    fine = peak + (np.sum(d[sel] * L[sel]) / max(1e-9, np.sum(L[sel])))
    fine %= 90
    return (fine - 90 if fine > 45 else fine) * -1.0

def yaw_symmetry(V2):
    """Angle of the plan's mirror axis (degrees, 0..180), through the centroid:
    the line across which the reflected outline lands closest on itself."""
    P = V2 - V2.mean(0)
    idx = np.random.default_rng(0).choice(len(P), min(len(P), 1500), replace=False); P = P[idx]
    def cost(th):
        t = math.radians(th); d = np.array([math.cos(t), math.sin(t)])
        R = 2 * np.outer(P @ d, d) - P            # reflection across the axis
        dd = np.sqrt(((R[:, None, :] - P[None, :, :]) ** 2).sum(2)).min(1)
        return float(np.mean(dd))
    coarse = min(range(0, 180, 3), key=cost)
    fine = min([coarse + k * 0.5 for k in range(-6, 7)], key=cost)
    return fine % 180

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes:
    bpy.context.view_layer.objects.active = o; o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
V = np.concatenate([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in meshes])
H = hull(V[:, :2])
a_rect = yaw_minrect(H); a_edge = yaw_edges(H)
a_sym = yaw_symmetry(V[:, :2]) if symmetric else None
print(f"MEDIDA {os.path.basename(src)}: rectangulo {a_rect:+.1f}  aristas {a_edge:+.1f}" + (f"  eje de simetria {a_sym:.1f}" if symmetric else ""))
if not measure_only:
    if symmetric:
        turn = (90 - a_sym) + extra          # the mirror axis onto y
        if az_cam is not None:
            az_new = az_cam - turn           # the camera azimuth after the turn
            if abs(((az_new + 180) % 360) - 180) > 90: turn += 180   # the seen side faces -y
    else:
        turn = extra if fixed else a_edge + extra
    for o in meshes:
        o.data.transform(Matrix.Rotation(math.radians(turn), 4, "Z")); o.data.update()
    V = np.concatenate([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in meshes])
    lo, hi = V.min(0), V.max(0)
    for o in meshes:
        o.data.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))); o.data.update()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_yup=True, export_apply=True)
    print(f"GIRADA {turn:+.2f} -> {dst}")

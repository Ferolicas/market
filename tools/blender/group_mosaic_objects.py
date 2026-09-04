"""Cluster a mosaic GLB's meshes into the objects the reference sheet shows.

The sheet is a grid and the GLB is a 3D scan of that grid, so an object's parts
sit together in space while different objects stand well apart. Clustering on
3D gaps is far more reliable than segmenting the printed sheet, where cast
shadows weld neighbours together and thin objects fall apart.
"""
from __future__ import annotations

import json, sys
import bpy
import numpy as np
from mathutils import Vector


def opt(name, default=""):
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = f"--{name}="
    return next((a.removeprefix(p) for a in args if a.startswith(p)), default)


SOURCE = opt("source")
OUT = opt("out")
GAP = float(opt("gap", "0.055"))          # share of the sheet's diagonal

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SOURCE)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

boxes = {}
for o in meshes:
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo[i], w[i]) for i in range(3)))
        hi = Vector((max(hi[i], w[i]) for i in range(3)))
    boxes[o.name] = (np.array(lo), np.array(hi))

allmin = np.min([b[0] for b in boxes.values()], axis=0)
allmax = np.max([b[1] for b in boxes.values()], axis=0)
diag = float(np.linalg.norm(allmax - allmin))
thr = GAP * diag


def gap(a, b):
    la, ha = boxes[a]; lb, hb = boxes[b]
    d = np.maximum(np.maximum(lb - ha, la - hb), 0.0)
    return float(np.linalg.norm(d))


names = list(boxes)
parent = {n: n for n in names}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for i, a in enumerate(names):
    for b in names[i + 1:]:
        if gap(a, b) <= thr:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

groups = {}
for n in names:
    groups.setdefault(find(n), []).append(n)

def diag_of(members):
    lo = np.min([boxes[m][0] for m in members], axis=0)
    hi = np.max([boxes[m][1] for m in members], axis=0)
    return float(np.linalg.norm(hi - lo))


def kmeans2_centres(pts, iters=40):
    """Two-way split on mesh centroids, farthest pair as the seeds."""
    d = ((pts[:, None, :] - pts[None, :, :]) ** 2).sum(2)
    i, j = np.unravel_index(int(np.argmax(d)), d.shape)
    c = np.array([pts[i], pts[j]], dtype=float)
    lab = np.zeros(len(pts), int)
    for _ in range(iters):
        lab = np.argmin(((pts[:, None, :] - c[None, :, :]) ** 2).sum(2), 1)
        for k in (0, 1):
            if (lab == k).any():
                c[k] = pts[lab == k].mean(0)
    return lab


members_list = list(groups.values())
# Two objects that touch on the sheet cluster as one. A group whose extent is an
# outlier is cut in two on its members' centroids, repeatedly.
for _ in range(6):
    diags = [diag_of(m) for m in members_list]
    med = float(np.median(diags))
    nxt, changed = [], False
    for m, dg in zip(members_list, diags):
        if dg <= 1.5 * med or len(m) < 2:
            nxt.append(m)
            continue
        pts = np.array([(boxes[n][0] + boxes[n][1]) / 2 for n in m])
        lab = kmeans2_centres(pts)
        a = [n for n, l in zip(m, lab) if l == 0]
        b = [n for n, l in zip(m, lab) if l == 1]
        if a and b and max(diag_of(a), diag_of(b)) < dg * 0.92:
            nxt.extend([a, b]); changed = True
        else:
            nxt.append(m)
    members_list = nxt
    if not changed:
        break

out = []
for members in members_list:
    lo = np.min([boxes[m][0] for m in members], axis=0)
    hi = np.max([boxes[m][1] for m in members], axis=0)
    tris = sum(sum(len(p.vertices) - 2 for p in bpy.data.objects[m].data.polygons) for m in members)
    out.append({"piezas": sorted(members), "tris": int(tris),
                "min": [round(float(v), 4) for v in lo],
                "max": [round(float(v), 4) for v in hi],
                "centro": [round(float(v), 4) for v in (lo + hi) / 2],
                "tam": [round(float(v), 4) for v in (hi - lo)]})
# sheet reading order: rows top to bottom (Z down), then left to right (X up)
heights = [g["tam"][2] for g in out]
tol = 0.6 * float(np.median(heights))
rows, used = [], set()
for i in sorted(range(len(out)), key=lambda i: -out[i]["centro"][2]):
    if i in used:
        continue
    row = [j for j in range(len(out)) if j not in used
           and abs(out[j]["centro"][2] - out[i]["centro"][2]) <= tol]
    used.update(row)
    rows.append(sorted(row, key=lambda j: out[j]["centro"][0]))
order = [i for r in rows for i in r]
out = [out[i] for i in order]
for i, g in enumerate(out):
    g["indice"] = i

payload = {"fuente": SOURCE, "diagonal": round(diag, 4), "umbral": round(thr, 4),
           "mallas": len(meshes), "objetos": len(out),
           "extension": {"min": [round(float(v), 4) for v in allmin],
                         "max": [round(float(v), 4) for v in allmax]},
           "grupos": out}
if OUT:
    open(OUT, "w").write(json.dumps(payload, indent=1))
print(f"GRUPOS {len(out)} de {len(meshes)} mallas (umbral {thr:.4f})")
for g in out:
    print(f"  {g['indice']:>2} piezas={len(g['piezas']):>2} tris={g['tris']:>7} "
          f"centro=({g['centro'][0]:+.3f},{g['centro'][1]:+.3f},{g['centro'][2]:+.3f}) "
          f"tam=({g['tam'][0]:.3f},{g['tam'][1]:.3f},{g['tam'][2]:.3f})")

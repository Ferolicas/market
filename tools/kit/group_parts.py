"""Group the parts of a mosaic into the objects the sheet draws, without a camera.

    python3 tools/kit/group_parts.py <bboxes.json> [gap] [--pares]

Tripo cuts an object into stacked layers, so parts are grouped by proximity
(single linkage over the boxes, joined when they are closer than `gap` times
the scene size). The sheet's layout survives in the mosaic: each row of the
sheet is a height band, so groups come out in reading order -- bands top to
bottom, left to right -- which is the blob numbering of sheet_blobs.py.
With --pares it prints the pairs string fit_camera.py expects.
"""
import sys, json
import numpy as np
bb = json.load(open(sys.argv[1]))
gap = float(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else 0.06
lo = np.array([p["lo"] for p in bb]); hi = np.array([p["hi"] for p in bb])
cen = (lo + hi) / 2
esc = float(np.max(hi.max(0) - lo.min(0)))
tol = gap * esc
n = len(bb); par = list(range(n))
def find(a):
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
for i in range(n):
    for j in range(i + 1, n):
        d = np.maximum(0, np.maximum(lo[i] - hi[j], lo[j] - hi[i])).max()
        if d <= tol:
            a, b = find(i), find(j)
            if a != b: par[a] = b
grupos = {}
for i in range(n): grupos.setdefault(find(i), []).append(i)
gs = []
for miembros in grupos.values():
    l = lo[miembros].min(0); h = hi[miembros].max(0)
    gs.append({"partes": [int(bb[i]["name"].split("_")[-1]) for i in miembros],
               "lo": l.tolist(), "hi": h.tolist(), "centro": ((l + h) / 2).tolist(),
               "caras": int(sum(bb[i]["caras"] for i in miembros))})
# rows: height bands, from the top of the sheet down
gs.sort(key=lambda g: -g["centro"][2])
bandas, banda, suelo = [], [], None
for g in gs:
    alto = g["hi"][2] - g["lo"][2]
    if banda and g["centro"][2] < suelo - 0.5 * alto: bandas.append(banda); banda = []
    banda.append(g); suelo = g["centro"][2] if not banda[:-1] else min(suelo, g["centro"][2])
if banda: bandas.append(banda)
orden = [g for b in bandas for g in sorted(b, key=lambda g: g["centro"][0])]
for i, g in enumerate(orden):
    t = np.array(g["hi"]) - np.array(g["lo"])
    print(f"g{i:<3d} partes {'+'.join(str(p) for p in g['partes']):<28s} caras {g['caras']:>7d} "
          f"centro ({g['centro'][0]:+.3f},{g['centro'][1]:+.3f},{g['centro'][2]:+.3f}) tam ({t[0]:.3f},{t[1]:.3f},{t[2]:.3f})")
print(f"{len(orden)} grupos en {len(bandas)} bandas")
if "--pares" in sys.argv:
    print("PARES " + ",".join("+".join(str(p) for p in g["partes"]) + f":{i}" for i, g in enumerate(orden)))

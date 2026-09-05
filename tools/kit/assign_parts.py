"""Assign every part of a mosaic to a sheet blob by projection.

    python3 tools/kit/assign_parts.py <bboxes.json> <blobs.json> <P.npy> <groups.json>

A part belongs to the blob whose box (grown by a tenth) holds the projection
of its centre; ties go to the nearest blob centre. Prints the groups.
"""
import sys, json, numpy as np
bb = json.load(open(sys.argv[1])); blobs = json.load(open(sys.argv[2]))["blobs"]; P = np.load(sys.argv[3])
groups = {i: [] for i in range(len(blobs))}; loose = []
for p in bb:
    n = int(p["name"].split("_")[-1])
    c = np.array([(p["lo"][k] + p["hi"][k]) / 2 for k in range(3)] + [1.0])
    h = P @ c; u, v = h[0] / h[2], h[1] / h[2]
    cands = []
    for i, b in enumerate(blobs):
        gw = 0.1 * (b["x1"] - b["x0"]); gh = 0.1 * (b["y1"] - b["y0"])
        if b["x0"] - gw <= u <= b["x1"] + gw and b["y0"] - gh <= v <= b["y1"] + gh:
            cands.append((abs(u - b["cx"]) / (b["x1"] - b["x0"]) + abs(v - b["cy"]) / (b["y1"] - b["y0"]), i))
    if cands: groups[min(cands)[1]].append(n)
    else: loose.append((n, round(u), round(v), p["tris"]))
for i, b in enumerate(blobs):
    print(f"b{i} ({b['cx']:.0f},{b['cy']:.0f}): " + " ".join(f"p{n}" for n in sorted(groups[i])))
print("sueltas:", loose)
json.dump({str(i): sorted(v) for i, v in groups.items()}, open(sys.argv[4], "w"))

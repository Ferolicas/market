"""Fit the sheet camera of a mosaic: a 3x4 projection by DLT, or affine with --afin.

    python3 tools/kit/fit_camera.py [--afin] <bboxes.json> <blobs.json> <pairs> <P.npy> [<verts.npz> <sheet.png> <overlay.png>]

pairs: "13:0,2:3,24+25+26:13,..." -- part number(s) : index of the blob in
blobs.json (rows top to bottom, left to right). Joined parts share one box.
Prints the residual of every pair; the optional overlay draws all projected
vertices on the sheet.
"""
import sys, json, numpy as np
affine = "--afin" in sys.argv
if affine: sys.argv.remove("--afin")
bb = {int(p["name"].split("_")[-1]): p for p in json.load(open(sys.argv[1]))}
blobs = json.load(open(sys.argv[2]))["blobs"]
X = []; U = []; names = []
for pair in sys.argv[3].split(","):
    parts, bi = pair.split(":"); ids = [int(v) for v in parts.split("+")]
    lo = np.min([bb[i]["lo"] for i in ids], 0); hi = np.max([bb[i]["hi"] for i in ids], 0)
    X.append(list((lo + hi) / 2) + [1.0]); b = blobs[int(bi)]; U.append([b["cx"], b["cy"]]); names.append(parts)
X = np.array(X); U = np.array(U)
if affine:
    # uv = A x + b: eight parameters, one viewing direction for the whole
    # sheet; with few pairs the projective fit can put the camera inside the scene
    sol, *_ = np.linalg.lstsq(X, U, rcond=None)
    P = np.vstack([sol.T, [0, 0, 0, 1.0]])
else:
    A = []
    for x, (u, v) in zip(X, U):
        A.append(np.concatenate([x, np.zeros(4), -u * x])); A.append(np.concatenate([np.zeros(4), x, -v * x]))
    _, _, vt = np.linalg.svd(np.array(A)); P = vt[-1].reshape(3, 4); P = P / P[2, 3]
def proj(X):
    h = X @ P.T; return h[:, :2] / h[:, 2:3]
res = proj(X) - U
for n, r in zip(names, res): print(f"  parte {n:>10s} residuo {r[0]:+6.1f} {r[1]:+6.1f} px")
print("RMS %.1f px  (%d pares)" % (np.sqrt((res ** 2).sum(1).mean()), len(names)))
np.save(sys.argv[4], P)
if len(sys.argv) > 7:
    from PIL import Image, ImageDraw
    V = np.load(sys.argv[5]); im = Image.open(sys.argv[6]).convert("RGB"); d = ImageDraw.Draw(im)
    for k in V.files:
        w = V[k]; uv = proj(np.c_[w, np.ones(len(w))])
        for u, v in uv[::3]:
            if 0 <= u < im.width and 0 <= v < im.height: d.point((u, v), fill=(255, 0, 0))
    im.resize((im.width * 3 // 4, im.height * 3 // 4)).save(sys.argv[7]); print("overlay", sys.argv[7])

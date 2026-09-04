"""Give every 3D object group its own crop and silhouette from the reference sheet.

The 3D grouping is the trustworthy signal: objects stand apart in space, so
clustering on 3D gaps recovers exactly how many objects the sheet holds. The
printed sheet is the awkward one -- cast shadows weld neighbours together and
thin objects shatter -- so rather than segmenting it blind, it is segmented to
the count the 3D already established, and the two lists are paired in reading
order.
"""
from __future__ import annotations

import json, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
from extract_reference_cells import background_field, object_mask, partition  # noqa: E402


def fit_field(win: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Fit the ground under one cell using pixels known to be background."""
    h, w, _ = win.shape
    yy, xx = np.mgrid[0:h, 0:w]
    A = np.stack([np.ones(h * w), xx.ravel(), yy.ravel(),
                  (xx * xx).ravel(), (yy * yy).ravel(), (xx * yy).ravel()], 1)
    sel = bg.ravel()
    if sel.sum() < 60:
        return background_field(win, ring=4)
    out = np.zeros_like(win)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A[sel], win[..., c].ravel()[sel], rcond=None)
        out[..., c] = (A @ coef).reshape(h, w)
    return out


def local_silhouette(win: np.ndarray, near: np.ndarray):
    """Segment one object inside its own window.

    The fit uses only pixels outside the object's neighbourhood, and the result
    is clipped back to that neighbourhood, so neither a badly conditioned fit
    nor a neighbouring object can leak into the silhouette.
    """
    grown = ndimage.binary_dilation(near, np.ones((9, 9)), iterations=2)
    field = fit_field(win, ~grown)
    m = object_mask(win, field, thr=7.0) & grown
    if m.sum() < 40:
        return None
    core = ndimage.binary_erosion(m, np.ones((3, 3)))
    lab, n = ndimage.label(core)
    if n == 0:
        return ndimage.binary_fill_holes(m)
    sizes = ndimage.sum(core, lab, range(1, n + 1))
    seed = lab == (int(np.argmax(sizes)) + 1)
    return ndimage.binary_fill_holes(ndimage.binary_propagation(seed, mask=m))


def merge_smallest(parts: list[np.ndarray]) -> list[np.ndarray]:
    """Fold the smallest fragment into whichever neighbour it sits closest to."""
    sizes = [int(m.sum()) for m in parts]
    i = int(np.argmin(sizes))
    cy, cx = ndimage.center_of_mass(parts[i])
    best, bd = None, 1e18
    for j, m in enumerate(parts):
        if j == i:
            continue
        oy, ox = ndimage.center_of_mass(m)
        d = (oy - cy) ** 2 + (ox - cx) ** 2
        if d < bd:
            bd, best = d, j
    out = [m for j, m in enumerate(parts) if j not in (i, best)]
    out.append(parts[i] | parts[best])
    return out


def partition_to_count(mask: np.ndarray, target: int, min_area: float) -> list[np.ndarray]:
    best = None
    for r in (3, 4, 5, 6, 7, 8, 9, 11, 13):
        parts = partition(mask, r, min_area)
        if not parts:
            continue
        if len(parts) == target:
            return parts
        if best is None or abs(len(parts) - target) < abs(len(best) - target):
            best = parts
    parts = best or []
    guard = 0
    while len(parts) > target and guard < 200:
        parts = merge_smallest(parts)
        guard += 1
    return parts


def reading_order(boxes):
    heights = [b[3] - b[1] for b in boxes]
    tol = 0.55 * float(np.median(heights))
    rows, used = [], set()
    for i in sorted(range(len(boxes)), key=lambda i: boxes[i][1]):
        if i in used:
            continue
        row = [j for j in range(len(boxes)) if j not in used and abs(boxes[j][1] - boxes[i][1]) <= tol]
        used.update(row)
        rows.append(sorted(row, key=lambda j: boxes[j][0]))
    return [i for r in rows for i in r]


def main() -> int:
    groups = json.loads(Path(sys.argv[1]).read_text())
    sheet_path = Path(sys.argv[2])
    outdir = Path(sys.argv[3])
    scale = int(sys.argv[4]) if len(sys.argv) > 4 else 5
    outdir.mkdir(parents=True, exist_ok=True)
    stem = sheet_path.stem

    im = Image.open(sheet_path).convert("RGB")
    a = np.asarray(im).astype(float)
    mask = object_mask(a, background_field(a), thr=8.0)
    gs = groups["grupos"]
    min_area = 0.00035 * a.shape[0] * a.shape[1]
    parts = partition_to_count(mask, len(gs), min_area)

    boxes = []
    for m in parts:
        ys, xs = np.nonzero(m)
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    order = reading_order(boxes)

    cells, preview = [], []
    for rank, idx in enumerate(order):
        if rank >= len(gs):
            break
        g = gs[rank]
        m = parts[idx]
        ys, xs = np.nonzero(m)
        # Re-cut the silhouette inside the cell. The sheet-wide background fit is
        # too coarse locally and lets the cast shadow into the mask, which
        # stretches the silhouette and makes the camera solve chase an aspect
        # ratio the object cannot produce.
        mw = int(0.14 * (xs.max() - xs.min() + 1)) + 8
        mh = int(0.14 * (ys.max() - ys.min() + 1)) + 8
        wx0 = int(max(0, xs.min() - mw)); wy0 = int(max(0, ys.min() - mh))
        wx1 = int(min(a.shape[1], xs.max() + mw + 1)); wy1 = int(min(a.shape[0], ys.max() + mh + 1))
        win = a[wy0:wy1, wx0:wx1]
        local = local_silhouette(win, m[wy0:wy1, wx0:wx1])
        if local is None or local.sum() < 40:
            local = m[wy0:wy1, wx0:wx1]
        ly, lx = np.nonzero(local)
        pad = max(3, int(0.03 * (ly.max() - ly.min() + 1)))
        lx0 = int(max(0, lx.min() - pad)); ly0 = int(max(0, ly.min() - pad))
        lx1 = int(min(local.shape[1], lx.max() + pad + 1))
        ly1 = int(min(local.shape[0], ly.max() + pad + 1))
        x0, y0 = wx0 + lx0, wy0 + ly0
        x1, y1 = wx0 + lx1, wy0 + ly1
        name = f"{stem}_{g['indice']:02d}"
        crop = im.crop((x0, y0, x1, y1))
        crop.save(outdir / f"{name}.png")
        hi = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
        hi.save(outdir / f"{name}_hi.png")
        # Also as raw sRGB bytes. Blender hands back PNG pixels without applying
        # the sRGB decode -- a near-black object reads as mid grey -- and the
        # setting that should fix it does not, so the decode is done explicitly
        # downstream from an array whose encoding is not in doubt.
        np.save(outdir / f"{name}_hi.npy", np.asarray(hi, dtype=np.uint8))
        sil = local[ly0:ly1, lx0:lx1]
        np.save(outdir / f"{name}_sil.npy", sil)
        if sil.sum() < 30:
            cells.append({"indice": g["indice"], "error": "silueta vacia"})
            continue
        by, bx = np.nonzero(~m)
        # the 3D group's own proportions, as a sanity check on the pairing
        gw, gh = g["tam"][0], g["tam"][2]
        cells.append({"indice": g["indice"], "nombre": name,
                      "caja": [x0, y0, x1, y1], "piezas": g["piezas"],
                      "aspecto_hoja": round((x1 - x0) / max(y1 - y0, 1), 3),
                      "aspecto_3d": round(gw / max(gh, 1e-6), 3),
                      "fondo": [int(round(v)) for v in np.median(a[by, bx], axis=0)]})
        preview.append((name, crop))

    (outdir / f"{stem}_celdas.json").write_text(json.dumps(cells, indent=1))

    cols = min(6, max(1, len(preview)))
    rows = (len(preview) + cols - 1) // cols
    tw = th = 260
    sh = Image.new("RGB", (cols * tw, rows * (th + 18)), (18, 18, 18))
    d = ImageDraw.Draw(sh)
    for i, (name, t) in enumerate(preview):
        t = t.copy(); t.thumbnail((tw - 8, th - 8), Image.LANCZOS)
        sh.paste(t, ((i % cols) * tw + (tw - t.width) // 2, (i // cols) * (th + 18) + 18))
        d.text(((i % cols) * tw + 4, (i // cols) * (th + 18) + 3), name.split("_")[-1], fill=(150, 230, 160))
    sh.save(outdir / f"{stem}_contacto.png")

    cells = [c for c in cells if "nombre" in c or "error" in c]
    off = [c for c in cells if "aspecto_hoja" in c and abs(c["aspecto_hoja"] - c["aspecto_3d"]) > 0.75]
    print(json.dumps({"hoja": stem, "grupos": len(gs), "celdas": len(parts),
                      "recortados": sum(1 for c in cells if "nombre" in c), "aspecto_dudoso": [c["indice"] for c in off]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

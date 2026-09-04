"""Cut a reference contact sheet into one crop and silhouette per object.

The sheets are a grid of objects on a vignetted grey ground with a soft cast
shadow. A single global threshold does not separate them: the vignette makes the
corners darker than the pale cream of some objects, and the shadows bridge
neighbours into one blob. So the background is fitted as a smooth field, the
shadow is recognised as a neutral darkening of that field and removed, and only
then are the objects labelled.
"""
from __future__ import annotations

import json, sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def background_field(a: np.ndarray, ring: int = 8) -> np.ndarray:
    h, w, _ = a.shape
    m = np.zeros((h, w), bool)
    m[:ring, :] = m[-ring:, :] = m[:, :ring] = m[:, -ring:] = True
    yy, xx = np.mgrid[0:h, 0:w]
    A = np.stack([np.ones(h * w), xx.ravel(), yy.ravel(),
                  (xx * xx).ravel(), (yy * yy).ravel(), (xx * yy).ravel()], 1)
    sel = m.ravel()
    out = np.zeros_like(a)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A[sel], a[..., c].ravel()[sel], rcond=None)
        out[..., c] = (A @ coef).reshape(h, w)
    return out


def object_mask(a: np.ndarray, field: np.ndarray, thr: float = 8.0) -> np.ndarray:
    resid = np.abs(a - field).max(2)
    raw = resid > thr
    ratio = a / np.maximum(field, 1e-3)
    mean = ratio.mean(2)
    # a cast shadow is the ground scaled down evenly; an object is not
    neutral = np.abs(ratio - mean[..., None]).max(2) < 0.05
    shadow = neutral & (mean > 0.45) & (mean < 0.988)
    return raw & ~shadow


def partition(mask: np.ndarray, radius: int, min_area: float) -> list[np.ndarray]:
    """Erode to seeds, then hand every pixel to its nearest seed.

    Growing each seed back with binary_propagation is wrong here: within one
    connected blob every seed regrows to the whole blob, so a shadow-welded row
    of four objects comes back as the same strip four times.
    """
    core = ndimage.binary_erosion(mask, np.ones((radius, radius)))
    lab, n = ndimage.label(core)
    if n == 0:
        return []
    areas = ndimage.sum(core, lab, range(1, n + 1))
    keep = [i + 1 for i in range(n) if areas[i] >= min_area]
    if not keep:
        return []
    seeds = np.zeros_like(lab)
    for i, k in enumerate(keep):
        seeds[lab == k] = i + 1
    _, (iy, ix) = ndimage.distance_transform_edt(seeds == 0, return_indices=True)
    owner = seeds[iy, ix]
    return [ndimage.binary_fill_holes((owner == i + 1) & mask) for i in range(len(keep))]


def split_objects(mask: np.ndarray, min_area: int) -> list[np.ndarray]:
    return split_merged(partition(mask, 5, min_area), min_area)


def split_merged(parts, min_area):
    """Break up cells the cast shadow welded together.

    Neighbouring objects share a soft shadow, so one erosion radius sometimes
    leaves two or four of them in a single component. An outlier in size is
    re-partitioned with a harder erosion until it falls apart.
    """
    def longest(m):
        ys, xs = np.nonzero(m)
        return max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1)

    for _ in range(5):
        if len(parts) < 2:
            break
        sizes = [longest(m) for m in parts]
        med = float(np.median(sizes))
        nxt, changed = [], False
        for m, s in zip(parts, sizes):
            if s <= 1.9 * med:
                nxt.append(m)
                continue
            broke = None
            for r in (7, 9, 11, 13, 15, 19, 23):
                cand = partition(m, r, min_area * 0.35)
                if len(cand) >= 2:
                    broke = cand
                    break
            if broke:
                nxt.extend(broke); changed = True
            else:
                nxt.append(m)
        parts = nxt
        if not changed:
            break
    return parts


def grid_order(boxes):
    """Sort cells the way the sheet reads: rows top to bottom, then left to right."""
    heights = [b[3] - b[1] for b in boxes]
    tol = 0.55 * float(np.median(heights))
    rows, used = [], set()
    for i in sorted(range(len(boxes)), key=lambda i: boxes[i][1]):
        if i in used:
            continue
        row = [j for j in range(len(boxes))
               if j not in used and abs(boxes[j][1] - boxes[i][1]) <= tol]
        used.update(row)
        rows.append(sorted(row, key=lambda j: boxes[j][0]))
    return [i for row in rows for i in row]


def main() -> int:
    sheet = Path(sys.argv[1])
    outdir = Path(sys.argv[2])
    scale = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    outdir.mkdir(parents=True, exist_ok=True)

    im = Image.open(sheet).convert("RGB")
    a = np.asarray(im).astype(float)
    field = background_field(a)
    mask = object_mask(a, field)
    min_area = int(0.0012 * a.shape[0] * a.shape[1])
    parts = split_objects(mask, min_area)
    if not parts:
        print(json.dumps({"error": "sin objetos", "hoja": sheet.name}))
        return 1

    boxes = []
    for m in parts:
        ys, xs = np.nonzero(m)
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    order = grid_order(boxes)

    cells = []
    for rank, idx in enumerate(order):
        m = parts[idx]
        ys, xs = np.nonzero(m)
        pad = max(4, int(0.02 * (ys.max() - ys.min())))
        x0 = int(max(0, xs.min() - pad)); y0 = int(max(0, ys.min() - pad))
        x1 = int(min(a.shape[1], xs.max() + pad + 1)); y1 = int(min(a.shape[0], ys.max() + pad + 1))
        name = f"{sheet.stem}_{rank:02d}"
        crop = im.crop((x0, y0, x1, y1))
        crop.save(outdir / f"{name}.png")
        crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS).save(outdir / f"{name}_hi.png")
        sil = m[y0:y1, x0:x1]
        np.save(outdir / f"{name}_sil.npy", sil)
        by, bx = np.nonzero(~m)
        cells.append({"nombre": name, "caja": [x0, y0, x1, y1],
                      "tam": [int(x1 - x0), int(y1 - y0)],
                      "px": int(m.sum()),
                      "fondo": [int(round(v)) for v in np.median(a[by, bx], axis=0)]})

    (outdir / f"{sheet.stem}_celdas.json").write_text(json.dumps(cells, indent=1))

    # contact sheet so the split can be eyeballed before anything downstream runs
    cols = min(5, len(cells))
    rows = (len(cells) + cols - 1) // cols
    tw = th = 300
    sheet_img = Image.new("RGB", (cols * tw, rows * (th + 18)), (18, 18, 18))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet_img)
    for i, c in enumerate(cells):
        t = Image.open(outdir / f"{c['nombre']}.png")
        t.thumbnail((tw - 8, th - 8), Image.LANCZOS)
        x = (i % cols) * tw + (tw - t.width) // 2
        y = (i // cols) * (th + 18) + 18
        sheet_img.paste(t, (x, y))
        d.text(((i % cols) * tw + 4, (i // cols) * (th + 18) + 3),
               f"{i:02d} {c['tam'][0]}x{c['tam'][1]}", fill=(150, 230, 160))
    sheet_img.save(outdir / f"{sheet.stem}_contacto.png")
    print(json.dumps({"hoja": sheet.name, "objetos": len(cells),
                      "contacto": str(outdir / f"{sheet.stem}_contacto.png")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

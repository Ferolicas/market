"""Cut a reference sheet into cells using the catalogue's own grid.

The catalogue already records, for every object, both the meshes it is made of
and the cell it was drawn in -- row, column, and how many columns that row has.
Detecting blobs on the sheet and pairing them with 3D groups in reading order
instead was a mistake: the counts do not match (HUERTA has 29 objects and
clustering finds 25), and one missing object shifts every pairing after it, so
objects were coloured from a neighbour's picture.
"""
from __future__ import annotations

import json, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
from extract_reference_cells import background_field, object_mask, partition  # noqa: E402


def local_silhouette(win: np.ndarray, ring: int = 6):
    """Segment the object this cell is about.

    A column's share of the sheet often clips a slice of the neighbour, and that
    neighbour can be the larger shape in frame, so the component is chosen by
    how close it sits to the cell's centre rather than by area.
    """
    field = background_field(win, ring=ring)
    m = object_mask(win, field, thr=7.0)
    if m.sum() < 40:
        return None
    core = ndimage.binary_erosion(m, np.ones((3, 3)))
    lab, n = ndimage.label(core)
    if n == 0:
        return ndimage.binary_fill_holes(m)
    cy, cx = win.shape[0] / 2, win.shape[1] / 2
    best, score = None, -1e18
    for k in range(1, n + 1):
        piece = lab == k
        area = float(piece.sum())
        if area < 30:
            continue
        py, px = ndimage.center_of_mass(piece)
        dist = ((px - cx) / max(cx, 1)) ** 2 + ((py - cy) / max(cy, 1)) ** 2
        value = area ** 0.5 - 260.0 * dist
        if value > score:
            score, best = value, piece
    if best is None:
        return ndimage.binary_fill_holes(m)
    return ndimage.binary_fill_holes(ndimage.binary_propagation(best, mask=m))


def row_bands(mask: np.ndarray, rows: int) -> list[tuple[int, int]]:
    """Find the horizontal bands the sheet's rows occupy from where ink sits."""
    ink = mask.sum(1).astype(float)
    gaps = ink < max(1.0, 0.02 * ink.max())
    bands, start = [], None
    for y, empty in enumerate(gaps):
        if not empty and start is None:
            start = y
        elif empty and start is not None:
            if y - start > mask.shape[0] * 0.04:
                bands.append((start, y))
            start = None
    if start is not None:
        bands.append((start, mask.shape[0]))
    if len(bands) == rows:
        return bands
    # fall back to equal division when the shadows bridge two rows together
    h = mask.shape[0] / rows
    return [(int(r * h), int((r + 1) * h)) for r in range(rows)]


def main() -> int:
    report = json.loads(Path(sys.argv[1]).read_text())
    sheet_path = Path(sys.argv[2])
    outdir = Path(sys.argv[3])
    scale = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    outdir.mkdir(parents=True, exist_ok=True)
    stem = sheet_path.stem

    im = Image.open(sheet_path).convert("RGB")
    a = np.asarray(im).astype(float)
    mask = object_mask(a, background_field(a), thr=8.0)

    objects = report["objects"]
    rows = max(o["referenceCell"]["row"] for o in objects)
    bands = row_bands(mask, rows)

    blobs = partition(mask, 5, 0.0004 * a.shape[0] * a.shape[1])
    centres = []
    for m in blobs:
        ys, xs = np.nonzero(m)
        centres.append((float(xs.mean()), float(ys.mean()), m))

    cells, preview, problems = [], [], []
    for o in objects:
        rc = o["referenceCell"]
        r, c, n = rc["row"] - 1, rc["column"] - 1, rc["columnsInRow"]
        y0, y1 = bands[min(r, len(bands) - 1)]
        # blobs whose centre falls in this row, ordered left to right
        inrow = sorted([b for b in centres if y0 <= b[1] < y1], key=lambda b: b[0])
        m = inrow[c][2] if len(inrow) == n and c < len(inrow) else None
        if m is None:
            # the row did not split into the expected number of cells: fall back
            # to the column's share of the band and segment inside it
            w = a.shape[1] / n
            wx0, wx1 = int(c * w), int((c + 1) * w)
            win = a[y0:y1, wx0:wx1]
            sil = local_silhouette(win)
            if sil is None:
                problems.append({"id": o["id"], "motivo": "celda vacia"})
                continue
            oy, ox = y0, wx0
            problems.append({"id": o["id"], "motivo": "fila con reparto irregular"})
        else:
            ys, xs = np.nonzero(m)
            mw = int(0.14 * (xs.max() - xs.min() + 1)) + 8
            mh = int(0.14 * (ys.max() - ys.min() + 1)) + 8
            ox = int(max(0, xs.min() - mw)); oy = int(max(0, ys.min() - mh))
            wx1 = int(min(a.shape[1], xs.max() + mw + 1)); wy1 = int(min(a.shape[0], ys.max() + mh + 1))
            win = a[oy:wy1, ox:wx1]
            sil = local_silhouette(win)
            if sil is None:
                sil = m[oy:wy1, ox:wx1]

        ly, lx = np.nonzero(sil)
        if len(ly) < 40:
            problems.append({"id": o["id"], "motivo": "silueta vacia"})
            continue
        pad = max(3, int(0.03 * (ly.max() - ly.min() + 1)))
        lx0 = int(max(0, lx.min() - pad)); ly0 = int(max(0, ly.min() - pad))
        lx1 = int(min(sil.shape[1], lx.max() + pad + 1)); ly1 = int(min(sil.shape[0], ly.max() + pad + 1))
        bx0, by0 = ox + lx0, oy + ly0
        bx1, by1 = ox + lx1, oy + ly1
        name = f"{stem}_{o['id']}"
        crop = im.crop((bx0, by0, bx1, by1))
        crop.save(outdir / f"{name}.png")
        hi = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
        np.save(outdir / f"{name}_hi.npy", np.asarray(hi, dtype=np.uint8))
        np.save(outdir / f"{name}_sil.npy", sil[ly0:ly1, lx0:lx1])
        back = a[max(0, by0 - 12):by0, bx0:bx1]
        cells.append({"id": o["id"], "nombre": name, "piezas": o["sourceParts"],
                      "tris": o.get("trianglesAfter") or 50000,
                      "caja": [bx0, by0, bx1, by1],
                      "fondo": [int(round(v)) for v in (np.median(back.reshape(-1, 3), axis=0)
                                                        if back.size else np.array([232, 230, 227]))]})
        preview.append((o["id"], crop))

    (outdir / f"{stem}_celdas.json").write_text(json.dumps(cells, indent=1, ensure_ascii=False))

    cols = min(6, max(1, len(preview)))
    nrows = (len(preview) + cols - 1) // cols
    tw = th = 240
    sh = Image.new("RGB", (cols * tw, nrows * (th + 20)), (18, 18, 18))
    d = ImageDraw.Draw(sh)
    for i, (name, t) in enumerate(preview):
        t = t.copy(); t.thumbnail((tw - 8, th - 8), Image.LANCZOS)
        sh.paste(t, ((i % cols) * tw + (tw - t.width) // 2, (i // cols) * (th + 20) + 20))
        d.text(((i % cols) * tw + 4, (i // cols) * (th + 20) + 4), name[:26], fill=(150, 230, 160))
    sh.save(outdir / f"{stem}_contacto.png")
    print(json.dumps({"hoja": stem, "catalogo": len(objects), "recortados": len(cells),
                      "incidencias": problems}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

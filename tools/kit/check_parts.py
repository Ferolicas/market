"""Contact sheet of projected parts: sheet crop | seen from the sheet | from behind | from above.

    python3 tools/kit/check_parts.py <outdir> <sheet.png> <contact.png> [names...]

Reads <outdir>/lote.log (one PARTE json per part) for the crop box and the
viewing direction; renders with tools/kit/render_view.py.
"""
import sys, os, json, subprocess
from PIL import Image, ImageDraw
BL = os.environ.get("BLENDER", "/home/ferney_oliveros/software/blender-5.2.0-linux-x64/blender")
outdir, sheet, contact = sys.argv[1], sys.argv[2], sys.argv[3]
only = set(sys.argv[4:])
parts = [json.loads(l.split("PARTE ", 1)[1]) for l in open(os.path.join(outdir, "lote.log")) if l.startswith("PARTE ")]
parts = [p for p in parts if not only or p["nombre"] in only]
im = Image.open(sheet).convert("RGB")
N = 256; rows = []
here = os.path.dirname(os.path.abspath(__file__))
for p in parts:
    glb = os.path.join(outdir, p["nombre"] + ".glb")
    if not os.path.exists(glb): continue
    views = []
    az0 = p["camara"][0] + p["giro"]         # camera azimuth after the squaring turn
    for tag, az, el in (("vista", az0, p["el"]), ("detras", az0 + 180, p["el"]), ("arriba", 0, 89.9)):
        out = os.path.join(outdir, f"_{p['nombre']}_{tag}.png")
        if not os.path.exists(out):
            subprocess.run([BL, "-b", "-P", os.path.join(here, "render_view.py"), "--", glb, out, str(az), str(el), str(N)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        views.append(Image.open(out).convert("RGB") if os.path.exists(out) else Image.new("RGB", (N, N), "red"))
    x0, y0, x1, y1 = p["recorte"]; m = 24
    crop = im.crop((max(0, x0 - m), max(0, y0 - m), min(im.width, x1 + m), min(im.height, y1 + m)))
    k = N / max(crop.size); crop = crop.resize((max(1, int(crop.width * k)), max(1, int(crop.height * k))))
    cell = Image.new("RGB", (N, N), (206, 202, 200)); cell.paste(crop, ((N - crop.width) // 2, (N - crop.height) // 2))
    rows.append((p, [cell] + views))
W = 4 * (N + 6) + 6; H = len(rows) * (N + 26) + 6
c = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(c)
for r, (p, ims) in enumerate(rows):
    y = 6 + r * (N + 26)
    d.text((8, y), f"{p['nombre']}  caras {p['caras']}  vistas {p['vistas']:.2f}  espejadas {p.get('espejadas', 0):.2f} ({p.get('espejo', '')})  IoU {p['iou_inicial']:.2f}->{p['iou_afinado']:.2f}  giro {p['giro']:+.1f}  mide {p['mide']}", fill="black")
    for k, imk in enumerate(ims):
        c.paste(imk, (6 + k * (N + 6), y + 16))
c.save(contact); print("CONTACTO", contact, len(rows), "piezas")

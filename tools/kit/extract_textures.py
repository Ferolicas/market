"""Pull the texture out of a GLB: it travels embedded, there is no loose file.

    python3 tools/kit/extract_textures.py <outdir> <a.glb> [b.glb ...]
"""
import sys, os, json, struct
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for p in sys.argv[2:]:
    d = open(p, "rb").read(); assert d[:4] == b"glTF"
    off = 12; js = None; binoff = 0
    while off < len(d):
        ln, ty = struct.unpack_from("<II", d, off); off += 8
        if ty == 0x4E4F534A: js = json.loads(d[off:off+ln])
        else: binoff = off
        off += ln
    vistas = js.get("bufferViews", [])
    nombre = os.path.basename(p)[:-4]
    for i, im in enumerate(js.get("images", [])):
        if "bufferView" not in im: continue
        v = vistas[im["bufferView"]]
        datos = d[binoff + v.get("byteOffset", 0): binoff + v.get("byteOffset", 0) + v["byteLength"]]
        ext = ".jpg" if datos[:2] == b"\xff\xd8" else ".png"
        sufijo = "" if i == 0 else f"_{i}"
        ruta = os.path.join(out, f"{nombre}_textura{sufijo}{ext}")
        open(ruta, "wb").write(datos)
        print("TEXTURA", ruta, len(datos)//1024, "KB")

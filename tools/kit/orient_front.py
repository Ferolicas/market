"""Turn projected pieces so the side the sheet camera saw faces -y, then square.

    python3 tools/kit/orient_front.py <projdir> <outdir> [overrides.json]

Reads <projdir>/lote.log: each piece's camera azimuth `az` (0 = camera in
front, positive to the +x side). The turn is the multiple of 90 nearest to
`az`, so the face the camera looked at most becomes the front; a
`overrides.json` {"Name": degrees} adds a manual turn. Output GLBs keep their
textures.
"""
import sys, os, json, subprocess
BL = os.environ.get("BLENDER", "/home/ferney_oliveros/software/blender-5.2.0-linux-x64/blender")
src, out = sys.argv[1], sys.argv[2]
over = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
os.makedirs(out, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
for l in open(os.path.join(src, "lote.log")):
    if not l.startswith("PARTE "): continue
    p = json.loads(l.split("PARTE ", 1)[1]); name = p["nombre"]
    az = p["camara"][0] + p["giro"]          # camera azimuth after the squaring turn
    t = 90 * round(az / 90) + over.get(name, 0)
    g = os.path.join(src, name + ".glb")
    if not os.path.exists(g): continue
    r = subprocess.run([BL, "-b", "-P", os.path.join(here, "square_yaw.py"), "--", g, os.path.join(out, name + ".glb"),
                        f"giro={t}", "giro_fijo=1"], capture_output=True, text=True)
    ok = "GIRADA" in r.stdout
    print(f"{name:28s} az {az:+6.1f} giro {t:+4d} {'ok' if ok else 'FALLO'}")

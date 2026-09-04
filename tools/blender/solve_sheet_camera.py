"""Solve the one camera a reference sheet was rendered with.

Every object on a sheet is drawn from the same viewpoint, so solving a camera
per object is both wasteful and fragile: a squat or near-symmetric object has a
flat silhouette score and lands on a pose no other object agrees with. Fitting a
single pose against several objects at once pins it down.
"""
from __future__ import annotations

import json, math, os, sys
import bpy
import numpy as np
from mathutils import Vector


def opt(name, default=""):
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = f"--{name}="
    return next((a.removeprefix(p) for a in args if a.startswith(p)), default)


SOURCE = opt("source")
CELLS = json.loads(open(opt("cells")).read())
CELLDIR = opt("celldir")
OUT = opt("out")
NSAMP = int(opt("n", "4"))
TMP = os.path.dirname(OUT) or "."

usable = [c for c in CELLS if "nombre" in c]
sils = []
for c in usable:
    m = np.load(os.path.join(CELLDIR, c["nombre"] + "_sil.npy"))
    sils.append((c, m, int(m.sum())))
sils.sort(key=lambda t: -t[2])
chosen = sils[:NSAMP]
print("MUESTRAS " + json.dumps([c["nombre"] for c, _, _ in chosen]))

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SOURCE)
allmesh = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}
for o in allmesh.values():
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "SINGLE"
scene.display.shading.single_color = (1, 1, 1)
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_x = scene.render.resolution_y = 240
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_width = 36
SHOT = os.path.join(TMP, "_sheetcam.png")


def fit(m, n=140):
    ys, xs = np.nonzero(m)
    if len(ys) < 20:
        return None
    m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = m.shape
    k = (n - 2) / max(h, w)
    th, tw = max(1, int(round(h * k))), max(1, int(round(w * k)))
    yi = np.linspace(0, h - 1e-6, th).astype(int)
    xi = np.linspace(0, w - 1e-6, tw).astype(int)
    out = np.zeros((n, n), bool)
    y0, x0 = (n - th) // 2, (n - tw) // 2
    out[y0:y0 + th, x0:x0 + tw] = m[yi][:, xi]
    return out


# each sample object is centred and scaled on its own, exactly as the builder does
groups = []
for c, m, _ in chosen:
    objs = [allmesh[n] for n in c["piezas"] if n in allmesh]
    if not objs:
        continue
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for cc in o.bound_box:
            w = o.matrix_world @ Vector(cc)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    groups.append({"objs": objs, "centre": (lo + hi) / 2,
                   "k": 2.0 / max(max(hi - lo), 1e-9), "ref": fit(m), "nombre": c["nombre"]})

for g in groups:
    for o in g["objs"]:
        o["mm_centre"] = list(g["centre"])
        o["mm_k"] = g["k"]

for o in allmesh.values():
    o.hide_render = True


def score(az, el, dist, verbose=False):
    a, e = math.radians(az), math.radians(el)
    total = 0.0
    for g in groups:
        for o in allmesh.values():
            o.hide_render = True
        for o in g["objs"]:
            o.hide_render = False
        c = g["centre"]; k = g["k"]
        # frame this object the way the builder will: centred at the origin,
        # scaled so its longest axis spans 2
        cam_data.lens = 85.0 * dist / 5.0
        eye = Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))) * (dist / k)
        cam.location = c + eye
        cam.rotation_euler = (-eye).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        scene.render.filepath = SHOT
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(SHOT)
        b = np.empty(len(im.pixels), dtype=np.float32)
        im.pixels.foreach_get(b)
        bpy.data.images.remove(im)
        m = fit(b.reshape(240, 240, 4)[::-1, :, 3] > 0.5)
        if m is None or g["ref"] is None:
            continue
        iou = float((m & g["ref"]).sum()) / float(max((m | g["ref"]).sum(), 1))
        if verbose:
            print(f"    {g['nombre']}: {iou:.4f}")
        total += iou
    return total / max(len(groups), 1)


if opt("probe"):
    for spec in opt("probe").split(";"):
        az, el, dist = [float(x) for x in spec.split(",")]
        print(f"  sonda az={az} el={el} dist={dist} -> {score(az, el, dist, verbose=True):.4f}")
    raise SystemExit(0)

best = (0.0, 40.0, 15.0, 9.0)
for az in range(0, 91, 7):
    for el in range(0, 51, 7):
        for dist in (5.0, 10.0, 20.0):
            s = score(az, el, dist)
            if s > best[0]:
                best = (s, float(az), float(el), float(dist))
_, AZ, EL, DIST = best
for daz in (-5, -3, -1, 0, 1, 3, 5):
    for dele in (-5, -3, -1, 0, 1, 3, 5):
        for f in (0.65, 1.0, 1.5):
            s = score(AZ + daz, EL + dele, DIST * f)
            if s > best[0]:
                best = (s, AZ + daz, EL + dele, DIST * f)
S, AZ, EL, DIST = best
print(f"CAMARA_HOJA IoU_medio={S:.4f} az={AZ} el={EL} dist={DIST}")
json.dump({"iou": S, "az": AZ, "el": EL, "dist": DIST,
           "muestras": [g["nombre"] for g in groups]}, open(OUT, "w"), indent=1)

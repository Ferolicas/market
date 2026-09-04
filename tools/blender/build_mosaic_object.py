"""Rebuild one mosaic object so it matches its reference cell.

Generalises the entrance build. The delivered GLBs carry only POSITION and
NORMAL, so all colour comes from the sheet, and painting the sheet on by camera
projection does not survive contact with the mesh: Tripo's reconstruction is
close but not identical, so thin parts sample whatever sits behind them. Instead
each part is cut into regions -- here by clustering the colours its faces read
off the sheet, then smoothing the labels over the mesh so a boundary follows an
edge rather than zigzagging -- and each region's albedo is solved in a loop:
render, measure the region through an id pass, correct, repeat.
"""
from __future__ import annotations

import json, math, os, sys
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
from bpy_extras.object_utils import world_to_camera_view


def opt(name, default=""):
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = f"--{name}="
    return next((a.removeprefix(p) for a in args if a.startswith(p)), default)


SOURCE  = opt("source")
NODES   = [n for n in opt("nodes", "").split(",") if n]
REF     = opt("ref")            # high-res crop of the cell
REFNAT  = opt("refnative")      # native-res crop, same aspect
SIL     = opt("sil")            # silhouette .npy at native res
BACKDROP = json.loads(opt("backdrop", "[232,230,227]"))
SAMPLES = int(opt("samples", "260"))
RES     = int(opt("res", "1100"))
ROUNDS  = int(opt("rounds", "6"))
OUTPUT  = opt("output")
EXPORT  = opt("export", "")
REPORT  = opt("report", "")
MAXK    = int(opt("maxk", "4"))
TMP     = os.path.dirname(OUTPUT) or "."
NAME    = opt("name", "objeto")


def srgb_to_linear(c):
    c = np.asarray(c, dtype=float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=float), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255.0


# ---------------------------------------------------------------- load & frame
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SOURCE)
for o in list(bpy.context.scene.objects):
    if o.type != "MESH" or (NODES and o.name not in NODES):
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise RuntimeError("sin mallas")

for o in meshes:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for poly in o.data.polygons:
        poly.use_smooth = False

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo[i], w[i]) for i in range(3)))
        hi = Vector((max(hi[i], w[i]) for i in range(3)))
CENTRE = (lo + hi) / 2
K = 2.0 / max(max(hi - lo), 1e-9)
for o in meshes:
    for v in o.data.vertices:
        v.co = (v.co - CENTRE) * K
    o.data.update()
bpy.context.view_layer.update()


def separate_shells(objs, delta=0.0009):
    """Pull each shell in along its own normals by a hair.

    Tripo builds every part as a closed shell and neighbours end up sharing a
    surface. Coincident surfaces ray-trace as a speckled fringe, which reads as
    shavings around the contact.
    """
    for o in objs:
        acc = {}
        for poly in o.data.polygons:
            n = poly.normal.normalized()
            for vi in poly.vertices:
                acc[vi] = n if vi not in acc else acc[vi] + n
        for vi, n in acc.items():
            if n.length > 1e-6:
                o.data.vertices[vi].co -= n.normalized() * delta
        o.data.update()


separate_shells(meshes)
bpy.context.view_layer.update()

# ------------------------------------------------------------ reference sheet
# The sheet is read from a raw sRGB array, not through Blender's image loader:
# that loader returns PNG pixels still sRGB-encoded while claiming they are
# linear, so a near-black object samples as mid grey and every albedo solved
# from it comes out washed.
REFPX = srgb_to_linear(np.load(REF).astype(np.float32))
IH, IW = REFPX.shape[:2]
sil = np.load(SIL)
SH, SW = sil.shape


def erode(m, n):
    out = m.copy()
    for _ in range(n):
        e = out.copy()
        e[1:, :] &= out[:-1, :]; e[:-1, :] &= out[1:, :]
        e[:, 1:] &= out[:, :-1]; e[:, :-1] &= out[:, 1:]
        out = e
    return out


SIL_IN = erode(sil, max(2, int(0.012 * min(SH, SW))))
if SIL_IN.sum() < 60:
    SIL_IN = erode(sil, 1)
sy, sx = np.nonzero(sil)
U0, U1 = sx.min() / SW, (sx.max() + 1) / SW
V0, V1 = 1 - (sy.max() + 1) / SH, 1 - sy.min() / SH

# ------------------------------------------------------------ camera solving
scene = bpy.context.scene
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_width = 36


def place(az, el, dist):
    cam_data.lens = 85.0 * dist / 5.0
    a, e = math.radians(az), math.radians(el)
    cam.location = Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))) * dist
    cam.rotation_euler = (-cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()


def render_to_array(path, res, samples, transparent, raw=False, exr=False):
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.cycles.samples = samples
    scene.cycles.use_denoising = not raw
    scene.render.filter_size = 0.01 if raw else 1.5
    scene.render.film_transparent = transparent
    if exr:
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        scene.render.image_settings.color_mode = "RGBA"
    else:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(path)
    if exr:
        im.colorspace_settings.name = "Non-Color"
    b = np.empty(len(im.pixels), dtype=np.float32)
    im.pixels.foreach_get(b)
    ch = im.channels
    bpy.data.images.remove(im)
    return b.reshape(res, res, ch)[::-1]


def fit_canvas(m, n=150):
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


REF_CANVAS = fit_canvas(sil)
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "SINGLE"
scene.display.shading.single_color = (1, 1, 1)
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
SILPATH = os.path.join(TMP, f"_sil_{NAME}.png")


def silhouette_iou(az, el, dist):
    place(az, el, dist)
    scene.render.resolution_x = scene.render.resolution_y = 260
    scene.render.filepath = SILPATH
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(SILPATH)
    b = np.empty(len(im.pixels), dtype=np.float32)
    im.pixels.foreach_get(b)
    bpy.data.images.remove(im)
    m = fit_canvas(b.reshape(260, 260, 4)[::-1, :, 3] > 0.5)
    if m is None:
        return 0.0
    return float((m & REF_CANVAS).sum()) / float(max((m | REF_CANVAS).sum(), 1))


# A seed from the sheet-wide solve keeps a squat or near-symmetric object from
# wandering off to a pose no other object on the sheet agrees with.
SEED = opt("seed", "")
if SEED:
    sd = json.loads(open(SEED).read())
    best = (silhouette_iou(sd["az"], sd["el"], sd["dist"]), sd["az"], sd["el"], sd["dist"])
    for daz in (-9, -6, -3, 0, 3, 6, 9):
        for dele in (-9, -6, -3, 0, 3, 6, 9):
            for f in (0.75, 1.0, 1.35):
                az, el, dist = sd["az"] + daz, sd["el"] + dele, sd["dist"] * f
                s = silhouette_iou(az, el, dist)
                if s > best[0]:
                    best = (s, az, el, dist)
else:
    best = (0.0, 30.0, 15.0, 9.0)
    for az in range(0, 90, 6):
        for el in range(0, 46, 6):
            for dist in (5.0, 9.0, 18.0):
                s = silhouette_iou(az, el, dist)
                if s > best[0]:
                    best = (s, float(az), float(el), dist)
    _, AZ, EL, DIST = best
    for daz in (-4, -2, 0, 2, 4):
        for dele in (-4, -2, 0, 2, 4):
            for f in (0.7, 1.0, 1.5):
                s = silhouette_iou(AZ + daz, EL + dele, DIST * f)
                if s > best[0]:
                    best = (s, AZ + daz, EL + dele, DIST * f)
IOU, AZ, EL, DIST = best
place(AZ, EL, DIST)
print(f"CAMARA IoU={IOU:.4f} az={AZ} el={EL} dist={DIST}")

scene.render.engine = "CYCLES"
scene.cycles.use_denoising = True
prefs = bpy.context.preferences.addons["cycles"].preferences
for backend in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = backend
        prefs.get_devices()
        if any(d.type == backend for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type in (backend, "CPU")
            scene.cycles.device = "GPU"
            break
    except Exception:
        continue
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

# --------------------------------------------------------- sample the sheet
nx0 = ny0 = 1e9; nx1 = ny1 = -1e9
for o in meshes:
    for i in range(0, len(o.data.vertices), 2):
        p = world_to_camera_view(scene, cam, o.data.vertices[i].co)
        nx0 = min(nx0, p.x); nx1 = max(nx1, p.x)
        ny0 = min(ny0, p.y); ny1 = max(ny1, p.y)


def to_uv(p):
    return (U0 + (p.x - nx0) / max(nx1 - nx0, 1e-9) * (U1 - U0),
            V0 + (p.y - ny0) / max(ny1 - ny0, 1e-9) * (V1 - V0))


def sample_uv(u, v):
    if not (0 <= u <= 1 and 0 <= v <= 1):
        return None
    r = int(round((1 - v) * (SH - 1))); c = int(round(u * (SW - 1)))
    if not (0 <= r < SH and 0 <= c < SW and SIL_IN[r, c]):
        return None
    col = int(round(u * (IW - 1))); row = int(round(v * (IH - 1)))
    patch = REFPX[max(0, row - 2):row + 3, max(0, col - 2):col + 3].reshape(-1, 3)
    return np.median(patch, axis=0)


BACK_LIN = srgb_to_linear(BACKDROP)


def register_part(uvs):
    """Nudge a part's sampling window until its own colours agree.

    The camera is solved to a few per cent, which is fine for a chunky part and
    fatal for a thin one: a wire rack projected two per cent off reads the pale
    floor behind it and the whole part comes out the wrong colour. Shifting the
    window to wherever the part's samples are most self-consistent puts it back
    on its own pixels.
    """
    if len(uvs) < 24:
        return 0.0, 0.0
    step = max(1, len(uvs) // 380)
    probe = uvs[::step]
    best = (1e9, 0.0, 0.0)
    for du in np.linspace(-0.08, 0.08, 13):
        for dv in np.linspace(-0.08, 0.08, 13):
            cols = [c for c in (sample_uv(u + du, v + dv) for u, v in probe) if c is not None]
            if len(cols) < 0.45 * len(probe):
                continue
            arr = np.array(cols)
            med = np.median(arr, axis=0)
            mad = float(np.median(np.abs(arr - med).sum(1)))
            ground = float(np.exp(-((med - BACK_LIN) ** 2).sum() / 0.004))
            score = mad + 1.10 * ground
            if score < best[0]:
                best = (score, float(du), float(dv))
    return best[1], best[2]


from mathutils.bvhtree import BVHTree
verts_all, tris_all = [], []
for o in meshes:
    base = len(verts_all)
    verts_all += [v.co.copy() for v in o.data.vertices]
    for poly in o.data.polygons:
        vs = list(poly.vertices)
        for i in range(1, len(vs) - 1):
            tris_all.append((base + vs[0], base + vs[i], base + vs[i + 1]))
bvh = BVHTree.FromPolygons(verts_all, tris_all, all_triangles=True)
cam_pos = cam.matrix_world.translation

seen, shifts = {}, {}
for o in meshes:
    vis = []
    for poly in o.data.polygons:
        c = poly.center
        n = poly.normal.normalized()
        to_cam = cam_pos - c
        d = to_cam.length
        dirn = to_cam / d
        if n.dot(dirn) <= 0.25:
            continue
        if bvh.ray_cast(c + n * (d * 0.0015), dirn, d * 0.99)[0] is not None:
            continue
        vis.append((poly.index, to_uv(world_to_camera_view(scene, cam, c))))
    du, dv = register_part([uv for _, uv in vis])
    shifts[o.name] = (round(du, 4), round(dv, 4))
    got = {}
    for idx, (u, v) in vis:
        col = sample_uv(u + du, v + dv)
        if col is not None:
            got[idx] = col
    seen[o.name] = got
print("REGISTRO " + json.dumps(shifts))

_all = np.array([c for g in seen.values() for c in g.values()])
if len(_all):
    _l = _all @ np.array([0.2126, 0.7152, 0.0722])
    print("MUESTREO caras=%d  sRGB p10=%s p50=%s p90=%s" % (
        len(_all),
        [int(round(x)) for x in linear_to_srgb(np.percentile(_all, 10, axis=0))],
        [int(round(x)) for x in linear_to_srgb(np.percentile(_all, 50, axis=0))],
        [int(round(x)) for x in linear_to_srgb(np.percentile(_all, 90, axis=0))]))
    _ref = REFPX.reshape(-1, 3)
    print("HOJA_CRUDA sRGB p10=%s p50=%s p90=%s  silueta_util=%d de %d" % (
        [int(round(x)) for x in linear_to_srgb(np.percentile(_ref, 10, axis=0))],
        [int(round(x)) for x in linear_to_srgb(np.percentile(_ref, 50, axis=0))],
        [int(round(x)) for x in linear_to_srgb(np.percentile(_ref, 90, axis=0))],
        int(SIL_IN.sum()), int(sil.sum())))

# --------------------------------------------- cluster colours into regions
def kmeans(pts, k, iters=30):
    idx = np.linspace(0, len(pts) - 1, k).astype(int)
    c = pts[idx].astype(float).copy()
    lab = np.zeros(len(pts), int)
    for _ in range(iters):
        lab = np.argmin(((pts[:, None, :] - c[None, :, :]) ** 2).sum(2), 1)
        for j in range(k):
            if (lab == j).any():
                c[j] = pts[lab == j].mean(0)
    inertia = float(((pts - c[lab]) ** 2).sum())
    return lab, c, inertia


face_region, targets = {}, {}
for o in meshes:
    got = seen[o.name]
    if len(got) < 40:
        face_region.update({(o.name, p.index): f"{o.name}:0" for p in o.data.polygons})
        targets.setdefault(f"{o.name}:0", np.array([0.55, 0.52, 0.47]))
        continue
    order = sorted(got)
    pts = np.array([got[i] for i in order])
    # Cluster on colour AND position. With the camera only approximately solved,
    # a face here and there samples its neighbour's colour; clustering on colour
    # alone scatters those across the mesh as speckle, while the position terms
    # keep a region contiguous and let the later median absorb the strays.
    cen = np.array([[o.data.polygons[i].center.x,
                     o.data.polygons[i].center.y,
                     o.data.polygons[i].center.z] for i in order])
    nrm = np.array([[*o.data.polygons[i].normal.normalized()] for i in order])
    span = max(float(cen.max() - cen.min()), 1e-6)
    feat = np.concatenate([pts, 0.55 * cen / span, 0.30 * nrm], axis=1)
    limit = MAXK
    best_k, best_lab = 1, np.zeros(len(pts), int)
    prev = float(((feat - feat.mean(0)) ** 2).sum())
    for k in range(2, limit + 1):
        lab, c, inertia = kmeans(feat, k)
        if inertia > 0.70 * prev:          # no worthwhile gain: stop splitting
            break
        best_k, best_lab = k, lab
        prev = inertia
    label_of = {fi: int(best_lab[j]) for j, fi in enumerate(order)}
    for p in o.data.polygons:
        face_region[(o.name, p.index)] = f"{o.name}:{label_of.get(p.index, -1)}"
    # faces with no sample inherit the nearest sampled face
    unknown = [p.index for p in o.data.polygons if p.index not in label_of]
    if unknown and label_of:
        tree = KDTree(len(label_of))
        keys = list(label_of)
        for j, fi in enumerate(keys):
            tree.insert(o.data.polygons[fi].center, j)
        tree.balance()
        for fi in unknown:
            _, j, _ = tree.find(o.data.polygons[fi].center)
            face_region[(o.name, fi)] = f"{o.name}:{label_of[keys[j]]}"
    for j in range(best_k):
        sel = pts[best_lab == j]
        if len(sel):
            targets[f"{o.name}:{j}"] = np.median(sel, axis=0)


def smooth_labels(obj, rounds=8):
    mesh = obj.data
    nbr = [[] for _ in range(len(mesh.polygons))]
    ef = {}
    for poly in mesh.polygons:
        for ek in poly.edge_keys:
            ef.setdefault(ek, []).append(poly.index)
    for f in ef.values():
        if len(f) == 2:
            nbr[f[0]].append(f[1]); nbr[f[1]].append(f[0])
    labels = [face_region[(obj.name, i)] for i in range(len(mesh.polygons))]
    for _ in range(rounds):
        nxt = labels[:]
        for i, ns in enumerate(nbr):
            if not ns:
                continue
            t = {labels[i]: 1}
            for j in ns:
                t[labels[j]] = t.get(labels[j], 0) + 1
            nxt[i] = max(t.items(), key=lambda kv: kv[1])[0]
        labels = nxt
    for i, l in enumerate(labels):
        face_region[(obj.name, i)] = l


for o in meshes:
    if len({face_region[(o.name, p.index)] for p in o.data.polygons}) > 1:
        smooth_labels(o)

regions = sorted({v for v in face_region.values() if not v.endswith(":-1")})
for r in list(face_region):
    if face_region[r].endswith(":-1"):
        face_region[r] = regions[0] if regions else "fallback:0"
regions = sorted(set(face_region.values()))
for r in regions:
    targets.setdefault(r, np.array([0.55, 0.52, 0.47]))
print(f"REGIONES {len(regions)} " + json.dumps(
    {r: [int(round(x)) for x in linear_to_srgb(targets[r])] for r in regions}))

# ------------------------------------------------------------------ materials
albedo = {r: targets[r].copy() for r in regions}
mats = {}
for r in regions:
    m = bpy.data.materials.new(r)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*np.clip(albedo[r], 0, 1), 1)
    b.inputs["Roughness"].default_value = 0.52
    mats[r] = m
for o in meshes:
    o.data.materials.clear()
    slots = {}
    for r in sorted({face_region[(o.name, p.index)] for p in o.data.polygons}):
        slots[r] = len(slots)
        o.data.materials.append(mats[r])
    for poly in o.data.polygons:
        poly.material_index = slots[face_region[(o.name, poly.index)]]

# ------------------------------------------------------------------ lighting
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
WRGB = tuple(float(x) for x in srgb_to_linear(BACKDROP))
world.node_tree.nodes["Background"].inputs[0].default_value = (*WRGB, 1)
LIGHT = Vector((-0.52, -0.66, 0.54)).normalized()
kd = bpy.data.lights.new("key", type="AREA"); kd.energy = 900; kd.size = 7
key = bpy.data.objects.new("key", kd); scene.collection.objects.link(key)
key.location = LIGHT * 8
key.rotation_euler = (-LIGHT).to_track_quat("-Z", "Y").to_euler()
FD = Vector((0.72, -0.42, 0.42)).normalized()
fd = bpy.data.lights.new("fill", type="AREA"); fd.energy = 240; fd.size = 12
fil = bpy.data.objects.new("fill", fd); scene.collection.objects.link(fil)
fil.location = FD * 9
fil.rotation_euler = (-FD).to_track_quat("-Z", "Y").to_euler()

zmin = min(min(v.co.z for v in o.data.vertices) for o in meshes)
bpy.ops.mesh.primitive_plane_add(size=90, location=(0, 0, zmin - 0.004))
floor = bpy.context.active_object
fm = bpy.data.materials.new("fondo"); fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*WRGB, 1)
floor.is_shadow_catcher = True

# ---------------------------------------------- solve albedos against the sheet
CAL = 420
ids = {r: i + 1 for i, r in enumerate(regions)}
id_mats = {}
for r, i in ids.items():
    m = bpy.data.materials.new("id_" + r)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (i / 64.0, i / 64.0, i / 64.0, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    id_mats[r] = m

keep_mats = {o.name: list(o.data.materials) for o in meshes}
for o in meshes:
    for i, m in enumerate(o.data.materials):
        o.data.materials[i] = id_mats[m.name]
floor.hide_render = True; key.hide_render = True; fil.hide_render = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
idp = render_to_array(os.path.join(TMP, f"_id_{NAME}.exr"), CAL, 1, True, raw=True, exr=True)
world.node_tree.nodes["Background"].inputs[0].default_value = (*WRGB, 1)
key.hide_render = False; fil.hide_render = False
for o in meshes:
    for i, m in enumerate(keep_mats[o.name]):
        o.data.materials[i] = m

vals = idp[..., 0] * 64.0
masks = {}
for r, i in ids.items():
    m = (np.abs(vals - i) < 0.2) & (idp[..., 3] > 0.995)
    if m.sum() >= 30:
        masks[r] = m

for _ in range(ROUNDS):
    arr = render_to_array(os.path.join(TMP, f"_cal_{NAME}.exr"), CAL, 40, True, exr=True)
    lit = arr[..., :3]
    for r, m in masks.items():
        got = np.median(lit[m], axis=0)
        k = np.clip(targets[r] / np.maximum(got, 1e-4), 0.25, 4.0)
        albedo[r] = np.clip(albedo[r] * k, 0.002, 0.99)
        mats[r].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*albedo[r], 1)

ver = render_to_array(os.path.join(TMP, f"_ver_{NAME}.exr"), CAL, 64, True, exr=True)
errs = {}
for r, m in masks.items():
    got = np.median(ver[..., :3][m], axis=0)
    errs[r] = float(np.max(np.abs(linear_to_srgb(got) - linear_to_srgb(targets[r]))))
worst = max(errs.values()) if errs else 0.0
suspect = [r for r in regions
           if float(np.abs(linear_to_srgb(albedo[r]) - linear_to_srgb(BACK_LIN)).max()) < 14]
print(f"COLOR peor_error={worst:.1f} niveles sRGB en {len(masks)} regiones medidas"
      + (f" | sospechosas(color de suelo): {suspect}" if suspect else ""))

# ------------------------------------------------------------------- framing
def frame_object(fill=0.74, iterations=4):
    box = None
    for _ in range(iterations + 1):
        bpy.context.view_layer.update()
        x0 = y0 = 1e9; x1 = y1 = -1e9
        for o in meshes:
            for i in range(0, len(o.data.vertices), 3):
                p = world_to_camera_view(scene, cam, o.data.vertices[i].co)
                x0 = min(x0, p.x); x1 = max(x1, p.x)
                y0 = min(y0, p.y); y1 = max(y1, p.y)
        box = (x0, x1, y0, y1)
        cam_data.lens *= fill / max(x1 - x0, y1 - y0, 1e-6)
    return box


BOX = frame_object()
floor.hide_render = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.render.image_settings.color_mode = "RGB"
scene.render.film_transparent = False
scene.cycles.use_denoising = True
scene.render.filter_size = 1.5
scene.render.resolution_x = scene.render.resolution_y = RES
scene.cycles.samples = SAMPLES
scene.render.filepath = OUTPUT
bpy.ops.render.render(write_still=True)

if EXPORT:
    for ob in (floor, cam, key, fil):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=EXPORT, export_format="GLB",
                              use_selection=True, export_materials="EXPORT",
                              export_yup=True)

if REPORT:
    json.dump({"nombre": NAME, "piezas": NODES, "iou": IOU,
               "sospechosas": suspect, "registro": shifts,
               "camara": {"az": AZ, "el": EL, "dist": DIST},
               "regiones": {r: [int(round(x)) for x in linear_to_srgb(albedo[r])] for r in regions},
               "objetivos": {r: [int(round(x)) for x in linear_to_srgb(targets[r])] for r in regions},
               "peor_error_srgb": worst,
               "recorte": [float(v) for v in BOX]}, open(REPORT, "w"), indent=1)
print("OBJETO_OK " + OUTPUT)

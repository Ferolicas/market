"""Build the store entrance to match its reference sheet, region by region.

The delivered GLB carries only POSITION and NORMAL, so every colour has to come
from the sheet. Painting the sheet on by camera projection does not work here:
Tripo's reconstruction is close but not identical to the illustration, so thin
parts -- the bollards, the door frame -- sample the pale floor behind them and
come out washed. Instead the mesh is cut into the regions the reference itself
distinguishes, each region gets one material, and the material's albedo is
solved: render, measure the region, correct, repeat, until the rendered colour
lands on the colour read off the sheet.

Two thresholds are measured from the mesh rather than guessed -- the slab top
and the cornice top are the strongest horizontal planes in the lower and upper
halves of the shell.

The plaque is the one place geometry has to change: Tripo generated garbled
pseudo-lettering in relief that reads as neither ENTRADA nor its mirror. The
relief is flattened back to the panel plane and real type is set in its place.
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


SOURCE  = opt("source")
NODES   = [n for n in opt("nodes", "").split(",") if n]
REF     = opt("ref")
SIL     = opt("sil")
TARGETS = json.loads(open(opt("targets")).read())
AZ      = float(opt("azimuth", "31.5"))
EL      = float(opt("elevation", "10"))
DIST    = float(opt("distance", "10.8"))
SAMPLES = int(opt("samples", "512"))
RES     = int(opt("res", "1400"))
ROUNDS  = int(opt("rounds", "3"))
OUTPUT  = opt("output")
FONT    = opt("font", "/usr/share/fonts/liberation/LiberationSans-Bold.ttf")
TEXT    = opt("text", "ENTRADA")
DIAG    = opt("diagnostic", "")
SWEEP   = opt("sweep", "")     # "az0,az1,step,el0,el1,step,d0:d1:d2" -> solve the framing

TMP     = os.path.dirname(OUTPUT)


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
K = 2.0 / max(hi - lo)
for o in meshes:
    for v in o.data.vertices:
        v.co = (v.co - CENTRE) * K
    o.data.update()
bpy.context.view_layer.update()

# --------------------------- measure the horizontal planes instead of guessing
shell = bpy.data.objects.get("tripo_part_3")


def strongest_plane(obj, lower, upper):
    zs, ars = [], []
    for p in obj.data.polygons:
        n = p.normal.normalized()
        if n.z > 0.85 and lower <= p.center.z <= upper:
            zs.append(p.center.z); ars.append(p.area)
    if not zs:
        return None
    zs = np.array(zs); ars = np.array(ars)
    h, edges = np.histogram(zs, bins=90, range=(lower, upper), weights=ars)
    i = int(np.argmax(h))
    return float((edges[i] + edges[i + 1]) / 2)


SLAB_TOP = strongest_plane(shell, -0.95, -0.2) if shell else -0.7
CORNICE_TOP = strongest_plane(shell, 0.3, 0.95) if shell else 0.85
print(f"PLANOS losa_superior={SLAB_TOP:+.4f}  cornisa_superior={CORNICE_TOP:+.4f}")

# ------------------------------------------------------------- plaque surgery
sign = bpy.data.objects.get("tripo_part_24")
letter_box = None
PANEL_Y = RIM_Y = None
if sign:
    # The plaque is three parallel planes: a raised outer rim, the lettering
    # relief, and the recessed panel behind them. Measure them instead of
    # hard-coding, because the numbers move whenever the part list changes the
    # group's bounding box and therefore its normalisation.
    ys, ars = [], []
    for poly in sign.data.polygons:
        if poly.normal.normalized().y < -0.85:
            ys.append(poly.center.y); ars.append(poly.area)
    ys = np.array(ys); ars = np.array(ars)
    h, edges = np.histogram(ys, bins=48, weights=ars)
    h = h / h.sum()
    mid = (edges[:-1] + edges[1:]) / 2
    peaks = [i for i in range(len(h)) if h[i] > 0.05
             and h[i] >= h[max(0, i - 1)] and h[i] >= h[min(len(h) - 1, i + 1)]]
    if len(peaks) >= 3:
        PANEL_Y = float(mid[max(peaks, key=lambda i: h[i])])
        RIM_Y = float(mid[min(peaks)])
        inner = [i for i in peaks if mid[i] > RIM_Y + 1e-6 and mid[i] < PANEL_Y - 1e-6]
        LET_Y = float(mid[max(inner, key=lambda i: h[i])]) if inner else (RIM_Y + PANEL_Y) / 2
        print(f"ROTULO planos borde={RIM_Y:+.4f} letras={LET_Y:+.4f} panel={PANEL_Y:+.4f} "
              f"(picos {[round(float(mid[i]),4) for i in peaks]})")
        # Bound the surgery by the lettering plane's own faces. Selecting on
        # depth alone also catches the rim's inner bevel, whose intermediate
        # vertices sit at the same depth, and flattening those erases the
        # plaque's recess.
        lx, lz = [], []
        for poly in sign.data.polygons:
            if poly.normal.normalized().y < -0.85 and abs(poly.center.y - LET_Y) < 0.004:
                lx.append(poly.center.x); lz.append(poly.center.z)
        if not lx:
            raise RuntimeError("no se localizo el plano de las letras")
        # Flatten the whole recess, bounded by the panel plane's own rectangle.
        # Using only the box the lettering faces fill leaves stray relief just
        # outside it, which reads as a ghost of the garbled text beside the new
        # type. Insetting a little keeps the rim's bevel, which sits at the
        # recess boundary and shares the same depth range as the relief.
        prx = [poly.center.x for poly in sign.data.polygons
               if poly.normal.normalized().y < -0.85 and abs(poly.center.y - PANEL_Y) < 0.0035]
        prz = [poly.center.z for poly in sign.data.polygons
               if poly.normal.normalized().y < -0.85 and abs(poly.center.y - PANEL_Y) < 0.0035]
        if not prx:
            raise RuntimeError("no se localizo el plano del panel")
        rx0, rx1, rz0, rz1 = min(prx), max(prx), min(prz), max(prz)
        ix = 0.018 * (rx1 - rx0); iz = 0.018 * (rz1 - rz0)
        bx0, bx1 = rx0 + ix, rx1 - ix
        bz0, bz1 = rz0 + iz, rz1 - iz
        print(f"ROTULO rebaje X[{rx0:+.3f},{rx1:+.3f}] Z[{rz0:+.3f},{rz1:+.3f}] "
              f"placa X[{min(v.co.x for v in sign.data.vertices):+.3f},"
              f"{max(v.co.x for v in sign.data.vertices):+.3f}] "
              f"Z[{min(v.co.z for v in sign.data.vertices):+.3f},"
              f"{max(v.co.z for v in sign.data.vertices):+.3f}]")
        # Pull engraved marks forward as well as raised ones: Tripo left the
        # pseudo-lettering partly cut into the panel.
        # Snap to the panel's exact plane, not the histogram bin centre. Half a
        # thousandth of error leaves each letter's side walls standing as a
        # hairline outline, which is exactly what the ghost was.
        near = [poly.center.y for poly in sign.data.polygons
                if poly.normal.normalized().y < -0.85 and abs(poly.center.y - PANEL_Y) < 0.0035]
        PANEL_Y = float(np.median(near))
        # Bias the cut towards the rim so relief that stands taller than half
        # way to it is caught too; the recess rectangle keeps the rim safe.
        cut = RIM_Y + 0.28 * (LET_Y - RIM_Y)
        sel = [v for v in sign.data.vertices
               if cut < v.co.y < PANEL_Y + 0.005 and bx0 <= v.co.x <= bx1 and bz0 <= v.co.z <= bz1]
        if sel:
            letter_box = (min(lx), max(lx), min(lz), max(lz))
            for v in sel:
                v.co.y = PANEL_Y
            sign.data.update()
            # Flattening collapses each letter's side walls to zero-area faces.
            # Left in place they keep a normal of their own and shade as a ghost
            # of the garbled text, so they go and the seam is welded shut.
            import bmesh
            bm = bmesh.new(); bm.from_mesh(sign.data)
            dead = [f for f in bm.faces if f.calc_area() < 1.2e-6]
            bmesh.ops.delete(bm, geom=dead, context="FACES_ONLY")
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=4e-4)
            bm.to_mesh(sign.data); bm.free()
            sign.data.update()
            print(f"ROTULO relieve aplanado: {len(sel)} vertices, {len(dead)} caras degeneradas fuera, "
                  f"banda X[{letter_box[0]:+.3f},{letter_box[1]:+.3f}] Z[{letter_box[2]:+.3f},{letter_box[3]:+.3f}]")
            px, pz = [], []
            for poly in sign.data.polygons:
                if poly.normal.normalized().y < -0.85 and abs(poly.center.y - PANEL_Y) < 0.0035:
                    px.append(poly.center.x); pz.append(poly.center.z)
            if px:
                cx = (min(px) + max(px)) / 2; cz = (min(pz) + max(pz)) / 2
                halfz = (letter_box[3] - letter_box[2]) / 2
                halfx = (letter_box[1] - letter_box[0]) / 2
                letter_box = (cx - halfx, cx + halfx, cz - halfz, cz + halfz)
                print(f"ROTULO panel centro X{cx:+.3f} Z{cz:+.3f}; texto recentrado")

# --------------------------------------------------------------- segmentation
bounds = {}
for o in meshes:
    co = np.array([[v.co.x, v.co.y, v.co.z] for v in o.data.vertices])
    bounds[o.name] = (co.min(0), co.max(0))


def region_of(part, c, n):
    mn, mx = bounds[part]
    if part == "tripo_part_3":
        # Split on the plane AND the normal. A plain height cut runs through the
        # rounded transition between slab and wall, and since face centres there
        # straddle it by a triangle, the boundary comes out as a sawtooth of two
        # colours -- the "plastic shavings" along the base.
        if n.z > 0.5 and c.z <= SLAB_TOP + 0.02:
            return "losa_superficie"
        if c.z < SLAB_TOP - 0.004:
            return "losa_canto"
        if c.z >= CORNICE_TOP - 0.02 and n.z > 0.6:
            return "cornisa"
        return "muro"
    if part == "tripo_part_24":
        return "placa_borde" if c.y < RIM_Y else "placa_panel"
    if part in ("tripo_part_29", "tripo_part_30"):
        fz = (c.z - mn[2]) / max(mx[2] - mn[2], 1e-6)
        return "bolardo_capitel" if fz > 0.84 else "bolardo_cuerpo"
    if part in ("tripo_part_27", "tripo_part_47"):
        return "cristal"
    if part == "tripo_part_31":
        return "marco"
    return "detalle"


face_region = {}
for o in meshes:
    for poly in o.data.polygons:
        face_region[(o.name, poly.index)] = region_of(o.name, poly.center, poly.normal.normalized())


def smooth_labels(obj, rounds=4):
    """Majority vote over edge neighbours, so a region boundary follows the mesh
    instead of zigzagging one triangle either side of a numeric threshold."""
    mesh = obj.data
    nbr = [[] for _ in range(len(mesh.polygons))]
    edge_faces = {}
    for poly in mesh.polygons:
        for ek in poly.edge_keys:
            edge_faces.setdefault(ek, []).append(poly.index)
    for faces in edge_faces.values():
        if len(faces) == 2:
            a, b = faces
            nbr[a].append(b); nbr[b].append(a)
    labels = [face_region[(obj.name, i)] for i in range(len(mesh.polygons))]
    for _ in range(rounds):
        nxt = labels[:]
        for i, ns in enumerate(nbr):
            if not ns:
                continue
            tally = {labels[i]: 1}
            for j in ns:
                tally[labels[j]] = tally.get(labels[j], 0) + 1
            nxt[i] = max(tally.items(), key=lambda kv: kv[1])[0]
        labels = nxt
    changed = sum(1 for i, l in enumerate(labels) if l != face_region[(obj.name, i)])
    for i, l in enumerate(labels):
        face_region[(obj.name, i)] = l
    return changed


total_smoothed = 0
for o in meshes:
    if len({face_region[(o.name, p.index)] for p in o.data.polygons}) > 1:
        total_smoothed += smooth_labels(o)
census = {}
for o in meshes:
    for poly in o.data.polygons:
        r = face_region[(o.name, poly.index)]
        census[r] = census.get(r, 0) + 1
print(f"SUAVIZADO {total_smoothed} caras reasignadas en la frontera")
print("CENSO " + json.dumps(census))


def separate_shells(objs, delta=0.0009):
    """Pull every shell in along its own normals by a hair.

    Tripo builds each part as its own closed shell and neighbours end up sharing
    a surface -- the bollard's foot sits exactly on the slab. Coincident surfaces
    ray-trace as a speckled fringe, which reads as shavings around the contact.
    """
    moved = 0
    for o in objs:
        normals = {}
        for poly in o.data.polygons:
            n = poly.normal.normalized()
            for vi in poly.vertices:
                acc = normals.get(vi)
                normals[vi] = n if acc is None else (acc + n)
        for vi, n in normals.items():
            if n.length > 1e-6:
                o.data.vertices[vi].co -= n.normalized() * delta
                moved += 1
        o.data.update()
    return moved


print(f"SEPARACION {separate_shells(meshes)} vertices retraidos")

# ---------------------------------------------------------------- camera setup
scene = bpy.context.scene
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_width = 36
cam_data.lens = 85.0 * DIST / 5.0
a = math.radians(AZ); e = math.radians(EL)
cam.location = Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))) * DIST
cam.rotation_euler = (-cam.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.view_layer.update()

# ------------------------------------------------------------------ materials
ROUGH = {"cristal": 0.26, "placa_borde": 0.42, "placa_panel": 0.44, "marco": 0.46,
         "bolardo_capitel": 0.38, "bolardo_cuerpo": 0.42, "losa_superficie": 0.62,
         "losa_canto": 0.60, "muro": 0.56, "cornisa": 0.54, "detalle": 0.5, "letras": 0.46}
SHARED = {"cornisa": "muro", "losa_canto": "losa_superficie",
          "bolardo_capitel": "bolardo_cuerpo"}      # one material, lighting does the rest

albedo = {k: srgb_to_linear(v) for k, v in TARGETS.items()}
mats = {}
for reg in sorted(set(list(face_region.values()) + ["letras"])):
    base = SHARED.get(reg, reg)
    m = bpy.data.materials.new(reg)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*albedo.get(base, [0.5, 0.5, 0.5]), 1)
    b.inputs["Roughness"].default_value = ROUGH.get(reg, 0.5)
    if reg == "cristal":
        b.inputs["Specular IOR Level"].default_value = 0.34
    mats[reg] = m

for o in meshes:
    o.data.materials.clear()
    slots = {}
    for reg in sorted({face_region[(o.name, p.index)] for p in o.data.polygons}):
        slots[reg] = len(slots)
        o.data.materials.append(mats[reg])
    for poly in o.data.polygons:
        poly.material_index = slots[face_region[(o.name, poly.index)]]

# ------------------------------------------------------------------- lettering
letters_obj = None
if sign and letter_box:
    x0, x1, z0, z1 = letter_box
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.body = TEXT
    t.data.font = bpy.data.fonts.load(FONT)
    t.data.align_x = "CENTER"; t.data.align_y = "CENTER"
    t.data.extrude = 0.0032
    t.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.convert(target="MESH")
    t = bpy.context.object
    bpy.ops.object.select_all(action="DESELECT")
    t.select_set(True); bpy.context.view_layer.objects.active = t
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    co = np.array([[v.co.x, v.co.y, v.co.z] for v in t.data.vertices])
    s = 0.9 * (x1 - x0) / max(co[:, 0].max() - co[:, 0].min(), 1e-6)
    for v in t.data.vertices:
        v.co *= s
    co = np.array([[v.co.x, v.co.y, v.co.z] for v in t.data.vertices])
    shift = Vector(((x0 + x1) / 2 - (co[:, 0].min() + co[:, 0].max()) / 2,
                    PANEL_Y - co[:, 1].max() - 0.0008,
                    (z0 + z1) / 2 - (co[:, 2].min() + co[:, 2].max()) / 2))
    for v in t.data.vertices:
        v.co += shift
    t.data.update()
    t.data.materials.append(mats["letras"])
    letters_obj = t
    for poly in t.data.polygons:
        face_region[(t.name, poly.index)] = "letras"
    meshes.append(t)
    co = np.array([[v.co.x, v.co.y, v.co.z] for v in t.data.vertices])
    print(f"LETRAS colocadas X[{co[:,0].min():+.3f},{co[:,0].max():+.3f}] "
          f"Y[{co[:,1].min():+.3f},{co[:,1].max():+.3f}] Z[{co[:,2].min():+.3f},{co[:,2].max():+.3f}]")

# ------------------------------------------------------------------ scene look
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
            print("GPU " + backend)
            break
    except Exception:
        continue
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "PNG"

sheet_bg = json.loads(open(opt("backdrop")).read()) if opt("backdrop") else [232, 230, 227]
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
WORLD_RGB = tuple(float(x) for x in srgb_to_linear(sheet_bg))
world.node_tree.nodes["Background"].inputs[0].default_value = (*WORLD_RGB, 1)

zmin = min(bounds[o.name][0][2] for o in meshes if o.name in bounds)
bpy.ops.mesh.primitive_plane_add(size=90, location=(0, 0, zmin - 0.004))
floor = bpy.context.active_object
fm = bpy.data.materials.new("fondo"); fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb_to_linear(sheet_bg), 1)
fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.96
floor.data.materials.append(fm)

# The sheet is lit from the upper left front; matching it keeps the shading and
# the cast shadow falling the same way.
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

# --------------------------------------------------- solve the albedos by loop
CAL_RES = 460
ID_COLOURS = {}
for i, reg in enumerate(sorted(set(face_region.values()))):
    ID_COLOURS[reg] = i + 1


def render_to_array(path, res, samples, transparent, raw=False, exr=False):
    """Render and read the result back.

    Measurement passes go through 32-bit EXR: an 8-bit PNG round trip runs the
    values through colour management, so what comes back is not what was
    rendered and both the id lookup and the albedo correction read nonsense.
    """
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.cycles.samples = samples
    # An id pass must not be filtered either: denoising and pixel AA average
    # neighbouring ids into values that belong to no region at all.
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
    buf = np.empty(len(im.pixels), dtype=np.float32)
    im.pixels.foreach_get(buf)
    ch = im.channels
    bpy.data.images.remove(im)
    return buf.reshape(res, res, ch)[::-1]


# ID pass: every region flat-emits a unique value, so each region can be
# measured in the beauty render without guessing where it landed on screen.
id_mats = {}
for reg, idx in ID_COLOURS.items():
    m = bpy.data.materials.new("id_" + reg)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (idx / 64.0, idx / 64.0, idx / 64.0, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    id_mats[reg] = m

beauty_mats = {}
for o in meshes:
    beauty_mats[o.name] = list(o.data.materials)
    for i, m in enumerate(o.data.materials):
        o.data.materials[i] = id_mats[m.name]
floor.hide_render = True
key.hide_render = True; fil.hide_render = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
idp = render_to_array(os.path.join(TMP, "_id.exr"), CAL_RES, 1, True, raw=True, exr=True)
world.node_tree.nodes["Background"].inputs[0].default_value = (*WORLD_RGB, 1)
key.hide_render = False; fil.hide_render = False
for o in meshes:
    for i, m in enumerate(beauty_mats[o.name]):
        o.data.materials[i] = m

ids = idp[..., 0] * 64.0
op = idp[..., 3]
vals = ids[op > 0.9]
if len(vals):
    u, cnt = np.unique(np.round(vals, 3), return_counts=True)
    top = np.argsort(-cnt)[:14]
    pass
if False:
    print("IDDEBUG alpha>0.9 px", int(len(vals)), "valores", [(float(u[i]), int(cnt[i])) for i in top])
else:
    print("IDDEBUG sin pixeles opacos; alpha max", float(idp[..., 3].max()), "canales", idp.shape)
masks = {}
for reg, idx in ID_COLOURS.items():
    m = (np.abs(ids - idx) < 0.2) & (idp[..., 3] > 0.995)
    if m.sum() >= 40:
        masks[reg] = m
print("MASCARAS " + json.dumps({k: int(v.sum()) for k, v in masks.items()}))

for rnd in range(ROUNDS):
    img = render_to_array(os.path.join(TMP, "_cal.exr"), CAL_RES, 40, True, exr=True)
    lit = img[..., :3]
    if rnd == 0:
        allm = np.zeros(lit.shape[:2], bool)
        for m in masks.values():
            allm |= m
        want = float(np.mean(srgb_to_linear(np.array(TARGETS["_media"])))) if "_media" in TARGETS else None
    line = []
    for reg, m in masks.items():
        if reg in SHARED:
            continue      # driven by its primary region; calibrating both fights itself
        base = reg
        if base not in TARGETS:
            continue
        got = np.median(lit[m], axis=0)
        tgt = srgb_to_linear(TARGETS[base])
        k = np.clip(tgt / np.maximum(got, 1e-4), 0.25, 4.0)
        albedo[base] = np.clip(albedo[base] * k, 0.002, 0.99)
        line.append(f"{reg}:{np.mean(k):.2f}")
    for reg, m in mats.items():
        base = SHARED.get(reg, reg)
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
            *albedo.get(base, [0.5, 0.5, 0.5]), 1)
    print(f"CALIBRACION vuelta {rnd + 1}: " + " ".join(line))

# The ground is a shadow catcher, not a lit plane: a lit plane pools light
# under the object and the plate stops matching the sheet's flat backdrop.
floor.is_shadow_catcher = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb_to_linear(sheet_bg), 1)

# Final verification: what the render actually produces per region, against the
# colour read off the sheet. This is the number that says whether it matched.
ver = render_to_array(os.path.join(TMP, "_ver.exr"), CAL_RES, 64, True, exr=True)
check = {}
for reg, m in masks.items():
    if reg in SHARED or reg not in TARGETS:
        continue
    got = np.median(ver[..., :3][m], axis=0)
    check[reg] = {"objetivo": TARGETS[reg],
                  "render": [int(round(float(x))) for x in linear_to_srgb(got)]}
print("VERIFICACION " + json.dumps(check))

print("ALBEDO " + json.dumps({k: [int(round(x)) for x in linear_to_srgb(v)] for k, v in albedo.items()}))

# ------------------------------------------------- solve the framing on colour
def canvas(mask, rgb, n=190):
    ys, xs = np.nonzero(mask)
    if len(ys) < 50:
        return None, None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    m = mask[y0:y1 + 1, x0:x1 + 1]
    c = rgb[y0:y1 + 1, x0:x1 + 1]
    h, w = m.shape
    k = (n - 2) / max(h, w)
    th, tw = max(1, int(round(h * k))), max(1, int(round(w * k)))
    yi = np.linspace(0, h - 1e-6, th).astype(int)
    xi = np.linspace(0, w - 1e-6, tw).astype(int)
    om = np.zeros((n, n), bool); oc = np.zeros((n, n, 3), np.float32)
    ay, ax = (n - th) // 2, (n - tw) // 2
    om[ay:ay + th, ax:ax + tw] = m[yi][:, xi]
    oc[ay:ay + th, ax:ax + tw] = c[yi][:, xi]
    return om, oc


if SWEEP:
    rn = bpy.data.images.load(opt("refnative"))
    rw, rh = rn.size
    rbuf = np.empty(rw * rh * rn.channels, dtype=np.float32)
    rn.pixels.foreach_get(rbuf)
    refimg = rbuf.reshape(rh, rw, rn.channels)[::-1, :, :3]   # linear, row 0 = top
    bpy.data.images.remove(rn)
    refsil = np.load(SIL)
    if refsil.shape != refimg.shape[:2]:
        raise RuntimeError(f"silueta {refsil.shape} no cuadra con referencia {refimg.shape[:2]}")
    refimg = np.clip(refimg, 0, 4) ** (1 / 2.2)
    RM, RC = canvas(refsil, refimg)
    a0, a1, astep, e0, e1, estep, ds = SWEEP.split(",")
    dists = [float(x) for x in ds.split(":")]
    floor.hide_render = True
    grid = []
    az = float(a0)
    while az <= float(a1) + 1e-6:
        el = float(e0)
        while el <= float(e1) + 1e-6:
            for dd in dists:
                grid.append((az, el, dd))
            el += float(estep)
        az += float(astep)
    best = None
    for az, el, dd in grid:
        cam_data.lens = 85.0 * dd / 5.0
        ra, re = math.radians(az), math.radians(el)
        cam.location = Vector((math.cos(re) * math.sin(ra), -math.cos(re) * math.cos(ra), math.sin(re))) * dd
        cam.rotation_euler = (-cam.location).to_track_quat("-Z", "Y").to_euler()
        arr = render_to_array(os.path.join(TMP, "_sweep.exr"), 300, 16, True, exr=True)
        gm, gc = canvas(arr[..., 3] > 0.5, np.clip(arr[..., :3], 0, 4) ** (1 / 2.2))
        if gm is None:
            continue
        inter = float((gm & RM).sum()); union = float((gm | RM).sum())
        iou = inter / max(union, 1)
        both = gm & RM
        diff = float(np.mean(np.abs(gc[both] - RC[both]))) if both.sum() > 200 else 1.0
        score = 0.55 * (1 - iou) + 0.45 * diff
        if best is None or score < best[0]:
            best = (score, az, el, dd, iou, diff)
    print(f"ENCUADRE mejor score={best[0]:.4f} az={best[1]} el={best[2]} dist={best[3]} "
          f"IoU={best[4]:.4f} dif={best[5]:.4f}")
    AZ, EL, DIST = best[1], best[2], best[3]
    cam_data.lens = 85.0 * DIST / 5.0
    ra, re = math.radians(AZ), math.radians(EL)
    cam.location = Vector((math.cos(re) * math.sin(ra), -math.cos(re) * math.cos(ra), math.sin(re))) * DIST
    cam.rotation_euler = (-cam.location).to_track_quat("-Z", "Y").to_euler()

# ------------------------------------------------------- frame like the sheet
def frame_object(fill=0.74, iterations=4):
    """Set the lens so the object occupies a known share of the frame.

    Sensor shift is deliberately not used: world_to_camera_view does not report
    it back consistently, so a closed loop on it runs away. The projected box is
    reported instead and the delivery crop uses it.
    """
    box = None
    for _ in range(iterations):
        bpy.context.view_layer.update()
        x0 = y0 = 1e9; x1 = y1 = -1e9
        for o in meshes:
            for i in range(0, len(o.data.vertices), 3):
                p = world_to_camera_view(scene, cam, o.data.vertices[i].co)
                x0 = min(x0, p.x); x1 = max(x1, p.x)
                y0 = min(y0, p.y); y1 = max(y1, p.y)
        box = (x0, x1, y0, y1)
        cam_data.lens *= fill / max(x1 - x0, y1 - y0, 1e-6)
    bpy.context.view_layer.update()
    x0 = y0 = 1e9; x1 = y1 = -1e9
    for o in meshes:
        for i in range(0, len(o.data.vertices), 3):
            p = world_to_camera_view(scene, cam, o.data.vertices[i].co)
            x0 = min(x0, p.x); x1 = max(x1, p.x)
            y0 = min(y0, p.y); y1 = max(y1, p.y)
    print(f"ENCAJE lente={cam_data.lens:.1f}mm")
    print(f"RECORTE {x0:.5f} {x1:.5f} {y0:.5f} {y1:.5f}")


from bpy_extras.object_utils import world_to_camera_view
frame_object()

# ---------------------------------------------------------------------- render
floor.hide_render = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.cycles.use_denoising = True
scene.render.filter_size = 1.5
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGB"
scene.render.resolution_x = scene.render.resolution_y = RES
scene.cycles.samples = SAMPLES
scene.render.filepath = OUTPUT
bpy.ops.render.render(write_still=True)
print("BUILD_OK " + OUTPUT)

if DIAG:
    import colorsys
    for reg, m in mats.items():
        r, g, b = colorsys.hsv_to_rgb((hash(reg) % 997) / 997.0, 0.85, 0.9)
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (r, g, b, 1)
    scene.cycles.samples = 32
    scene.render.filepath = DIAG
    bpy.ops.render.render(write_still=True)
    print("DIAG_OK " + DIAG)

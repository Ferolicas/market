"""Render a mosaic object to match its reference sheet as closely as possible.

The mosaic splits one object across several tripo_part nodes, which is what
lets each part carry its own material instead of a single smeared projection.
"""
from __future__ import annotations

import json, math, sys
import bpy
from mathutils import Vector

def opt(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = f"--{name}="
    return next((a.removeprefix(p) for a in args if a.startswith(p)), default)

source   = opt("source")
nodes    = [n for n in opt("nodes", "").split(",") if n]
output   = opt("output")
mode     = opt("mode", "clay")          # clay | project | parts
texture  = opt("texture", "")
palette  = opt("palette", "")            # JSON: {"tripo_part_3": [r,g,b], ...}
azimuth  = float(opt("azimuth", "38"))
elevation= float(opt("elevation", "26"))
distance = float(opt("distance", "7.0"))
lens     = float(opt("lens", "85"))
samples  = int(opt("samples", "128"))
res      = int(opt("res", "1024"))
dissolve = float(opt("dissolve", "0"))

bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if nodes:
    keep = [o for o in meshes if o.name in nodes]
    for o in meshes:
        if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
    meshes = keep
if not meshes: raise RuntimeError("sin mallas")

for o in meshes:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if dissolve > 0:
        m = o.modifiers.new("planar", type="DECIMATE")
        m.decimate_type = "DISSOLVE"; m.angle_limit = math.radians(dissolve)
        bpy.ops.object.modifier_apply(modifier=m.name)
    for poly in o.data.polygons: poly.use_smooth = False

# Frame the whole group, not one part, so every version lines up identically.
lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo[i], w[i]) for i in range(3)))
        hi = Vector((max(hi[i], w[i]) for i in range(3)))
centre = (lo + hi) / 2
span = max(hi - lo)
scale = 2.0 / span
# Move the vertices themselves: parenting needs a depsgraph update before
# matrix_world is valid, and reading it too early silently leaves the group
# sitting wherever the mosaic sheet put it.
mirror = opt("mirror", "0") == "1"
for o in meshes:
    for vert in o.data.vertices:
        co = (vert.co - centre) * scale
        # The mosaic sheet stores this object mirrored: its raised ENTRADA relief
        # reads backwards next to the reference sheet.
        vert.co = Vector((-co.x, co.y, co.z)) if mirror else co
    if mirror:
        o.data.flip_normals()
    o.data.update()

bpy.context.view_layer.update()
lo2 = Vector((1e9,)*3); hi2 = Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo2 = Vector((min(lo2[i], w[i]) for i in range(3)))
        hi2 = Vector((max(hi2[i], w[i]) for i in range(3)))
print("BBOX final min=", [round(v,3) for v in lo2], "max=", [round(v,3) for v in hi2])

scene = bpy.context.scene
cam_data = bpy.data.cameras.new("cam"); cam_data.lens = lens
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
a, e = math.radians(azimuth), math.radians(elevation)
cam.location = Vector((math.cos(e)*math.sin(a), -math.cos(e)*math.cos(a), math.sin(e))) * distance
cam.rotation_euler = (Vector((0,0,0)) - cam.location).to_track_quat("-Z", "Y").to_euler()

def add_light(name, kind, energy, size, direction, dist):
    d = bpy.data.lights.new(name, type=kind); d.energy = energy
    if kind == "AREA": d.size = size
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o)
    o.location = Vector(direction).normalized() * dist
    o.rotation_euler = (Vector((0,0,0)) - o.location).to_track_quat("-Z", "Y").to_euler()
    return o

# Albedo comes from the reference, which is already a lit render, so the rig
# has to land back on those values instead of piling more light on top.
key_e  = float(opt("key", "1400")); fill_e = float(opt("fill", "380"))
rim_e  = float(opt("rim", "260"));  amb    = float(opt("ambient", "1.05"))
add_light("key",  "AREA", key_e,  7, ( 0.9, -1.2,  1.5), 7)
add_light("fill", "AREA", fill_e, 9, (-1.4, -0.9,  0.5), 8)
add_light("rim",  "AREA", rim_e,  6, (-0.4,  1.3,  0.9), 8)

world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.60, 0.585, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = amb

def principled(name, colour, roughness=0.55, metallic=0.0, transmission=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = metallic
    if transmission and "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = transmission
    return m

if mode == "clay":
    m = principled("clay", (0.80, 0.78, 0.74), 0.62)
    for o in meshes: o.data.materials.clear(); o.data.materials.append(m)
elif mode == "project":
    from bpy_extras.object_utils import world_to_camera_view
    scene.render.resolution_x = res; scene.render.resolution_y = res
    img = bpy.data.images.load(texture)
    m = bpy.data.materials.new("proj"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    tex = m.node_tree.nodes.new("ShaderNodeTexImage"); tex.image = img
    tex.interpolation = "Cubic"
    m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.58
    bpy.context.view_layer.update()
    for o in meshes:
        uv = o.data.uv_layers.new(name="ref")
        for poly in o.data.polygons:
            for li in poly.loop_indices:
                v = o.data.vertices[o.data.loops[li].vertex_index]
                ndc = world_to_camera_view(scene, cam, o.matrix_world @ v.co)
                uv.data[li].uv = (ndc.x, ndc.y)
        o.data.materials.clear(); o.data.materials.append(m)
elif mode == "parts":
    table = json.loads(palette) if palette else {}
    for o in meshes:
        spec = table.get(o.name, {})
        colour = tuple(spec.get("colour", [0.8, 0.78, 0.74]))
        m = principled(o.name, colour, spec.get("roughness", 0.55),
                       spec.get("metallic", 0.0), spec.get("transmission", 0.0))
        if spec.get("transmission", 0.0) > 0:
            m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
        o.data.materials.clear(); o.data.materials.append(m)

elif mode == "hybrid":
    # Project the reference only onto faces the camera can actually see, and
    # give every hidden face a flat fallback. A plain projection also paints the
    # sheet's grey backdrop onto the geometry behind, which is what produced the
    # translucent double image.
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils.bvhtree import BVHTree
    import bmesh
    scene.render.resolution_x = res; scene.render.resolution_y = res
    bpy.context.view_layer.update()

    verts_all, faces_all = [], []
    for o in meshes:
        base = len(verts_all)
        verts_all += [o.matrix_world @ v.co for v in o.data.vertices]
        for poly in o.data.polygons:
            vs = list(poly.vertices)
            for i in range(1, len(vs) - 1):
                faces_all.append((base + vs[0], base + vs[i], base + vs[i + 1]))
    bvh = BVHTree.FromPolygons(verts_all, faces_all, all_triangles=True)

    img = bpy.data.images.load(texture)
    projected = bpy.data.materials.new("projected"); projected.use_nodes = True
    pb = projected.node_tree.nodes["Principled BSDF"]
    ptex = projected.node_tree.nodes.new("ShaderNodeTexImage")
    ptex.image = img; ptex.interpolation = "Cubic"
    ptex.extension = "EXTEND"
    projected.node_tree.links.new(ptex.outputs["Color"], pb.inputs["Base Color"])
    pb.inputs["Roughness"].default_value = 0.52

    table = json.loads(palette) if palette else {}
    cam_pos = cam.matrix_world.translation
    visible_total = hidden_total = 0
    for o in meshes:
        spec = table.get(o.name, {})
        fallback = principled(o.name + "_hidden", tuple(spec.get("colour", [0.72, 0.70, 0.66])),
                              spec.get("roughness", 0.55), 0.0, spec.get("transmission", 0.0))
        o.data.materials.clear()
        o.data.materials.append(projected)   # slot 0
        o.data.materials.append(fallback)    # slot 1
        uv = o.data.uv_layers.new(name="ref")
        for poly in o.data.polygons:
            centre = o.matrix_world @ poly.center
            normal = (o.matrix_world.to_3x3() @ poly.normal).normalized()
            to_cam = cam_pos - centre
            facing = normal.dot(to_cam.normalized()) > 0.05
            occluded = True
            if facing:
                origin = centre + normal * (to_cam.length * 0.002)
                hit = bvh.ray_cast(origin, to_cam.normalized(), to_cam.length * 0.995)
                occluded = hit[0] is not None
            poly.material_index = 0 if (facing and not occluded) else 1
            if poly.material_index == 0: visible_total += 1
            else: hidden_total += 1
            for li in poly.loop_indices:
                v = o.data.vertices[o.data.loops[li].vertex_index]
                ndc = world_to_camera_view(scene, cam, o.matrix_world @ v.co)
                uv.data[li].uv = (ndc.x, ndc.y)
    print(f"HYBRID visibles={visible_total} ocultas={hidden_total}")

scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = "GPU"
except Exception as exc:
    print("GPU no disponible:", exc)
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.render.resolution_x = res; scene.render.resolution_y = res
scene.render.filepath = output
bpy.ops.render.render(write_still=True)
print(f"MATCH mode={mode} az={azimuth} el={elevation} -> {output}")

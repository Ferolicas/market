"""Contact sheet of the parts of a mosaic, each rendered alone and numbered.

    blender -b -P tools/kit/part_thumbs.py -- <mosaic.glb> <outdir> [az] [el] [size]

Use it to read off which part is which object before pairing parts with the
sheet's blobs (tools/kit/fit_camera.py).
"""
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, outdir = argv[0], argv[1]
az = float(argv[2]) if len(argv) > 2 else 30.0
el = float(argv[3]) if len(argv) > 3 else 25.0
size = int(argv[4]) if len(argv) > 4 else 200
os.makedirs(outdir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.render.resolution_x = sc.render.resolution_y = size
sc.render.film_transparent = False
sh = sc.display.shading; sh.light = "STUDIO"; sh.color_type = "MATERIAL"
cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"
cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes: o.hide_render = True
a, e = math.radians(az), math.radians(el)
d = Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))
for o in meshes:
    o.hide_render = False
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    mid = (lo + hi) / 2; r = max((hi - lo).length / 2, 1e-5)
    cam_d.ortho_scale = r * 2.3
    cam.location = mid + d * (r * 6); cam.rotation_euler = (math.radians(90 - el), 0, math.radians(az))
    sc.render.filepath = os.path.join(outdir, o.name + ".png")
    bpy.ops.render.render(write_still=True)
    o.hide_render = True
    print("MINIATURA", o.name)

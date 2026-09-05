"""Flat, unlit render of a GLB with its textures, seen from azimuth/elevation.

    blender -b -P tools/kit/render_view.py -- <in.glb> <out.png> <az> <el> [size]
"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out, az, el = argv[0], argv[1], float(argv[2]), float(argv[3])
size = int(argv[4]) if len(argv) > 4 else 512
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
mid = (lo + hi) / 2; r = max((hi - lo).length / 2, 1e-5)
cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = r * 2.2
cam = bpy.data.objects.new("c", cam_d); bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam
a, e = math.radians(az), math.radians(el)
d = Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))
cam.location = mid + d * r * 4
cam.rotation_euler = (mid - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "FLAT"; sc.display.shading.color_type = "TEXTURE"
sc.display.shading.show_backface_culling = False
sc.render.resolution_x = size; sc.render.resolution_y = size
sc.render.film_transparent = False
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.81, 0.79, 0.78, 1)
sc.world = w
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RENDER_OK")

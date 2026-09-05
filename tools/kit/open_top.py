"""Remove a piece's roof so the isometric camera can see inside.

    blender -b -P tools/kit/open_top.py -- <in.glb> <out.glb> [desde=0.88]

Faces whose centre lies above `desde` of the height and that face up or down
are deleted; walls stay. Textures are kept.
"""
import bpy, bmesh, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
frac = float(dict(o.split("=", 1) for o in argv[2:]).get("desde", 0.88))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
removed = 0
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    bm = bmesh.new(); bm.from_mesh(o.data)
    zs = [v.co.z for v in bm.verts]; lo, hi = min(zs), max(zs); cut = lo + frac * (hi - lo)
    roof = [f for f in bm.faces if f.calc_center_median().z > cut and abs(f.normal.z) > 0.5]
    removed += len(roof)
    bmesh.ops.delete(bm, geom=roof, context="FACES")
    bm.to_mesh(o.data); bm.free(); o.data.update()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_yup=True, export_apply=True)
print(f"TECHO_FUERA {removed} caras -> {dst}")

"""World bounding box of every part of a mosaic, for the camera fit.

    blender -b -P tools/kit/part_boxes.py -- <mosaic.glb> <bboxes.json> [verts.npz]

Writes [{"name": "tripo_part_7", "lo": [...], "hi": [...], "caras": n}, ...] and,
if asked, the vertices of each part so fit_camera.py can draw its overlay.
"""
import bpy, sys, json
import numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
cajas, verts = [], {}
for o in [x for x in bpy.data.objects if x.type == "MESH"]:
    v = np.empty(len(o.data.vertices) * 3, np.float32)
    o.data.vertices.foreach_get("co", v)
    v = v.reshape(-1, 3) @ np.array(o.matrix_world.to_3x3()).T + np.array(o.matrix_world.translation)
    cajas.append({"name": o.name, "lo": v.min(0).tolist(), "hi": v.max(0).tolist(),
                  "caras": len(o.data.polygons), "tris": len(o.data.polygons)})
    verts[o.name] = v.astype(np.float32)
cajas.sort(key=lambda c: int(c["name"].split("_")[-1]) if c["name"].split("_")[-1].isdigit() else 0)
json.dump(cajas, open(out, "w"), indent=1)
if len(argv) > 2: np.savez_compressed(argv[2], **verts)
print("CAJAS", len(cajas))

"""Report closed-lid depth against the evaluated character face for QA."""

from __future__ import annotations

import sys

import bpy


source = sys.argv[sys.argv.index("--") + 1]
bpy.ops.import_scene.gltf(filepath=source, import_pack_images=True)
for obj in bpy.context.scene.objects:
    if obj.type == "MESH" and obj.data.shape_keys:
        for key in obj.data.shape_keys.key_blocks:
            if key.name in {"Blink_L", "Blink_R"}:
                key.value = 1.0
bpy.context.view_layer.update()

overlay = next(obj for obj in bpy.context.scene.objects if "FacialBlinkOverlay" in obj.name)
body = max(
    (obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj != overlay),
    key=lambda obj: len(obj.data.vertices),
)
depsgraph = bpy.context.evaluated_depsgraph_get()
evaluated_body_object = body.evaluated_get(depsgraph)
evaluated_overlay_object = overlay.evaluated_get(depsgraph)
evaluated_body = evaluated_body_object.to_mesh()
evaluated_overlay = evaluated_overlay_object.to_mesh()
try:
    body_points = [evaluated_body_object.matrix_world @ vertex.co for vertex in evaluated_body.vertices]
    for index in (0, 7, 13, 19, 25, 47, 54, 60, 66, 72):
        lid = evaluated_overlay_object.matrix_world @ evaluated_overlay.vertices[index].co
        distances = [((point.x - lid.x) ** 2 + (point.z - lid.z) ** 2, point.y) for point in body_points]
        nearest = min(distance for distance, _ in distances)
        face_y = min(y for distance, y in distances if distance <= nearest + 0.00004)
        print(
            f"BLINK_DEPTH vertex={index} x={lid.x:.5f} z={lid.z:.5f} "
            f"lid_y={lid.y:.5f} face_y={face_y:.5f} front_delta={face_y - lid.y:.5f}"
        )
finally:
    evaluated_body_object.to_mesh_clear()
    evaluated_overlay_object.to_mesh_clear()

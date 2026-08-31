"""Report head-weighted bounds used to derive accessory fit profiles."""

from __future__ import annotations

import sys

import bpy
from mathutils import Vector


source = sys.argv[sys.argv.index("--") + 1]
bpy.ops.import_scene.gltf(filepath=source, import_pack_images=True)
armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
head = armature.data.bones["Head"]
points: list[Vector] = []
for mesh_object in (obj for obj in bpy.context.scene.objects if obj.type == "MESH"):
    group = mesh_object.vertex_groups.get("Head")
    if group is None:
        continue
    for vertex in mesh_object.data.vertices:
        membership = next((item for item in vertex.groups if item.group == group.index), None)
        if membership is not None and membership.weight >= 0.60:
            points.append(mesh_object.matrix_world @ vertex.co)
minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
print(
    f"HEAD_SOCKET source={source} bone_head={tuple(round(v, 5) for v in head.head_local)} "
    f"bone_tail={tuple(round(v, 5) for v in head.tail_local)} "
    f"bounds_min={tuple(round(v, 5) for v in minimum)} "
    f"bounds_max={tuple(round(v, 5) for v in maximum)} "
    f"dimensions={tuple(round(maximum[i] - minimum[i], 5) for i in range(3))}"
)

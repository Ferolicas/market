"""Report polygons whose edges stretch most under an animation pose."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


def option(name: str, default: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


source = Path(option("source", "")).resolve()
action_name = option("animation", "Walk")
frame = int(option("frame", "0"))
limit = int(option("limit", "12"))
sort_mode = option("sort", "deformed")
region = option("region", "all")
bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
action = bpy.data.actions[action_name]
animation_data = armature.animation_data_create()
animation_data.action = action
if action.slots:
    animation_data.action_slot = action.slots[0]
bpy.context.scene.frame_set(frame)
bpy.context.view_layer.update()

mesh_object = max(
    (obj for obj in bpy.context.scene.objects if obj.type == "MESH"),
    key=lambda obj: len(obj.data.vertices),
)
evaluated_object = mesh_object.evaluated_get(bpy.context.evaluated_depsgraph_get())
evaluated_mesh = evaluated_object.to_mesh()
try:
    records = []
    for polygon in evaluated_mesh.polygons:
        if region == "feet" and min(
            evaluated_mesh.vertices[index].co.z for index in polygon.vertices
        ) > 0.24:
            continue
        evaluated_lengths = []
        rest_lengths = []
        for index, vertex_index in enumerate(polygon.vertices):
            next_index = polygon.vertices[(index + 1) % len(polygon.vertices)]
            evaluated_lengths.append(
                (evaluated_mesh.vertices[vertex_index].co - evaluated_mesh.vertices[next_index].co).length
            )
            rest_lengths.append(
                (mesh_object.data.vertices[vertex_index].co - mesh_object.data.vertices[next_index].co).length
            )
        rest_polygon = mesh_object.data.polygons[polygon.index]
        sliver_score = max(rest_lengths) ** 2 / max(rest_polygon.area, 1e-9)
        records.append(
            (max(evaluated_lengths), max(rest_lengths), sliver_score, polygon.index, list(polygon.vertices))
        )
    if sort_mode == "sliver":
        records.sort(key=lambda item: item[2], reverse=True)
    else:
        records.sort(reverse=True)
    for evaluated_length, rest_length, sliver_score, polygon_index, vertex_indices in records[:limit]:
        print(
            f"FACE polygon={polygon_index} evaluated_edge={evaluated_length:.6f} "
            f"rest_edge={rest_length:.6f} ratio={evaluated_length / max(rest_length, 1e-9):.3f} "
            f"sliver={sliver_score:.3f}"
        )
        for vertex_index in vertex_indices:
            vertex = mesh_object.data.vertices[vertex_index]
            weights = [
                (mesh_object.vertex_groups[item.group].name, round(item.weight, 4))
                for item in vertex.groups
            ]
            rest = tuple(round(value, 5) for value in vertex.co)
            posed = tuple(round(value, 5) for value in evaluated_mesh.vertices[vertex_index].co)
            print(f"  VERTEX index={vertex_index} rest={rest} posed={posed} weights={weights}")
finally:
    evaluated_object.to_mesh_clear()

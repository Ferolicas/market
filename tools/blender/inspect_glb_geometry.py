"""Print object, material and world-bound metadata for a GLB asset."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def vector(value: Vector) -> list[float]:
    return [round(component, 6) for component in value]


def main() -> None:
    source = Path(option("source"))
    include_all_bones = option("all-bones", "0") == "1"
    if not source.is_file():
        raise FileNotFoundError(source)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    head_points: list[Vector] = []
    for obj in meshes:
        head_group = obj.vertex_groups.get("Head")
        if head_group is None:
            continue
        for vertex in obj.data.vertices:
            if any(
                membership.group == head_group.index and membership.weight >= 0.35
                for membership in vertex.groups
            ):
                head_points.append(obj.matrix_world @ vertex.co)
    head_bounds = None
    if head_points:
        head_minimum = Vector(tuple(min(point[index] for point in head_points) for index in range(3)))
        head_maximum = Vector(tuple(max(point[index] for point in head_points) for index in range(3)))
        head_bounds = {
            "min": vector(head_minimum),
            "max": vector(head_maximum),
            "size": vector(head_maximum - head_minimum),
        }
    report = {
        "source": str(source),
        "bounds": {"min": vector(minimum), "max": vector(maximum), "size": vector(maximum - minimum)},
        "head_bounds": head_bounds,
        "meshes": [
            {
                "name": obj.name,
                "vertices": len(obj.data.vertices),
                "polygons": len(obj.data.polygons),
                "materials": [material.name for material in obj.data.materials if material],
                "parent": obj.parent.name if obj.parent else None,
                "modifiers": [modifier.type for modifier in obj.modifiers],
                "shape_keys": (
                    {
                        key.name: round(key.value, 6)
                        for key in obj.data.shape_keys.key_blocks
                    }
                    if obj.data.shape_keys
                    else {}
                ),
                "scale": vector(obj.scale),
                "location": vector(obj.location),
            }
            for obj in meshes
        ],
        "armatures": [
            {
                "name": armature.name,
                "bones": {
                    bone.name: {"head": vector(bone.head_local), "tail": vector(bone.tail_local)}
                    for bone in armature.data.bones
                    if include_all_bones or bone.name in {"Head", "Neck", "Foot_L", "Foot_R"}
                },
            }
            for armature in armatures
        ],
        "actions": [action.name for action in bpy.data.actions],
    }
    print("GLB_REPORT " + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()

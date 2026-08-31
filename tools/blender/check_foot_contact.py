"""Measure left/right shoe clearance throughout an exported locomotion clip."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


def value(name: str, default: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((item.removeprefix(prefix) for item in args if item.startswith(prefix)), default)


def shoe_clearance() -> tuple[float, float]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    minima = {"left": float("inf"), "right": float("inf")}
    for source in bpy.context.scene.objects:
        if source.type != "MESH":
            continue
        evaluated = source.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            foot_groups = {
                side: source.vertex_groups.get(f"Foot_{side}")
                for side in ("L", "R")
            }
            if all(foot_groups.values()):
                group_side = {
                    group.index: ("left" if side == "L" else "right")
                    for side, group in foot_groups.items()
                }
                for original in source.data.vertices:
                    weighted_sides = [
                        group_side[membership.group]
                        for membership in original.groups
                        if membership.group in group_side and membership.weight > 0.45
                    ]
                    if not weighted_sides:
                        continue
                    point = evaluated.matrix_world @ mesh.vertices[original.index].co
                    for side in weighted_sides:
                        minima[side] = min(minima[side], point.z)
                continue
            shoe_slots = {
                index
                for index, slot in enumerate(evaluated.material_slots)
                if slot.material and "shoe" in slot.material.name.lower()
            }
            if not shoe_slots:
                continue
            vertex_indices = {
                vertex_index
                for polygon in mesh.polygons
                if polygon.material_index in shoe_slots
                for vertex_index in polygon.vertices
            }
            for vertex_index in vertex_indices:
                point = evaluated.matrix_world @ mesh.vertices[vertex_index].co
                side = "left" if point.x < 0 else "right"
                minima[side] = min(minima[side], point.z)
        finally:
            evaluated.to_mesh_clear()
    return minima["left"], minima["right"]


def main() -> None:
    source = Path(value("source", "public/models/market/characters/owner_man.glb")).resolve()
    animation = value("animation", "Walk")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    action = bpy.data.actions.get(animation)
    if action is None:
        raise RuntimeError(f"Missing action {animation}")
    animation_data = armature.animation_data_create()
    animation_data.action = action
    if action.slots:
        animation_data.action_slot = action.slots[0]
    start, end = (round(item) for item in action.frame_range)
    print("frame,left_min_z,right_min_z,grounded_min_z,hips_local_y,hips_local_z,hips_world_z")
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        left, right = shoe_clearance()
        hips = armature.pose.bones["Hips"]
        hips_world_z = (armature.matrix_world @ hips.head).z
        print(f"{frame},{left:.5f},{right:.5f},{min(left, right):.5f},{hips.location.y:.5f},{hips.location.z:.5f},{hips_world_z:.5f}")


if __name__ == "__main__":
    main()

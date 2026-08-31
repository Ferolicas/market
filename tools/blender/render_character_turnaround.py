"""Render eight orthographic QA views and the five required facial states."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def cli_value(name: str, default: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def look_at(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def create_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = 0.82
    return material


EXPRESSIONS = {
    "neutral": {},
    "blink": {"Blink_L": 1.0, "Blink_R": 1.0},
    "happy": {"Smile": 0.75, "CheekUp": 0.45, "BrowUp_L": 0.10, "BrowUp_R": 0.10},
    "surprise": {"EyeWide_L": 0.65, "EyeWide_R": 0.65, "BrowUp_L": 0.70, "BrowUp_R": 0.70, "JawOpen": 0.35, "Surprise": 0.70},
    "confused": {"BrowUp_L": 0.45, "BrowDown_R": 0.20, "MouthNarrow": 0.25, "Confused": 0.35},
    "mouth-open": {"MouthOpen": 0.70, "JawOpen": 0.40},
}


def apply_expression(name: str) -> None:
    values = EXPRESSIONS[name]
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.shape_keys:
            continue
        for key in obj.data.shape_keys.key_blocks:
            if key.name != "Basis":
                key.value = values.get(key.name, 0.0)


def main() -> None:
    source_value = cli_value("source", "public/models/market/characters/owner_man.glb")
    source = PROJECT_ROOT / source_value
    output = Path(cli_value("output", "/tmp/market-owner-turnaround"))
    output.mkdir(parents=True, exist_ok=True)

    if source_value != "current":
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)

    only_mesh = cli_value("only-mesh", "")
    hide_mesh = cli_value("hide-mesh", "")
    for mesh_object in (obj for obj in bpy.context.scene.objects if obj.type == "MESH"):
        if only_mesh and only_mesh.lower() not in mesh_object.name.lower():
            mesh_object.hide_render = True
        if hide_mesh and hide_mesh.lower() in mesh_object.name.lower():
            mesh_object.hide_render = True

    animation_name = cli_value("animation", "")
    requested_frames = [
        int(item.strip())
        for item in cli_value("frames", cli_value("frame", "1")).split(",")
        if item.strip()
    ]
    if animation_name:
        armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
        action = bpy.data.actions.get(animation_name)
        if armature and action:
            animation_data = armature.animation_data_create()
            animation_data.action = action
            if action.slots:
                animation_data.action_slot = action.slots[0]

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = int(cli_value("width", "420"))
    scene.render.resolution_y = int(cli_value("height", "560"))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.018, 0.024, 0.028)

    floor_mat = create_material("QA Floor", (0.13, 0.16, 0.17, 1.0))
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.012))
    floor = bpy.context.object
    floor.data.materials.append(floor_mat)

    bpy.ops.object.light_add(type="AREA", location=(-2.6, -3.0, 4.2))
    key = bpy.context.object
    key.data.energy = 920
    key.data.shape = "DISK"
    key.data.size = 3.0
    look_at(key, (0, 0, 1.0))

    bpy.ops.object.light_add(type="AREA", location=(2.5, -0.8, 2.7))
    fill = bpy.context.object
    fill.data.energy = 520
    fill.data.size = 2.4
    look_at(fill, (0, 0, 1.15))

    bpy.ops.object.light_add(type="AREA", location=(0, 2.2, 3.0))
    rim = bpy.context.object
    rim.data.energy = 700
    rim.data.size = 2.0
    look_at(rim, (0, 0, 1.1))

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.15
    camera.data.sensor_width = 36
    scene.camera = camera

    views = {
        "front": (0.0, -4.0, 1.02),
        "front-left": (-2.83, -2.83, 1.02),
        "left": (-4.0, 0.0, 1.02),
        "back-left": (-2.83, 2.83, 1.02),
        "back": (0.0, 4.0, 1.02),
        "back-right": (2.83, 2.83, 1.02),
        "right": (4.0, 0.0, 1.02),
        "front-right": (2.83, -2.83, 1.02),
    }
    requested_views = [
        item.strip()
        for item in cli_value("views", "all").split(",")
        if item.strip()
    ]
    if requested_views != ["all"]:
        unknown_views = set(requested_views) - set(views)
        if unknown_views:
            raise ValueError(f"Unknown QA views: {sorted(unknown_views)}")
        views = {name: views[name] for name in requested_views}
    requested_expression = cli_value("expression", "all")
    expressions = EXPRESSIONS if requested_expression == "all" else {requested_expression: EXPRESSIONS[requested_expression]}
    multiple_frames = len(requested_frames) > 1
    for frame in requested_frames:
        if animation_name:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
        frame_output = output / f"frame-{frame:03d}" if multiple_frames else output
        for expression in expressions:
            apply_expression(expression)
            expression_output = frame_output / expression
            expression_output.mkdir(parents=True, exist_ok=True)
            for name, position in views.items():
                camera.location = position
                look_at(camera, (0, 0, 0.93))
                scene.render.filepath = str(expression_output / f"{name}.png")
                bpy.ops.render.render(write_still=True)
                print(f"RENDERED {scene.render.filepath}")


if __name__ == "__main__":
    main()

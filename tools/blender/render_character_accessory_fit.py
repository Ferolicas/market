"""Render a hair or hat at the production Head socket for visual fit QA."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def vector_option(name: str, default: str) -> Vector:
    return Vector(tuple(float(value) for value in option(name, default).split(",")))


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def material(name: str, color: tuple[float, float, float, float], roughness: float) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    node = result.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = roughness
    return result


def main() -> None:
    character = Path(option("character"))
    accessory = Path(option("accessory"))
    output = Path(option("output"))
    offset = vector_option("offset", "0,0,0")
    scale = vector_option("scale", "1,1,1")
    rotation = vector_option("rotation", "0,0,0")
    if not character.is_file() or not accessory.is_file():
        raise FileNotFoundError((character, accessory))
    output.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(character), import_pack_images=True)
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    head = armature.data.bones["Head"]
    debug_skin = option("debug-skin-color", "")
    if debug_skin:
        color = tuple(float(value) for value in debug_skin.split(",")) + (1.0,)
        for scene_object in bpy.context.scene.objects:
            if scene_object.type != "MESH":
                continue
            for scene_material in scene_object.data.materials:
                if scene_material is None or "skin" not in scene_material.name.lower():
                    continue
                scene_material.diffuse_color = color
                if scene_material.use_nodes:
                    principled = scene_material.node_tree.nodes.get("Principled BSDF")
                    if principled is not None:
                        principled.inputs["Base Color"].default_value = color

    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(accessory), import_pack_images=True)
    accessory_objects = set(bpy.context.scene.objects) - before
    socket = (
        Matrix.Translation(head.head_local + offset)
        @ Euler(rotation, "XYZ").to_matrix().to_4x4()
        @ Matrix.Diagonal((*scale, 1.0))
    )
    for obj in accessory_objects:
        obj.matrix_world = socket @ obj.matrix_world
        if obj.type == "MESH":
            for polygon in obj.data.polygons:
                polygon.use_smooth = True

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = int(option("width", "520"))
    scene.render.resolution_y = int(option("height", "650"))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.018, 0.022, 0.028)

    floor = material("QA Floor", (0.10, 0.12, 0.14, 1.0), 0.88)
    bpy.ops.mesh.primitive_plane_add(size=5.0, location=(0, 0, -0.004))
    bpy.context.object.data.materials.append(floor)
    target = Vector((0.0, 0.0, 1.0))
    for position, energy, size in [
        ((-2.4, -2.8, 3.5), 1050, 2.3),
        ((2.2, -0.4, 2.7), 580, 2.0),
        ((0.0, 2.4, 3.0), 760, 1.8),
    ]:
        bpy.ops.object.light_add(type="AREA", location=position)
        light = bpy.context.object
        light.data.energy = energy
        light.data.size = size
        look_at(light, target)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = float(option("ortho-scale", "2.12"))
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
        "top-front": (0.0, -3.0, 4.1),
    }
    for name, position in views.items():
        camera.location = position
        look_at(camera, target)
        scene.render.filepath = str(output / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"RENDERED {scene.render.filepath}")


if __name__ == "__main__":
    main()

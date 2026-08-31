"""Render a geometry-only GLB from eight horizontal and four elevated views."""

from __future__ import annotations

import math
import json
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def cli_value(name: str, default: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def material(name: str, color: tuple[float, float, float, float], roughness: float) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    node = result.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = roughness
    return result


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points))),
        Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points))),
    )


def restore_glb_vertex_colors(source: Path, meshes: list[bpy.types.Object]) -> None:
    """Restore COLOR_0 when Blender drops it from a material-less source GLB."""
    payload = source.read_bytes()
    if payload[:4] != b"glTF":
        return
    json_length, json_type = struct.unpack_from("<II", payload, 12)
    if json_type != 0x4E4F534A:
        return
    document = json.loads(payload[20 : 20 + json_length].decode("utf-8"))
    binary_header = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", payload, binary_header)
    if binary_type != 0x004E4942:
        return
    binary = payload[binary_header + 8 : binary_header + 8 + binary_length]

    for mesh_definition, mesh_object in zip(document.get("meshes", []), meshes):
        primitives = mesh_definition.get("primitives", [])
        if len(primitives) != 1 or "COLOR_0" not in primitives[0].get("attributes", {}):
            continue
        accessor = document["accessors"][primitives[0]["attributes"]["COLOR_0"]]
        view = document["bufferViews"][accessor["bufferView"]]
        if accessor.get("componentType") != 5121 or accessor.get("type") not in {"VEC3", "VEC4"}:
            continue
        component_count = 4 if accessor["type"] == "VEC4" else 3
        stride = view.get("byteStride", component_count)
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        count = accessor["count"]
        if count != len(mesh_object.data.vertices):
            continue
        color_layer = mesh_object.data.color_attributes.new(
            name="COLOR_0", type="BYTE_COLOR", domain="POINT"
        )
        for index in range(count):
            color = binary[start + index * stride : start + index * stride + component_count]
            rgba = tuple(channel / 255.0 for channel in color)
            color_layer.data[index].color = rgba if component_count == 4 else (*rgba, 1.0)

        vertex_material = material("Vertex Colors", (1.0, 1.0, 1.0, 1.0), 0.74)
        nodes = vertex_material.node_tree.nodes
        principled = nodes.get("Principled BSDF")
        vertex_color = nodes.new("ShaderNodeVertexColor")
        vertex_color.layer_name = color_layer.name
        vertex_material.node_tree.links.new(vertex_color.outputs["Color"], principled.inputs["Base Color"])
        mesh_object.data.materials.clear()
        mesh_object.data.materials.append(vertex_material)


def main() -> None:
    source = Path(cli_value("source", ""))
    output = Path(cli_value("output", "/tmp/market-static-turnaround"))
    if not source.is_file():
        raise FileNotFoundError(source)
    output.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {source}")

    preserve_materials = cli_value("preserve-materials", "0") == "1"
    if preserve_materials:
        restore_glb_vertex_colors(source, meshes)
    neutral = material("QA Neutral", (0.47, 0.52, 0.58, 1.0), 0.72)
    for mesh in meshes:
        if not preserve_materials:
            mesh.data.materials.clear()
            mesh.data.materials.append(neutral)
        for polygon in mesh.data.polygons:
            polygon.use_smooth = True

    root = bpy.data.objects.new("Subject", None)
    bpy.context.collection.objects.link(root)
    imported = [obj for obj in bpy.context.scene.objects if obj is not root and obj.parent is None]
    for obj in imported:
        obj.parent = root
    root.rotation_euler.z = math.radians(float(cli_value("yaw", "0")))
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    center = (minimum + maximum) * 0.5
    root.location = (-center.x, -center.y, -minimum.z)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    size = maximum - minimum
    target = Vector((0.0, 0.0, size.z * 0.51))
    radius = max(size.x, size.y, size.z) * 2.25

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = int(cli_value("width", "560"))
    scene.render.resolution_y = int(cli_value("height", "640"))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = float(cli_value("exposure", "0"))
    scene.world.color = (0.018, 0.022, 0.028)

    floor = material("QA Floor", (0.10, 0.12, 0.14, 1.0), 0.88)
    bpy.ops.mesh.primitive_plane_add(size=max(size.x, size.y) * 4.0, location=(0, 0, -0.004))
    bpy.context.object.data.materials.append(floor)

    lights = [
        ((-radius * 0.7, -radius * 0.8, size.z * 1.7), 1100, radius * 0.75),
        ((radius * 0.8, -radius * 0.2, size.z * 1.1), 650, radius * 0.58),
        ((0, radius * 0.8, size.z * 1.4), 850, radius * 0.55),
    ]
    for position, energy, light_size in lights:
        bpy.ops.object.light_add(type="AREA", location=position)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = light_size
        look_at(light, target)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(size.z * 1.12, max(size.x, size.y) * 1.28)
    scene.camera = camera

    horizontal = {
        "front": 0,
        "front-left": -45,
        "left": -90,
        "back-left": -135,
        "back": 180,
        "back-right": 135,
        "right": 90,
        "front-right": 45,
    }
    for name, degrees in horizontal.items():
        angle = math.radians(degrees)
        camera.location = (math.sin(angle) * radius, -math.cos(angle) * radius, target.z)
        look_at(camera, target)
        scene.render.filepath = str(output / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"RENDERED {scene.render.filepath}")

    elevated = {
        "top-front": (0, -radius * 0.72, size.z * 2.5),
        "top-back": (0, radius * 0.72, size.z * 2.5),
        "top": (0, 0.0001, size.z * 3.2),
        "bottom": (0, 0.0001, -size.z * 2.2),
    }
    for name, position in elevated.items():
        camera.location = position
        look_at(camera, target)
        scene.render.filepath = str(output / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"RENDERED {scene.render.filepath}")


if __name__ == "__main__":
    main()

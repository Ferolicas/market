"""Rebuild the scanned automatic entrance as clean architectural geometry.

The approved entrance established the exact envelope, door opening and moving
leaf positions, but its scan still contains torn rear faces, serrated edges and
loose pavement fragments.  This tool keeps those measured dimensions and the
runtime node/material contracts while replacing the scan with regular solids.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


EXPECTED_MIN = Vector((-1.499116, -0.724951, -0.881881))
EXPECTED_MAX = Vector((1.499089, 0.725082, 0.881842))
FONT = "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def srgb_channel(value: int) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else math.pow((value + 0.055) / 1.055, 2.4)


def material(
    name: str,
    colour: str,
    roughness: float,
    metallic: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    rgb = tuple(srgb_channel(int(colour[index : index + 2], 16)) for index in (0, 2, 4))
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = (*rgb, alpha)
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        result.use_backface_culling = False
        if hasattr(result, "surface_render_method"):
            result.surface_render_method = "DITHERED"
        elif hasattr(result, "blend_method"):
            result.blend_method = "BLEND"
    return result


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def verify_source(source: Path) -> None:
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {source}")
    minimum, maximum = bounds(meshes)
    if (minimum - EXPECTED_MIN).length > 0.002 or (maximum - EXPECTED_MAX).length > 0.002:
        raise RuntimeError(
            "Unexpected entrance dimensions: "
            f"min={tuple(round(value, 6) for value in minimum)} "
            f"max={tuple(round(value, 6) for value in maximum)}"
        )
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def box(
    name: str,
    minimum: tuple[float, float, float],
    maximum: tuple[float, float, float],
    surface: bpy.types.Material,
    bevel: float = 0.0,
) -> bpy.types.Object:
    low = Vector(minimum)
    high = Vector(maximum)
    bpy.ops.mesh.primitive_cube_add(location=(low + high) * 0.5)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = high - low
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(surface)
    if bevel > 0:
        modifier = obj.modifiers.new("Architectural edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.affect = "EDGES"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def cylinder(
    name: str,
    radius: float,
    z_min: float,
    z_max: float,
    location: tuple[float, float],
    surface: bpy.types.Material,
    vertices: int = 32,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=z_max - z_min,
        location=(location[0], location[1], (z_min + z_max) * 0.5),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(surface)
    bevel = obj.modifiers.new("Machined edge", "BEVEL")
    bevel.width = min(0.018, (z_max - z_min) * 0.08)
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def join(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    objects[0].data.name = f"{name}Mesh"
    return objects[0]


def frame_half(
    name: str,
    x_min: float,
    x_max: float,
    frame_surface: bpy.types.Material,
) -> bpy.types.Object:
    front = -0.168
    back = -0.112
    bottom = -0.755
    top = 0.245
    rail = 0.045
    pieces = [
        box(f"{name}Left", (x_min, front, bottom), (x_min + rail, back, top), frame_surface, 0.008),
        box(f"{name}Right", (x_max - rail, front, bottom), (x_max, back, top), frame_surface, 0.008),
        box(f"{name}Bottom", (x_min, front, bottom), (x_max, back, bottom + rail), frame_surface, 0.008),
        box(f"{name}Top", (x_min, front, top - rail), (x_max, back, top), frame_surface, 0.008),
    ]
    return join(pieces, name)


def entrance_text(surface: bpy.types.Material) -> bpy.types.Object:
    curve = bpy.data.curves.new("EntradaWord", type="FONT")
    curve.body = "ENTRADA"
    curve.font = bpy.data.fonts.load(FONT)
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = 0.006
    curve.resolution_u = 3
    word = bpy.data.objects.new("Text", curve)
    bpy.context.collection.objects.link(word)
    bpy.context.view_layer.objects.active = word
    word.select_set(True)
    bpy.ops.object.convert(target="MESH")
    word.rotation_euler = (math.radians(90), 0.0, 0.0)
    bpy.context.view_layer.update()
    minimum, maximum = bounds([word])
    target_width = 0.83
    target_height = 0.135
    word.scale.x *= target_width / (maximum.x - minimum.x)
    word.scale.y *= target_height / (maximum.z - minimum.z)
    bpy.context.view_layer.update()
    minimum, maximum = bounds([word])
    current = (minimum + maximum) * 0.5
    wanted = Vector((0.0, -0.205, 0.615))
    word.location += wanted - current
    word.data.materials.append(surface)
    return word


def build_clean_entrance() -> None:
    masonry = material("muro", "D8D0BF", 0.72)
    trim = material("marco", "343A3E", 0.46, 0.04)
    pavement = material("losa_superficie", "D8D0BF", 0.82)
    sign_border = material("placa_borde", "596A42", 0.62)
    sign_panel = material("placa_panel", "758558", 0.68)
    letters = material("letras", "F7F3E8", 0.58)
    bollard = material("bolardo_cuerpo", "4A4E4B", 0.52, 0.08)
    bollard_cap = material("bolardo_capitel", "363A38", 0.40, 0.12)
    glass = material("cristal", "76B7C5", 0.16, alpha=0.18)

    body = [
        box(
            "EntranceStep",
            (EXPECTED_MIN.x, EXPECTED_MIN.y, EXPECTED_MIN.z),
            (EXPECTED_MAX.x, 0.16, -0.772),
            pavement,
            0.018,
        ),
        box("EntrancePierLeft", (-1.35, -0.105, -0.772), (-0.69, EXPECTED_MAX.y, 0.86), masonry, 0.018),
        box("EntrancePierRight", (0.69, -0.105, -0.772), (1.35, EXPECTED_MAX.y, 0.86), masonry, 0.018),
        box("EntranceHeader", (-1.35, -0.105, 0.31), (1.35, EXPECTED_MAX.y, 0.86), masonry, 0.018),
        box(
            "EntranceCornice",
            (EXPECTED_MIN.x, -0.105, 0.86),
            (EXPECTED_MAX.x, EXPECTED_MAX.y, EXPECTED_MAX.z),
            trim,
            0.010,
        ),
    ]
    join(body, "EntranceBody")

    portal = [
        box("PortalLeft", (-0.72, -0.176, -0.78), (-0.66, -0.095, 0.34), trim, 0.010),
        box("PortalRight", (0.66, -0.176, -0.78), (0.72, -0.095, 0.34), trim, 0.010),
        box("PortalTop", (-0.72, -0.176, 0.28), (0.72, -0.095, 0.34), trim, 0.010),
    ]
    join(portal, "EntrancePortalTrim")

    frame_half("EntranceFrameLeft", -0.64, 0.0, trim)
    frame_half("EntranceFrameRight", 0.0, 0.64, trim)
    box("EntranceGlassLeft", (-0.588, -0.151, -0.704), (-0.052, -0.139, 0.194), glass)
    box("EntranceGlassRight", (0.052, -0.151, -0.704), (0.588, -0.139, 0.194), glass)

    sign = [
        box("EntranceSignBorder", (-0.68, -0.174, 0.405), (0.68, -0.075, 0.825), sign_border, 0.035),
        box("EntranceSignPanel", (-0.61, -0.190, 0.468), (0.61, -0.164, 0.762), sign_panel, 0.018),
    ]
    join(sign, "EntranceSign")
    entrance_text(letters)

    for side, x in (("Left", -1.275), ("Right", 1.275)):
        post = [
            cylinder(f"Bollard{side}Base", 0.155, -0.775, -0.705, (x, -0.405), bollard),
            cylinder(f"Bollard{side}Body", 0.105, -0.715, -0.235, (x, -0.405), bollard),
            cylinder(f"Bollard{side}Cap", 0.125, -0.255, -0.155, (x, -0.405), bollard_cap),
        ]
        join(post, f"EntranceBollard{side}")


def main() -> None:
    source = Path(option("source")).resolve()
    output = Path(option("output")).resolve()
    blend_output = option("blend-output")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    verify_source(source)
    build_clean_entrance()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    minimum, maximum = bounds(meshes)
    if (minimum - EXPECTED_MIN).length > 0.002 or (maximum - EXPECTED_MAX).length > 0.002:
        raise RuntimeError(
            "Clean entrance changed the approved envelope: "
            f"min={tuple(round(value, 6) for value in minimum)} "
            f"max={tuple(round(value, 6) for value in maximum)}"
        )

    if blend_output:
        blend_path = Path(blend_output).resolve()
        blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_materials="EXPORT",
        export_yup=True,
    )
    for obj in meshes:
        obj.data.calc_loop_triangles()
    print(
        "ENTRANCE_REBUILT "
        f"objects={len(meshes)} triangles={sum(len(obj.data.loop_triangles) for obj in meshes)} "
        f"bytes={os.path.getsize(output)} output={output}"
    )


if __name__ == "__main__":
    main()

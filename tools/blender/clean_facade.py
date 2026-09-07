"""Rebuild the scanned storefront module as clean architectural geometry.

The supplied Tripo mesh contains thousands of disconnected scan islands and its
base-colour texture contains baked reconstruction streaks.  Deleting islands by
size cannot distinguish mouldings from debris, so this tool preserves the
measured outside bounds and window apertures while replacing the scan with
regular solids.  The result has no loose triangles, rear wisps or corner scraps.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


EXPECTED_MIN = Vector((-49.039631, -14.148371, 0.0))
EXPECTED_MAX = Vector((49.039631, 14.148371, 61.541718))
LEFT_APERTURE = (-41.52, -1.52)
RIGHT_APERTURE = (1.52, 42.02)
APERTURE_BOTTOM = 12.25
APERTURE_TOP = 52.25
CAP_BOTTOM = 57.50


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def srgb_channel(value: int) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else math.pow((value + 0.055) / 1.055, 2.4)


def solid_material(name: str, colour: str, roughness: float, metallic: float = 0.0) -> bpy.types.Material:
    rgb = tuple(srgb_channel(int(colour[index : index + 2], 16)) for index in (0, 2, 4))
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*rgb, 1.0)
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return material


def glass_material() -> bpy.types.Material:
    material = solid_material("FacadeGlass", "76B7C5", 0.12)
    material.diffuse_color = (*material.diffuse_color[:3], 0.18)
    material.use_backface_culling = False
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    elif hasattr(material, "blend_method"):
        material.blend_method = "BLEND"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Alpha"].default_value = 0.18
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.62
    return material


def imported_bounds(source: Path) -> tuple[Vector, Vector]:
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {source}")
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    if (minimum - EXPECTED_MIN).length > 0.02 or (maximum - EXPECTED_MAX).length > 0.02:
        raise RuntimeError(
            "Unexpected facade dimensions: "
            f"min={tuple(round(value, 5) for value in minimum)} "
            f"max={tuple(round(value, 5) for value in maximum)}"
        )
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for data in list(bpy.data.meshes):
        if data.users == 0:
            bpy.data.meshes.remove(data)
    for data in list(bpy.data.materials):
        if data.users == 0:
            bpy.data.materials.remove(data)
    for data in list(bpy.data.images):
        if data.users == 0:
            bpy.data.images.remove(data)
    return minimum, maximum


def box(
    name: str,
    minimum: tuple[float, float, float],
    maximum: tuple[float, float, float],
    material: bpy.types.Material,
    bevel: float = 0.0,
) -> bpy.types.Object:
    low = Vector(minimum)
    high = Vector(maximum)
    bpy.ops.mesh.primitive_cube_add(location=(low + high) * 0.5)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = high - low
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
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


def pane(
    name: str,
    x_min: float,
    x_max: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    inset = 0.34
    y = EXPECTED_MIN.y + 0.72
    thickness = 0.10
    z_min = APERTURE_BOTTOM + inset
    z_max = APERTURE_TOP - inset
    # A wafer-thin closed solid gives Unity/URP valid outward faces on both
    # sides and remains visible from inside and outside with back-face culling.
    return box(
        name,
        (x_min + inset, y - thickness * 0.5, z_min),
        (x_max - inset, y + thickness * 0.5, z_max),
        material,
    )


def join(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    objects[0].data.name = f"{name}Mesh"
    return objects[0]


def build_clean_facade() -> None:
    masonry = solid_material("FacadeMasonry", "D2C8B4", 0.72)
    trim = solid_material("FacadeTrim", "343A3E", 0.48, 0.04)
    glass = glass_material()

    body_y = (EXPECTED_MIN.y + 0.55, EXPECTED_MAX.y - 0.55)
    masonry_parts = [
        box(
            "FacadeBase",
            (EXPECTED_MIN.x, body_y[0], EXPECTED_MIN.z),
            (EXPECTED_MAX.x, body_y[1], APERTURE_BOTTOM),
            masonry,
            0.34,
        ),
        box(
            "FacadePierLeft",
            (EXPECTED_MIN.x, body_y[0], APERTURE_BOTTOM),
            (LEFT_APERTURE[0], body_y[1], CAP_BOTTOM),
            masonry,
            0.28,
        ),
        box(
            "FacadeMullion",
            (LEFT_APERTURE[1], body_y[0], APERTURE_BOTTOM),
            (RIGHT_APERTURE[0], body_y[1], APERTURE_TOP),
            masonry,
            0.20,
        ),
        box(
            "FacadePierRight",
            (RIGHT_APERTURE[1], body_y[0], APERTURE_BOTTOM),
            (EXPECTED_MAX.x, body_y[1], CAP_BOTTOM),
            masonry,
            0.28,
        ),
        box(
            "FacadeHeader",
            (LEFT_APERTURE[0], body_y[0], APERTURE_TOP),
            (RIGHT_APERTURE[1], body_y[1], CAP_BOTTOM),
            masonry,
            0.28,
        ),
    ]

    front_min = EXPECTED_MIN.y
    front_max = body_y[0] + 0.10
    frame = 0.72
    trim_parts = [
        box(
            "FacadeCornice",
            (EXPECTED_MIN.x, EXPECTED_MIN.y, CAP_BOTTOM),
            (EXPECTED_MAX.x, EXPECTED_MAX.y, EXPECTED_MAX.z),
            trim,
            0.42,
        ),
        box(
            "FacadeSillLeft",
            (LEFT_APERTURE[0], front_min, APERTURE_BOTTOM - frame),
            (LEFT_APERTURE[1], front_max, APERTURE_BOTTOM + frame),
            trim,
            0.18,
        ),
        box(
            "FacadeSillRight",
            (RIGHT_APERTURE[0], front_min, APERTURE_BOTTOM - frame),
            (RIGHT_APERTURE[1], front_max, APERTURE_BOTTOM + frame),
            trim,
            0.18,
        ),
        box(
            "FacadeLintelLeft",
            (LEFT_APERTURE[0], front_min, APERTURE_TOP - frame),
            (LEFT_APERTURE[1], front_max, APERTURE_TOP + frame),
            trim,
            0.18,
        ),
        box(
            "FacadeLintelRight",
            (RIGHT_APERTURE[0], front_min, APERTURE_TOP - frame),
            (RIGHT_APERTURE[1], front_max, APERTURE_TOP + frame),
            trim,
            0.18,
        ),
        box(
            "FacadeJambOuterLeft",
            (LEFT_APERTURE[0] - frame, front_min, APERTURE_BOTTOM),
            (LEFT_APERTURE[0] + frame, front_max, APERTURE_TOP),
            trim,
            0.18,
        ),
        box(
            "FacadeJambInnerLeft",
            (LEFT_APERTURE[1] - frame, front_min, APERTURE_BOTTOM),
            (LEFT_APERTURE[1] + frame, front_max, APERTURE_TOP),
            trim,
            0.18,
        ),
        box(
            "FacadeJambInnerRight",
            (RIGHT_APERTURE[0] - frame, front_min, APERTURE_BOTTOM),
            (RIGHT_APERTURE[0] + frame, front_max, APERTURE_TOP),
            trim,
            0.18,
        ),
        box(
            "FacadeJambOuterRight",
            (RIGHT_APERTURE[1] - frame, front_min, APERTURE_BOTTOM),
            (RIGHT_APERTURE[1] + frame, front_max, APERTURE_TOP),
            trim,
            0.18,
        ),
        box(
            "FacadePlinth",
            (EXPECTED_MIN.x, front_min, EXPECTED_MIN.z),
            (EXPECTED_MAX.x, front_max, 2.40),
            trim,
            0.22,
        ),
    ]

    join(masonry_parts, "FacadeFrame")
    join(trim_parts, "FacadeTrim")
    pane("FacadeGlassLeft", *LEFT_APERTURE, glass)
    pane("FacadeGlassRight", *RIGHT_APERTURE, glass)


def main() -> None:
    source = Path(option("source")).resolve()
    output = Path(option("output")).resolve()
    blend_output = option("blend-output")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    imported_bounds(source)
    build_clean_facade()

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
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    print(
        "FACADE_REBUILT "
        f"objects={len(meshes)} polygons={sum(len(obj.data.polygons) for obj in meshes)} "
        f"bytes={os.path.getsize(output)} output={output}"
    )


if __name__ == "__main__":
    main()

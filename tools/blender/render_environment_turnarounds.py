"""Render eight neutral-light QA views for every canonical environment GLB."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def value(name: str, default: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((item.removeprefix(prefix) for item in args if item.startswith(prefix)), default)


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def imported_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects if obj.type == "MESH" for corner in obj.bound_box]
    if not points:
        return Vector((-0.5, -0.5, 0.0)), Vector((0.5, 0.5, 1.0))
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def main() -> None:
    source_root = PROJECT_ROOT / "public/models/market/environment"
    output = Path(value("output", "/tmp/market-environment-turnarounds"))
    output.mkdir(parents=True, exist_ok=True)
    requested = {item for item in value("only", "").split(",") if item}
    sources = [source for source in sorted(source_root.glob("*.glb")) if not requested or source.stem in requested]

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = int(value("size", "320"))
    scene.render.resolution_y = int(value("size", "320"))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.025, 0.032, 0.035)

    bpy.ops.object.light_add(type="AREA", location=(-5.0, -6.0, 8.0))
    key = bpy.context.object
    key.name = "QA_Key"
    key.data.energy = 1150
    key.data.size = 5.0
    look_at(key, Vector((0, 0, 1)))
    bpy.ops.object.light_add(type="AREA", location=(5.0, -1.5, 5.0))
    fill = bpy.context.object
    fill.name = "QA_Fill"
    fill.data.energy = 700
    fill.data.size = 4.0
    look_at(fill, Vector((0, 0, 1)))
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "QA_Camera"
    camera.data.type = "ORTHO"
    scene.camera = camera
    permanent = {key, fill, camera}

    angles = [
        ("front", -90), ("front-left", -135), ("left", 180), ("back-left", 135),
        ("back", 90), ("back-right", 45), ("right", 0), ("front-right", -45),
    ]
    for source in sources:
        before = set(scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
        imported = [obj for obj in scene.objects if obj not in before]
        minimum, maximum = imported_bounds(imported)
        center = (minimum + maximum) * 0.5
        extent = maximum - minimum
        radius = max(0.5, extent.x, extent.y, extent.z)
        camera.data.ortho_scale = max(0.8, extent.z * 1.35, max(extent.x, extent.y) * 1.45)
        asset_output = output / source.stem
        asset_output.mkdir(parents=True, exist_ok=True)
        for label, degrees in angles:
            radians = math.radians(degrees)
            camera.location = center + Vector((math.cos(radians) * radius * 2.4, math.sin(radians) * radius * 2.4, radius * 1.35))
            look_at(camera, center)
            scene.render.filepath = str(asset_output / f"{label}.png")
            bpy.ops.render.render(write_still=True)
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
        print(f"RENDERED {source.stem}: 8 views")

    print(f"COMPLETE {len(sources)} assets -> {output}")


if __name__ == "__main__":
    main()

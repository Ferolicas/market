"""Render every hair/hat in eight views on all four supported head fits."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
HAIR = ["side-part", "fade", "waves", "swept", "bob", "ponytail", "long-wavy", "bun", "messy", "curls", "short-fringe", "quiff", "blunt-bob", "pigtails", "braid", "high-ponytail"]
HATS = ["red-panda", "red-fox", "chicken", "owl", "elephant", "rhino", "giraffe", "panda", "frog", "cow", "rabbit", "capybara"]
PROFILES = {
    "owner_man": ((1.00, 1.00, 1.00), 1.00, 0.000),
    "owner_woman": ((0.98, 0.98, 1.00), 0.97, -0.005),
    "owner_boy": ((0.91, 0.94, 0.93), 0.93, -0.025),
    "owner_girl": ((0.92, 0.94, 0.94), 0.92, -0.035),
}
VIEWS = [("front", -90), ("front-left", -135), ("left", 180), ("back-left", 135), ("back", 90), ("back-right", 45), ("right", 0), ("front-right", -45)]


def option(name: str, default: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((item.removeprefix(prefix) for item in args if item.startswith(prefix)), default)


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def skin_material() -> bpy.types.Material:
    material = bpy.data.materials.new("QA_Skin")
    material.diffuse_color = (0.58, 0.34, 0.23, 1)
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = material.diffuse_color
    node.inputs["Roughness"].default_value = 0.66
    return material


def dummy_head(profile_scale: tuple[float, float, float], material: bpy.types.Material) -> list[bpy.types.Object]:
    sx, sy, sz = profile_scale
    created: list[bpy.types.Object] = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=22, location=(0, 0, 0.20), scale=(0.205 * sx, 0.19 * sy, 0.255 * sz))
    created.append(bpy.context.object)
    for x in (-0.205 * sx, 0.205 * sx):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=12, location=(x, 0, 0.20), scale=(0.032, 0.027, 0.060 * sz))
        created.append(bpy.context.object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.085 * sx, depth=0.15 * sz, location=(0, 0.01, -0.015))
    created.append(bpy.context.object)
    for obj in created:
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return created


def main() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = int(option("size", "360"))
    scene.render.resolution_y = int(option("size", "360"))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.018, 0.024, 0.028)

    bpy.ops.object.light_add(type="AREA", location=(-2.5, -3.0, 3.0))
    key = bpy.context.object
    key.data.energy = 820
    key.data.size = 2.8
    look_at(key, Vector((0, 0, 0.22)))
    bpy.ops.object.light_add(type="AREA", location=(2.2, 0.8, 2.1))
    fill = bpy.context.object
    fill.data.energy = 540
    fill.data.size = 2.2
    look_at(fill, Vector((0, 0, 0.22)))
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 0.92
    scene.camera = camera
    permanent = {key, fill, camera}
    skin = skin_material()

    kind = option("kind", "all")
    kinds = ("hair", "hats") if kind == "all" else (kind,)
    output = Path(option("output", "/tmp/market-accessory-turnarounds"))
    requested_profiles = option("profiles", "all")
    profiles = PROFILES if requested_profiles == "all" else {name: PROFILES[name] for name in requested_profiles.split(",")}

    total = 0
    for current_kind in kinds:
        items = HAIR if current_kind == "hair" else HATS
        source_folder = "hair" if current_kind == "hair" else "hats"
        for profile_name, (head_scale, accessory_scale, z_offset) in profiles.items():
            for item in items:
                created = dummy_head(head_scale, skin)
                before = set(scene.objects)
                bpy.ops.import_scene.gltf(filepath=str(ROOT / "public/models/market" / source_folder / f"{item}.glb"), import_pack_images=True)
                imported = [obj for obj in scene.objects if obj not in before]
                for root in (obj for obj in imported if obj.parent is None):
                    root.scale = (accessory_scale,) * 3
                    root.location.z = z_offset
                asset_output = output / current_kind / profile_name / item
                asset_output.mkdir(parents=True, exist_ok=True)
                for label, degrees in VIEWS:
                    radians = math.radians(degrees)
                    camera.location = Vector((math.cos(radians) * 2.0, math.sin(radians) * 2.0, 0.34))
                    look_at(camera, Vector((0, 0, 0.22)))
                    scene.render.filepath = str(asset_output / f"{label}.png")
                    bpy.ops.render.render(write_still=True)
                for obj in [*created, *imported]:
                    if obj not in permanent and obj.name in scene.objects:
                        bpy.data.objects.remove(obj, do_unlink=True)
                total += 1
                print(f"RENDERED {current_kind}/{profile_name}/{item}")
    print(f"COMPLETE {total} accessory/profile combinations -> {output}")


if __name__ == "__main__":
    main()

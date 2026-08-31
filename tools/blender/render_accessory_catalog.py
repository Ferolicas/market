"""Render the generated hair or hat catalog on neutral heads for visual QA."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HAIR = [
    "side-part", "fade", "waves", "swept", "bob", "ponytail", "long-wavy", "bun",
    "messy", "curls", "short-fringe", "quiff", "blunt-bob", "pigtails", "braid", "high-ponytail",
]
HATS = ["red-panda", "red-fox", "chicken", "owl", "elephant", "rhino", "giraffe", "panda", "frog", "cow", "rabbit", "capybara"]


def value(name: str, default: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((item.removeprefix(prefix) for item in args if item.startswith(prefix)), default)


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def make_material(name: str, color: tuple[float, float, float, float], roughness: float = 0.72) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = roughness
    return material


def dummy_head(location: tuple[float, float, float], scale: float, skin: bpy.types.Material) -> None:
    x, y, z = location
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=22, location=(x, y, z + 0.20), scale=(0.205 * scale, 0.19 * scale, 0.255 * scale))
    head = bpy.context.object
    head.data.materials.append(skin)
    for polygon in head.data.polygons:
        polygon.use_smooth = True
    bpy.ops.mesh.primitive_uv_sphere_add(segments=22, ring_count=14, location=(x - 0.205 * scale, y, z + 0.20), scale=(0.032 * scale, 0.027 * scale, 0.060 * scale))
    bpy.context.object.data.materials.append(skin)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=22, ring_count=14, location=(x + 0.205 * scale, y, z + 0.20), scale=(0.032 * scale, 0.027 * scale, 0.060 * scale))
    bpy.context.object.data.materials.append(skin)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.085 * scale, depth=0.15 * scale, location=(x, y + 0.01, z - 0.015))
    bpy.context.object.data.materials.append(skin)


def main() -> None:
    # Blender opens with a cube, camera and light.  Leaving the cube in the QA
    # scene hides the centre rows of the contact sheet and can be mistaken for
    # geometry accidentally exported inside an accessory.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    kind = value("kind", "hair")
    output = Path(value("output", f"/tmp/market-{kind}-catalog.png"))
    items = HAIR if kind == "hair" else HATS
    requested = value("only", "")
    if requested:
        items = [item for item in requested.split(",") if item]
    columns = 4
    rows = (len(items) + columns - 1) // columns
    spacing_x = 0.72
    spacing_z = 0.76
    skin = make_material("QA Skin", (0.55, 0.31, 0.19, 1.0), 0.68)

    for index, item in enumerate(items):
        column = index % columns
        row = index // columns
        x = (column - (columns - 1) / 2) * spacing_x
        z = (rows - row - 1) * spacing_z
        dummy_head((x, 0, z), 1.0, skin)
        before = set(bpy.context.scene.objects)
        source = PROJECT_ROOT / "public" / "models" / "market" / kind / f"{item}.glb"
        bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
        imported = [obj for obj in bpy.context.scene.objects if obj not in before]
        roots = [obj for obj in imported if obj.parent is None]
        for root in roots:
            root.location = (x, 0, z)

        bpy.ops.object.text_add(location=(x, -0.29, z - 0.19), rotation=(1.5708, 0, 0))
        label = bpy.context.object
        label.data.body = item
        label.data.align_x = "CENTER"
        label.data.size = 0.045
        label.data.extrude = 0.002

    bpy.ops.object.light_add(type="AREA", location=(-3.5, -4.5, 5.5))
    key = bpy.context.object
    key.data.energy = 1100
    key.data.size = 4.0
    look_at(key, (0, 0, (rows - 1) * spacing_z * 0.5 + 0.2))
    bpy.ops.object.light_add(type="AREA", location=(3.0, -2.0, 3.0))
    fill = bpy.context.object
    fill.data.energy = 650
    fill.data.size = 3.0
    look_at(fill, (0, 0, (rows - 1) * spacing_z * 0.5 + 0.2))
    bpy.ops.object.camera_add(location=(0, -8.5, (rows - 1) * spacing_z * 0.5 + 0.2))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(3.2, rows * spacing_z + 0.28)
    look_at(camera, (0, 0, (rows - 1) * spacing_z * 0.5 + 0.2))

    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1536
    scene.render.resolution_y = 1536
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.018, 0.022, 0.025)
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {output}")


if __name__ == "__main__":
    main()

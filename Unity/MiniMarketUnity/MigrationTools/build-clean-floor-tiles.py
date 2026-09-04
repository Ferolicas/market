"""Build clean, modular runtime copies of the two approved mosaic floor tiles.

The Tripo source GLBs remain untouched. Their scanned outer silhouettes are
not rectangular and cannot tile without holes, so these runtime copies retain
the reference palette and 3x2 tile design with low-poly game geometry.
"""
from pathlib import Path

import bpy


PROJECT = Path("/home/ferney_oliveros/Mini Market")
GAME_OUTPUT = PROJECT / "GameAssets/Environment/RuntimeCorrected/Structural"
UNITY_OUTPUT = PROJECT / "Unity/MiniMarketUnity/Assets/StreamingAssets/Art/Furniture"


def srgb(hex_value: str):
    value = hex_value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)) + (1.0,)


def material(name: str, color: str):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = srgb(color)
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = 0.72
    shader.inputs["Specular IOR Level"].default_value = 0.2
    return result


def rounded_box(name, location, scale, assigned, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0] / 2, scale[1] / 2, scale[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(assigned)
    modifier = obj.modifiers.new("SoftBevel", "BEVEL")
    modifier.width = bevel
    modifier.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def build(asset_id: str, tile_color: str, edge_color: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    top = material(f"{asset_id}_RoyalMatch", tile_color)
    edge = material(f"{asset_id}_Grout", edge_color)
    objects = [rounded_box("Base", (0, 0, 0.045), (3.0, 2.2, 0.09), edge, 0.035)]
    columns, rows = 3, 2
    gap = 0.035
    cell_x = (3.0 - gap * (columns + 1)) / columns
    cell_y = (2.2 - gap * (rows + 1)) / rows
    for column in range(columns):
        for row in range(rows):
            x = -1.5 + gap + cell_x / 2 + column * (cell_x + gap)
            y = -1.1 + gap + cell_y / 2 + row * (cell_y + gap)
            objects.append(rounded_box(f"Tile_{column}_{row}", (x, y, 0.115), (cell_x, cell_y, 0.11), top, 0.035))
    for root in (GAME_OUTPUT, UNITY_OUTPUT):
        root.mkdir(parents=True, exist_ok=True)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.export_scene.gltf(
            filepath=str(root / f"{asset_id}.glb"), export_format="GLB", use_selection=True,
            export_materials="EXPORT", export_yup=True, export_animations=False,
            export_cameras=False, export_lights=False,
        )


build("FloorTileBeige", "#D8C8AD", "#8D8475")
build("FloorTileWhite", "#E7E4DE", "#9A958B")
print(f"Clean floor runtime GLBs written to {GAME_OUTPUT} and {UNITY_OUTPUT}")

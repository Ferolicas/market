"""Build the original Mini Market environment kit without importing legacy models.

Run with:
  /home/ferney_oliveros/software/blender-5.2.0-linux-x64/blender \
    --background --factory-startup --python tools/blender/build_market_environment.py
"""
from __future__ import annotations

import math
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public/models/market/environment"
SOURCE = ROOT / "art/environment/market_environment_pipeline.blend"

EXPOSURE = [
    "shelf_gondola_single", "shelf_gondola_double", "shelf_wall_low", "shelf_wall_tall", "shelf_endcap",
    "display_produce_tomato", "display_produce_mixed", "display_bakery", "display_eggs",
    "display_refrigerated_open", "display_refrigerated_doors", "display_freezer_chest", "display_promo_basket", "rack_stockroom",
]
EQUIPMENT = [
    "build_floor_tile", "build_wall_straight", "build_wall_corner", "build_storefront_window", "build_entrance_frame",
    "equipment_auto_door", "equipment_ceiling_light", "equipment_checkout_counter", "equipment_cash_register",
    "equipment_conveyor", "equipment_scanner", "equipment_cash_drawer", "equipment_card_terminal", "equipment_bagging_area",
    "equipment_basket_stack", "equipment_bread_oven", "equipment_flour_mill", "equipment_juice_machine",
    "equipment_cheese_maker", "equipment_delivery_dock", "equipment_upgrade_pad", "equipment_hire_pad",
]
FARM = [
    "farm_plot_empty", "farm_plot_seeded", "farm_plot_watered", "tomato_sprout", "tomato_small", "tomato_growing",
    "tomato_ripe", "tomato_harvest_item", "wheat_sprout", "wheat_small", "wheat_growing", "wheat_ripe",
    "wheat_harvest_item", "corn_sprout", "corn_small", "corn_growing", "corn_ripe", "corn_harvest_item",
    "chicken_coop", "chicken_character", "egg_output_tray", "cow_station", "cow_character", "milk_output_can", "farm_tool_set",
]

COLORS = {
    "cream": (0.88, 0.82, 0.68, 1), "ivory": (0.96, 0.93, 0.84, 1), "green": (0.28, 0.39, 0.18, 1),
    "dark": (0.055, 0.065, 0.06, 1), "metal": (0.43, 0.48, 0.46, 1), "glass": (0.48, 0.72, 0.73, 0.36),
    "wood": (0.48, 0.25, 0.095, 1), "soil": (0.29, 0.14, 0.06, 1), "leaf": (0.22, 0.48, 0.12, 1),
    "tomato": (0.72, 0.08, 0.035, 1), "wheat": (0.93, 0.58, 0.12, 1), "corn": (0.95, 0.67, 0.08, 1),
    "white": (0.91, 0.88, 0.79, 1), "brown": (0.18, 0.11, 0.07, 1), "pink": (0.72, 0.39, 0.39, 1),
}


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        if datablocks is bpy.data.materials:
            continue
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def mat(name: str, color: tuple[float, float, float, float]):
    material = bpy.data.materials.get(name)
    if material:
        return material
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_backface_culling = True
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.66
    if color[3] < 1:
        bsdf.inputs["Alpha"].default_value = color[3]
        bsdf.inputs["Transmission Weight"].default_value = 0.18
        material.surface_render_method = "DITHERED"
    return material


def finish(obj, name: str, material: str):
    obj.name = name
    obj.data.materials.append(mat(material, COLORS[material]))
    for polygon in obj.data.polygons:
        polygon.use_smooth = not name.startswith("Panel")
    return obj


def box(name, loc, scale, material="cream", bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = finish(bpy.context.object, name, material)
    obj.scale = (scale[0] / 2, scale[1] / 2, scale[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("SoftEdges", "BEVEL")
        modifier.width = min(bevel, min(scale) * 0.22)
        modifier.segments = 2
    return obj


def sphere(name, loc, scale, material="white"):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=loc)
    obj = finish(bpy.context.object, name, material)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def cyl(name, loc, radius, depth, material="metal", rotation=(0, 0, 0), vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    return finish(bpy.context.object, name, material)


def cone(name, loc, radius, depth, material="green", rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=radius, radius2=radius * 0.18, depth=depth, location=loc, rotation=rotation)
    return finish(bpy.context.object, name, material)


def shelf(double=False, low=False, endcap=False):
    width = 0.8 if endcap else 2.15
    height = 1.15 if low else 2.15
    box("Base", (0, 0.12, 0), (width, 0.24, 0.74 if double else 0.48), "dark")
    for x in (-width / 2 + 0.05, width / 2 - 0.05):
        box("Post", (x, height / 2, 0), (0.1, height, 0.1), "dark")
    levels = 2 if low else 4
    for row in range(levels):
        y = 0.35 + row * ((height - 0.45) / max(1, levels - 1))
        box("Shelf", (0, y, 0.15 if not double else 0), (width - 0.12, 0.09, 0.55 if double else 0.42), "ivory")
        box("Trim", (0, y + 0.05, 0.39 if double else 0.35), (width - 0.08, 0.08, 0.05), "green")
        if double:
            box("Trim", (0, y + 0.05, -0.39), (width - 0.08, 0.08, 0.05), "green")
    box("Header", (0, height, 0), (width, 0.14, 0.5 if double else 0.18), "green")


def display(kind: str):
    if "produce" in kind:
        box("Plinth", (0, 0.22, 0), (1.9, 0.44, 1.15), "dark")
        box("Backboard", (0, 1.15, -0.49), (1.9, 1.42, 0.12), "green")
        for x in (-0.9, 0.9): box("Post", (x, 0.98, 0), (0.1, 1.78, 1.05), "dark")
        box("Canopy", (0, 1.72, -0.04), (1.9, 0.15, 1.08), "green")
        for column in (-0.58, 0, 0.58):
            tray = box("ProduceBin", (column, 0.74, 0), (0.53, 0.2, 0.85), "wood")
            tray.rotation_euler.x = -0.12
    elif kind == "display_bakery":
        box("Cabinet", (0, 0.62, 0), (2.0, 1.24, 0.78), "dark")
        box("Glass", (0, 1.02, 0.41), (1.76, 0.62, 0.035), "glass", 0.01)
        for y in (0.45, 0.77): box("Tray", (0, y, 0.1), (1.65, 0.05, 0.58), "metal")
    elif kind == "display_eggs":
        box("Stand", (0, 0.34, 0), (1.5, 0.68, 0.82), "wood")
        box("Backboard", (0, 1.04, -0.34), (1.5, 1.4, 0.14), "wheat")
        for x in (-0.69, 0.69): box("SidePost", (x, 1.02, 0), (0.12, 1.72, 0.76), "wood")
        for y in (0.48, 0.91, 1.34):
            tray = box("EggTray", (0, y, 0.22), (1.32, 0.09, 0.54), "cream")
            tray.rotation_euler.x = -0.06
        box("Canopy", (0, 1.73, -0.02), (1.5, 0.14, 0.82), "wood")
    elif "refrigerated" in kind:
        box("Cabinet", (0, 1.05, 0), (2.05, 2.1, 0.72), "dark")
        for y in (0.45, 0.95, 1.45): box("ColdShelf", (0, y, 0.08), (1.85, 0.05, 0.48), "metal")
        if "doors" in kind:
            for x in (-0.5, 0.5): box("Door", (x, 1.05, 0.38), (0.94, 1.85, 0.035), "glass", 0.01)
    elif kind == "display_freezer_chest":
        box("Freezer", (0, 0.5, 0), (1.85, 1.0, 1.05), "ivory")
        for x in (-0.44, 0.44): box("Lid", (x, 1.02, 0), (0.82, 0.04, 0.9), "glass", 0.01)
    else:
        box("Basket", (0, 0.34, 0), (1.3, 0.68, 0.82), "green")


def equipment(asset: str):
    if asset == "build_floor_tile": box("Floor", (0, 0.06, 0), (2.4, 0.12, 2.4), "cream")
    elif asset == "build_wall_straight": box("Wall", (0, 1.35, 0), (2.4, 2.7, 0.22), "cream")
    elif asset == "build_wall_corner":
        box("WallA", (-0.58, 1.35, 0), (1.25, 2.7, 0.22), "cream"); box("WallB", (0, 1.35, -0.58), (0.22, 2.7, 1.25), "cream")
    elif asset == "build_storefront_window":
        box("Frame", (0, 1.35, 0), (2.4, 2.7, 0.16), "dark"); box("Glass", (0, 1.35, 0.1), (2.05, 2.25, 0.035), "glass", 0.01)
    elif asset == "build_entrance_frame":
        for x in (-1.05, 1.05): box("Post", (x, 1.35, 0), (0.18, 2.7, 0.2), "dark")
        box("Lintel", (0, 2.62, 0), (2.25, 0.18, 0.2), "dark")
    elif asset == "equipment_auto_door":
        for x in (-0.52, 0.52): box("DoorLeaf", (x, 1.15, 0), (0.95, 2.3, 0.05), "glass", 0.01)
        box("Sensor", (0, 2.4, 0), (0.55, 0.16, 0.18), "dark")
    elif asset == "equipment_ceiling_light": box("Light", (0, 0.04, 0), (2, 0.08, 0.42), "ivory")
    elif asset == "equipment_checkout_counter":
        box("Counter", (0, 0.44, 0), (3.1, 0.88, 0.92), "green"); box("Top", (0, 0.91, 0), (3.2, 0.08, 0.96), "dark")
    elif asset == "equipment_cash_register":
        box("Drawer", (0, 0.18, 0), (0.82, 0.36, 0.62), "dark"); box("Screen", (0, 0.68, 0), (0.72, 0.55, 0.12), "green")
    elif asset == "equipment_conveyor":
        box("Belt", (0, 0.55, 0), (2.1, 0.16, 0.72), "dark");
        for x in (-1, 1): cyl("Roller", (x, 0.55, 0), 0.12, 0.78, "metal", (math.pi / 2, 0, 0))
    elif asset in {"equipment_scanner", "equipment_card_terminal"}:
        box("Body", (0, 0.24, 0), (0.4, 0.48, 0.32), "dark"); box("Screen", (0, 0.48, 0.09), (0.29, 0.22, 0.025), "green", 0.01)
    elif asset == "equipment_cash_drawer": box("CashDrawer", (0, 0.16, 0), (0.86, 0.32, 0.62), "dark")
    elif asset == "equipment_bagging_area": box("Bagging", (0, 0.42, 0), (1.25, 0.84, 0.82), "cream")
    elif asset == "equipment_basket_stack":
        for i in range(4): box("Basket", (0, 0.12 + i * 0.1, 0), (0.72, 0.22, 0.5), "green")
    elif asset == "equipment_bread_oven":
        box("Oven", (0, 0.95, 0), (1.45, 1.9, 0.94), "metal")
        for y in (0.72, 1.3): box("OvenGlass", (0, y, 0.49), (1.12, 0.45, 0.035), "glass", 0.01)
    elif asset == "equipment_flour_mill":
        box("Mill", (0, 0.58, 0), (1.3, 1.16, 0.9), "wheat"); cone("Hopper", (0, 1.48, 0), 0.48, 0.7, "wood"); cyl("Wheel", (0, 0.65, 0.5), 0.32, 0.12, "dark", (math.pi / 2, 0, 0))
    elif asset in {"equipment_juice_machine", "equipment_cheese_maker"}:
        box("Machine", (0, 0.65, 0), (1.2, 1.3, 0.82), "metal"); cyl("Tank", (0, 1.35, 0), 0.34, 0.55, "cream"); box("Output", (0, 0.42, 0.45), (0.42, 0.28, 0.3), "green")
    elif asset == "equipment_delivery_dock":
        box("Dock", (0, 0.12, 0), (2.2, 0.24, 1.45), "wood"); box("Crate", (0, 0.55, 0), (0.8, 0.8, 0.72), "cream")
    elif asset in {"equipment_upgrade_pad", "equipment_hire_pad"}:
        cyl("Pad", (0, 0.06, 0), 0.85, 0.12, "green", vertices=32); cyl("Ring", (0, 0.13, 0), 0.62, 0.04, "ivory", vertices=32)


def plant(kind: str, stage: int, origin=(0, 0, 0)):
    ox, oy, oz = origin
    height = 0.15 + stage * 0.18
    cyl("Stem", (ox, oy + height / 2, oz), 0.022 + stage * 0.004, height, "leaf", vertices=8)
    for side in (-1, 1):
        leaf = sphere("Leaf", (ox + side * 0.1, oy + height * 0.62, oz), (0.15, 0.035, 0.07), "leaf")
        leaf.rotation_euler.y = side * 0.25
    if stage >= 2:
        fruit_mat = "tomato" if kind == "tomato" else "wheat" if kind == "wheat" else "corn"
        for x in (-0.1, 0, 0.1):
            if kind == "wheat": cone("Grain", (ox + x, oy + height, oz), 0.055, 0.2, fruit_mat)
            elif kind == "corn": sphere("Cob", (ox + x, oy + height * 0.75, oz), (0.055, 0.16, 0.055), fruit_mat)
            else: sphere("Fruit", (ox + x, oy + height * 0.72, oz + 0.07), (0.075, 0.075, 0.075), fruit_mat)


def chicken():
    sphere("Body", (0, 0.55, 0), (0.42, 0.38, 0.36), "white"); sphere("Head", (0, 0.9, 0.2), (0.25, 0.25, 0.24), "white")
    cone("Beak", (0, 0.87, 0.47), 0.1, 0.22, "wheat", (math.pi / 2, 0, 0))
    for x in (-0.09, 0.09): sphere("Eye", (x, 0.96, 0.4), (0.028, 0.028, 0.028), "dark")
    for x in (-0.12, 0, 0.12): sphere("Comb", (x, 1.15 - abs(x) * 0.3, 0.18), (0.07, 0.1, 0.055), "tomato")
    for x in (-0.2, 0.2): cyl("Leg", (x, 0.18, 0), 0.025, 0.32, "wheat", vertices=7)


def cow():
    sphere("Body", (0, 0.85, 0), (0.78, 0.48, 0.43), "white")
    for x, z in ((-0.36, -0.25), (-0.36, 0.25), (0.36, -0.25), (0.36, 0.25)): cyl("Leg", (x, 0.37, z), 0.085, 0.72, "white", vertices=10)
    sphere("Head", (0, 0.94, 0.65), (0.36, 0.39, 0.34), "white"); sphere("Muzzle", (0, 0.79, 0.94), (0.28, 0.17, 0.19), "pink")
    for x in (-0.13, 0.13): sphere("Eye", (x, 1.03, 0.94), (0.035, 0.035, 0.025), "dark")
    for x in (-0.27, 0.27): cone("Horn", (x, 1.26, 0.65), 0.06, 0.24, "cream", (0, 0, -x * 1.4))
    sphere("Udder", (0, 0.42, 0), (0.22, 0.14, 0.18), "pink")
    for x, z in ((-0.32, 0.16), (0.25, -0.2), (0.4, 0.12)): sphere("Spot", (x, 0.95, z), (0.25, 0.13, 0.21), "brown")


def farm_asset(asset: str):
    if asset.startswith("farm_plot"):
        box("Soil", (0, 0.08, 0), (1.2, 0.16, 1.1), "soil")
        if asset == "farm_plot_seeded":
            for x in (-0.34, 0, 0.34):
                for z in (-0.3, 0, 0.3): sphere("Seed", (x, 0.18, z), (0.035, 0.025, 0.035), "wheat")
        if asset == "farm_plot_watered": box("WetSoil", (0, 0.17, 0), (1.05, 0.025, 0.95), "brown", 0.01)
    elif any(asset.startswith(kind) for kind in ("tomato_", "wheat_", "corn_")):
        kind = asset.split("_")[0]
        if asset.endswith("harvest_item"):
            plant(kind, 3)
        else:
            stage = {"sprout": 0, "small": 1, "growing": 2, "ripe": 3}[asset.split("_")[-1]]
            box("Soil", (0, 0.06, 0), (1.2, 0.12, 1.1), "soil")
            for x in (-0.34, 0, 0.34):
                for z in (-0.3, 0, 0.3):
                    plant(kind, stage, (x, 0.11, z))
    elif asset == "chicken_character": chicken()
    elif asset == "cow_character": cow()
    elif asset == "chicken_coop":
        box("Coop", (0, 0.55, 0), (1.35, 1.1, 0.95), "wood"); box("Roof", (0, 1.18, 0), (1.65, 0.14, 1.18), "green")
    elif asset == "cow_station":
        box("Platform", (0, 0.08, 0), (1.9, 0.16, 1.35), "wood")
        for x in (-0.82, 0.82): box("Rail", (x, 0.72, 0), (0.08, 1.35, 1.2), "green")
    elif asset == "egg_output_tray":
        box("Tray", (0, 0.07, 0), (0.82, 0.14, 0.58), "wood")
        for x in (-0.24, 0, 0.24):
            for z in (-0.14, 0.14): sphere("Egg", (x, 0.18, z), (0.07, 0.09, 0.07), "white")
    elif asset == "milk_output_can":
        cyl("MilkCan", (0, 0.34, 0), 0.22, 0.68, "metal"); cyl("Neck", (0, 0.72, 0), 0.14, 0.16, "metal")
    elif asset == "farm_tool_set":
        cyl("Handle", (-0.2, 0.65, 0), 0.025, 1.3, "wood"); box("Spade", (-0.2, 0.08, 0), (0.24, 0.28, 0.06), "metal"); cyl("Can", (0.35, 0.2, 0), 0.2, 0.4, "metal")


def build(asset: str):
    reset()
    if asset.startswith("shelf_") or asset == "rack_stockroom":
        shelf(double=asset == "shelf_gondola_double", low=asset == "shelf_wall_low", endcap=asset == "shelf_endcap")
    elif asset.startswith("display_"):
        display(asset)
    elif asset.startswith("build_") or asset.startswith("equipment_"):
        equipment(asset)
    else:
        farm_asset(asset)
    root = bpy.data.objects.new(asset, None)
    bpy.context.scene.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root
    root["canonicalId"] = asset
    root["source"] = "KIT MARKET PNG"
    OUTPUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / f"{asset}.glb"), export_format="GLB", use_selection=True, export_apply=True, export_materials="EXPORT")


def main():
    for asset in EXPOSURE + EQUIPMENT + FARM:
        build(asset)
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
    print(f"Exported {len(EXPOSURE) + len(EQUIPMENT) + len(FARM)} original environment assets to {OUTPUT}")


if __name__ == "__main__":
    main()

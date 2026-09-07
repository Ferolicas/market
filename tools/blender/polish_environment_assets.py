"""Rebuild the Mini Market environment as clean, metric, game-ready GLBs.

The first Tripo mosaic extraction fused parts of the catalogue sheet into many
objects.  Removing small connected islands cannot fix that safely because the
sheet and the intended object often share one watertight mesh.  This builder
reconstructs the affected props from regular solids, keeps the catalogue PNG
palette, puts every pivot at the centre of its footprint on the floor, and
exports a deterministic asset with no loose scan fragments.

Approved user-delivered pieces are intentionally absent from BUILDERS.  They
are protected by ``tools/locked`` or by their approved runtime replacement.

Run with Blender 5.2 or newer::

  blender --background --factory-startup \
    --python tools/blender/polish_environment_assets.py -- \
    --output=/tmp/market-polished
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Callable

import bpy
from mathutils import Vector


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((item.removeprefix(prefix) for item in args if item.startswith(prefix)), default)


OUTPUT = Path(option("output", "/tmp/market-polished"))
ONLY = {item for item in option("only").split(",") if item}

COLORS = {
    "cream": "E9DFC8", "ivory": "F5F0E5", "beige": "CDBB98", "olive": "62753B",
    "green": "405C2D", "green2": "738B45", "dark": "2E3332", "steel": "7E8987",
    "silver": "AEB7B5", "glass": "9CC8CC", "wood": "9A6032", "wood2": "C08445",
    "soil": "633B22", "wetsoil": "422719", "leaf": "4E8439", "leaf2": "78A94A",
    "red": "B53B2D", "orange": "D77B2E", "yellow": "E5B642", "white": "ECEAE2",
    "black": "171A1A", "blue": "73B7C7", "cardboard": "B8874D", "gold": "D9A640",
}


def rgba(token: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = COLORS.get(token, token).lstrip("#")
    def linear(channel: int) -> float:
        srgb = channel / 255
        return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4
    return tuple(linear(int(value[index : index + 2], 16)) for index in (0, 2, 4)) + (alpha,)


def material(token: str, *, alpha: float = 1.0, metallic: float = 0.0, roughness: float = 0.55):
    key = f"Polished_{token}_{alpha:.2f}_{metallic:.2f}_{roughness:.2f}"
    found = bpy.data.materials.get(key)
    if found:
        return found
    mat = bpy.data.materials.new(key)
    mat.diffuse_color = rgba(token, alpha)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(token)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        bsdf.inputs["Transmission Weight"].default_value = 0.08
        mat.surface_render_method = "DITHERED"
        mat.use_transparency_overlap = False
    return mat


def finish(obj, name: str, token: str, *, alpha=1.0, metallic=0.0, roughness=0.55, smooth=False):
    obj.name = name
    obj.data.materials.append(material(token, alpha=alpha, metallic=metallic, roughness=roughness))
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def box(name, size, loc=(0, 0, 0), token="cream", bevel=0.025, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = finish(bpy.context.object, name, token)
    obj.scale = tuple(max(0.001, value) / 2 for value in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Clean edge", "BEVEL")
        modifier.width = min(bevel, min(size) * 0.18)
        modifier.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def cylinder(name, radius, depth, loc=(0, 0, 0), token="steel", vertices=20, rotation=(0, 0, 0), metallic=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    return finish(bpy.context.object, name, token, metallic=metallic, roughness=0.4, smooth=True)


def sphere(name, size, loc=(0, 0, 0), token="leaf", segments=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(8, segments // 2), location=loc)
    obj = finish(bpy.context.object, name, token, roughness=0.62, smooth=True)
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def cone(name, radius1, radius2, depth, loc=(0, 0, 0), token="green", vertices=20, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=loc, rotation=rotation)
    return finish(bpy.context.object, name, token, smooth=True)


def torus(name, major, minor, loc=(0, 0, 0), token="black", rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24, minor_segments=8, location=loc, rotation=rotation)
    return finish(bpy.context.object, name, token, roughness=0.45, smooth=True)


def pipe(name, start, end, radius, token="steel"):
    a, b = Vector(start), Vector(end)
    delta = b - a
    obj = cylinder(name, radius, delta.length, (a + b) * 0.5, token)
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return obj


def glass_box(name, size, loc=(0, 0, 0), rotation=(0, 0, 0)):
    obj = box(name, size, loc, "glass", 0.008, rotation)
    obj.data.materials.clear()
    obj.data.materials.append(material("glass", alpha=0.22, metallic=0.03, roughness=0.12))
    return obj


def label(text: str, loc, size=0.16, rotation=(math.pi / 2, 0, 0), token="ivory", name="Label"):
    bpy.ops.object.text_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = size * 0.025
    obj.data.bevel_depth = size * 0.008
    obj.data.materials.append(material(token, roughness=0.48))
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return obj


def shelf(width=2.2, height=1.8, depth=0.55, levels=5, *, double=False, low=False):
    height = 1.15 if low else height
    base_depth = depth * (1.8 if double else 1)
    box("ShelfBase", (width, base_depth, 0.16), (0, 0, 0.08), "dark", 0.035)
    for x in (-width / 2 + 0.055, width / 2 - 0.055):
        for y in ((-base_depth / 2 + 0.04, base_depth / 2 - 0.04) if double else (base_depth / 2 - 0.05,)):
            box("ShelfPost", (0.09, 0.09, height), (x, y, height / 2), "dark", 0.018)
    count = 3 if low else levels
    for row in range(count):
        z = 0.27 + row * ((height - 0.38) / max(1, count - 1))
        for side in ((-1, 1) if double else (1,)):
            y = side * (depth * 0.38 if double else 0)
            box("ShelfTray", (width - 0.12, depth, 0.055), (0, y, z), "ivory", 0.014)
            lip_y = y + side * depth * 0.48
            box("PriceRail", (width - 0.07, 0.035, 0.09), (0, lip_y, z + 0.035), "olive", 0.008)
    box("ShelfHeader", (width, base_depth, 0.14), (0, 0, height - 0.04), "olive", 0.025)


def wood_crate(width=0.72, depth=0.5, height=0.34):
    plank = 0.075
    box("CrateFloor", (width - 0.08, depth - 0.08, 0.045), (0, 0, 0.045), "wood", 0.01)
    for z in (0.12, 0.23, 0.32):
        for y in (-depth / 2, depth / 2): box("CrateLongPlank", (width, plank, 0.075), (0, y, z), "wood2", 0.012)
        for x in (-width / 2, width / 2): box("CrateSidePlank", (plank, depth, 0.075), (x, 0, z), "wood", 0.012)
    for x in (-width / 2, width / 2):
        for y in (-depth / 2, depth / 2): box("CrateCorner", (0.085, 0.085, height), (x, y, height / 2), "wood", 0.014)


def shopping_basket():
    width, depth, height = 0.52, 0.34, 0.25
    box("BasketFloor", (width * 0.86, depth * 0.82, 0.045), (0, 0, 0.045), "olive", 0.03)
    for z in (0.09, 0.17, 0.25):
        for y in (-depth / 2, depth / 2): box("BasketRail", (width, 0.035, 0.035), (0, y, z), "olive", 0.012)
        for x in (-width / 2, width / 2): box("BasketRail", (0.035, depth, 0.035), (x, 0, z), "olive", 0.012)
    for x in (-0.2, 0, 0.2):
        for y in (-depth / 2, depth / 2): box("BasketSlat", (0.026, 0.028, height), (x, y, height / 2), "olive", 0.008)
    for side in (-1, 1):
        pipe("BasketHandle", (-0.20, 0, 0.27), (-0.20, 0, 0.52), 0.022, "dark")
        pipe("BasketHandle", (0.20, 0, 0.27), (0.20, 0, 0.52), 0.022, "dark")
        pipe("BasketGrip", (-0.20, 0, 0.52), (0.20, 0, 0.52), 0.025, "dark")
        break


def shopping_cart():
    # 1.10 m long, 0.62 m wide and 1.00 m high, matching the character scale.
    silver = "silver"
    for x in (-0.28, 0.28):
        pipe("CartRearLeg", (x, -0.52, 0.14), (x, -0.40, 0.84), 0.025, silver)
        pipe("CartLowerRail", (x, -0.48, 0.17), (x, 0.50, 0.17), 0.022, silver)
    for x in (-0.28, 0.28):
        for y in (-0.47, 0.46):
            torus("CartWheel", 0.065, 0.025, (x, y, 0.075), "black", (math.pi / 2, 0, 0))
            cylinder("CartHub", 0.025, 0.075, (x, y, 0.075), silver, 16, (math.pi / 2, 0, 0), 0.5)
    # Tapered wire basket.
    for z, half_x, front_y, back_y in ((0.42, 0.25, 0.48, -0.38), (0.62, 0.30, 0.52, -0.41), (0.82, 0.32, 0.54, -0.44)):
        pipe("CartRail", (-half_x, front_y, z), (half_x, front_y, z), 0.018, silver)
        pipe("CartRail", (-half_x, back_y, z), (half_x, back_y, z), 0.018, silver)
        pipe("CartSideRail", (-half_x, back_y, z), (-half_x, front_y, z), 0.018, silver)
        pipe("CartSideRail", (half_x, back_y, z), (half_x, front_y, z), 0.018, silver)
    for x in (-0.27, -0.135, 0, 0.135, 0.27):
        pipe("CartFrontWire", (x * 0.83, 0.48, 0.42), (x, 0.54, 0.82), 0.012, silver)
        pipe("CartBackWire", (x * 0.83, -0.38, 0.42), (x, -0.44, 0.82), 0.012, silver)
    for y in (-0.30, -0.04, 0.22, 0.48):
        pipe("CartSideWire", (-0.24, y, 0.43), (-0.30, y, 0.81), 0.012, silver)
        pipe("CartSideWire", (0.24, y, 0.43), (0.30, y, 0.81), 0.012, silver)
    pipe("CartHandle", (-0.36, -0.50, 0.96), (0.36, -0.50, 0.96), 0.035, "olive")
    for x in (-0.32, 0.32): pipe("CartHandlePost", (x, -0.44, 0.80), (x, -0.50, 0.96), 0.022, silver)


def checkout_device(kind: str):
    if kind == "register":
        box("RegisterDrawer", (0.72, 0.52, 0.22), (0, 0, 0.11), "dark", 0.05)
        box("RegisterBody", (0.62, 0.42, 0.26), (0, 0.01, 0.31), "black", 0.06)
        box("RegisterKeys", (0.43, 0.24, 0.035), (0, -0.16, 0.47), "beige", 0.01, (math.radians(15), 0, 0))
        box("RegisterScreen", (0.48, 0.06, 0.23), (0, 0.13, 0.61), "dark", 0.025, (math.radians(-8), 0, 0))
        box("RegisterDisplay", (0.38, 0.012, 0.14), (0, 0.101, 0.62), "green", 0.005, (math.radians(-8), 0, 0))
    elif kind == "terminal":
        box("TerminalBase", (0.30, 0.28, 0.08), (0, 0, 0.04), "dark", 0.04)
        box("TerminalBody", (0.25, 0.13, 0.42), (0, 0.02, 0.29), "dark", 0.045, (math.radians(-10), 0, 0))
        box("TerminalScreen", (0.19, 0.012, 0.12), (0, -0.055, 0.40), "green2", 0.005, (math.radians(-10), 0, 0))
        for row in range(3):
            for col in range(3): box("TerminalKey", (0.045, 0.012, 0.035), ((col - 1) * 0.058, -0.075, 0.28 - row * 0.045), "beige", 0.004)
    elif kind == "printer":
        box("PrinterBody", (0.34, 0.33, 0.31), (0, 0, 0.155), "dark", 0.055)
        box("ReceiptSlot", (0.22, 0.025, 0.025), (0, -0.17, 0.23), "black", 0.005)
        box("Receipt", (0.20, 0.20, 0.018), (0, -0.06, 0.36), "white", 0.004, (math.radians(12), 0, 0))
    elif kind == "scanner":
        box("ScannerBase", (0.42, 0.34, 0.10), (0, 0, 0.05), "dark", 0.045)
        pipe("ScannerStem", (0, 0, 0.10), (0, 0, 0.52), 0.035, "dark")
        box("ScannerHead", (0.20, 0.30, 0.14), (0, 0, 0.57), "dark", 0.05, (math.radians(-12), 0, 0))
        box("ScannerBeam", (0.12, 0.01, 0.045), (0, -0.151, 0.56), "red", 0.004, (math.radians(-12), 0, 0))


def checkout_counter():
    box("CounterBody", (2.35, 0.86, 0.84), (0, 0, 0.43), "olive", 0.08)
    box("CounterPlinth", (2.42, 0.92, 0.15), (0, 0, 0.075), "dark", 0.035)
    box("CounterTop", (2.48, 0.94, 0.09), (0, 0, 0.91), "ivory", 0.035)
    box("CounterBelt", (1.25, 0.60, 0.045), (0.48, -0.05, 0.97), "black", 0.018)


def work_counter(sink=False):
    width = 1.75 if sink else 1.9
    box("CounterCabinet", (width, 0.68, 0.78), (0, 0, 0.39), "dark", 0.035)
    box("CounterTop", (width + 0.08, 0.76, 0.09), (0, 0, 0.84), "ivory" if not sink else "silver", 0.028)
    if sink:
        box("SinkBasin", (0.95, 0.50, 0.12), (0, 0, 0.86), "steel", 0.03)
        pipe("FaucetStem", (0, 0.24, 0.89), (0, 0.24, 1.24), 0.028, "silver")
        pipe("FaucetSpout", (0, 0.24, 1.24), (0, 0.03, 1.24), 0.028, "silver")
    else:
        for x in (-0.45, 0.45): box("CabinetDoor", (0.68, 0.025, 0.55), (x, -0.353, 0.40), "steel", 0.012)


def oven():
    box("OvenBody", (1.35, 0.92, 1.85), (0, 0, 0.925), "steel", 0.06)
    for level in (0.46, 0.93, 1.40):
        box("OvenDoor", (1.05, 0.045, 0.36), (0, -0.482, level), "dark", 0.025)
        glass_box("OvenWindow", (0.78, 0.012, 0.22), (0, -0.508, level))
        pipe("OvenHandle", (-0.39, -0.53, level + 0.18), (0.39, -0.53, level + 0.18), 0.018, "silver")
    for z in (0.15, 1.70): box("OvenTrim", (1.43, 0.98, 0.11), (0, 0, z), "dark", 0.025)


def chest_freezer():
    box("FreezerBody", (1.75, 0.95, 0.82), (0, 0, 0.41), "ivory", 0.08)
    box("FreezerPlinth", (1.78, 0.98, 0.17), (0, 0, 0.085), "olive", 0.04)
    for x in (-0.43, 0.43): glass_box("FreezerLid", (0.82, 0.86, 0.045), (x, 0, 0.85))
    for x in (-0.82, 0.82):
        for y in (-0.41, 0.41): cylinder("FreezerFoot", 0.045, 0.12, (x, y, 0.06), "dark")


def rack(width=1.5, height=1.8, depth=0.58):
    for x in (-width / 2, width / 2):
        for y in (-depth / 2, depth / 2): box("RackPost", (0.055, 0.055, height), (x, y, height / 2), "steel", 0.008)
    for z in (0.12, 0.62, 1.12, 1.62): box("RackShelf", (width, depth, 0.065), (0, 0, z), "beige", 0.012)


def pallet():
    for y in (-0.42, -0.21, 0, 0.21, 0.42): box("PalletSlat", (1.2, 0.14, 0.075), (0, y, 0.22), "wood2", 0.014)
    for x in (-0.48, 0, 0.48):
        box("PalletRunner", (0.15, 1.02, 0.10), (x, 0, 0.05), "wood", 0.014)
        for y in (-0.38, 0, 0.38): box("PalletBlock", (0.15, 0.16, 0.18), (x, y, 0.13), "wood", 0.014)


def wall_clock():
    cylinder("ClockFrame", 0.33, 0.09, (0, 0, 0.33), "dark", 32, (math.pi / 2, 0, 0), 0.35)
    cylinder("ClockFace", 0.285, 0.012, (0, -0.051, 0.33), "ivory", 32, (math.pi / 2, 0, 0))
    for hour in range(12):
        angle = hour * math.pi / 6
        x, z = math.sin(angle) * 0.235, 0.33 + math.cos(angle) * 0.235
        box("ClockMark", (0.018, 0.012, 0.055), (x, -0.061, z), "dark", 0.004, (0, angle, 0))
    pipe("ClockHourHand", (0, -0.07, 0.33), (-0.10, -0.07, 0.43), 0.012, "dark")
    pipe("ClockMinuteHand", (0, -0.071, 0.33), (0.15, -0.071, 0.46), 0.009, "dark")


def security_camera():
    box("CameraBracket", (0.18, 0.12, 0.28), (0, 0.18, 0.22), "ivory", 0.04)
    pipe("CameraArm", (0, 0.12, 0.25), (0, -0.12, 0.38), 0.045, "steel")
    box("CameraBody", (0.52, 0.28, 0.25), (0, -0.30, 0.48), "ivory", 0.10, (math.radians(-8), 0, 0))
    cylinder("CameraLens", 0.09, 0.035, (0, -0.451, 0.48), "black", 24, (math.pi / 2, 0, 0))


def ceiling_light():
    box("LightFrame", (1.75, 0.42, 0.08), (0, 0, 0.04), "steel", 0.018)
    box("LightPanel", (1.58, 0.30, 0.035), (0, 0, 0.086), "white", 0.008)
    for x in (-0.52, 0, 0.52): box("LightDivider", (0.025, 0.31, 0.018), (x, 0, 0.11), "silver", 0.004)


def hanging_sign():
    pipe("SignBar", (-0.8, 0, 0.92), (0.8, 0, 0.92), 0.035, "dark")
    for x in (-0.65, 0.65): pipe("SignDrop", (x, 0, 0.92), (x, 0, 0.66), 0.025, "dark")
    box("SignPanel", (1.5, 0.10, 0.42), (0, 0, 0.45), "olive", 0.045)
    box("SignInset", (1.28, 0.012, 0.28), (0, -0.056, 0.45), "green", 0.018)


def car():
    # Compact city hatchback from EXTERIOR.png.
    box("CarLowerBody", (3.90, 1.62, 0.62), (0, 0, 0.59), "blue", 0.20)
    box("CarBonnet", (1.24, 1.48, 0.36), (1.31, 0, 1.02), "blue", 0.16, (0, math.radians(-3), 0))
    box("CarCabin", (2.04, 1.42, 0.76), (-0.30, 0, 1.22), "blue", 0.22)
    glass_box("WindshieldFront", (0.72, 1.18, 0.035), (0.70, 0, 1.42), (0, math.radians(63), 0))
    glass_box("WindshieldRear", (0.65, 1.16, 0.035), (-1.37, 0, 1.40), (0, math.radians(-67), 0))
    for y in (-0.716, 0.716):
        glass_box("SideWindow", (1.02, 0.025, 0.52), (-0.32, y, 1.43))
        box("Door", (1.12, 0.025, 0.68), (-0.35, y * 1.02, 0.78), "blue", 0.025)
        box("DoorHandle", (0.18, 0.035, 0.04), (-0.20, y * 1.045, 0.98), "dark", 0.008)
    for x in (-1.34, 1.34):
        for y in (-0.74, 0.74):
            torus("Tyre", 0.30, 0.105, (x, y, 0.37), "black", (math.pi / 2, 0, 0))
            cylinder("Wheel", 0.19, 0.08, (x, y * 1.04, 0.37), "silver", 18, (math.pi / 2, 0, 0), 0.65)
    for y in (-0.46, 0.46): cylinder("Headlight", 0.14, 0.04, (1.98, y, 0.81), "ivory", 20, (0, math.pi / 2, 0))
    box("FrontGrille", (0.04, 0.62, 0.16), (1.98, 0, 0.58), "dark", 0.02)


def city_building():
    box("Building", (4.2, 3.6, 4.7), (0, 0, 2.35), "cream", 0.06)
    box("BuildingPlinth", (4.5, 3.9, 0.28), (0, 0, 0.14), "beige", 0.035)
    box("RoofTrim", (4.48, 3.88, 0.30), (0, 0, 4.64), "ivory", 0.035)
    for side in (-1, 1):
        for x in (-1.15, 0, 1.15):
            glass_box("Window", (0.68, 0.035, 0.86), (x, -1.817 * side, 3.18))
            box("WindowFrame", (0.78, 0.06, 0.96), (x, -1.825 * side, 3.18), "olive", 0.025)
            glass_box("WindowPane", (0.65, 0.012, 0.83), (x, -1.86 * side, 3.18))
        break
    glass_box("ShopDoor", (1.15, 0.04, 1.85), (0, -1.84, 1.12))
    for x in (-1.30, 1.30): glass_box("ShopWindow", (1.0, 0.04, 1.35), (x, -1.84, 1.13))
    for index, x in enumerate((-1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75)):
        box("AwningStripe", (0.48, 0.78, 0.12), (x, -2.05, 2.05), "olive" if index % 2 == 0 else "ivory", 0.025, (math.radians(10), 0, 0))
    box("RoofUnit", (0.95, 0.75, 0.55), (0.7, 0.35, 5.05), "beige", 0.04)


def bench():
    for x in (-0.94, 0.94):
        for y in (-0.26, 0.26): box("BenchLeg", (0.12, 0.12, 0.72), (x, y, 0.36), "dark", 0.035)
        pipe("BenchArm", (x, -0.34, 0.68), (x, 0.34, 0.92), 0.055, "dark")
    for y in (-0.25, -0.08, 0.09, 0.26): box("BenchSeatSlat", (2.05, 0.13, 0.08), (0, y, 0.72), "wood2", 0.025)
    for z in (0.98, 1.18, 1.38): box("BenchBackSlat", (2.05, 0.08, 0.14), (0, 0.35, z), "wood2", 0.025, (math.radians(-4), 0, 0))


def bus_stop():
    box("BusStopBase", (3.4, 1.55, 0.10), (0, 0, 0.05), "beige", 0.035)
    for x in (-1.52, 1.52):
        for y in (-0.62, 0.62): pipe("BusStopPost", (x, y, 0.08), (x, y, 2.45), 0.055, "dark")
    for x in (-1.05, 0, 1.05): box("BusStopRoof", (1.08, 1.58, 0.12), (x, 0, 2.52), "olive", 0.05, (0, math.radians(x * 1.8), 0))
    for x in (-1.50, 1.50): glass_box("BusStopSideGlass", (0.035, 1.15, 1.95), (x, 0.05, 1.15))
    glass_box("BusStopBackGlass", (2.9, 0.035, 1.95), (0, 0.61, 1.15))
    box("BusBench", (2.2, 0.42, 0.12), (0, 0.24, 0.62), "wood", 0.025)


def tree():
    box("TreeBase", (1.25, 1.25, 0.16), (0, 0, 0.08), "beige", 0.035)
    cylinder("TreeTrunk", 0.22, 2.3, (0, 0, 1.25), "wood", 16)
    for x, y, z, s in ((0, 0, 3.25, 1.12), (-0.62, 0.05, 3.05, 0.78), (0.58, 0.12, 3.1, 0.84), (0.1, -0.55, 3.2, 0.82), (0.12, 0.55, 3.15, 0.76), (0, 0, 3.85, 0.73)):
        sphere("TreeCrown", (s, s * 0.82, s * 0.78), (x, y, z), "leaf2", 16)


def street_light():
    cylinder("LampBase", 0.28, 0.20, (0, 0, 0.10), "dark", 24)
    cylinder("LampFoot", 0.18, 0.48, (0, 0, 0.34), "dark", 24)
    cylinder("LampPole", 0.065, 4.45, (0, 0, 2.62), "dark", 18)
    pipe("LampArm", (0, 0, 4.82), (0.52, 0, 5.18), 0.055, "dark")
    cylinder("LampShade", 0.22, 0.18, (0.56, 0, 5.08), "dark", 20)
    sphere("LampGlow", (0.15, 0.15, 0.17), (0.56, 0, 4.96), "yellow", 16)


def flat_tile(kind: str):
    if kind == "sidewalk":
        box("Sidewalk", (7.65, 2.2, 0.10), (0, 0, 0.05), "beige", 0.018)
        for x in (-2.55, 0, 2.55): box("Joint", (0.025, 2.18, 0.012), (x, 0, 0.107), "steel", 0)
        box("Kerb", (7.65, 0.22, 0.22), (0, -0.99, 0.11), "ivory", 0.015)
    elif kind == "parking":
        box("Parking", (8.0, 2.4, 0.06), (0, 0, 0.03), "dark", 0.008)
        for x in (-3.85, -1.3, 1.3, 3.85): box("ParkingLine", (0.08, 2.1, 0.018), (x, 0, 0.068), "white", 0.002)
    elif kind == "road":
        box("Road", (7.6, 3.0, 0.06), (0, 0, 0.03), "dark", 0.008)
        for x in (-3.72, 3.72): box("RoadEdge", (0.08, 3.0, 0.018), (x, 0, 0.068), "white", 0.002)
        for y in (-1.0, 0, 1.0): box("LaneDash", (1.0, 0.07, 0.019), (0, y, 0.07), "white", 0.002)
    else:
        box("Crosswalk", (7.0, 4.67, 0.035), (0, 0, 0.0175), "dark", 0.004)
        for y in (-1.65, -1.1, -0.55, 0, 0.55, 1.1, 1.65): box("CrosswalkStripe", (5.8, 0.30, 0.018), (0, y, 0.045), "white", 0.002)


def farm_plot(kind: str):
    wet = kind in {"watered", "irrigation"}
    box("PlotSoil", (1.45, 1.18, 0.16), (0, 0, 0.08), "wetsoil" if wet else "soil", 0.035)
    if kind in {"furrows", "watered", "irrigation"}:
        for x in (-0.48, -0.16, 0.16, 0.48):
            box("Furrow", (0.18, 1.02, 0.10), (x, 0, 0.18), "soil" if wet else "wood", 0.04)
    if kind == "seeded":
        for x in (-0.45, 0, 0.45):
            for y in (-0.36, 0, 0.36): sphere("Seed", (0.035, 0.035, 0.025), (x, y, 0.19), "yellow", 10)


def fence(length=1.55, corner=False, gate=False):
    def section(yaw=0, offset=(0, 0, 0)):
        ox, oy, oz = offset
        for x in (-length / 2, length / 2): box("FencePost", (0.13, 0.13, 1.05), (ox + x, oy, oz + 0.525), "wood", 0.018, (0, 0, yaw))
        for z in (0.34, 0.72): box("FenceRail", (length, 0.10, 0.12), (ox, oy, oz + z), "wood2", 0.018, (0, 0, yaw))
    if gate:
        for x in (-length / 2, length / 2): box("GatePost", (0.15, 0.15, 1.35), (x, 0, 0.675), "wood", 0.02)
        box("GatePanel", (length - 0.20, 0.10, 0.98), (0, 0, 0.58), "wood2", 0.025)
        pipe("GateBrace", (-0.60, -0.06, 0.18), (0.60, -0.06, 0.96), 0.055, "dark")
    else:
        section()
        if corner:
            # second leg at 90 degrees
            for y in (0, length): box("FencePost", (0.13, 0.13, 1.05), (-length / 2, y, 0.525), "wood", 0.018)
            for z in (0.34, 0.72): box("FenceRail", (0.10, length, 0.12), (-length / 2, length / 2, z), "wood2", 0.018)


def crop(stage: str, crop_kind="generic"):
    stage_height = {"seed": 0.05, "sprout": 0.22, "small": 0.45, "growing": 0.72, "ripe": 0.95}[stage]
    farm_plot("empty")
    if stage == "seed":
        sphere("CropSeed", (0.055, 0.045, 0.035), (0, 0, 0.20), "yellow", 10)
        return
    for x, y in ((-0.38, -0.28), (0.38, -0.28), (-0.38, 0.28), (0.38, 0.28)):
        pipe("CropStem", (x, y, 0.17), (x, y, 0.17 + stage_height), 0.025, "leaf")
        for side in (-1, 1):
            sphere("CropLeaf", (0.16, 0.07, 0.08), (x + side * 0.10, y, 0.38 + stage_height * 0.35), "leaf2", 12)
        if stage in {"growing", "ripe"}:
            token = {"tomato": "red", "carrot": "orange", "pumpkin": "orange", "corn": "yellow", "wheat": "gold", "lettuce": "leaf2"}.get(crop_kind, "leaf2")
            if crop_kind == "wheat":
                for dx in (-0.07, 0, 0.07): cone("WheatHead", 0.05, 0.015, 0.25, (x + dx, y, 0.18 + stage_height), token, 12)
            elif crop_kind == "corn":
                cone("CornPlant", 0.24, 0.04, stage_height, (x, y, 0.17 + stage_height / 2), "leaf", 12)
                sphere("CornCob", (0.08, 0.07, 0.21), (x + 0.08, y, 0.45 + stage_height * 0.3), token, 12)
            elif crop_kind == "lettuce":
                for angle in range(0, 360, 45):
                    a = math.radians(angle); sphere("LettuceLeaf", (0.21, 0.10, 0.10), (x + math.cos(a) * 0.10, y + math.sin(a) * 0.10, 0.27), token, 12)
            else:
                sphere("CropFruit", (0.11, 0.11, 0.11 if crop_kind != "carrot" else 0.17), (x, y - 0.07, 0.39 + stage_height * 0.42), token, 14)


def watering_can():
    cylinder("CanBody", 0.28, 0.50, (0, 0, 0.28), "steel", 24, metallic=0.55)
    pipe("CanHandleA", (-0.22, 0, 0.45), (-0.38, 0, 0.72), 0.035, "steel")
    pipe("CanHandleB", (0.22, 0, 0.45), (0.38, 0, 0.72), 0.035, "steel")
    pipe("CanHandleTop", (-0.38, 0, 0.72), (0.38, 0, 0.72), 0.035, "steel")
    pipe("CanSpout", (0, -0.22, 0.28), (0, -0.78, 0.48), 0.07, "steel")
    cylinder("CanRose", 0.14, 0.07, (0, -0.82, 0.50), "steel", 20, (math.pi / 2, 0, 0), 0.55)


def sprinkler():
    cylinder("SprinklerBase", 0.30, 0.10, (0, 0, 0.05), "green", 24)
    cylinder("SprinklerStem", 0.055, 0.58, (0, 0, 0.37), "steel", 18, metallic=0.5)
    for angle in (0, 120, 240):
        a = math.radians(angle)
        pipe("SprinklerArm", (0, 0, 0.64), (math.cos(a) * 0.28, math.sin(a) * 0.28, 0.64), 0.025, "steel")


def greenhouse():
    box("GreenhouseBase", (2.6, 1.85, 0.18), (0, 0, 0.09), "beige", 0.025)
    for x in (-1.2, 1.2):
        for y in (-0.82, 0.82): pipe("GreenhousePost", (x, y, 0.18), (x, y, 1.72), 0.045, "dark")
    for x in (-1.2, 1.2):
        pipe("RoofRafter", (x, -0.82, 1.72), (x, 0, 2.28), 0.045, "dark")
        pipe("RoofRafter", (x, 0.82, 1.72), (x, 0, 2.28), 0.045, "dark")
    pipe("RoofRidge", (-1.2, 0, 2.28), (1.2, 0, 2.28), 0.045, "dark")
    glass_box("GreenhouseLeft", (0.035, 1.62, 1.45), (-1.2, 0, 0.95))
    glass_box("GreenhouseRight", (0.035, 1.62, 1.45), (1.2, 0, 0.95))
    glass_box("GreenhouseBack", (2.32, 0.035, 1.45), (0, 0.82, 0.95))
    glass_box("GreenhouseDoor", (0.95, 0.035, 1.42), (0, -0.82, 0.94))


def scarecrow():
    cylinder("ScarecrowPole", 0.06, 2.1, (0, 0, 1.05), "wood", 12)
    pipe("ScarecrowArms", (-0.78, 0, 1.65), (0.78, 0, 1.65), 0.055, "wood")
    cone("ScarecrowBody", 0.42, 0.24, 0.88, (0, 0, 1.28), "orange", 16)
    sphere("ScarecrowHead", (0.22, 0.22, 0.26), (0, 0, 1.98), "cardboard", 16)
    cone("ScarecrowHat", 0.42, 0.12, 0.34, (0, 0, 2.28), "gold", 18)


def machine(kind: str):
    box("MachineBase", (1.15, 0.82, 0.24), (0, 0, 0.12), "dark", 0.045)
    box("MachineBody", (1.05, 0.74, 1.05), (0, 0, 0.70), "olive" if kind != "oven" else "steel", 0.08)
    if kind == "mill":
        cone("MillHopper", 0.38, 0.20, 0.60, (0, 0, 1.52), "steel", 20)
        cylinder("MillWheel", 0.30, 0.12, (0.57, 0, 0.78), "wood", 20, (math.pi / 2, 0, 0))
        box("FlourTray", (0.50, 0.45, 0.12), (0, -0.46, 0.34), "ivory", 0.025)
    elif kind == "juice":
        glass_box("JuiceTank", (0.62, 0.55, 0.78), (0, 0, 1.22))
        for z in (1.0, 1.25, 1.48):
            for x in (-0.18, 0, 0.18): sphere("Orange", (0.09, 0.09, 0.09), (x, 0, z), "orange", 12)
        pipe("JuiceTap", (0, -0.40, 0.78), (0, -0.52, 0.62), 0.035, "dark")
    elif kind == "cheese":
        cylinder("CheeseVat", 0.40, 0.62, (0, 0, 1.18), "silver", 24, metallic=0.45)
        box("CheesePress", (0.55, 0.48, 0.45), (0, -0.20, 0.55), "gold", 0.05)


def platform(kind: str):
    cylinder("Platform", 0.78, 0.13, (0, 0, 0.065), "olive", 32)
    cylinder("PlatformInset", 0.58, 0.035, (0, 0, 0.148), "green2", 32)
    pipe("SignPost", (0, 0.55, 0.12), (0, 0.55, 1.05), 0.045, "dark")
    box("PlatformSign", (1.20, 0.12, 0.42), (0, 0.55, 1.20), "olive", 0.045)


def delivery_dock():
    box("DockBase", (2.4, 1.55, 0.16), (0, 0, 0.08), "beige", 0.03)
    box("DockWall", (2.2, 0.30, 1.55), (0, 0.62, 0.87), "cream", 0.05)
    box("DockDoor", (1.45, 0.035, 1.12), (0, 0.45, 0.68), "dark", 0.035)
    box("DockRamp", (1.45, 1.05, 0.12), (0, -0.42, 0.10), "steel", 0.02, (math.radians(4), 0, 0))
    for x in (-0.62, 0.62): box("HazardStripe", (0.10, 1.03, 0.025), (x, -0.42, 0.18), "yellow", 0.004)


def operation_wall():
    box("OperationsCabinet", (3.0, 0.62, 0.85), (0, 0, 0.425), "olive", 0.045)
    box("OperationsTop", (3.08, 0.68, 0.09), (0, 0, 0.90), "ivory", 0.025)
    box("OperationsBoard", (3.0, 0.12, 1.02), (0, 0.28, 1.43), "beige", 0.035)
    box("OperationsHeader", (3.08, 0.17, 0.28), (0, 0.27, 2.02), "olive", 0.025)
    label("OPERACIONES", (0, 0.195, 2.02), 0.13, (math.pi / 2, 0, 0), "ivory", "OperationsLabel")
    glass_box("OperationsScreen", (0.65, 0.025, 0.42), (-0.82, 0.205, 1.48))
    for x in (0.15, 0.68, 1.10): box("OperationsPaper", (0.34, 0.018, 0.48), (x, 0.205, 1.48), "ivory", 0.008)


def cart_bay():
    box("CartBayBase", (2.2, 1.55, 0.10), (0, 0, 0.05), "beige", 0.025)
    for x in (-1.0, 1.0):
        pipe("CartBayPost", (x, -0.70, 0.10), (x, -0.70, 1.95), 0.055, "dark")
        pipe("CartBayPost", (x, 0.70, 0.10), (x, 0.70, 1.95), 0.055, "dark")
    for x in (-0.72, 0, 0.72): box("CartBayRoof", (0.74, 1.55, 0.11), (x, 0, 2.0), "olive", 0.035)
    for index in range(3):
        # Scale and shift the reusable clean cart, without importing another GLB.
        before = list(bpy.context.scene.objects)
        shopping_cart()
        made = [obj for obj in bpy.context.scene.objects if obj not in before]
        scale = 0.84 - index * 0.06
        for obj in made:
            obj.scale *= scale
            obj.location = Vector((obj.location.x * scale, obj.location.y * scale + 0.25 - index * 0.22, obj.location.z * scale + 0.10))


def animal(kind: str):
    token = "white"
    if kind == "chicken":
        sphere("ChickenBody", (0.30, 0.23, 0.34), (0, 0, 0.48), token, 16)
        sphere("ChickenHead", (0.19, 0.18, 0.20), (0, -0.18, 0.76), token, 16)
        cone("ChickenBeak", 0.08, 0.01, 0.18, (0, -0.37, 0.75), "yellow", 12, (math.pi / 2, 0, 0))
        for x in (-0.08, 0.08): pipe("ChickenLeg", (x, 0, 0.22), (x, 0, 0.02), 0.018, "yellow")
        for x in (-0.08, 0, 0.08): sphere("ChickenComb", (0.055, 0.05, 0.075), (x, -0.12, 0.99), "red", 10)
    else:
        sphere("CowBody", (0.80, 0.38, 0.48), (0, 0, 0.85), token, 18)
        sphere("CowHead", (0.33, 0.28, 0.36), (0.62, -0.05, 0.90), token, 16)
        sphere("CowMuzzle", (0.23, 0.20, 0.16), (0.86, -0.07, 0.78), "beige", 14)
        for x in (-0.48, 0.48):
            for y in (-0.22, 0.22): pipe("CowLeg", (x, y, 0.56), (x, y, 0.06), 0.075, token)
        for x, y, z, s in ((-0.30, -0.30, 0.95, 0.24), (0.10, 0.31, 0.90, 0.28), (0.38, -0.25, 1.03, 0.20)):
            sphere("CowSpot", (s, 0.035, s * 0.75), (x, y, z), "black", 12)


def paddock(kind: str):
    size = 3.4 if kind == "chicken" else 3.8
    box("PaddockBase", (size, size, 0.12), (0, 0, 0.06), "beige", 0.025)
    for x in (-size / 2, size / 2):
        for y in (-size / 2, size / 2): pipe("PaddockPost", (x, y, 0.12), (x, y, 1.42), 0.06, "wood" if kind == "chicken" else "dark")
    for z in (0.45, 0.95, 1.38):
        for y in (-size / 2, size / 2): pipe("PaddockRail", (-size / 2, y, z), (size / 2, y, z), 0.045, "wood" if kind == "chicken" else "steel")
        for x in (-size / 2, size / 2): pipe("PaddockRail", (x, -size / 2, z), (x, size / 2, z), 0.045, "wood" if kind == "chicken" else "steel")
    animal(kind)
    if kind == "chicken":
        box("Coop", (1.25, 1.0, 1.10), (0.75, 0.72, 0.66), "wood", 0.055)
        box("CoopRoof", (1.45, 1.18, 0.14), (0.75, 0.72, 1.28), "olive", 0.035)
    else:
        for x in (-0.82, 0.82): pipe("CowCanopy", (x, 0.80, 1.40), (x, 0.80, 2.18), 0.055, "dark")
        box("CowRoof", (2.0, 1.20, 0.14), (0, 0.80, 2.20), "olive", 0.04)


def service_station(kind: str):
    if kind == "supplier":
        box("TerminalPlinth", (0.82, 0.72, 0.12), (0, 0, 0.06), "dark", 0.035)
        box("TerminalColumn", (0.72, 0.62, 1.18), (0, 0, 0.65), "cream", 0.08)
        box("TerminalHead", (0.86, 0.28, 0.82), (0, -0.20, 1.55), "ivory", 0.08, (math.radians(-7), 0, 0))
        glass_box("TerminalDisplay", (0.60, 0.02, 0.48), (0, -0.35, 1.62), (math.radians(-7), 0, 0))
    elif kind == "returns":
        box("ReturnsBody", (1.65, 0.82, 0.92), (0, 0, 0.46), "cream", 0.06)
        box("ReturnsTop", (1.75, 0.90, 0.10), (0, 0, 0.97), "olive", 0.035)
        box("ReturnsSlot", (0.75, 0.025, 0.22), (0, -0.46, 0.62), "dark", 0.012)
    elif kind == "backroom":
        rack(1.55, 1.85, 0.62)
        box("BackroomParcel", (0.62, 0.45, 0.42), (0.35, 0, 0.86), "cardboard", 0.025)
        shopping_basket()
    elif kind == "bakery":
        box("BakeryKiosk", (2.25, 1.25, 0.82), (0, 0, 0.41), "cream", 0.06)
        box("BakeryTop", (2.32, 1.30, 0.10), (0, 0, 0.87), "olive", 0.035)
        box("BreadShelf", (1.80, 0.52, 1.25), (0, 0.38, 1.45), "wood", 0.045)
        for z in (1.08, 1.38, 1.68): box("BreadTray", (1.62, 0.45, 0.06), (0, 0.12, z), "wood2", 0.012)


def milk_can():
    cylinder("MilkCan", 0.24, 0.62, (0, 0, 0.35), "silver", 24, metallic=0.55)
    cylinder("MilkCanShoulder", 0.20, 0.16, (0, 0, 0.70), "silver", 24, metallic=0.55)
    cylinder("MilkCanNeck", 0.14, 0.15, (0, 0, 0.84), "silver", 24, metallic=0.55)
    for side in (-1, 1): torus("MilkCanHandle", 0.13, 0.018, (side * 0.25, 0, 0.58), "steel", (math.pi / 2, 0, 0))


def egg_tray():
    box("EggTray", (0.72, 0.48, 0.08), (0, 0, 0.04), "beige", 0.018)
    for x in (-0.26, -0.09, 0.09, 0.26):
        for y in (-0.15, 0, 0.15): sphere("TrayEgg", (0.065, 0.065, 0.085), (x, y, 0.14), "cream", 14)


def seed_sack():
    sphere("SeedSack", (0.34, 0.28, 0.47), (0, 0, 0.45), "cardboard", 18)
    torus("SackTie", 0.10, 0.018, (0, 0, 0.88), "wood", (0, 0, 0))


def compost_bin():
    wood_crate(1.05, 0.88, 0.86)
    for x in (-0.25, 0, 0.25): sphere("Compost", (0.16, 0.13, 0.08), (x, 0, 0.83), "soil", 12)


def water_tank():
    cylinder("TankBase", 0.86, 0.16, (0, 0, 0.08), "beige", 28)
    cylinder("WaterTank", 0.72, 1.65, (0, 0, 0.95), "silver", 32, metallic=0.5)
    cone("TankRoof", 0.76, 0.12, 0.38, (0, 0, 1.97), "olive", 32)
    for z in (0.38, 0.78, 1.18, 1.58): torus("TankBand", 0.72, 0.018, (0, 0, z), "dark")
    pipe("TankTap", (0, -0.70, 0.38), (0, -0.92, 0.38), 0.045, "dark")


def farm_tool_set():
    wood_crate(1.05, 0.52, 0.34)
    for index, x in enumerate((-0.30, -0.05, 0.22)):
        pipe("ToolHandle", (x, 0, 0.30), (x, 0, 1.24 - index * 0.09), 0.025, "wood2")
        box("ToolHead", (0.20, 0.06, 0.16), (x, -0.02, 0.24), "steel", 0.012)
    watering_can()


def bag():
    box("BagBody", (0.48, 0.18, 0.54), (0, 0, 0.27), "cardboard", 0.035)
    for x in (-0.14, 0.14): torus("BagHandle", 0.12, 0.016, (x, 0, 0.60), "wood", (math.pi / 2, 0, 0))


def harvest_basket_like():
    wood_crate(0.78, 0.52, 0.35)


def make_simple_display(kind: str):
    if kind == "bakery":
        box("BakeryCase", (1.9, 0.78, 1.10), (0, 0, 0.55), "dark", 0.06)
        glass_box("BakeryGlass", (1.70, 0.035, 0.72), (0, -0.40, 0.78), (math.radians(-5), 0, 0))
        for z in (0.38, 0.68, 0.98): box("BakeryTray", (1.60, 0.60, 0.05), (0, 0, z), "steel", 0.01)
    elif kind == "produce":
        box("ProduceBase", (1.9, 1.15, 0.42), (0, 0, 0.21), "dark", 0.045)
        for row, z in enumerate((0.58, 1.02)):
            for x in (-0.58, 0, 0.58):
                box("ProduceBin", (0.54, 0.68, 0.20), (x, 0.05 + row * 0.10, z), "wood", 0.025, (math.radians(-9), 0, 0))
        for x in (-0.84, 0.84): pipe("ProducePost", (x, 0.40, 0.30), (x, 0.40, 1.92), 0.045, "dark")
        box("ProduceCanopy", (1.9, 0.92, 0.12), (0, 0.22, 1.96), "olive", 0.035)
    elif kind == "promo":
        shopping_basket()
        pipe("PromoPost", (0, 0.14, 0.25), (0, 0.14, 1.16), 0.035, "dark")
        box("PromoSign", (0.82, 0.10, 0.38), (0, 0.14, 1.30), "olive", 0.04)
        label("OFERTA", (0, 0.083, 1.30), 0.11, (math.pi / 2, 0, 0), "ivory", "PromoLabel")


def build_named(asset_id: str) -> None:
    # Families whose variants intentionally share one clean construction.
    if asset_id in {"ShoppingBasket", "ShoppingBasketAlt"}: shopping_basket()
    elif asset_id == "ShoppingCart": shopping_cart()
    elif asset_id in {"CashRegister", "CashDrawer", "CashDrawerAlt"}: checkout_device("register")
    elif asset_id == "CardTerminal": checkout_device("terminal")
    elif asset_id == "ReceiptPrinter": checkout_device("printer")
    elif asset_id in {"CheckoutScanner", "CheckoutScannerAlt"}: checkout_device("scanner")
    elif asset_id in {"CheckoutCounter", "CheckoutShelf", "BaggingArea", "BaggingAreaAlt"}: checkout_counter()
    elif asset_id == "Conveyor":
        box("ConveyorFrame", (2.15, 0.78, 0.48), (0, 0, 0.40), "steel", 0.045)
        box("ConveyorBelt", (2.02, 0.64, 0.10), (0, 0, 0.69), "black", 0.025)
        for x in (-0.96, 0.96): cylinder("ConveyorRoller", 0.10, 0.66, (x, 0, 0.69), "silver", 18, (math.pi / 2, 0, 0), 0.45)
    elif asset_id in {"CheckoutBag", "ReusableShoppingBag"}: bag()
    elif asset_id in {"BasketStack", "BasketStackAlt"}:
        for index in range(5):
            before = list(bpy.context.scene.objects); shopping_basket()
            for obj in [item for item in bpy.context.scene.objects if item not in before]: obj.location.z += index * 0.08
    elif asset_id == "BreadOven": oven()
    elif asset_id == "WorkCounter": work_counter()
    elif asset_id == "UtilitySink": work_counter(True)
    elif asset_id in {"ChestFreezer", "RefrigeratedDisplay"}: chest_freezer()
    elif asset_id == "StockroomRack": rack()
    elif asset_id == "Pallet": pallet()
    elif asset_id == "Parcel": box("Parcel", (0.62, 0.55, 0.58), (0, 0, 0.29), "cardboard", 0.035)
    elif asset_id == "WallClock": wall_clock()
    elif asset_id == "SecurityCamera": security_camera()
    elif asset_id == "CeilingLight": ceiling_light()
    elif asset_id == "HangingSign": hanging_sign()
    elif asset_id == "CheckoutLaneSign":
        pipe("LaneSignPost", (0, 0, 0), (0, 0, 1.35), 0.045, "dark")
        box("LaneSignPanel", (0.48, 0.12, 0.48), (0, 0, 1.48), "olive", 0.045)
        label("1", (0, -0.066, 1.48), 0.26, (math.pi / 2, 0, 0), "ivory", "LaneNumber")
    elif asset_id == "Car": car()
    elif asset_id == "CityBuilding": city_building()
    elif asset_id == "Bench": bench()
    elif asset_id == "BusStop": bus_stop()
    elif asset_id == "Tree": tree()
    elif asset_id == "StreetLight": street_light()
    elif asset_id == "SidewalkSegment": flat_tile("sidewalk")
    elif asset_id == "ParkingSpace": flat_tile("parking")
    elif asset_id == "RoadSegment": flat_tile("road")
    elif asset_id == "Crosswalk": flat_tile("crosswalk")
    elif asset_id in {"ShelfGondolaDouble"}: shelf(2.45, 1.80, 0.56, 5, double=True)
    elif asset_id in {"ShelfGondolaSingle"}: shelf(2.25, 1.80, 0.56, 5)
    elif asset_id == "ShelfCorner":
        shelf(1.45, 1.80, 0.52, 5)
        before = list(bpy.context.scene.objects); shelf(1.45, 1.80, 0.52, 5)
        for obj in [item for item in bpy.context.scene.objects if item not in before]: obj.rotation_euler.z = math.pi / 2; obj.location.x += 0.72; obj.location.y += 0.72
    elif asset_id == "ShelfDivider": box("ShelfDivider", (1.25, 0.08, 0.72), (0, 0, 0.36), "beige", 0.018)
    elif asset_id == "ShelfPriceRail": box("ShelfPriceRail", (1.65, 0.08, 0.12), (0, 0, 0.06), "olive", 0.018)
    elif asset_id in {"DisplayBakery"}: make_simple_display("bakery")
    elif asset_id in {"DisplayProduceSloped"}: make_simple_display("produce")
    elif asset_id in {"PromotionalBasket"}: make_simple_display("promo")
    elif asset_id in {"WoodCrate", "Furniture2:WoodCrate"}: wood_crate()
    elif asset_id == "AutomaticDoor":
        for x in (-0.52, 0.52): glass_box("AutomaticDoorLeaf", (0.96, 0.055, 2.18), (x, 0, 1.09))
        for x in (-1.08, 0, 1.08): box("AutomaticDoorFrame", (0.10, 0.10, 2.35), (x, 0, 1.175), "dark", 0.018)
        box("AutomaticDoorHeader", (2.25, 0.12, 0.17), (0, 0, 2.28), "dark", 0.025)
    elif asset_id == "WallCorner":
        box("CornerWallA", (2.4, 0.22, 2.7), (-0.55, 0, 1.35), "cream", 0.02)
        box("CornerWallB", (0.22, 1.2, 2.7), (0.55, 0.49, 1.35), "cream", 0.02)
    elif asset_id in {"FlourMill", "FlourMillAlt"}: machine("mill")
    elif asset_id in {"JuiceMachine", "JuiceMachineAlt"}: machine("juice")
    elif asset_id == "CheeseMachine": machine("cheese")
    elif asset_id in {"UpgradePlatform", "UpgradePlatformAlt", "HiringPoint"}: platform("upgrade")
    elif asset_id in {"DeliveryDock", "DeliveryDockAlt"}: delivery_dock()
    elif asset_id == "OperationsWall": operation_wall()
    elif asset_id == "BackroomStorage": service_station("backroom")
    elif asset_id == "BakeryWorkArea": service_station("bakery")
    elif asset_id == "CartBay": cart_bay()
    elif asset_id == "ReturnsStation": service_station("returns")
    elif asset_id == "SupplierTerminal": service_station("supplier")
    elif asset_id == "CashierStool":
        cylinder("StoolBase", 0.34, 0.08, (0, 0, 0.04), "silver", 28, metallic=0.45)
        cylinder("StoolStem", 0.045, 0.72, (0, 0, 0.40), "silver", 18, metallic=0.45)
        sphere("StoolSeat", (0.38, 0.32, 0.08), (0, 0, 0.82), "ivory", 20)
        torus("StoolFootrest", 0.25, 0.025, (0, 0, 0.34), "silver")
    elif asset_id == "GlassPartition":
        for x in (-1.2, 0, 1.2): pipe("PartitionPost", (x, 0, 0), (x, 0, 2.25), 0.035, "dark")
        glass_box("PartitionGlass", (2.35, 0.035, 2.10), (0, 0, 1.08))
    elif asset_id == "FarmPlotEmpty": farm_plot("empty")
    elif asset_id == "FarmPlotFurrows": farm_plot("furrows")
    elif asset_id == "FarmPlotSeeded": farm_plot("seeded")
    elif asset_id == "FarmPlotWatered": farm_plot("watered")
    elif asset_id in {"IrrigationBed", "IrrigationChannel"}: farm_plot("irrigation")
    elif asset_id == "RaisedBed":
        farm_plot("empty")
        for x in (-0.76, 0.76): box("RaisedBedSide", (0.12, 1.30, 0.46), (x, 0, 0.23), "wood", 0.02)
        for y in (-0.65, 0.65): box("RaisedBedSide", (1.64, 0.12, 0.46), (0, y, 0.23), "wood", 0.02)
    elif asset_id in {"FarmFenceShort", "FarmFenceLong"}: fence(1.4 if asset_id.endswith("Short") else 2.4)
    elif asset_id == "FarmFenceCorner": fence(1.45, corner=True)
    elif asset_id == "FarmGate": fence(1.65, gate=True)
    elif asset_id == "Sprinkler": sprinkler()
    elif asset_id == "WateringCan": watering_can()
    elif asset_id == "SeedSack": seed_sack()
    elif asset_id == "CompostBin": compost_bin()
    elif asset_id == "MiniGreenhouse": greenhouse()
    elif asset_id == "Scarecrow": scarecrow()
    elif asset_id == "FarmWaterTank": water_tank()
    elif asset_id == "FarmToolSet": farm_tool_set()
    elif asset_id == "MilkCan": milk_can()
    elif asset_id == "EggTray": egg_tray()
    elif asset_id in {"CropSeed", "CropSprout", "CropSmall", "CropGrowing"}:
        crop({"CropSeed": "seed", "CropSprout": "sprout", "CropSmall": "small", "CropGrowing": "growing"}[asset_id])
    elif asset_id.endswith("Ripe") and asset_id in {"WheatRipe", "CarrotRipe", "TomatoRipe", "LettuceRipe", "PumpkinRipe", "CornRipe"}:
        crop("ripe", asset_id.removesuffix("Ripe").lower())
    elif asset_id == "WheatGrowing": crop("growing", "wheat")
    elif asset_id == "Chicken": animal("chicken")
    elif asset_id == "Cow": animal("cow")
    elif asset_id == "ChickenPaddock": paddock("chicken")
    elif asset_id == "CowPaddock": paddock("cow")
    else:
        raise KeyError(asset_id)


BUILDERS = {
    # Every affected environment entry. User-approved replacements stay out.
    "AutomaticDoor", "BackroomStorage", "BaggingArea", "BaggingAreaAlt", "BakeryWorkArea",
    "BasketStack", "BasketStackAlt", "Bench", "BreadOven", "BusStop", "Car", "CardTerminal",
    "CarrotRipe", "CartBay", "CashDrawer", "CashDrawerAlt", "CashRegister", "CashierStool",
    "CeilingLight", "CheckoutBag", "CheckoutCounter", "CheckoutLaneSign", "CheckoutScanner", "CheckoutScannerAlt",
    "CheckoutShelf", "CheeseMachine", "ChestFreezer", "Chicken", "ChickenPaddock", "CityBuilding",
    "CompostBin", "Conveyor", "CornRipe", "Cow", "CowPaddock", "CropGrowing", "CropSeed",
    "CropSmall", "CropSprout", "Crosswalk", "DeliveryDock", "DeliveryDockAlt", "DisplayBakery",
    "DisplayProduceSloped", "EggTray", "FarmFenceCorner", "FarmFenceLong", "FarmFenceShort",
    "FarmGate", "FarmPlotEmpty", "FarmPlotFurrows", "FarmPlotSeeded", "FarmPlotWatered",
    "FarmToolSet", "FarmWaterTank", "FlourMill", "FlourMillAlt", "Furniture2:WoodCrate",
    "GlassPartition", "HangingSign", "HiringPoint", "IrrigationBed", "IrrigationChannel",
    "JuiceMachine", "JuiceMachineAlt", "LettuceRipe", "MilkCan", "MiniGreenhouse", "OperationsWall",
    "Pallet", "Parcel", "ParkingSpace", "PromotionalBasket", "PumpkinRipe", "RaisedBed",
    "ReceiptPrinter", "RefrigeratedDisplay", "ReturnsStation", "ReusableShoppingBag", "RoadSegment",
    "Scarecrow", "SecurityCamera", "SeedSack", "ShelfCorner", "ShelfDivider", "ShelfGondolaDouble",
    "ShelfGondolaSingle", "ShelfPriceRail", "ShoppingBasket", "ShoppingBasketAlt", "ShoppingCart",
    "SidewalkSegment", "Sprinkler", "StockroomRack", "StoreEntranceAlt", "StreetLight",
    "SupplierTerminal", "TomatoRipe", "Tree", "UpgradePlatform", "UpgradePlatformAlt", "UtilitySink",
    "WallClock", "WallCorner", "WateringCan", "WheatGrowing", "WheatRipe", "WoodCrate", "WorkCounter",
}

# StoreEntranceAlt can reuse the polished entrance at install time. It is not
# rebuilt here because the approved entrance has functional split leaf names.
BUILDERS.remove("StoreEntranceAlt")


def reset() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for group in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(group):
            if block.users == 0:
                group.remove(block)


def normalize_origin() -> tuple[list[float], int]:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("The asset builder produced no meshes")
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    offset = Vector((-(minimum.x + maximum.x) * 0.5, -(minimum.y + maximum.y) * 0.5, -minimum.z))
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.location += offset
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    triangles = sum(len(obj.data.loop_triangles) or (obj.data.calc_loop_triangles() or len(obj.data.loop_triangles)) for obj in meshes)
    return [round(value, 5) for value in maximum - minimum], triangles


def export(asset_id: str) -> dict:
    reset()
    build_named(asset_id)
    dimensions, triangles = normalize_origin()
    root = bpy.data.objects.new(asset_id.replace(":", "_"), None)
    bpy.context.scene.collection.objects.link(root)
    for obj in list(bpy.context.scene.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root
    root["canonicalId"] = asset_id
    root["source"] = "KIT MARKET PNG; clean metric reconstruction"
    destination = OUTPUT / f"{asset_id.replace(':', '__')}.glb"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(destination), export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_materials="EXPORT", export_animations=False, export_skins=False,
        export_morph=False, export_cameras=False, export_lights=False, export_loglevel=-1,
    )
    return {"id": asset_id, "file": destination.name, "dimensionsMeters": dimensions, "triangles": triangles}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    wanted = sorted(BUILDERS if not ONLY else BUILDERS & ONLY)
    missing = ONLY - BUILDERS
    if missing:
        raise KeyError(f"Assets are approved or unsupported: {', '.join(sorted(missing))}")
    records = []
    for index, asset_id in enumerate(wanted, 1):
        record = export(asset_id)
        records.append(record)
        print(f"POLISHED {index}/{len(wanted)} {asset_id} {record['dimensionsMeters']} tris={record['triangles']}")
    payload = {
        "schemaVersion": 1,
        "units": "metres",
        "pivot": "centre of footprint at floor",
        "source": "KIT MARKET catalogue PNGs",
        "assets": records,
    }
    (OUTPUT / "polished-environment-manifest.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(f"COMPLETE {len(records)} clean assets -> {OUTPUT}")


if __name__ == "__main__":
    main()

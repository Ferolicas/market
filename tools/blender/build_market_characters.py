"""Build Mini Market characters from clean Blender primitives and authored poses.

This generator never imports or reads a legacy GLB. The PNG sheets are the visual
specification; proportions and palette below are documented interpretations of
the views that exist in those sheets.

Run with Blender 5.2 LTS:
  blender --background --factory-startup --python tools/blender/build_market_characters.py
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

import bpy
import bmesh
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = PROJECT_ROOT / "public" / "models" / "market"
SOURCE_ROOT = PROJECT_ROOT / "art" / "characters"
FPS = 30

MORPH_TARGETS = [
    "Blink_L", "Blink_R", "EyeWide_L", "EyeWide_R",
    "BrowUp_L", "BrowUp_R", "BrowDown_L", "BrowDown_R",
    "Smile", "Smile_L", "Smile_R", "Frown", "JawOpen", "MouthOpen",
    "MouthNarrow", "MouthWide", "CheekUp", "Surprise", "Confused",
]

REQUIRED_CLIPS = [
    "Idle", "Walk", "Run", "TurnLeft", "TurnRight", "CarryIdle", "CarryWalk",
    "HarvestLow", "HarvestHigh", "PickupLow", "PickupHigh", "StockLow",
    "StockMid", "StockHigh", "CheckoutScan", "CheckoutBag", "Pay",
    "ReceiveBag", "Happy", "Confused", "Impatient", "Talk", "LookAround",
    "Phone", "Enter", "Exit",
]

COMPATIBILITY_CLIPS = [
    "Wave", "ReceiveOrder", "LiftBox", "CarryBox", "ScanItem", "Plant", "Harvest",
    "Wait", "Browse", "ReachShelf", "CarryBasket", "Queue", "CheckoutItem",
]


@dataclass(frozen=True)
class Palette:
    skin: str
    shirt: str
    secondary: str
    trousers: str
    shoes: str
    hair: str
    eyes: str = "#3a281f"
    apron: str = "#183f35"


@dataclass(frozen=True)
class CharacterProfile:
    id: str
    output: str
    height: float
    shoulder_width: float
    hip_width: float
    head_radius: tuple[float, float, float]
    head_center_z: float
    hips_z: float
    knee_z: float
    ankle_z: float
    chest_z: float
    neck_z: float
    arm_length: float
    hand_scale: float
    foot_length: float
    palette: Palette
    body_kind: str = "adult"
    clothing: str = "owner"
    hair_style: str | None = None
    beard: bool = False
    face_width: float = 1.0
    nose_scale: float = 1.0
    age_lines: float = 0.0
    reference: str = ""


CHARACTERS = [
    CharacterProfile(
        id="owner_man", output="characters/owner_man.glb", height=1.78,
        shoulder_width=0.54, hip_width=0.36, head_radius=(0.225, 0.215, 0.275),
        head_center_z=1.535, hips_z=0.88, knee_z=0.49, ankle_z=0.12,
        chest_z=1.18, neck_z=1.34, arm_length=0.61, hand_scale=0.105,
        foot_length=0.28, palette=Palette("#c98258", "#76aee0", "#5b91c4", "#272a2c", "#242526", "#292927"),
        beard=True, hair_style=None, reference="PERSONAJES.png / VENDEDOR HOMBRE.png",
    ),
    CharacterProfile(
        id="owner_woman", output="characters/owner_woman.glb", height=1.69,
        shoulder_width=0.47, hip_width=0.39, head_radius=(0.215, 0.205, 0.265),
        head_center_z=1.47, hips_z=0.84, knee_z=0.46, ankle_z=0.11,
        chest_z=1.12, neck_z=1.28, arm_length=0.57, hand_scale=0.096,
        foot_length=0.255, palette=Palette("#d79a72", "#79b0df", "#5d94c4", "#272a2d", "#242526", "#4a2f24"),
        face_width=0.96, hair_style=None, reference="PERSONAJES.png",
    ),
    CharacterProfile(
        id="owner_boy", output="characters/owner_boy.glb", height=1.28,
        shoulder_width=0.36, hip_width=0.29, head_radius=(0.205, 0.195, 0.245),
        head_center_z=1.085, hips_z=0.58, knee_z=0.34, ankle_z=0.085,
        chest_z=0.79, neck_z=0.91, arm_length=0.42, hand_scale=0.077,
        foot_length=0.20, palette=Palette("#d99b6f", "#76aee0", "#5b91c4", "#292c2e", "#242526", "#60391f"),
        body_kind="child", face_width=1.04, hair_style=None, reference="PERSONAJES.png",
    ),
    CharacterProfile(
        id="owner_girl", output="characters/owner_girl.glb", height=1.22,
        shoulder_width=0.34, hip_width=0.29, head_radius=(0.20, 0.19, 0.24),
        head_center_z=1.035, hips_z=0.55, knee_z=0.32, ankle_z=0.08,
        chest_z=0.75, neck_z=0.87, arm_length=0.40, hand_scale=0.074,
        foot_length=0.19, palette=Palette("#df9b6c", "#78afdf", "#5d94c4", "#292c2e", "#242526", "#5d2f20"),
        body_kind="child", face_width=1.03, hair_style=None, reference="PERSONAJES.png",
    ),
    CharacterProfile(
        id="customer_01_man_young", output="customers/customer_01_man_young.glb", height=1.78,
        shoulder_width=0.52, hip_width=0.36, head_radius=(0.215, 0.205, 0.265),
        head_center_z=1.535, hips_z=0.88, knee_z=0.49, ankle_z=0.12,
        chest_z=1.18, neck_z=1.34, arm_length=0.61, hand_scale=0.10,
        foot_length=0.28, palette=Palette("#bb7851", "#536d43", "#efe3ca", "#243344", "#513b2f", "#3a251b"),
        clothing="jacket", hair_style="short_side_part", beard=True, reference="cliente1.png",
    ),
    CharacterProfile(
        id="customer_02_man_senior", output="customers/customer_02_man_senior.glb", height=1.68,
        shoulder_width=0.49, hip_width=0.36, head_radius=(0.215, 0.205, 0.27),
        head_center_z=1.455, hips_z=0.82, knee_z=0.45, ankle_z=0.11,
        chest_z=1.08, neck_z=1.25, arm_length=0.56, hand_scale=0.097,
        foot_length=0.255, palette=Palette("#d1a078", "#1c3352", "#91afd0", "#a88b61", "#3a3029", "#a6a6a1"),
        clothing="sweater", hair_style="senior_side", face_width=0.98, age_lines=1.0, reference="cliente2.png",
    ),
    CharacterProfile(
        id="customer_03_woman_young", output="customers/customer_03_woman_young.glb", height=1.70,
        shoulder_width=0.45, hip_width=0.39, head_radius=(0.21, 0.20, 0.265),
        head_center_z=1.475, hips_z=0.84, knee_z=0.46, ankle_z=0.11,
        chest_z=1.12, neck_z=1.29, arm_length=0.57, hand_scale=0.094,
        foot_length=0.25, palette=Palette("#bd7b57", "#f0e7d8", "#e6dbca", "#273848", "#6b4635", "#24211f"),
        clothing="blouse", hair_style="long_wavy", face_width=0.95, reference="cliente3.png",
    ),
    CharacterProfile(
        id="customer_04_woman_adult", output="customers/customer_04_woman_adult.glb", height=1.68,
        shoulder_width=0.46, hip_width=0.40, head_radius=(0.21, 0.20, 0.265),
        head_center_z=1.455, hips_z=0.82, knee_z=0.45, ankle_z=0.11,
        chest_z=1.10, neck_z=1.27, arm_length=0.56, hand_scale=0.095,
        foot_length=0.245, palette=Palette("#d5966d", "#7c2637", "#691f30", "#282b2d", "#29272a", "#7d321c"),
        clothing="top", hair_style="high_ponytail", face_width=0.97, reference="cliente4.png",
    ),
    CharacterProfile(
        id="customer_05_woman_mature", output="customers/customer_05_woman_mature.glb", height=1.65,
        shoulder_width=0.47, hip_width=0.40, head_radius=(0.21, 0.20, 0.265),
        head_center_z=1.43, hips_z=0.80, knee_z=0.44, ankle_z=0.105,
        chest_z=1.07, neck_z=1.24, arm_length=0.55, hand_scale=0.094,
        foot_length=0.24, palette=Palette("#c98f6c", "#18716b", "#eee4d0", "#263949", "#313439", "#383836"),
        clothing="blazer", hair_style="mature_bob", face_width=0.98, age_lines=0.45, reference="cliente5.png",
    ),
    CharacterProfile(
        id="customer_06_woman_senior", output="customers/customer_06_woman_senior.glb", height=1.58,
        shoulder_width=0.45, hip_width=0.39, head_radius=(0.21, 0.20, 0.27),
        head_center_z=1.365, hips_z=0.76, knee_z=0.41, ankle_z=0.10,
        chest_z=1.01, neck_z=1.18, arm_length=0.53, hand_scale=0.092,
        foot_length=0.23, palette=Palette("#d7ac8b", "#a98bc0", "#eee4d2", "#4b4d53", "#343238", "#d2d1ca"),
        clothing="cardigan", hair_style="senior_bun", face_width=1.0, age_lines=0.8, reference="cliente6.png",
    ),
]


def hex_rgba(value: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = value.lstrip("#")
    srgb = [int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in srgb]
    return tuple(linear) + (alpha,)


def clean_scene() -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
        for block in list(datablocks):
            datablocks.remove(block)


def material(name: str, color: str, roughness: float = 0.66, metallic: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = hex_rgba(color)
    mat.use_backface_culling = True
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = hex_rgba(color)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.28
    return mat


def apply_transform(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def smooth(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def ellipsoid(name: str, location: tuple[float, float, float], scale: tuple[float, float, float], mat: bpy.types.Material, segments: int = 28, rings: int = 18) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    apply_transform(obj)
    smooth(obj)
    return obj


def rounded_box(name: str, location: tuple[float, float, float], scale: tuple[float, float, float], mat: bpy.types.Material, bevel: float = 0.04, rotation: tuple[float, float, float] = (0, 0, 0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0] / 2, scale[1] / 2, scale[2] / 2)
    obj.data.materials.append(mat)
    apply_transform(obj)
    modifier = obj.modifiers.new("Rounded", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    smooth(obj)
    return obj


def cone(name: str, location: tuple[float, float, float], radius: float, depth: float, mat: bpy.types.Material, rotation: tuple[float, float, float] = (0, 0, 0), vertices: int = 16) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius * 0.22, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    apply_transform(obj)
    smooth(obj)
    return obj


def torus(name: str, location: tuple[float, float, float], major: float, minor: float, mat: bpy.types.Material, rotation: tuple[float, float, float] = (0, 0, 0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=28, minor_segments=10, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    apply_transform(obj)
    smooth(obj)
    return obj


def curve_mesh(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    mat: bpy.types.Material,
    resolution: int = 2,
    point_radii: list[float] | None = None,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 3
    curve_data.use_fill_caps = True
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for index, (point, coordinate) in enumerate(zip(spline.bezier_points, points)):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
        if point_radii:
            point.radius = point_radii[min(index, len(point_radii) - 1)]
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    apply_transform(obj)
    smooth(obj)
    return obj


def assign_weight(obj: bpy.types.Object, bone_name: str, weight: float = 1.0) -> None:
    group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
    group.add([vertex.index for vertex in obj.data.vertices], weight, "REPLACE")


def add_armature_modifier(obj: bpy.types.Object, armature: bpy.types.Object) -> None:
    modifier = obj.modifiers.new("MarketArmature", "ARMATURE")
    modifier.object = armature
    obj.parent = armature
    obj.matrix_parent_inverse = armature.matrix_world.inverted()


def join_meshes(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    if not objects:
        raise ValueError(f"No meshes supplied for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    smooth(joined)
    return joined


def create_armature(profile: CharacterProfile) -> bpy.types.Object:
    data = bpy.data.armatures.new("MarketCharacterRig")
    armature = bpy.data.objects.new("MarketCharacterRig", data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bones: dict[str, bpy.types.EditBone] = {}

    def bone(name: str, head: tuple[float, float, float], tail: tuple[float, float, float], parent: str | None = None, connected: bool = False) -> None:
        item = data.edit_bones.new(name)
        item.head = head
        item.tail = tail
        if parent:
            item.parent = bones[parent]
            item.use_connect = connected
        bones[name] = item

    hip = profile.hips_z
    chest = profile.chest_z
    neck = profile.neck_z
    head_top = profile.head_center_z + profile.head_radius[2]
    shoulder_z = chest + (neck - chest) * 0.12
    shoulder_x = profile.shoulder_width * 0.49
    elbow_z = shoulder_z - profile.arm_length * 0.48
    wrist_z = shoulder_z - profile.arm_length
    elbow_x = shoulder_x + profile.arm_length * 0.035
    wrist_x = shoulder_x + profile.arm_length * 0.02
    leg_x = profile.hip_width * 0.30

    bone("Root", (0, 0, 0), (0, 0, 0.12))
    bone("Hips", (0, 0, hip - 0.06), (0, 0, hip + 0.09), "Root")
    bone("Spine", (0, 0, hip + 0.09), (0, 0, (hip + chest) * 0.5), "Hips", True)
    bone("Chest", (0, 0, (hip + chest) * 0.5), (0, 0, chest), "Spine", True)
    bone("Neck", (0, 0, chest), (0, 0, neck), "Chest", True)
    bone("Head", (0, 0, neck), (0, 0, head_top), "Neck", True)
    for side, sign in (("L", -1), ("R", 1)):
        bone(f"Rig_Arm_{side}", (sign * shoulder_x, 0, shoulder_z), (sign * elbow_x, 0, elbow_z), "Chest")
        bone(f"Forearm_{side}", (sign * elbow_x, 0, elbow_z), (sign * wrist_x, 0, wrist_z), f"Rig_Arm_{side}", True)
        bone(f"Hand_{side}", (sign * wrist_x, 0, wrist_z), (sign * wrist_x, -0.02, wrist_z - profile.hand_scale * 1.5), f"Forearm_{side}", True)
        bone(f"Rig_Leg_{side}", (sign * leg_x, 0, hip), (sign * leg_x, 0, profile.knee_z), "Hips")
        bone(f"Shin_{side}", (sign * leg_x, 0, profile.knee_z), (sign * leg_x, 0, profile.ankle_z), f"Rig_Leg_{side}", True)
        bone(f"Foot_{side}", (sign * leg_x, 0, profile.ankle_z), (sign * leg_x, -profile.foot_length, profile.ankle_z - 0.015), f"Shin_{side}", True)
        bone(f"Toe_{side}", (sign * leg_x, -profile.foot_length, profile.ankle_z - 0.015), (sign * leg_x, -profile.foot_length * 1.16, profile.ankle_z - 0.015), f"Foot_{side}", True)

    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)
    return armature


def create_materials(profile: CharacterProfile) -> dict[str, bpy.types.Material]:
    palette = profile.palette
    return {
        "skin": material("Skin", palette.skin, 0.64),
        "skin_blush": material("SkinBlush", blend_hex(palette.skin, "#cf6e61", 0.18), 0.67),
        "shirt": material("Shirt", palette.shirt, 0.78),
        "secondary": material("SecondaryCloth", palette.secondary, 0.8),
        "trousers": material("Trousers", palette.trousers, 0.82),
        "shoes": material("Shoes", palette.shoes, 0.48),
        "apron": material("Apron", palette.apron, 0.8),
        "hair": material("Hair", palette.hair, 0.72),
        "eye_white": material("EyeWhite", "#f7f2e7", 0.34),
        "iris": material("Iris", palette.eyes, 0.32),
        "pupil": material("Pupil", "#151515", 0.22),
        "brow": material("Brows", palette.hair, 0.76),
        "mouth": material("MouthInterior", "#5f222a", 0.72),
        "lip": material("Lips", blend_hex(palette.skin, "#a53c48", 0.36), 0.62),
        "teeth": material("Teeth", "#fff9e9", 0.42),
        "metal": material("Metal", "#889591", 0.3, 0.42),
    }


def blend_hex(a: str, b: str, amount: float) -> str:
    av = [int(a.lstrip("#")[index:index + 2], 16) for index in (0, 2, 4)]
    bv = [int(b.lstrip("#")[index:index + 2], 16) for index in (0, 2, 4)]
    values = [round(x + (y - x) * amount) for x, y in zip(av, bv)]
    return "#" + "".join(f"{value:02x}" for value in values)


def build_head(profile: CharacterProfile, mats: dict[str, bpy.types.Material], armature: bpy.types.Object) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    cx, cy, cz = 0.0, 0.0, profile.head_center_z
    rx, ry, rz = profile.head_radius
    head = ellipsoid("HeadFace", (cx, cy, cz), (rx * profile.face_width, ry, rz), mats["skin"], 40, 28)
    for vertex in head.data.vertices:
        x, y, z = vertex.co
        normalized_z = max(-1.0, min(1.0, (z - cz) / max(0.001, rz)))
        lower = max(0.0, min(1.0, (-normalized_z - 0.08) / 0.92))
        crown = max(0.0, min(1.0, (normalized_z - 0.58) / 0.42))
        vertex.co.x *= 1.0 - lower * 0.15 - crown * 0.05
        if y < 0:
            vertex.co.y *= 0.93
            vertex.co.y -= ry * 0.025 * lower
    head.data.update()
    assign_weight(head, "Head")
    create_face_shape_keys(head, profile)
    add_armature_modifier(head, armature)

    features: list[bpy.types.Object] = []
    ear_x = rx * profile.face_width * 0.96
    for side, sign in (("L", -1), ("R", 1)):
        ear = ellipsoid(f"Ear_{side}", (sign * ear_x, 0.005, cz + 0.005), (rx * 0.18, ry * 0.15, rz * 0.25), mats["skin"], 20, 14)
        assign_weight(ear, "Head")
        features.append(ear)

    eye_z = cz + rz * 0.12
    eye_y = -ry * 0.88
    eye_x = rx * profile.face_width * 0.39
    for side, sign in (("L", -1), ("R", 1)):
        white = ellipsoid(f"EyeWhite_{side}", (sign * eye_x, eye_y, eye_z), (rx * 0.22, ry * 0.090, rz * 0.145), mats["eye_white"], 24, 16)
        iris = ellipsoid(f"Iris_{side}", (sign * eye_x, eye_y - ry * 0.080, eye_z), (rx * 0.100, ry * 0.026, rz * 0.075), mats["iris"], 20, 14)
        pupil = ellipsoid(f"Pupil_{side}", (sign * eye_x, eye_y - ry * 0.105, eye_z), (rx * 0.050, ry * 0.014, rz * 0.045), mats["pupil"], 18, 12)
        brow = curve_mesh(
            f"Brow_{side}",
            [(sign * (eye_x - rx * 0.12), eye_y - ry * 0.025, eye_z + rz * 0.18),
             (sign * eye_x, eye_y - ry * 0.04, eye_z + rz * 0.21),
             (sign * (eye_x + rx * 0.12), eye_y - ry * 0.02, eye_z + rz * 0.17)],
            rx * 0.035, mats["brow"], 1,
        )
        for item in (white, iris, pupil, brow):
            assign_weight(item, "Head")
            features.append(item)

    nose = ellipsoid("Nose", (0, -ry * 1.015, cz - rz * 0.035), (rx * 0.15 * profile.nose_scale, ry * 0.15 * profile.nose_scale, rz * 0.175), mats["skin_blush"], 22, 14)
    assign_weight(nose, "Head")
    features.append(nose)

    mouth_z = cz - rz * 0.34
    mouth = ellipsoid("Mouth", (0, -ry * 0.985, mouth_z), (rx * 0.22, ry * 0.035, rz * 0.045), mats["mouth"], 24, 12)
    upper_lip = curve_mesh("UpperLip", [(-rx * 0.18, -ry * 1.015, mouth_z + rz * 0.018), (0, -ry * 1.028, mouth_z), (rx * 0.18, -ry * 1.015, mouth_z + rz * 0.018)], rx * 0.018, mats["lip"], 1)
    lower_lip = curve_mesh("LowerLip", [(-rx * 0.15, -ry * 1.02, mouth_z - rz * 0.006), (0, -ry * 1.03, mouth_z - rz * 0.035), (rx * 0.15, -ry * 1.02, mouth_z - rz * 0.006)], rx * 0.016, mats["lip"], 1)
    for item in (mouth, upper_lip, lower_lip):
        assign_weight(item, "Head")
        features.append(item)

    if profile.beard:
        beard = create_beard(profile, mats["hair"])
        for item in beard:
            assign_weight(item, "Head")
            features.append(item)
    if profile.age_lines:
        line_mat = material("AgeLines", blend_hex(profile.palette.skin, "#60483f", 0.45), 0.88)
        for side, sign in (("L", -1), ("R", 1)):
            line = curve_mesh(
                f"AgeLine_{side}",
                [(sign * eye_x * 1.35, eye_y - ry * 0.04, eye_z - rz * 0.02),
                 (sign * eye_x * 1.55, eye_y - ry * 0.03, eye_z - rz * 0.045)],
                rx * 0.007 * profile.age_lines, line_mat, 1,
            )
            assign_weight(line, "Head")
            features.append(line)

    if features:
        joined_features = join_meshes(features, "FaceFeatures")
        bpy.ops.object.select_all(action="DESELECT")
        joined_features.select_set(True)
        bpy.context.view_layer.objects.active = joined_features
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        create_feature_shape_keys(joined_features, profile)
        add_armature_modifier(joined_features, armature)
        features = [joined_features]
    return head, features


def create_face_shape_keys(head: bpy.types.Object, profile: CharacterProfile) -> None:
    head.shape_key_add(name="Basis", from_mix=False)
    rx, ry, rz = profile.head_radius
    eye_z = profile.head_center_z + rz * 0.12
    eye_x = rx * profile.face_width * 0.39
    mouth_z = profile.head_center_z - rz * 0.34

    for target in MORPH_TARGETS:
        key = head.shape_key_add(name=target, from_mix=False)
        key.value = 0.0
        for basis_vertex, vertex in zip(head.data.vertices, key.data):
            x, y, z = basis_vertex.co
            front = max(0.0, min(1.0, (-y / max(0.001, ry) - 0.25) / 0.75))
            left_mask = math.exp(-((x + eye_x) / (rx * 0.33)) ** 2)
            right_mask = math.exp(-((x - eye_x) / (rx * 0.33)) ** 2)
            eye_mask = math.exp(-((z - eye_z) / (rz * 0.24)) ** 2) * front
            mouth_mask = math.exp(-((z - mouth_z) / (rz * 0.30)) ** 2) * front
            cheek_mask = math.exp(-((z - (mouth_z + rz * 0.24)) / (rz * 0.30)) ** 2) * front
            side_mask = left_mask if target.endswith("_L") else right_mask if target.endswith("_R") else max(left_mask, right_mask)

            if target.startswith("Blink"):
                vertex.co.z += (eye_z - z) * eye_mask * side_mask * 0.48
                vertex.co.y += ry * 0.025 * eye_mask * side_mask
            elif target.startswith("EyeWide"):
                vertex.co.z += math.copysign(rz * 0.035, z - eye_z) * eye_mask * side_mask
            elif target.startswith("BrowUp"):
                vertex.co.z += rz * 0.045 * eye_mask * side_mask
            elif target.startswith("BrowDown"):
                vertex.co.z -= rz * 0.035 * eye_mask * side_mask
            elif target in {"Smile", "Smile_L", "Smile_R"}:
                smile_side = side_mask if target != "Smile" else max(left_mask, right_mask)
                vertex.co.z += rz * 0.055 * mouth_mask * smile_side * min(1.0, abs(x) / max(0.001, rx * 0.2))
                vertex.co.x *= 1 + 0.035 * mouth_mask
            elif target == "Frown":
                vertex.co.z -= rz * 0.045 * mouth_mask * min(1.0, abs(x) / max(0.001, rx * 0.2))
            elif target in {"JawOpen", "MouthOpen", "Surprise"}:
                amount = 0.085 if target == "JawOpen" else 0.06
                vertex.co.z -= rz * amount * mouth_mask
                vertex.co.y -= ry * 0.025 * mouth_mask
            elif target == "MouthNarrow":
                vertex.co.x *= 1 - 0.08 * mouth_mask
            elif target == "MouthWide":
                vertex.co.x *= 1 + 0.09 * mouth_mask
            elif target == "CheekUp":
                vertex.co.z += rz * 0.035 * cheek_mask * max(left_mask, right_mask)
                vertex.co.y -= ry * 0.018 * cheek_mask
            elif target == "Confused":
                vertex.co.z += rz * 0.035 * eye_mask * left_mask
                vertex.co.z -= rz * 0.018 * eye_mask * right_mask


def create_feature_shape_keys(features: bpy.types.Object, profile: CharacterProfile) -> None:
    """Give the visible eyes, brows and mouth the same expressive morph set.

    The continuous head surface already owns facial morphs. These corrective
    keys keep the attached closed feature meshes synchronized so expressions
    remain readable from the isometric camera and in the QA turnarounds.
    """
    features.shape_key_add(name="Basis", from_mix=False)
    rx, ry, rz = profile.head_radius
    eye_z = profile.head_center_z + rz * 0.12
    mouth_z = profile.head_center_z - rz * 0.34

    material_vertices: dict[str, set[int]] = {}
    for polygon in features.data.polygons:
        material = features.data.materials[polygon.material_index]
        material_name = material.name.split(".")[0] if material else ""
        material_vertices.setdefault(material_name, set()).update(polygon.vertices)

    eye_indices = set().union(*(indices for name, indices in material_vertices.items() if name in {"EyeWhite", "Iris", "Pupil"}))
    brow_indices = set().union(*(indices for name, indices in material_vertices.items() if name == "Brows"))
    mouth_indices = set().union(*(indices for name, indices in material_vertices.items() if name in {"MouthInterior", "Lips", "Teeth"}))

    def side_matches(x: float, target: str) -> bool:
        if target.endswith("_L"):
            return x < 0
        if target.endswith("_R"):
            return x > 0
        return True

    for target in MORPH_TARGETS:
        key = features.shape_key_add(name=target, from_mix=False)
        key.value = 0.0
        for index, basis_vertex in enumerate(features.data.vertices):
            vertex = key.data[index]
            x, _y, z = basis_vertex.co
            if index in eye_indices and side_matches(x, target):
                if target.startswith("Blink"):
                    vertex.co.z = eye_z + (z - eye_z) * 0.08
                elif target.startswith("EyeWide"):
                    vertex.co.z = eye_z + (z - eye_z) * 1.28
                elif target in {"Surprise"}:
                    vertex.co.z = eye_z + (z - eye_z) * 1.18
            if index in brow_indices and side_matches(x, target):
                if target.startswith("BrowUp"):
                    vertex.co.z += rz * 0.13
                elif target.startswith("BrowDown"):
                    vertex.co.z -= rz * 0.10
                elif target == "Surprise":
                    vertex.co.z += rz * 0.11
                elif target == "Confused":
                    vertex.co.z += rz * (0.12 if x < 0 else -0.06)
                    vertex.co.x += (rx * 0.018 if x < 0 else -rx * 0.012)
            if index in mouth_indices and side_matches(x, target):
                if target in {"Smile", "Smile_L", "Smile_R"}:
                    corner = min(1.0, abs(x) / max(0.001, rx * 0.22))
                    vertex.co.z += rz * 0.16 * corner
                    vertex.co.x *= 1.08
                elif target == "Frown":
                    corner = min(1.0, abs(x) / max(0.001, rx * 0.22))
                    vertex.co.z -= rz * 0.13 * corner
                elif target in {"JawOpen", "MouthOpen", "Surprise"}:
                    vertical_scale = 2.15 if target == "MouthOpen" else 1.72
                    vertex.co.z = mouth_z + (z - mouth_z) * vertical_scale - rz * (0.10 if z <= mouth_z else 0.015)
                elif target == "MouthNarrow":
                    vertex.co.x *= 0.70
                elif target == "MouthWide":
                    vertex.co.x *= 1.34
                elif target == "Confused":
                    vertex.co.z += rz * (0.07 if x < 0 else -0.035)


def create_beard(profile: CharacterProfile, hair_mat: bpy.types.Material) -> list[bpy.types.Object]:
    rx, ry, rz = profile.head_radius
    cz = profile.head_center_z
    items = [
        ellipsoid("BeardChin", (0, -ry * 0.955, cz - rz * 0.49), (rx * 0.43, ry * 0.075, rz * 0.18), hair_mat, 28, 16),
        curve_mesh("BeardJawL", [(-rx * 0.72, -ry * 0.78, cz - rz * 0.18), (-rx * 0.58, -ry * 0.91, cz - rz * 0.42), (-rx * 0.22, -ry * 0.98, cz - rz * 0.56)], rx * 0.075, hair_mat),
        curve_mesh("BeardJawR", [(rx * 0.72, -ry * 0.78, cz - rz * 0.18), (rx * 0.58, -ry * 0.91, cz - rz * 0.42), (rx * 0.22, -ry * 0.98, cz - rz * 0.56)], rx * 0.075, hair_mat),
        curve_mesh("MoustacheL", [(-rx * 0.26, -ry * 1.025, cz - rz * 0.22), (-rx * 0.06, -ry * 1.050, cz - rz * 0.19)], rx * 0.038, hair_mat),
        curve_mesh("MoustacheR", [(rx * 0.06, -ry * 1.050, cz - rz * 0.19), (rx * 0.26, -ry * 1.025, cz - rz * 0.22)], rx * 0.038, hair_mat),
    ]
    return items


def loft_mesh(
    name: str,
    rings: list[tuple[float, float, float, float, float, dict[str, float]]],
    mat: bpy.types.Material,
    segments: int = 28,
) -> bpy.types.Object:
    """Create a closed, deformation-friendly surface from horizontal oval rings."""
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for center_x, center_y, z, radius_x, radius_y, _weights in rings:
        for index in range(segments):
            angle = math.tau * index / segments
            vertices.append((center_x + math.cos(angle) * radius_x, center_y + math.sin(angle) * radius_y, z))
    bottom_center = len(vertices)
    vertices.append((rings[0][0], rings[0][1], rings[0][2]))
    top_center = len(vertices)
    vertices.append((rings[-1][0], rings[-1][1], rings[-1][2]))
    for ring_index in range(len(rings) - 1):
        first = ring_index * segments
        following = (ring_index + 1) * segments
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append((first + index, first + next_index, following + next_index, following + index))
    for index in range(segments):
        next_index = (index + 1) % segments
        faces.append((bottom_center, next_index, index))
        top_start = (len(rings) - 1) * segments
        faces.append((top_center, top_start + index, top_start + next_index))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    smooth(obj)

    for ring_index, ring in enumerate(rings):
        indices = list(range(ring_index * segments, (ring_index + 1) * segments))
        for bone_name, weight in ring[5].items():
            group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
            group.add(indices, weight, "REPLACE")
    for cap_index, ring in ((bottom_center, rings[0]), (top_center, rings[-1])):
        for bone_name, weight in ring[5].items():
            group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
            group.add([cap_index], weight, "REPLACE")
    return obj


def add_relaxed_hand(
    profile: CharacterProfile,
    mats: dict[str, bpy.types.Material],
    side: str,
    sign: int,
    center_x: float,
    wrist_z: float,
) -> list[bpy.types.Object]:
    bone_name = f"Hand_{side}"
    scale = profile.hand_scale
    parts: list[bpy.types.Object] = []
    palm = ellipsoid(
        f"Palm_{side}",
        (center_x, -0.006, wrist_z - scale * 0.55),
        (scale * 0.64, scale * 0.42, scale * 0.72),
        mats["skin"], 26, 18,
    )
    assign_weight(palm, bone_name)
    parts.append(palm)
    finger_offsets = (-0.42, -0.14, 0.14, 0.42)
    finger_lengths = (0.52, 0.62, 0.60, 0.48)
    for index, (offset, length) in enumerate(zip(finger_offsets, finger_lengths)):
        x = center_x + offset * scale * 1.18
        start_z = wrist_z - scale * 0.88
        finger = curve_mesh(
            f"Finger_{side}_{index}",
            [(x, -0.018, start_z), (x, -0.035, start_z - scale * length * 0.55),
             (x - sign * scale * 0.025, -0.015, start_z - scale * length)],
            scale * 0.105,
            mats["skin"],
            1,
        )
        assign_weight(finger, bone_name)
        parts.append(finger)
    thumb = curve_mesh(
        f"Thumb_{side}",
        [(center_x - sign * scale * 0.50, -0.005, wrist_z - scale * 0.42),
         (center_x - sign * scale * 0.80, -scale * 0.12, wrist_z - scale * 0.58),
         (center_x - sign * scale * 0.72, -scale * 0.23, wrist_z - scale * 0.79)],
        scale * 0.14,
        mats["skin"],
        1,
    )
    assign_weight(thumb, bone_name)
    parts.append(thumb)
    return parts


def build_body(profile: CharacterProfile, mats: dict[str, bpy.types.Material], armature: bpy.types.Object) -> list[bpy.types.Object]:
    hip = profile.hips_z
    chest = profile.chest_z
    shoulder_z = chest + (profile.neck_z - chest) * 0.12
    shoulder_x = profile.shoulder_width * 0.49
    leg_x = profile.hip_width * 0.30
    elbow_z = shoulder_z - profile.arm_length * 0.48
    wrist_z = shoulder_z - profile.arm_length

    skin_parts: list[bpy.types.Object] = []
    cloth_parts: list[bpy.types.Object] = []

    adult = profile.body_kind == "adult"
    neck = ellipsoid("Neck", (0, 0.018, profile.neck_z - 0.045), (0.095 if adult else 0.076, 0.082 if adult else 0.068, 0.115 if adult else 0.09), mats["skin"], 24, 16)
    assign_weight(neck, "Neck")
    skin_parts.append(neck)

    depth = 0.17 if adult else 0.125
    torso = loft_mesh("TorsoCloth", [
        (0, 0.015, hip - 0.08, profile.hip_width * 0.53, depth * 0.88, {"Hips": 0.78, "Spine": 0.22}),
        (0, 0.005, hip + 0.03, profile.hip_width * 0.56, depth * 0.92, {"Hips": 0.45, "Spine": 0.55}),
        (0, 0.000, (hip + chest) * 0.52, profile.shoulder_width * 0.42, depth, {"Spine": 0.55, "Chest": 0.45}),
        (0, 0.006, chest - 0.06, profile.shoulder_width * 0.50, depth * 1.03, {"Chest": 1.0}),
        (0, 0.012, shoulder_z + 0.035, profile.shoulder_width * 0.535, depth * 0.91, {"Chest": 0.94, "Neck": 0.06}),
        (0, 0.018, profile.neck_z - 0.055, profile.shoulder_width * 0.20, depth * 0.64, {"Chest": 0.55, "Neck": 0.45}),
    ], mats["shirt"], 32)
    cloth_parts.append(torso)
    pelvis_depth = 0.155 if adult else 0.115
    pelvis = loft_mesh("PelvisCloth", [
        (0, 0.012, hip - 0.18, profile.hip_width * 0.48, pelvis_depth * 0.92, {"Hips": 1.0}),
        (0, 0.018, hip - 0.07, profile.hip_width * 0.56, pelvis_depth, {"Hips": 1.0}),
        (0, 0.012, hip + 0.07, profile.hip_width * 0.55, pelvis_depth * 0.98, {"Hips": 1.0}),
        (0, 0.005, hip + 0.13, profile.hip_width * 0.48, pelvis_depth * 0.86, {"Hips": 1.0}),
    ], mats["trousers"], 28)
    cloth_parts.append(pelvis)

    for side, sign in (("L", -1), ("R", 1)):
        arm_x = sign * (shoulder_x + profile.arm_length * 0.025)
        bare_arm = loft_mesh(f"ArmSkin_{side}", [
            (sign * shoulder_x, 0, shoulder_z + 0.02, 0.074 if adult else 0.054, 0.070 if adult else 0.052, {f"Rig_Arm_{side}": 1.0}),
            (sign * (shoulder_x + profile.arm_length * 0.025), 0, elbow_z + 0.055, 0.069 if adult else 0.050, 0.066 if adult else 0.048, {f"Rig_Arm_{side}": 0.78, f"Forearm_{side}": 0.22}),
            (arm_x, 0, elbow_z, 0.068 if adult else 0.049, 0.064 if adult else 0.047, {f"Rig_Arm_{side}": 0.5, f"Forearm_{side}": 0.5}),
            (arm_x, -0.004, elbow_z - 0.055, 0.072 if adult else 0.052, 0.066 if adult else 0.049, {f"Rig_Arm_{side}": 0.18, f"Forearm_{side}": 0.82}),
            (arm_x, -0.006, (elbow_z + wrist_z) * 0.48, 0.066 if adult else 0.048, 0.060 if adult else 0.045, {f"Forearm_{side}": 1.0}),
            (arm_x, -0.005, wrist_z + 0.02, 0.052 if adult else 0.041, 0.048 if adult else 0.039, {f"Forearm_{side}": 0.76, f"Hand_{side}": 0.24}),
        ], mats["skin"], 22)
        skin_parts.append(bare_arm)

        sleeve = loft_mesh(f"RolledSleeve_{side}", [
            (sign * shoulder_x, 0.002, shoulder_z + 0.025, 0.102 if adult else 0.073, 0.096 if adult else 0.070, {f"Rig_Arm_{side}": 1.0}),
            (arm_x, 0.002, (shoulder_z + elbow_z) * 0.55, 0.094 if adult else 0.069, 0.088 if adult else 0.065, {f"Rig_Arm_{side}": 1.0}),
            (arm_x, -0.002, elbow_z + 0.07, 0.085 if adult else 0.064, 0.080 if adult else 0.060, {f"Rig_Arm_{side}": 0.82, f"Forearm_{side}": 0.18}),
        ], mats["shirt"], 22)
        cloth_parts.append(sleeve)
        shoulder_cap = ellipsoid(f"SleeveCap_{side}", (sign * shoulder_x, 0, shoulder_z - 0.005), (0.104 if adult else 0.075, 0.098 if adult else 0.072, 0.105 if adult else 0.076), mats["shirt"], 24, 16)
        assign_weight(shoulder_cap, f"Rig_Arm_{side}")
        cloth_parts.append(shoulder_cap)
        cuff_radius = 0.086 if adult else 0.064
        cuff = loft_mesh(f"SleeveCuff_{side}", [
            (arm_x, 0, elbow_z + 0.055, cuff_radius, cuff_radius * 0.94, {f"Rig_Arm_{side}": 0.70, f"Forearm_{side}": 0.30}),
            (arm_x, 0, elbow_z + 0.090, cuff_radius * 1.01, cuff_radius * 0.95, {f"Rig_Arm_{side}": 0.82, f"Forearm_{side}": 0.18}),
        ], mats["secondary"], 22)
        cloth_parts.append(cuff)
        skin_parts.extend(add_relaxed_hand(profile, mats, side, sign, arm_x, wrist_z))

        leg_radius = profile.hip_width
        # The lower cuff crosses the ankle pivot and shares most of its weight
        # with the foot.  This keeps trousers and shoes visually connected while
        # the ankle rolls through heel-strike and toe-off (the old single ring
        # stopped above the shoe and looked like a floating foot in motion).
        ground_offset = profile.ankle_z * 0.075
        trouser_leg = loft_mesh(f"TrouserLeg_{side}", [
            (sign * leg_x, 0.004, profile.ankle_z * 0.76 - ground_offset * 0.70, leg_radius * 0.190, (0.084 if adult else 0.061), {f"Shin_{side}": 0.18, f"Foot_{side}": 0.82}),
            (sign * leg_x, 0.008, profile.ankle_z + 0.015, leg_radius * 0.205, (0.090 if adult else 0.066), {f"Shin_{side}": 0.72, f"Foot_{side}": 0.28}),
            (sign * leg_x, 0.010, (profile.ankle_z + profile.knee_z) * 0.50, leg_radius * 0.245, (0.112 if adult else 0.080), {f"Shin_{side}": 1.0}),
            (sign * leg_x, 0.006, profile.knee_z - 0.055, leg_radius * 0.235, (0.108 if adult else 0.078), {f"Shin_{side}": 0.78, f"Rig_Leg_{side}": 0.22}),
            (sign * leg_x, 0.004, profile.knee_z + 0.055, leg_radius * 0.255, (0.118 if adult else 0.084), {f"Shin_{side}": 0.22, f"Rig_Leg_{side}": 0.78}),
            (sign * leg_x, 0.004, (profile.knee_z + hip) * 0.52, leg_radius * 0.29, (0.137 if adult else 0.098), {f"Rig_Leg_{side}": 1.0}),
            (sign * leg_x, 0.008, hip + 0.015, leg_radius * 0.31, (0.145 if adult else 0.105), {f"Rig_Leg_{side}": 0.84, "Hips": 0.16}),
        ], mats["trousers"], 24)
        cloth_parts.append(trouser_leg)

        shoe_center_z = profile.ankle_z * 0.48
        sole = rounded_box(f"ShoeSole_{side}", (sign * leg_x, -profile.foot_length * 0.43, shoe_center_z * 0.52 - ground_offset), (profile.hip_width * 0.48, profile.foot_length * 1.04, profile.ankle_z * 0.24), mats["shoes"], profile.ankle_z * 0.10)
        upper = rounded_box(f"ShoeUpper_{side}", (sign * leg_x, -profile.foot_length * 0.34, shoe_center_z - ground_offset), (profile.hip_width * 0.45, profile.foot_length * 0.84, profile.ankle_z * 0.60), mats["shoes"], profile.ankle_z * 0.20)
        toe = ellipsoid(f"ShoeToe_{side}", (sign * leg_x, -profile.foot_length * 0.78, shoe_center_z * 0.92 - ground_offset), (profile.hip_width * 0.225, profile.foot_length * 0.25, profile.ankle_z * 0.26), mats["shoes"], 22, 14)
        for shoe_part in (sole, upper, toe):
            assign_weight(shoe_part, f"Foot_{side}")
            cloth_parts.append(shoe_part)

    add_clothing_details(profile, mats, cloth_parts)

    body_skin = join_meshes(skin_parts, "BodySkin")
    clothing = join_meshes(cloth_parts, "Clothing")
    add_armature_modifier(body_skin, armature)
    add_armature_modifier(clothing, armature)
    return [body_skin, clothing]


def add_clothing_details(profile: CharacterProfile, mats: dict[str, bpy.types.Material], parts: list[bpy.types.Object]) -> None:
    hip, chest = profile.hips_z, profile.chest_z
    torso_mid = (hip + chest) * 0.5
    if profile.clothing == "owner":
        adult = profile.body_kind == "adult"
        front_y = -(0.184 if adult else 0.142)
        bib = rounded_box("ApronBib", (0, front_y - 0.014, torso_mid + 0.055), (profile.shoulder_width * 0.59, 0.032, chest - hip + 0.10), mats["apron"], 0.026)
        skirt = rounded_box("ApronSkirt", (0, front_y - 0.018, hip - (0.15 if adult else 0.10)), (profile.shoulder_width * 0.72, 0.036, 0.48 if adult else 0.34), mats["apron"], 0.032)
        pocket = rounded_box("ApronPocket", (0, front_y - 0.043, hip - (0.14 if adult else 0.09)), (profile.shoulder_width * 0.38, 0.026, 0.18 if adult else 0.13), mats["apron"], 0.018)
        assign_weight(bib, "Chest")
        assign_weight(skirt, "Hips")
        assign_weight(pocket, "Hips")
        parts.extend((bib, skirt, pocket))
        for sign in (-1, 1):
            strap = curve_mesh(f"ApronStrap_{sign}", [(sign * profile.shoulder_width * 0.25, front_y - 0.012, profile.neck_z - 0.055), (sign * profile.shoulder_width * 0.20, front_y - 0.032, torso_mid + 0.02)], 0.017 if adult else 0.013, mats["apron"])
            assign_weight(strap, "Chest")
            parts.append(strap)
            collar = rounded_box(f"ShirtCollar_{sign}", (sign * profile.shoulder_width * 0.10, front_y - 0.015, profile.neck_z - 0.07), (profile.shoulder_width * 0.18, 0.028, 0.12 if adult else 0.085), mats["secondary"], 0.012, (0, sign * 0.38, 0))
            assign_weight(collar, "Chest")
            parts.append(collar)
        button_count = 2 if adult else 1
        for index in range(button_count):
            button = ellipsoid(f"ShirtButton_{index}", (0, front_y - 0.034, profile.neck_z - 0.105 - index * 0.065), (0.009, 0.007, 0.009), mats["metal"], 14, 10)
            assign_weight(button, "Chest")
            parts.append(button)
        for sign in (-1, 1):
            tie = curve_mesh(f"ApronTie_{sign}", [(sign * profile.hip_width * 0.43, 0.13, hip + 0.015), (sign * profile.hip_width * 0.56, 0.18, hip - 0.03), (sign * profile.hip_width * 0.45, 0.19, hip - 0.13)], 0.016 if adult else 0.012, mats["apron"], 1)
            assign_weight(tie, "Hips")
            parts.append(tie)
    elif profile.clothing in {"jacket", "blazer", "cardigan"}:
        for sign in (-1, 1):
            lapel = rounded_box(f"Lapel_{sign}", (sign * profile.shoulder_width * 0.16, -0.19, torso_mid + 0.08), (profile.shoulder_width * 0.20, 0.035, chest - hip), mats["secondary"], 0.018, (0, sign * 0.22, 0))
            assign_weight(lapel, "Chest")
            parts.append(lapel)
    elif profile.clothing == "sweater":
        collar = torus("SweaterCollar", (0, 0, profile.neck_z - 0.09), profile.shoulder_width * 0.16, 0.018, mats["secondary"])
        assign_weight(collar, "Chest")
        parts.append(collar)
    elif profile.clothing == "blouse":
        for sign in (-1, 1):
            collar = rounded_box(f"BlouseCollar_{sign}", (sign * profile.shoulder_width * 0.11, -0.19, profile.neck_z - 0.09), (profile.shoulder_width * 0.20, 0.03, 0.13), mats["secondary"], 0.015, (0, sign * 0.4, 0))
            assign_weight(collar, "Chest")
            parts.append(collar)


def build_character(profile: CharacterProfile) -> Path:
    clean_scene()
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    mats = create_materials(profile)
    armature = create_armature(profile)
    build_body(profile, mats, armature)
    build_head(profile, mats, armature)
    if profile.hair_style:
        hair_objects = create_character_hair(profile, mats["hair"])
        for obj in hair_objects:
            assign_weight(obj, "Head")
        hair = join_meshes(hair_objects, "Hair")
        add_armature_modifier(hair, armature)
    create_actions(armature, profile)
    add_character_metadata(armature, profile)
    output = OUTPUT_ROOT / profile.output
    output.parent.mkdir(parents=True, exist_ok=True)
    export_character(output, armature)
    return output


def add_character_metadata(armature: bpy.types.Object, profile: CharacterProfile) -> None:
    armature["assetPipeline"] = "market-character-source-v1"
    armature["sourceReference"] = profile.reference
    armature["metersHigh"] = profile.height
    armature["headSocketBone"] = "Head"
    armature["leftGripBone"] = "Hand_L"
    armature["rightGripBone"] = "Hand_R"
    armature["morphTargets"] = ",".join(MORPH_TARGETS)
    armature["footEvents"] = "Walk:LeftFootDown@0.00,RightFootDown@0.50;Run:LeftFootDown@0.00,RightFootDown@0.50"


def export_character(output: Path, armature: bpy.types.Object) -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_merge_animation="NONE",
        export_force_sampling=True,
        export_frame_step=1,
        export_anim_slide_to_zero=True,
        export_reset_pose_bones=True,
        export_skins=True,
        export_armature_object_remove=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_morph=True,
        export_morph_normal=True,
        export_morph_animation=False,
        export_extras=True,
        export_loglevel=-1,
    )


def reset_pose(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def create_action(armature: bpy.types.Object, name: str, duration: float, frames: list[tuple[float, dict[str, tuple[float, float, float]]]]) -> None:
    animation_data = armature.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    slot = action.slots.new(id_type="OBJECT", name=armature.name)
    animation_data.action = action
    animation_data.action_slot = slot
    end_frame = max(2, round(duration * FPS) + 1)
    for progress, rotations in frames:
        frame = 1 + round(progress * (end_frame - 1))
        bpy.context.scene.frame_set(frame)
        reset_pose(armature)
        for bone_name, rotation in rotations.items():
            if bone_name == "Hips.location":
                armature.pose.bones["Hips"].location = rotation
                armature.pose.bones["Hips"].keyframe_insert(data_path="location", frame=frame, group="Hips")
                continue
            bone = armature.pose.bones.get(bone_name)
            if not bone:
                continue
            bone.rotation_euler = rotation
            bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
        for required in ("Hips", "Spine", "Chest", "Neck", "Head", "Rig_Arm_L", "Rig_Arm_R", "Forearm_L", "Forearm_R", "Rig_Leg_L", "Rig_Leg_R", "Shin_L", "Shin_R", "Foot_L", "Foot_R"):
            bone = armature.pose.bones.get(required)
            bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=required)
        hips = armature.pose.bones["Hips"]
        hips.keyframe_insert(data_path="location", frame=frame, group="Hips")
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fcurve in bag.fcurves:
                    for point in fcurve.keyframe_points:
                        point.interpolation = "BEZIER"
                        point.handle_left_type = "AUTO_CLAMPED"
                        point.handle_right_type = "AUTO_CLAMPED"
    animation_data.action = None
    reset_pose(armature)


def mirror_pose(pose: dict[str, tuple[float, float, float]]) -> dict[str, tuple[float, float, float]]:
    mirrored: dict[str, tuple[float, float, float]] = {}
    for name, value in pose.items():
        # Swap only the anatomical suffix.  Replacing every `_L` corrupted names
        # such as `Rig_Leg_L` at the `_Leg` segment, silently dropping the whole
        # mirrored half of the gait on export.
        if name.endswith("_L"):
            target = f"{name[:-2]}_R"
        elif name.endswith("_R"):
            target = f"{name[:-2]}_L"
        else:
            target = name
        mirrored[target] = (value[0], -value[1], -value[2]) if name != "Hips.location" else value
    return mirrored


def combine(*poses: dict[str, tuple[float, float, float]]) -> dict[str, tuple[float, float, float]]:
    result: dict[str, tuple[float, float, float]] = {}
    for pose in poses:
        result.update(pose)
    return result


def create_actions(armature: bpy.types.Object, profile: CharacterProfile) -> None:
    child = profile.body_kind == "child"
    stride = 0.88 if child else 1.0
    # The shorter child rig needs a 3 mm vertical gait offset.  Without it the
    # rounded shoe sole crosses the floor at mid-stance even though the adult
    # proportions remain grounded.  Keeping the correction in the source
    # animation also fixes Run/Enter/Exit/CarryWalk instead of masking it at
    # runtime with a character-specific transform.
    contact_drop = -0.007 if child else -0.016
    loading_drop = -0.003 if child else -0.008
    passing_lift = 0.013 if child else 0.015
    high_lift = 0.007 if child else 0.005
    contact = {
        "Rig_Leg_L": (-0.30 * stride, 0.0, 0.025), "Shin_L": (0.08, 0, 0), "Foot_L": (0.10, 0, 0),
        "Rig_Leg_R": (0.23 * stride, 0.0, -0.025), "Shin_R": (0.38, 0, 0), "Foot_R": (-0.36, 0, 0),
        "Rig_Arm_L": (0.22, 0, -0.04), "Rig_Arm_R": (-0.25, 0, 0.04),
        "Forearm_L": (-0.16, 0, 0), "Forearm_R": (-0.20, 0, 0),
        "Hips": (0.0, 0.025, -0.025), "Chest": (0.0, -0.035, 0.02), "Head": (0.0, 0.012, 0.0),
        "Hips.location": (0.0, contact_drop, 0.0),
    }
    down = {
        "Rig_Leg_L": (-0.19 * stride, 0, 0.02), "Shin_L": (0.22, 0, 0), "Foot_L": (-0.03, 0, 0),
        "Rig_Leg_R": (0.16 * stride, 0, -0.02), "Shin_R": (0.54, 0, 0), "Foot_R": (-0.55, 0, 0),
        "Rig_Arm_L": (0.15, 0, -0.03), "Rig_Arm_R": (-0.17, 0, 0.03), "Hips.location": (0, loading_drop, 0),
    }
    passing = {
        "Rig_Leg_L": (0.05 * stride, 0, 0.01), "Shin_L": (0.16, 0, 0), "Foot_L": (-0.11, 0, 0),
        "Rig_Leg_R": (-0.07 * stride, 0, -0.01), "Shin_R": (0.72 if not child else 0.78, 0, 0), "Foot_R": (-0.67, 0, 0),
        "Rig_Arm_L": (-0.03, 0, -0.02), "Rig_Arm_R": (0.04, 0, 0.02), "Hips.location": (0, passing_lift, 0),
    }
    high = {
        "Rig_Leg_L": (0.22 * stride, 0, 0.02), "Shin_L": (0.08, 0, 0), "Foot_L": (-0.20, 0, 0),
        "Rig_Leg_R": (-0.28 * stride, 0, -0.02), "Shin_R": (0.88 if not child else 0.96, 0, 0), "Foot_R": (-0.60, 0, 0),
        "Rig_Arm_L": (-0.20, 0, -0.04), "Rig_Arm_R": (0.23, 0, 0.04), "Hips.location": (0, high_lift, 0),
    }
    opposite = mirror_pose(contact)
    walk_frames = [(0.0, contact), (0.12, down), (0.30, passing), (0.43, high), (0.5, opposite), (0.62, mirror_pose(down)), (0.80, mirror_pose(passing)), (0.93, mirror_pose(high)), (1.0, contact)]
    create_action(armature, "Walk", 1.0, walk_frames)

    run_scale = 1.32
    run_frames = []
    for progress, pose in walk_frames:
        run_pose = {name: tuple(component * run_scale for component in value) for name, value in pose.items()}
        run_frames.append((progress, run_pose))
    create_action(armature, "Run", 0.74, run_frames)

    idle_a = {"Hips.location": (0, 0, 0), "Chest": (0.008, 0, 0), "Head": (-0.004, 0, 0)}
    idle_b = {"Hips.location": (0, 0.004, 0), "Chest": (-0.008, 0, 0), "Head": (0.004, 0, 0)}
    create_action(armature, "Idle", 2.4, [(0, idle_a), (0.5, idle_b), (1, idle_a)])

    carry_arms = {"Rig_Arm_L": (-0.62, 0.0, -0.22), "Rig_Arm_R": (-0.62, 0.0, 0.22), "Forearm_L": (-1.12, 0, 0.08), "Forearm_R": (-1.12, 0, -0.08), "Chest": (-0.035, 0, 0)}
    create_action(armature, "CarryIdle", 1.6, [(0, carry_arms), (0.5, combine(carry_arms, {"Chest": (-0.045, 0, 0)})), (1, carry_arms)])
    carry_walk_frames = [(progress, combine(pose, carry_arms)) for progress, pose in walk_frames]
    create_action(armature, "CarryWalk", 1.0, carry_walk_frames)
    # These clips are selected while visitor world positions are changing. They
    # must contain a complete gait, not a held gesture, or the customer slides.
    create_action(armature, "Enter", 1.0, walk_frames)
    create_action(armature, "Exit", 1.0, walk_frames)
    create_action(armature, "CarryBasket", 1.0, carry_walk_frames)

    create_action(armature, "TurnLeft", 0.58, [(0, {}), (0.5, {"Hips": (0, -0.38, 0), "Chest": (0, -0.22, 0), "Foot_L": (0, -0.18, 0), "Foot_R": (0, -0.08, 0)}), (1, {})])
    create_action(armature, "TurnRight", 0.58, [(0, {}), (0.5, {"Hips": (0, 0.38, 0), "Chest": (0, 0.22, 0), "Foot_L": (0, 0.08, 0), "Foot_R": (0, 0.18, 0)}), (1, {})])

    action_poses = {
        "HarvestLow": {"Spine": (0.42, 0, 0), "Chest": (0.18, 0, 0), "Rig_Leg_L": (-0.18, 0, 0), "Rig_Leg_R": (0.15, 0, 0), "Shin_L": (0.62, 0, 0), "Shin_R": (0.48, 0, 0), "Rig_Arm_L": (-0.88, 0, -0.12), "Rig_Arm_R": (-0.72, 0, 0.12), "Forearm_L": (-0.64, 0, 0), "Forearm_R": (-0.52, 0, 0)},
        "HarvestHigh": {"Rig_Arm_L": (-1.22, 0, -0.18), "Rig_Arm_R": (-1.08, 0, 0.18), "Forearm_L": (-0.35, 0, 0), "Forearm_R": (-0.42, 0, 0), "Chest": (-0.12, 0, 0)},
        "PickupLow": {"Spine": (0.52, 0, 0), "Chest": (0.22, 0, 0), "Shin_L": (0.72, 0, 0), "Shin_R": (0.55, 0, 0), "Rig_Arm_L": (-0.72, 0, -0.14), "Rig_Arm_R": (-0.72, 0, 0.14), "Forearm_L": (-0.44, 0, 0), "Forearm_R": (-0.44, 0, 0)},
        "PickupHigh": {"Rig_Arm_L": (-0.88, 0, -0.20), "Rig_Arm_R": (-0.88, 0, 0.20), "Forearm_L": (-0.80, 0, 0), "Forearm_R": (-0.80, 0, 0)},
        "StockLow": {"Spine": (0.35, 0, 0), "Rig_Arm_L": (-0.74, 0, -0.12), "Rig_Arm_R": (-0.70, 0, 0.12), "Forearm_L": (-0.78, 0, 0), "Forearm_R": (-0.78, 0, 0)},
        "StockMid": {"Rig_Arm_L": (-0.88, 0, -0.16), "Rig_Arm_R": (-0.82, 0, 0.16), "Forearm_L": (-0.72, 0, 0), "Forearm_R": (-0.72, 0, 0)},
        "StockHigh": {"Rig_Arm_L": (-1.38, 0, -0.18), "Rig_Arm_R": (-1.28, 0, 0.18), "Forearm_L": (-0.45, 0, 0), "Forearm_R": (-0.45, 0, 0), "Chest": (-0.16, 0, 0)},
        "CheckoutScan": {"Rig_Arm_R": (-0.62, -0.15, 0.12), "Forearm_R": (-0.92, 0, -0.18), "Chest": (0, -0.16, 0), "Head": (0.06, -0.12, 0)},
        "CheckoutBag": {"Rig_Arm_L": (-0.74, 0, -0.22), "Rig_Arm_R": (-0.74, 0, 0.22), "Forearm_L": (-1.02, 0, 0), "Forearm_R": (-1.02, 0, 0), "Spine": (0.12, 0, 0)},
        "Pay": {"Rig_Arm_R": (-0.70, -0.18, 0.18), "Forearm_R": (-1.10, 0, -0.12), "Head": (0.05, -0.15, 0)},
        "ReceiveBag": {"Rig_Arm_L": (-0.68, 0, -0.22), "Forearm_L": (-1.05, 0, 0.06), "Rig_Arm_R": (-0.22, 0, 0.08)},
        "Happy": {"Rig_Arm_L": (-1.05, 0, -0.72), "Rig_Arm_R": (-1.05, 0, 0.72), "Forearm_L": (-0.32, 0, 0), "Forearm_R": (-0.32, 0, 0), "Chest": (-0.12, 0, 0), "Head": (-0.08, 0, 0)},
        "Confused": {"Rig_Arm_L": (-0.32, 0, -0.25), "Forearm_L": (-1.16, 0, 0.10), "Head": (0.06, 0.12, -0.12), "Chest": (0, -0.08, 0)},
        "Impatient": {"Rig_Arm_L": (-0.46, 0, -0.36), "Rig_Arm_R": (-0.46, 0, 0.36), "Forearm_L": (-1.32, 0, 0), "Forearm_R": (-1.32, 0, 0), "Hips": (0, 0.12, 0)},
        "Talk": {"Rig_Arm_R": (-0.55, 0, 0.40), "Forearm_R": (-0.78, 0, 0), "Head": (0, -0.08, 0)},
        "LookAround": {"Head": (0, 0.40, 0), "Neck": (0, 0.18, 0)},
        "Phone": {"Rig_Arm_R": (-0.50, -0.08, 0.24), "Forearm_R": (-1.55, 0, -0.10), "Head": (0.10, -0.12, 0)},
        "Wave": {"Rig_Arm_R": (-1.22, 0, 0.52), "Forearm_R": (-0.48, 0, 0.22), "Head": (0, -0.12, 0)},
        "ReceiveOrder": {"Rig_Arm_L": (-0.72, 0, -0.22), "Rig_Arm_R": (-0.72, 0, 0.22), "Forearm_L": (-1.00, 0, 0), "Forearm_R": (-1.00, 0, 0)},
        "LiftBox": {"Spine": (0.30, 0, 0), "Shin_L": (0.55, 0, 0), "Shin_R": (0.55, 0, 0), "Rig_Arm_L": (-0.62, 0, -0.20), "Rig_Arm_R": (-0.62, 0, 0.20), "Forearm_L": (-0.88, 0, 0), "Forearm_R": (-0.88, 0, 0)},
        "CarryBox": carry_arms,
        "ScanItem": {"Rig_Arm_R": (-0.62, -0.15, 0.12), "Forearm_R": (-0.92, 0, -0.18), "Chest": (0, -0.16, 0)},
        "Plant": {"Spine": (0.48, 0, 0), "Shin_L": (0.72, 0, 0), "Shin_R": (0.58, 0, 0), "Rig_Arm_L": (-0.78, 0, -0.14), "Rig_Arm_R": (-0.72, 0, 0.14)},
        "Harvest": {"Spine": (0.38, 0, 0), "Rig_Arm_L": (-0.88, 0, -0.12), "Rig_Arm_R": (-0.72, 0, 0.12), "Forearm_L": (-0.64, 0, 0), "Forearm_R": (-0.52, 0, 0)},
        "Wait": {"Hips.location": (0, 0.003, 0), "Chest": (-0.008, 0, 0), "Head": (0.01, 0, 0)},
        "Browse": {"Head": (0.04, 0.28, 0), "Neck": (0, 0.12, 0), "Rig_Arm_R": (-0.18, 0, 0.08)},
        "ReachShelf": {"Rig_Arm_R": (-0.92, 0, 0.18), "Forearm_R": (-0.64, 0, -0.08), "Chest": (-0.08, 0.05, 0)},
        "Queue": {"Hips": (0, 0.05, 0), "Rig_Arm_L": (-0.16, 0, -0.08), "Rig_Arm_R": (-0.12, 0, 0.06)},
        "CheckoutItem": {"Rig_Arm_R": (-0.66, -0.12, 0.14), "Forearm_R": (-0.96, 0, -0.12), "Head": (0.04, -0.10, 0)},
    }
    for name, pose in action_poses.items():
        if name in {"Talk", "LookAround", "Impatient"}:
            alternate = mirror_pose(pose)
            create_action(armature, name, 1.8, [(0, {}), (0.28, pose), (0.62, alternate), (1, {})])
        else:
            create_action(armature, name, 1.1, [(0, {}), (0.22, pose), (0.72, pose), (1, {})])


def create_character_hair(profile: CharacterProfile, hair_mat: bpy.types.Material) -> list[bpy.types.Object]:
    style = profile.hair_style or "short_side_part"
    rx, ry, rz = profile.head_radius
    center = profile.head_center_z
    parts = [ellipsoid("HairScalp", (0, 0.055, center + rz * 0.28), (rx * 1.05, ry * 0.90, rz * 0.72), hair_mat, 32, 20)]
    if style in {"short_side_part", "senior_side"}:
        color_mat = hair_mat
        for index in range(7):
            x = (index - 3) * rx * 0.11
            parts.append(curve_mesh(f"HairSweep_{index}", [(x, -ry * 0.55, center + rz * 0.58), (x - rx * 0.22, -ry * 0.30, center + rz * 0.86)], rx * 0.055, color_mat))
    elif style == "long_wavy":
        for sign in (-1, 1):
            for offset in (-0.10, 0.04, 0.18):
                x = sign * (rx * 0.65 + abs(offset) * 0.25)
                parts.append(curve_mesh(f"LongWave_{sign}_{offset}", [(x, 0, center + rz * 0.55), (x + sign * 0.04, 0.03, center), (x - sign * 0.02, 0.05, center - rz * 0.95)], rx * 0.10, hair_mat))
    elif style == "high_ponytail":
        parts.append(ellipsoid("PonyRoot", (0, ry * 0.85, center + rz * 0.62), (rx * 0.22, ry * 0.22, rz * 0.18), hair_mat, 22, 14))
        parts.append(curve_mesh("Ponytail", [(0, ry * 0.96, center + rz * 0.60), (rx * 0.18, ry * 1.25, center + rz * 0.15), (rx * 0.08, ry * 1.08, center - rz * 0.70)], rx * 0.15, hair_mat))
    elif style == "mature_bob":
        for sign in (-1, 1):
            parts.append(ellipsoid(f"BobSide_{sign}", (sign * rx * 0.78, 0.03, center - rz * 0.10), (rx * 0.28, ry * 0.48, rz * 0.62), hair_mat, 24, 16))
        parts.append(ellipsoid("BobBack", (0, ry * 0.62, center - rz * 0.10), (rx * 0.92, ry * 0.34, rz * 0.65), hair_mat, 28, 18))
    elif style == "senior_bun":
        parts.append(ellipsoid("HairBun", (0, ry * 0.70, center + rz * 0.72), (rx * 0.44, ry * 0.42, rz * 0.40), hair_mat, 26, 18))
    return parts


HAIR_STYLES = [
    "side-part", "fade", "waves", "swept", "bob", "ponytail", "long-wavy", "bun",
    "messy", "curls", "short-fringe", "quiff", "blunt-bob", "pigtails", "braid", "high-ponytail",
]

HAT_STYLES = [
    "red-panda", "red-fox", "chicken", "owl", "elephant", "rhino",
    "giraffe", "panda", "frog", "cow", "rabbit", "capybara",
]


def trim_shell(obj: bpy.types.Object, keep: Callable[[Vector], bool], thickness: float = 0.012) -> bpy.types.Object:
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    remove = [face for face in bm.faces if not keep(face.calc_center_median())]
    bmesh.ops.delete(bm, geom=remove, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    if thickness:
        modifier = obj.modifiers.new("SoftThickness", "SOLIDIFY")
        modifier.thickness = thickness
        modifier.offset = -0.5
        modifier.use_rim = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    smooth(obj)
    return obj


def create_hair_cap(mat: bpy.types.Material, short: bool = False) -> bpy.types.Object:
    center_z = 0.20
    obj = ellipsoid("HairCap", (0, 0.012, center_z + 0.025), (0.226, 0.205, 0.272), mat, 36, 24)
    def keep(point: Vector) -> bool:
        front_amount = max(0.0, min(1.0, (-point.y - 0.015) / 0.19))
        # The cap is only the under-layer.  Keeping its frontal hairline high
        # leaves the forehead visible and lets the sculpted locks define each
        # silhouette, as in PEINADOS.png, instead of reading as a helmet.
        lower_limit = (0.18 if short else 0.135) + front_amount * (0.13 if short else 0.145)
        return point.z >= lower_limit
    return trim_shell(obj, keep, 0.014)


def hair_lock(name: str, points: list[tuple[float, float, float]], radius: float, mat: bpy.types.Material) -> bpy.types.Object:
    if len(points) == 2:
        radii = [0.78, 0.16]
    else:
        radii = [0.62] + [1.12] * (len(points) - 2) + [0.12]
    return curve_mesh(name, points, radius, mat, 3, radii)


def create_hair_asset(style: str, mat: bpy.types.Material) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = [create_hair_cap(mat, short=style in {"fade", "messy", "curls", "short-fringe", "quiff"})]
    front_y = -0.192

    if style in {"side-part", "swept"}:
        direction = -1 if style == "side-part" else 1
        for index in range(8):
            start_x = -0.16 + index * 0.042
            end_x = start_x + direction * (0.07 + index * 0.005)
            parts.append(hair_lock(f"Sweep_{index}", [(start_x, -0.10, 0.43), (start_x + direction * 0.035, front_y, 0.405), (end_x, front_y, 0.32)], 0.018, mat))
        parts.append(hair_lock("TempleLock", [(direction * 0.19, -0.11, 0.36), (direction * 0.215, -0.13, 0.25), (direction * 0.205, -0.08, 0.17)], 0.020, mat))
    elif style == "fade":
        for row, z in enumerate((0.34, 0.39, 0.43)):
            for index in range(6 - row):
                x = (index - (5 - row) / 2) * 0.055
                parts.append(hair_lock(f"FadeSpike_{row}_{index}", [(x, -0.11, z - 0.05), (x - 0.025, -0.17, z + 0.035), (x + 0.025, -0.13, z + 0.075)], 0.022, mat))
    elif style == "waves":
        for side, sign in (("L", -1), ("R", 1)):
            for index in range(4):
                x = sign * (0.10 + index * 0.034)
                parts.append(hair_lock(f"Wave_{side}_{index}", [(x, -0.14, 0.40), (x + sign * 0.025, front_y, 0.31), (x - sign * 0.025, -0.18, 0.22), (x + sign * 0.02, -0.12, 0.12)], 0.024, mat))
        parts.append(hair_lock("WaveCrown", [(-0.15, -0.12, 0.43), (0, -0.19, 0.47), (0.15, -0.12, 0.42)], 0.026, mat))
    elif style in {"bob", "blunt-bob"}:
        length = -0.08 if style == "blunt-bob" else 0.00
        for side, sign in (("L", -1), ("R", 1)):
            for index in range(5):
                x = sign * (0.10 + index * 0.027)
                finish = length + index * 0.012
                parts.append(hair_lock(f"Bob_{side}_{index}", [(x * 0.72, -0.11, 0.43), (x, -0.18, 0.27), (x * 1.02, -0.13, finish)], 0.029, mat))
        if style == "blunt-bob":
            for index in range(7):
                x = (index - 3) * 0.047
                parts.append(hair_lock(f"Bang_{index}", [(x, -0.18, 0.34), (x, -0.205, 0.23), (x * 0.98, -0.198, 0.14)], 0.021, mat))
    elif style in {"ponytail", "high-ponytail"}:
        high = style == "high-ponytail"
        root_z = 0.41 if high else 0.31
        parts.append(ellipsoid("PonyBinding", (0, 0.205, root_z), (0.055, 0.045, 0.055), mat, 22, 14))
        for index in range(5):
            x = (index - 2) * 0.027
            parts.append(hair_lock(f"Pony_{index}", [(x, 0.20, root_z), (x + 0.025, 0.28, root_z - 0.10), (x - 0.018, 0.26, root_z - 0.28), (x + 0.012, 0.20, root_z - 0.42)], 0.028, mat))
        for sign in (-1, 1):
            parts.append(hair_lock(f"PonyFaceLock_{sign}", [(sign * 0.13, -0.17, 0.38), (sign * 0.17, -0.205, 0.23), (sign * 0.145, -0.19, 0.08)], 0.018, mat))
    elif style == "long-wavy":
        for side, sign in (("L", -1), ("R", 1)):
            for index in range(6):
                x = sign * (0.10 + index * 0.024)
                y = -0.06 + index * 0.022
                parts.append(hair_lock(f"LongWave_{side}_{index}", [(x * 0.65, -0.11, 0.43), (x, y - 0.08, 0.26), (x + sign * 0.025, y, 0.02), (x - sign * 0.018, y - 0.03, -0.22)], 0.027, mat))
    elif style == "bun":
        parts.append(ellipsoid("Bun", (0, 0.19, 0.43), (0.105, 0.10, 0.105), mat, 28, 18))
        for sign in (-1, 1):
            parts.append(hair_lock(f"BunFaceLock_{sign}", [(sign * 0.13, -0.17, 0.39), (sign * 0.18, -0.205, 0.22), (sign * 0.15, -0.18, 0.05)], 0.018, mat))
    elif style == "messy":
        for index in range(18):
            angle = math.tau * index / 18
            x = math.cos(angle) * 0.16
            y = math.sin(angle) * 0.13
            z = 0.36 + 0.035 * math.sin(index * 2.1)
            parts.append(hair_lock(f"Messy_{index}", [(x * 0.65, y * 0.60, z), (x, y, z + 0.075), (x * 1.10, y * 1.06, z + 0.025)], 0.024, mat))
    elif style == "curls":
        for row in range(3):
            count = 8 - row
            for index in range(count):
                angle = math.pi * (index + 0.5) / count
                x = math.cos(angle) * (0.18 - row * 0.018)
                y = front_y + row * 0.035
                z = 0.23 + row * 0.075 + math.sin(angle) * 0.05
                parts.append(torus(f"Curl_{row}_{index}", (x, y, z), 0.026, 0.011, mat, (math.pi / 2, 0, 0)))
    elif style == "short-fringe":
        for index in range(9):
            x = (index - 4) * 0.042
            length = 0.09 + (index % 3) * 0.018
            parts.append(hair_lock(f"Fringe_{index}", [(x * 0.82, -0.13, 0.39), (x, -0.205, 0.30), (x + (0.01 if index % 2 else -0.01), -0.202, 0.30 - length)], 0.020, mat))
    elif style == "quiff":
        for index in range(9):
            x = (index - 4) * 0.040
            height = 0.49 + 0.05 * (1 - abs(index - 4) / 4)
            parts.append(hair_lock(f"Quiff_{index}", [(x, -0.12, 0.35), (x * 0.90, -0.18, height), (x + 0.035, -0.13, height + 0.035)], 0.023, mat))
    elif style == "pigtails":
        for side, sign in (("L", -1), ("R", 1)):
            parts.append(ellipsoid(f"PigtailBinding_{side}", (sign * 0.21, 0.03, 0.27), (0.05, 0.045, 0.05), mat, 20, 14))
            for index in range(4):
                x = sign * (0.21 + index * 0.008)
                parts.append(hair_lock(f"Pigtail_{side}_{index}", [(x, 0.03, 0.27), (x + sign * 0.045, 0.07, 0.12), (x + sign * 0.02, 0.04, -0.10)], 0.026, mat))
    elif style == "braid":
        for sign in (-1, 1):
            parts.append(hair_lock(f"BraidFaceLock_{sign}", [(sign * 0.12, -0.17, 0.39), (sign * 0.16, -0.205, 0.22), (sign * 0.13, -0.19, 0.08)], 0.018, mat))
        for index in range(7):
            z = 0.12 - index * 0.07
            x = 0.18 + (0.018 if index % 2 else -0.018)
            parts.append(ellipsoid(f"Braid_{index}", (x, -0.02, z), (0.045, 0.038, 0.055), mat, 20, 14))
    return parts


def export_static_asset(output: Path, asset_id: str, reference: str) -> None:
    root = bpy.data.objects.new("AssetRoot", None)
    bpy.context.collection.objects.link(root)
    root["assetPipeline"] = "market-character-source-v1"
    root["assetId"] = asset_id
    root["sourceReference"] = reference
    for obj in list(bpy.context.scene.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root
    bpy.ops.object.select_all(action="SELECT")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", use_selection=True, export_yup=True,
        export_materials="EXPORT", export_animations=False, export_extras=True,
        export_apply=True, export_loglevel=-1,
    )


def build_all_hair_assets() -> None:
    for style in HAIR_STYLES:
        clean_scene()
        hair_mat = material("Hair", "#3c302b", 0.72)
        parts = create_hair_asset(style, hair_mat)
        join_meshes(parts, f"Hair_{style}")
        output = OUTPUT_ROOT / "hair" / f"{style}.glb"
        export_static_asset(output, f"hair:{style}", "PEINADOS.png")
        print(f"BUILT hair {style}: {output.relative_to(PROJECT_ROOT)}")


HAT_COLORS = {
    "red-panda": "#b84f2f", "red-fox": "#e26436", "chicken": "#f4ead0",
    "owl": "#6d4e37", "elephant": "#8299a2", "rhino": "#8b9294",
    "giraffe": "#e3a945", "panda": "#eeeadd", "frog": "#70ad49",
    "cow": "#eee9dc", "rabbit": "#eeeae4", "capybara": "#9a6d4d",
}


def create_hood_shell(mat: bpy.types.Material) -> bpy.types.Object:
    # Extra tessellation is concentrated here so the face opening has a soft,
    # textile-like curve rather than the stair-stepped edge of the prototype.
    hood = ellipsoid("Hood", (0, 0.018, 0.225), (0.272, 0.225, 0.305), mat, 72, 48)
    def keep(point: Vector) -> bool:
        if point.z < -0.045:
            return False
        opening = (point.x / 0.205) ** 2 + ((point.z - 0.145) / 0.225) ** 2 < 1.0
        return not (point.y < -0.105 and opening)
    return trim_shell(hood, keep, 0.020)


def animal_eye(name: str, x: float, z: float, mats: dict[str, bpy.types.Material], scale: float = 1.0) -> list[bpy.types.Object]:
    white = ellipsoid(f"{name}EyeWhite", (x, -0.220, z), (0.054 * scale, 0.025, 0.065 * scale), mats["eye_white"], 22, 14)
    pupil = ellipsoid(f"{name}EyePupil", (x, -0.244, z), (0.029 * scale, 0.014, 0.036 * scale), mats["black"], 20, 12)
    highlight = ellipsoid(f"{name}EyeHighlight", (x - 0.010 * scale, -0.257, z + 0.014 * scale), (0.008 * scale, 0.004, 0.010 * scale), mats["white"], 14, 10)
    return [white, pupil, highlight]


def button_eye(name: str, x: float, z: float, mats: dict[str, bpy.types.Material], scale: float = 1.0) -> list[bpy.types.Object]:
    eye = ellipsoid(f"{name}Eye", (x, -0.244, z), (0.031 * scale, 0.021, 0.038 * scale), mats["black"], 20, 14)
    highlight = ellipsoid(f"{name}EyeHighlight", (x - 0.009 * scale, -0.264, z + 0.013 * scale), (0.007 * scale, 0.004, 0.009 * scale), mats["white"], 12, 8)
    return [eye, highlight]


def animal_ear(name: str, x: float, z: float, outer: bpy.types.Material, inner: bpy.types.Material, tall: float = 1.0, rotation_z: float = 0.0) -> list[bpy.types.Object]:
    outer_ear = cone(f"{name}Ear", (x, 0.018, z), 0.085, 0.18 * tall, outer, (0, 0, rotation_z), 24)
    inner_ear = cone(f"{name}EarInner", (x, -0.055, z + 0.004), 0.052, 0.125 * tall, inner, (0, 0, rotation_z), 22)
    return [outer_ear, inner_ear]


def create_hat_asset(style: str) -> list[bpy.types.Object]:
    mats = {
        "base": material("HatFabric", HAT_COLORS[style], 0.82),
        "black": material("HatBlack", "#171717", 0.55),
        "white": material("HatWhite", "#f5eddb", 0.74),
        "cream": material("HatCream", "#e8cfa4", 0.78),
        "pink": material("HatPink", "#d78373", 0.73),
        "yellow": material("HatYellow", "#e9ad25", 0.70),
        "red": material("HatRed", "#b92d22", 0.76),
        "brown": material("HatBrown", "#6c4028", 0.80),
        "eye_white": material("HatEyeWhite", "#e7c964", 0.55),
        "gray": material("HatGray", "#60686c", 0.78),
    }
    hood = create_hood_shell(mats["base"])
    # Follow the ellipsoid surface instead of placing a flat ring in front of
    # the face. The open lower arc meets the neck naturally and the textile
    # welt hides the discrete topology cut from all normal viewing angles.
    opening_points: list[tuple[float, float, float]] = []
    start_angle, end_angle = -0.927, math.pi + 0.927
    for index in range(49):
        angle = start_angle + (end_angle - start_angle) * index / 48
        x = 0.205 * math.cos(angle)
        z = 0.145 + 0.225 * math.sin(angle)
        radial = (x / 0.272) ** 2 + ((z - 0.225) / 0.305) ** 2
        y = 0.018 - 0.225 * math.sqrt(max(0.001, 1.0 - radial)) - 0.014
        opening_points.append((x, y, z))
    opening_welt = curve_mesh("FaceOpeningWelt", opening_points, 0.016, mats["base"], 3)
    lower_welt = curve_mesh("FaceOpeningLowerWelt", [(-0.125, -0.203, -0.032), (0, -0.219, -0.046), (0.125, -0.203, -0.032)], 0.014, mats["base"], 3)
    parts: list[bpy.types.Object] = [hood, opening_welt, lower_welt]

    if style in {"red-panda", "red-fox"}:
        for side, sign in (("L", -1), ("R", 1)):
            parts.extend(animal_ear(side, sign * 0.18, 0.48, mats["base"], mats["cream"], 1.15, -sign * 0.20))
            cheek = ellipsoid(f"Cheek_{side}", (sign * 0.105, -0.225, 0.235), (0.085, 0.025, 0.070), mats["cream"], 22, 14)
            parts.append(cheek)
        muzzle = ellipsoid("Muzzle", (0, -0.250, 0.225), (0.095, 0.040, 0.068), mats["cream"], 24, 15)
        nose = ellipsoid("Nose", (0, -0.292, 0.245), (0.037, 0.024, 0.026), mats["black"], 18, 12)
        parts.extend((muzzle, nose))
        for side, sign in (("L", -1), ("R", 1)):
            parts.extend(button_eye(side, sign * 0.095, 0.345, mats, 0.92))
        if style == "red-panda":
            for side, sign in (("L", -1), ("R", 1)):
                brow_patch = ellipsoid(f"BrowPatch_{side}", (sign * 0.095, -0.215, 0.400), (0.055, 0.018, 0.035), mats["white"], 18, 12)
                parts.append(brow_patch)
    elif style == "chicken":
        for side, sign in (("L", -1), ("R", 1)):
            parts.extend(button_eye(side, sign * 0.085, 0.350, mats, 0.90))
        for index, x in enumerate((-0.05, 0.0, 0.052)):
            parts.append(ellipsoid(f"Comb_{index}", (x, 0.005, 0.535 + (0.025 if index == 1 else 0)), (0.043, 0.040, 0.080), mats["red"], 20, 14))
        parts.append(cone("Beak", (0, -0.255, 0.275), 0.060, 0.115, mats["yellow"], (math.pi / 2, 0, 0), 24))
        for sign in (-1, 1):
            parts.append(ellipsoid(f"Wattle_{sign}", (sign * 0.026, -0.238, 0.205), (0.028, 0.020, 0.050), mats["red"], 18, 12))
    elif style == "owl":
        for side, sign in (("L", -1), ("R", 1)):
            parts.append(cone(f"OwlTuft_{side}", (sign * 0.17, 0.015, 0.48), 0.075, 0.16, mats["base"], (0, 0, -sign * 0.28), 20))
            disc = ellipsoid(f"EyeDisc_{side}", (sign * 0.085, -0.218, 0.335), (0.095, 0.026, 0.110), mats["cream"], 24, 16)
            parts.append(disc)
            parts.extend(animal_eye(side, sign * 0.085, 0.345, mats, 0.92))
        parts.append(cone("OwlBeak", (0, -0.258, 0.275), 0.037, 0.085, mats["black"], (math.pi / 2, 0, 0), 20))
    elif style == "elephant":
        for side, sign in (("L", -1), ("R", 1)):
            ear = ellipsoid(f"ElephantEar_{side}", (sign * 0.260, 0.015, 0.290), (0.125, 0.035, 0.150), mats["base"], 28, 18)
            inner = ellipsoid(f"ElephantEarInner_{side}", (sign * 0.270, -0.022, 0.290), (0.083, 0.018, 0.105), mats["pink"], 24, 16)
            parts.extend((ear, inner))
            parts.extend(button_eye(side, sign * 0.085, 0.355, mats, 0.86))
        trunk_points = [(0, -0.235, 0.300), (0.012, -0.286, 0.205), (0.020, -0.305, 0.105), (0.060, -0.305, 0.070), (0.105, -0.286, 0.115)]
        parts.append(curve_mesh("ElephantTrunk", trunk_points, 0.047, mats["base"], 4, [1.16, 1.06, 0.88, 0.68, 0.52]))
        parts.append(ellipsoid("ElephantTrunkTip", (0.105, -0.286, 0.115), (0.031, 0.026, 0.030), mats["base"], 20, 14))
        parts.append(ellipsoid("ElephantNostril", (0.115, -0.311, 0.121), (0.010, 0.006, 0.007), mats["gray"], 12, 8))
        for side, sign in (("L", -1), ("R", 1)):
            parts.append(cone(f"Tusk_{side}", (sign * 0.070, -0.275, 0.175), 0.026, 0.085, mats["white"], (math.pi / 2, 0, sign * 0.25), 18))
    elif style == "rhino":
        for side, sign in (("L", -1), ("R", 1)):
            parts.extend(animal_ear(side, sign * 0.18, 0.46, mats["base"], mats["pink"], 0.75, -sign * 0.18))
            parts.extend(button_eye(side, sign * 0.088, 0.350, mats, 0.86))
        snout = ellipsoid("RhinoSnout", (0, -0.245, 0.235), (0.115, 0.045, 0.078), mats["base"], 24, 16)
        horn = cone("RhinoHorn", (0, -0.285, 0.335), 0.065, 0.18, mats["cream"], (math.pi / 2, 0, 0), 24)
        parts.extend((snout, horn))
    elif style == "giraffe":
        for side, sign in (("L", -1), ("R", 1)):
            parts.extend(animal_ear(side, sign * 0.20, 0.42, mats["base"], mats["cream"], 0.70, -sign * 0.70))
            stalk = curve_mesh(f"Ossicone_{side}", [(sign * 0.09, 0.02, 0.45), (sign * 0.09, 0.02, 0.55)], 0.025, mats["brown"], 1)
            knob = ellipsoid(f"OssiconeKnob_{side}", (sign * 0.09, 0.02, 0.575), (0.042, 0.040, 0.042), mats["brown"], 20, 14)
            parts.extend((stalk, knob))
            parts.extend(button_eye(side, sign * 0.088, 0.345, mats, 0.90))
        muzzle = ellipsoid("GiraffeMuzzle", (0, -0.245, 0.230), (0.115, 0.042, 0.076), mats["cream"], 24, 16)
        parts.append(muzzle)
        for index, (x, z, sx, sz) in enumerate(((-0.13, 0.39, .055, .040), (.13, .43, .050, .035), (-.06, .50, .045, .032), (.02, .365, .040, .030))):
            parts.append(ellipsoid(f"GiraffeSpot_{index}", (x, -0.220, z), (sx, 0.014, sz), mats["brown"], 18, 12))
    elif style == "panda":
        for side, sign in (("L", -1), ("R", 1)):
            parts.append(ellipsoid(f"PandaEar_{side}", (sign * 0.19, 0.02, 0.475), (0.075, 0.060, 0.075), mats["black"], 24, 16))
            patch = ellipsoid(f"PandaPatch_{side}", (sign * 0.087, -0.220, 0.340), (0.069, 0.024, 0.088), mats["black"], 22, 14)
            parts.append(patch)
            parts.extend(button_eye(side, sign * 0.087, 0.350, mats, 0.82))
        muzzle = ellipsoid("PandaMuzzle", (0, -0.245, 0.245), (0.095, 0.038, 0.065), mats["white"], 24, 15)
        nose = ellipsoid("PandaNose", (0, -0.283, 0.265), (0.037, 0.022, 0.026), mats["black"], 18, 12)
        parts.extend((muzzle, nose))
    elif style == "frog":
        for side, sign in (("L", -1), ("R", 1)):
            stalk = ellipsoid(f"FrogEyeBase_{side}", (sign * 0.13, 0.0, 0.485), (0.080, 0.070, 0.090), mats["base"], 24, 16)
            parts.append(stalk)
            parts.extend(animal_eye(side, sign * 0.13, 0.500, mats, 1.05))
        lip = hair_lock("FrogLip", [(-0.17, -0.225, 0.195), (0, -0.255, 0.160), (0.17, -0.225, 0.195)], 0.024, mats["cream"])
        parts.append(lip)
        for sign in (-1, 1):
            parts.append(ellipsoid(f"FrogNostril_{sign}", (sign * 0.045, -0.235, 0.285), (0.010, 0.006, 0.008), mats["black"], 12, 8))
    elif style == "cow":
        for side, sign in (("L", -1), ("R", 1)):
            parts.extend(animal_ear(side, sign * 0.21, 0.40, mats["base"], mats["pink"], 0.64, -sign * 0.78))
            parts.append(cone(f"CowHorn_{side}", (sign * 0.145, 0.02, 0.49), 0.043, 0.13, mats["cream"], (0, 0, -sign * 0.42), 20))
            parts.extend(button_eye(side, sign * 0.090, 0.350, mats, 0.86))
        snout = ellipsoid("CowSnout", (0, -0.248, 0.230), (0.120, 0.044, 0.077), mats["pink"], 26, 16)
        parts.append(snout)
        for side, sign in (("L", -1), ("R", 1)):
            parts.append(ellipsoid(f"CowNostril_{side}", (sign * 0.045, -0.290, 0.235), (0.014, 0.008, 0.011), mats["brown"], 14, 10))
        for index, (x, z, sx, sz) in enumerate(((-0.12, .42, .075, .055), (.12, .46, .060, .045), (-.16, .28, .050, .040))):
            parts.append(ellipsoid(f"CowSpot_{index}", (x, -0.218, z), (sx, 0.014, sz), mats["black"], 18, 12))
    elif style == "rabbit":
        for side, sign in (("L", -1), ("R", 1)):
            ear = ellipsoid(f"RabbitEar_{side}", (sign * 0.105, 0.015, 0.585), (0.070, 0.052, 0.185), mats["base"], 28, 18)
            inner = ellipsoid(f"RabbitEarInner_{side}", (sign * 0.105, -0.040, 0.590), (0.036, 0.018, 0.130), mats["pink"], 24, 16)
            parts.extend((ear, inner))
            parts.extend(button_eye(side, sign * 0.088, 0.345, mats, 0.88))
        for side, sign in (("L", -1), ("R", 1)):
            parts.append(ellipsoid(f"RabbitMuzzle_{side}", (sign * 0.045, -0.245, 0.235), (0.061, 0.035, 0.052), mats["white"], 22, 14))
        parts.append(ellipsoid("RabbitNose", (0, -0.284, 0.270), (0.030, 0.020, 0.023), mats["pink"], 18, 12))
        for side, sign in (("L", -1), ("R", 1)):
            for index, z in enumerate((0.245, 0.225, 0.205)):
                parts.append(hair_lock(f"Whisker_{side}_{index}", [(sign * 0.055, -0.266, z), (sign * 0.175, -0.274, z + (index - 1) * 0.012)], 0.0035, mats["gray"],))
    elif style == "capybara":
        for side, sign in (("L", -1), ("R", 1)):
            ear = torus(f"CapybaraEar_{side}", (sign * 0.19, 0.0, 0.455), 0.045, 0.018, mats["brown"], (math.pi / 2, 0, 0))
            parts.append(ear)
            parts.extend(button_eye(side, sign * 0.095, 0.350, mats, 0.88))
        muzzle = ellipsoid("CapybaraMuzzle", (0, -0.246, 0.230), (0.105, 0.042, 0.078), mats["brown"], 24, 16)
        nose = ellipsoid("CapybaraNose", (0, -0.288, 0.260), (0.042, 0.023, 0.030), mats["black"], 18, 12)
        parts.extend((muzzle, nose))
    return parts


def build_all_hat_assets() -> None:
    for style in HAT_STYLES:
        clean_scene()
        parts = create_hat_asset(style)
        join_meshes(parts, f"Hat_{style}")
        output = OUTPUT_ROOT / "hats" / f"{style}.glb"
        export_static_asset(output, f"hat:{style}", "GORROS.png")
        print(f"BUILT hat {style}: {output.relative_to(PROJECT_ROOT)}")


def parse_only() -> set[str] | None:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not args:
        return None
    result: set[str] = set()
    for arg in args:
        if arg.startswith("--only="):
            result.update(filter(None, arg.split("=", 1)[1].split(",")))
    return result or None


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    SOURCE_ROOT.mkdir(parents=True, exist_ok=True)
    only = parse_only()
    for profile in CHARACTERS:
        if only and profile.id not in only and "characters" not in only:
            continue
        output = build_character(profile)
        print(f"BUILT {profile.id}: {output.relative_to(PROJECT_ROOT)}")
    if only and any(profile.id in only for profile in CHARACTERS):
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_ROOT / "market_character_pipeline.blend"), compress=True)
        print("DONE market character pipeline")
        return
    if not only or "hair" in only or "accessories" in only:
        build_all_hair_assets()
    if not only or "hats" in only or "accessories" in only:
        build_all_hat_assets()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_ROOT / "market_character_pipeline.blend"), compress=True)
    print("DONE market character pipeline")


if __name__ == "__main__":
    main()

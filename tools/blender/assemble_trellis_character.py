"""Bind a SkinTokens character to the game's stable bone and action contract."""

from __future__ import annotations

import colorsys
import math
import statistics
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


RENAME = {
    "bone_0": "Hips",
    "bone_1": "Spine",
    "bone_2": "SpineUpper",
    "bone_3": "Chest",
    "bone_4": "Neck",
    "bone_5": "Head",
    "bone_6": "Shoulder_R",
    "bone_7": "Rig_Arm_R",
    "bone_8": "Forearm_R",
    "bone_9": "Hand_R",
    "bone_25": "Shoulder_L",
    "bone_26": "Rig_Arm_L",
    "bone_27": "Forearm_L",
    "bone_28": "Hand_L",
    "bone_44": "Rig_Leg_R",
    "bone_45": "Shin_R",
    "bone_46": "Foot_R",
    "bone_47": "Toe_R",
    "bone_48": "Rig_Leg_L",
    "bone_49": "Shin_L",
    "bone_50": "Foot_L",
    "bone_51": "Toe_L",
}

# Skin-only runs conditioned on the game's authored 20-bone guide keep a
# deterministic depth-first ordering. This route is used when unconstrained
# skeleton prediction chooses a non-human topology for a stylised body.
GUIDED_RENAME = {
    "bone_0": "Root",
    "bone_1": "Hips",
    "bone_2": "Rig_Leg_L",
    "bone_3": "Shin_L",
    "bone_4": "Foot_L",
    "bone_5": "Toe_L",
    "bone_6": "Rig_Leg_R",
    "bone_7": "Shin_R",
    "bone_8": "Foot_R",
    "bone_9": "Toe_R",
    "bone_10": "Spine",
    "bone_11": "Chest",
    "bone_12": "Neck",
    "bone_13": "Head",
    "bone_14": "Rig_Arm_L",
    "bone_15": "Forearm_L",
    "bone_16": "Hand_L",
    "bone_17": "Rig_Arm_R",
    "bone_18": "Forearm_R",
    "bone_19": "Hand_R",
}

RETARGET_BONES = (
    "Root",
    "Hips",
    "Spine",
    "Chest",
    "Neck",
    "Head",
    "Rig_Arm_L",
    "Forearm_L",
    "Hand_L",
    "Rig_Arm_R",
    "Forearm_R",
    "Hand_R",
    "Rig_Leg_L",
    "Shin_L",
    "Foot_L",
    "Rig_Leg_R",
    "Shin_R",
    "Foot_R",
)

QUATERNIUS_BONE_MAP = {
    "Root": "root",
    "Hips": "DEF-hips",
    "Spine": "DEF-spine.001",
    "SpineUpper": "DEF-spine.002",
    "Chest": "DEF-spine.003",
    "Neck": "DEF-neck",
    "Head": "DEF-head",
    "Rig_Arm_L": "DEF-upper_arm.R",
    "Forearm_L": "DEF-forearm.R",
    "Hand_L": "DEF-hand.R",
    "Rig_Arm_R": "DEF-upper_arm.L",
    "Forearm_R": "DEF-forearm.L",
    "Hand_R": "DEF-hand.L",
    "Rig_Leg_L": "DEF-thigh.R",
    "Shin_L": "DEF-shin.R",
    "Foot_L": "DEF-foot.R",
    "Rig_Leg_R": "DEF-thigh.L",
    "Shin_R": "DEF-shin.L",
    "Foot_R": "DEF-foot.L",
}

LOCOMOTION_ACTIONS = {
    "Idle": "Idle_Loop",
    "Walk": "Walk_Loop",
    "Run": "Jog_Fwd_Loop",
    "CarryIdle": "Idle_Loop",
    "CarryWalk": "Walk_Formal_Loop",
    "Enter": "Walk_Loop",
    "Exit": "Walk_Loop",
    "CarryBasket": "Walk_Formal_Loop",
}


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def remove_floor_reconstruction_artifact(mesh_object: bpy.types.Object) -> int:
    """Remove a generated view-plane below the feet before normalization.

    Some one-view reconstructions retain their square support/background as a
    nearly zero-thickness mesh.  If it reaches rigging, it becomes a skinned
    sheet through the visitor's knees and also shifts the computed ground.
    Real shoe soles are smaller and contain far fewer faces, so require both a
    broad footprint and a substantial face count before deleting anything.
    """

    mesh = mesh_object.data
    minimum_z = min(vertex.co.z for vertex in mesh.vertices)
    maximum_z = max(vertex.co.z for vertex in mesh.vertices)
    height = maximum_z - minimum_z
    band_size = max(0.0001, height * 0.005)
    flat_bands: dict[int, list[bpy.types.MeshPolygon]] = {}
    for polygon in mesh.polygons:
        z_values = [mesh.vertices[index].co.z for index in polygon.vertices]
        if max(z_values) - min(z_values) > height * 0.003:
            continue
        center_z = sum(z_values) / len(z_values)
        flat_bands.setdefault(round(center_z / band_size), []).append(polygon)

    candidates: list[bpy.types.MeshPolygon] = []
    for band in sorted(flat_bands.values(), key=len, reverse=True):
        if len(band) < 200:
            continue
        candidate_vertices = {index for polygon in band for index in polygon.vertices}
        points = [mesh.vertices[index].co for index in candidate_vertices]
        width = max(point.x for point in points) - min(point.x for point in points)
        depth = max(point.y for point in points) - min(point.y for point in points)
        if max(width, depth) >= height * 0.55:
            candidates.extend(band)
    if not candidates:
        return 0
    candidate_indices = {polygon.index for polygon in candidates}
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(
        bm,
        geom=[face for face in bm.faces if face.index in candidate_indices],
        context="FACES",
    )
    loose = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return len(candidates)


def reset_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)


def stabilize_foot_weights(
    armature: bpy.types.Object,
    character_meshes: list[bpy.types.Object],
) -> None:
    """Make each stylised shoe a rigid foot volume below the ankle blend.

    Automatic skinning is intentionally soft around organic joints, but that
    smears the thick kit shoes across shin/foot/toe bones during heel strike.
    The shoe itself should remain rigid; only the narrow ankle band bends.
    """

    ankle_height = max(
        armature.data.bones["Foot_L"].head_local.z,
        armature.data.bones["Foot_R"].head_local.z,
    )
    # Keep the cutoff below the ankle joint.  Extending the rigid assignment
    # above it catches alternating vertices along trouser hems on reconstructed
    # one-piece meshes; adjacent vertices then follow different bones and open
    # into long triangular sheets during a stride.
    rigid_limit = ankle_height - 0.015
    for mesh in character_meshes:
        groups = {
            side: mesh.vertex_groups.get(f"Foot_{side}")
            or mesh.vertex_groups.new(name=f"Foot_{side}")
            for side in ("L", "R")
        }
        rigid_side: dict[int, str] = {}
        for vertex in mesh.data.vertices:
            if vertex.co.z > rigid_limit:
                continue
            side = "R" if vertex.co.x >= 0.0 else "L"
            for membership in list(vertex.groups):
                mesh.vertex_groups[membership.group].remove([vertex.index])
            groups[side].add([vertex.index], 1.0, "REPLACE")
            rigid_side[vertex.index] = side

        # Single-view reconstruction can fuse the two soles with a thin web
        # where the feet nearly touch in the neutral pose.  Assigning that web
        # by x-sign makes neighboring vertices follow opposite feet and turns
        # it into a large triangular sheet during a stride.  Those mixed-side
        # polygons are not anatomy or clothing, so split the shoes at the seam.
        def dominant_limb(vertex: bpy.types.MeshVertex) -> str | None:
            if not vertex.groups:
                return None
            membership = max(vertex.groups, key=lambda item: item.weight)
            name = mesh.vertex_groups[membership.group].name
            for family, names in {
                "arm_l": {"Rig_Arm_L", "Forearm_L", "Hand_L"},
                "arm_r": {"Rig_Arm_R", "Forearm_R", "Hand_R"},
                "leg_l": {"Rig_Leg_L", "Shin_L", "Foot_L", "Toe_L"},
                "leg_r": {"Rig_Leg_R", "Shin_R", "Foot_R", "Toe_R"},
            }.items():
                if name in names:
                    return family
            return None

        bridge_faces: set[int] = set()
        hip_height = armature.data.bones["Hips"].head_local.z
        for polygon in mesh.data.polygons:
            rigid_sides = {
                rigid_side[index]
                for index in polygon.vertices
                if index in rigid_side
            }
            families = {
                family
                for index in polygon.vertices
                if (family := dominant_limb(mesh.data.vertices[index])) is not None
            }
            center_z = sum(mesh.data.vertices[index].co.z for index in polygon.vertices) / len(polygon.vertices)
            fused_feet = rigid_sides == {"L", "R"}
            fused_lower_legs = (
                {"leg_l", "leg_r"}.issubset(families)
                and center_z < ankle_height + 0.15
            )
            fused_hand_to_leg = (
                (
                    {"arm_l", "leg_l"}.issubset(families)
                    or {"arm_r", "leg_r"}.issubset(families)
                )
                and center_z < hip_height + 0.04
            )
            if fused_feet or fused_lower_legs or fused_hand_to_leg:
                bridge_faces.add(polygon.index)
        if bridge_faces:
            bm = bmesh.new()
            bm.from_mesh(mesh.data)
            bm.faces.ensure_lookup_table()
            bmesh.ops.delete(
                bm,
                geom=[bm.faces[index] for index in sorted(bridge_faces)],
                context="FACES",
            )
            bm.to_mesh(mesh.data)
            bm.free()
            mesh.data.update()
            mesh["removedFusedLimbFaces"] = len(bridge_faces)
            print(f"FUSED_LIMB_REMOVAL {mesh.name}: faces={len(bridge_faces)}")


def add_closed_footwear_soles(
    armature: bpy.types.Object,
    character_meshes: list[bpy.types.Object],
    character_height: float,
) -> list[bpy.types.Object]:
    """Add a thin, closed outsole after reconstruction cleanup.

    Single-view character reconstruction occasionally fuses a shoe to its
    support plane. Removing that plane is correct, but it can leave the lowest
    shoe ring open. A separate rigid outsole closes the silhouette without
    changing the reconstructed upper, UV atlas, morphs or ankle deformation.
    Its dimensions come from the actual Foot-weighted vertices, so adults,
    children and every shoe shape use the same deterministic repair.
    """

    ratio = character_height / 1.803
    material = bpy.data.materials.new("PremiumClosedSole")
    material.use_nodes = True
    material.use_backface_culling = False
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.010, 0.012, 0.014, 1.0)
    principled.inputs["Roughness"].default_value = 0.38
    if "Coat Weight" in principled.inputs:
        principled.inputs["Coat Weight"].default_value = 0.16
        principled.inputs["Coat Roughness"].default_value = 0.52

    soles: list[bpy.types.Object] = []
    for side in ("L", "R"):
        group_name = f"Foot_{side}"
        points: list[Vector] = []
        for mesh_object in character_meshes:
            group = mesh_object.vertex_groups.get(group_name)
            if group is None:
                continue
            for vertex in mesh_object.data.vertices:
                weight = next(
                    (
                        membership.weight
                        for membership in vertex.groups
                        if membership.group == group.index
                    ),
                    0.0,
                )
                if weight >= 0.55:
                    points.append(vertex.co.copy())
        if not points:
            raise RuntimeError(f"Cannot derive outsole bounds for {group_name}")

        minimum_x, maximum_x = min(point.x for point in points), max(point.x for point in points)
        minimum_y, maximum_y = min(point.y for point in points), max(point.y for point in points)
        minimum_z = min(point.z for point in points)
        width = max(0.105 * ratio, min(0.205 * ratio, (maximum_x - minimum_x) * 0.86))
        length = max(0.19 * ratio, min(0.36 * ratio, (maximum_y - minimum_y) * 0.88))
        thickness = 0.032 * ratio
        center = (
            (minimum_x + maximum_x) * 0.5,
            (minimum_y + maximum_y) * 0.5,
            minimum_z + thickness * 0.42,
        )

        bpy.ops.mesh.primitive_cube_add(location=center)
        sole = bpy.context.object
        sole.name = f"PremiumClosedSole_{side}"
        sole.scale = (width * 0.5, length * 0.5, thickness * 0.5)
        sole.data.materials.append(material)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bevel = sole.modifiers.new("SoftOutsoleEdge", "BEVEL")
        bevel.width = min(width, thickness) * 0.34
        bevel.segments = 3
        bpy.context.view_layer.objects.active = sole
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        for polygon in sole.data.polygons:
            polygon.use_smooth = True

        sole.parent = armature
        modifier = sole.modifiers.new("FootRig", "ARMATURE")
        modifier.object = armature
        group = sole.vertex_groups.new(name=group_name)
        group.add([vertex.index for vertex in sole.data.vertices], 1.0, "REPLACE")
        sole["closedReconstructionSole"] = True
        soles.append(sole)
    return soles


def remove_integrated_scalp_hair(
    character_meshes: list[bpy.types.Object],
    character_height: float,
) -> None:
    """Remove the reconstructed scalp hair using height-relative anatomy.

    The source cast contains adults and children, so world-space thresholds
    tuned to one adult leave stray locks on small bodies and can cut into a
    child's face.  These ratios describe the same scalp envelope at every
    normalized character height while preserving eyebrows, ears and beards.
    """

    height_ratio = character_height / 1.803
    crown_limit = 1.64 * height_ratio
    rear_scalp_limit = 1.52 * height_ratio
    side_scalp_limit = 1.55 * height_ratio
    face_depth_limit = -0.10 * height_ratio
    side_limit = 0.10 * height_ratio

    for mesh_object in character_meshes:
        mesh = mesh_object.data
        hair_faces: set[int] = set()
        for polygon in mesh.polygons:
            points = [mesh.vertices[index].co for index in polygon.vertices]
            x = sum(point.x for point in points) / len(points)
            y = sum(point.y for point in points) / len(points)
            z = sum(point.z for point in points) / len(points)
            in_scalp = (
                z > crown_limit
                or (z > rear_scalp_limit and y > face_depth_limit)
                or (z > side_scalp_limit and abs(x) > side_limit)
            )
            if in_scalp:
                hair_faces.add(polygon.index)

        if not hair_faces:
            raise RuntimeError(f"Could not identify integrated scalp hair in {mesh_object.name}")
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(
            bm,
            geom=[face for face in bm.faces if face.index in hair_faces],
            context="FACES",
        )
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        mesh_object["integratedScalpHairRemoved"] = True


def remove_textured_head_hair(
    character_meshes: list[bpy.types.Object],
    armature: bpy.types.Object,
    character_height: float,
) -> int:
    """Remove the complete PNG-authored hairstyle by texture connectivity.

    A height envelope alone cannot remove low bangs, ponytails or pigtails
    without also cutting ears and eyebrows.  The production characters carry
    a baked UV texture, so classify hair-coloured faces against palettes
    sampled from the crown and central face, then retain only candidate
    components connected to the crown (or substantial side locks).  Small
    isolated dark components such as eyes and eyebrows are preserved.
    """

    def linear_to_srgb(channel: float) -> float:
        return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1.0 / 2.4) - 0.055

    def palette_distance(
        color: tuple[float, float, float],
        palette: list[tuple[float, float, float]],
    ) -> float:
        return min(
            sum((value - sample[index]) ** 2 for index, value in enumerate(color))
            for sample in palette
        )

    ratio = character_height / 1.803
    head = armature.data.bones["Head"].head_local
    removed = 0
    for mesh_object in character_meshes:
        mesh = mesh_object.data
        uv_layer = mesh.uv_layers.active
        material = next((item for item in mesh.materials if item and item.use_nodes), None)
        if uv_layer is None or material is None or material.node_tree is None:
            continue
        image = next(
            (node.image for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image),
            None,
        )
        if image is None:
            continue
        width, height = image.size
        pixels = list(image.pixels[:])

        def loop_color(loop_index: int) -> tuple[float, float, float]:
            uv = uv_layer.data[loop_index].uv
            x = min(width - 1, max(0, round((uv.x % 1.0) * (width - 1))))
            y = min(height - 1, max(0, round((uv.y % 1.0) * (height - 1))))
            offset = (y * width + x) * 4
            return tuple(linear_to_srgb(pixels[offset + index]) for index in range(3))

        crown_palette: list[tuple[float, float, float]] = []
        skin_palette: list[tuple[float, float, float]] = []
        for polygon in mesh.polygons:
            points = [mesh.vertices[index].co for index in polygon.vertices]
            point = sum(points, points[0] * 0.0) / len(points)
            destination = None
            if point.z > head.z + 0.34 * ratio:
                destination = crown_palette
            elif (
                abs(point.x - head.x) < 0.105 * ratio
                and point.y < head.y - 0.070 * ratio
                and head.z + 0.10 * ratio < point.z < head.z + 0.27 * ratio
            ):
                destination = skin_palette
            if destination is not None:
                destination.extend(loop_color(index) for index in polygon.loop_indices)
        if not crown_palette or not skin_palette:
            raise RuntimeError(f"Could not derive hair/skin palettes for {mesh_object.name}")
        crown_palette = crown_palette[:: max(1, len(crown_palette) // 192)][:192]
        skin_palette = skin_palette[:: max(1, len(skin_palette) // 192)][:192]

        candidates: set[int] = set()
        polygon_centers: dict[int, Vector] = {}
        for polygon in mesh.polygons:
            points = [mesh.vertices[index].co for index in polygon.vertices]
            point = sum(points, points[0] * 0.0) / len(points)
            polygon_centers[polygon.index] = point
            # Long sideburns and the lower edge of a bob can sit below the
            # centre of the head.  Start the colour pass at the upper neck so
            # none of that authored hairstyle survives under a replacement.
            if point.z < head.z - 0.165 * ratio:
                continue
            # Keep the facial feature band even though brows/eyes share the
            # hairstyle's dark palette. The actual fringe is connected to the
            # crown and begins above this anatomical band.
            if (
                abs(point.x - head.x) < 0.125 * ratio
                and point.y < head.y - 0.060 * ratio
                and point.z < head.z + 0.235 * ratio
            ):
                continue
            votes = 0
            for loop_index in polygon.loop_indices:
                color = loop_color(loop_index)
                _, saturation, value = colorsys.rgb_to_hsv(*color)
                hair_distance = palette_distance(color, crown_palette)
                skin_distance = palette_distance(color, skin_palette)
                if (
                    hair_distance < skin_distance * 0.94
                    and saturation > 0.10
                    and value < 0.91
                ):
                    votes += 1
            if votes >= max(1, (len(polygon.loop_indices) + 1) // 2):
                candidates.add(polygon.index)

        vertex_candidates: dict[int, list[int]] = {}
        for polygon_index in candidates:
            for vertex_index in mesh.polygons[polygon_index].vertices:
                vertex_candidates.setdefault(vertex_index, []).append(polygon_index)
        unseen = set(candidates)
        selected: set[int] = set()
        while unseen:
            seed = unseen.pop()
            component = {seed}
            frontier = [seed]
            while frontier:
                polygon_index = frontier.pop()
                for vertex_index in mesh.polygons[polygon_index].vertices:
                    for neighbor in vertex_candidates.get(vertex_index, []):
                        if neighbor in unseen:
                            unseen.remove(neighbor)
                            component.add(neighbor)
                            frontier.append(neighbor)
            centers = [polygon_centers[index] for index in component]
            touches_crown = max(point.z for point in centers) > head.z + 0.335 * ratio
            substantial_side_lock = (
                len(component) >= 180
                and max(abs(point.x - head.x) for point in centers) > 0.105 * ratio
            )
            if touches_crown or substantial_side_lock:
                selected.update(component)

        # Any remaining texture-classified island lies inside the anatomical
        # head envelope, while the facial feature band above was explicitly
        # protected. Include these small flyaways and rear wisps as well so a
        # replacement style never reveals fragments of the authored haircut.
        selected.update(candidates)

        if not selected:
            raise RuntimeError(f"Texture segmentation found no connected hairstyle on {mesh_object.name}")
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(
            bm,
            geom=[face for face in bm.faces if face.index in selected],
            context="FACES",
        )
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        mesh_object["integratedScalpHairRemoved"] = True
        mesh_object["hairRemovalMethod"] = "texture-connected-components-v2"
        removed += len(selected)
    print(f"HAIR_REMOVAL faces={removed}")
    return removed


def add_anatomical_scalp(
    armature: bpy.types.Object,
    character_height: float,
    scalp_color: tuple[float, float, float, float],
) -> bpy.types.Object:
    """Create a clean skinned scalp beneath interchangeable hair and hats.

    Image-to-3D reconstruction represents hair and cranium as one outer
    surface.  Removing the authored hairstyle therefore opens the head.  A
    smooth, slightly inset anatomical cap restores that missing surface and
    gives tight hairstyles a clean skin-coloured base without touching the
    reconstructed face.
    """

    ratio = character_height / 1.803
    head_bone = armature.data.bones["Head"]
    center = Vector(
        (
            head_bone.head_local.x,
            head_bone.head_local.y - 0.070 * ratio,
            head_bone.head_local.z + 0.198 * ratio,
        )
    )
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=center)
    scalp = bpy.context.object
    scalp.name = "AnatomicalScalp"
    scalp.data.name = "AnatomicalScalp"
    scalp.scale = (0.169 * ratio, 0.181 * ratio, 0.216 * ratio)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bm = bmesh.new()
    bm.from_mesh(scalp.data)
    bm.faces.ensure_lookup_table()
    discarded = []
    for face in bm.faces:
        point = face.calc_center_median()
        normalized_y = point.y / (0.181 * ratio)
        normalized_z = point.z / (0.216 * ratio)
        # Keep only a high crown at the front, a slightly deeper side cap and
        # the rear skull.  The progressively lowered hairline follows a real
        # cranium without ever crossing the reconstructed eyes or eyebrows.
        front_cut = normalized_y < -0.10 and normalized_z < 0.52
        side_cut = -0.10 <= normalized_y < 0.20 and normalized_z < 0.12
        rear_cut = normalized_y >= 0.20 and normalized_z < -0.42
        if front_cut or side_cut or rear_cut:
            discarded.append(face)
    bmesh.ops.delete(bm, geom=discarded, context="FACES")
    loose = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(scalp.data)
    bm.free()
    scalp.data.update()

    skin = bpy.data.materials.new("Scalp")
    skin.use_nodes = True
    principled = skin.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = scalp_color
    principled.inputs["Roughness"].default_value = 0.68
    scalp.data.materials.append(skin)
    for polygon in scalp.data.polygons:
        polygon.use_smooth = True

    scalp.parent = armature
    modifier = scalp.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    group = scalp.vertex_groups.new(name="Head")
    group.add([vertex.index for vertex in scalp.data.vertices], 1.0, "REPLACE")
    scalp["generatedAnatomicalScalp"] = True
    return scalp


def reconstructed_skin_color(
    character_meshes: list[bpy.types.Object],
    armature: bpy.types.Object,
    character_height: float,
) -> tuple[float, float, float, float]:
    """Sample the PNG-derived forehead/temple texture for a seamless scalp."""

    ratio = character_height / 1.803
    head = armature.data.bones["Head"].head_local
    samples: list[tuple[float, float, float]] = []
    for mesh_object in character_meshes:
        mesh = mesh_object.data
        uv_layer = mesh.uv_layers.active
        if uv_layer is None:
            continue
        material = next((item for item in mesh.materials if item and item.use_nodes), None)
        if material is None or material.node_tree is None:
            continue
        texture = next(
            (node.image for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image),
            None,
        )
        if texture is None:
            continue
        width, height = texture.size
        pixels = list(texture.pixels[:])
        for polygon in mesh.polygons:
            vertices = [mesh.vertices[index].co for index in polygon.vertices]
            point = sum(vertices, vertices[0] * 0.0) / len(vertices)
            horizontal = abs(point.x - head.x)
            # Sample the upper cheeks/temples rather than the centre of the
            # forehead.  The latter includes brows, irises and low fringes on
            # several kit characters and produced grey or hair-coloured lids.
            # This bilateral band stays on exposed skin for adult, child and
            # senior proportions while avoiding the authored lips and eyes.
            on_face = (
                0.060 * ratio < horizontal < 0.145 * ratio
                and point.y < head.y - 0.085 * ratio
                and head.z + 0.075 * ratio < point.z < head.z + 0.205 * ratio
            )
            if not on_face:
                continue
            for loop_index in polygon.loop_indices:
                uv = uv_layer.data[loop_index].uv
                x = min(width - 1, max(0, round((uv.x % 1.0) * (width - 1))))
                y = min(height - 1, max(0, round((uv.y % 1.0) * (height - 1))))
                offset = (y * width + x) * 4
                linear = tuple(pixels[offset + index] for index in range(3))
                srgb = tuple(
                    12.92 * value if value <= 0.0031308 else 1.055 * value ** (1.0 / 2.4) - 0.055
                    for value in linear
                )
                hue, saturation, brightness = colorsys.rgb_to_hsv(*srgb)
                if 0.015 <= hue <= 0.12 and 0.18 <= saturation <= 0.78 and brightness >= 0.28:
                    samples.append(linear)
    if not samples:
        print("SCALP_COLOR fallback: no qualifying face texture samples")
        return (0.52, 0.255, 0.16, 1.0)
    # `Image.pixels` is already scene-linear.  Keep that space for the
    # Principled material; applying the sRGB transfer function a second time
    # made pale faces unnaturally dark and neutral grey.
    color = tuple(statistics.median(sample[index] for sample in samples) for index in range(3)) + (1.0,)
    print(f"SCALP_COLOR samples={len(samples)} linear={color[:3]}")
    return color


def add_blink_overlay(
    armature: bpy.types.Object,
    face_mesh: bpy.types.Object,
    centers: dict[str, Vector],
    character_height: float,
    skin_color: tuple[float, float, float, float],
    fallback_landmarks: bool = False,
) -> bpy.types.Object:
    """Create hidden skin lids that move over the baked open-eye texture."""

    ratio = character_height / 1.803
    head = armature.data.bones["Head"].head_local
    vertices: list[tuple[float, float, float]] = []
    lid_alphas: list[float] = []
    faces: list[tuple[int, ...]] = []
    material_indices: list[int] = []
    targets: dict[str, dict[int, Vector]] = {"left": {}, "right": {}}
    segments = 24
    # The source face remains untouched during a blink.  This feathered lid
    # covers the full stylised eye for only a few animation frames, avoiding
    # the stretched UVs and eyebrow smearing caused by collapsing a textured
    # reconstructed face.
    # Wide zero-alpha rim softens the transition into the baked skin without
    # reducing the fully opaque core that conceals the eye.
    # A texture-derived iris tells us the eye really is one of the kit's
    # oversized variants.  When dark brown irises cannot be isolated safely,
    # use the narrower anatomical fallback instead of drawing an adult-sized
    # mask from brow to cheek.
    radius_x = (0.052 if fallback_landmarks else 0.078) * ratio
    radius_z_top = (0.025 if fallback_landmarks else 0.035) * ratio
    radius_z_bottom = (0.043 if fallback_landmarks else 0.075) * ratio
    surface_samples = [
        vertex.co.copy()
        for vertex in face_mesh.data.vertices
        if vertex.co.y < armature.data.bones["Head"].head_local.y
    ]

    def front_surface_y(x: float, z: float) -> float:
        """Return the reconstructed facial surface at an x/z landmark.

        A stylised head can vary by several centimetres in depth across one
        oversized eye.  Sampling the actual face keeps the lid visible without
        floating in front of the cheek in profile.
        """

        distances = [((point.x - x) ** 2 + (point.z - z) ** 2, point.y) for point in surface_samples]
        nearest_distance = min(distance for distance, _ in distances)
        # Use a small neighbourhood, not the single closest x/z vertex: the
        # cornea is deliberately convex and can sit in front of the denser
        # cheek topology even when its projected sample is a few millimetres
        # farther away.
        tolerance = (0.025 * ratio) ** 2
        return min(y for distance, y in distances if distance <= nearest_distance + tolerance)

    def positions(x: float, z: float, depth: float = 0.0) -> tuple[Vector, Vector]:
        surface_y = front_surface_y(x, z)
        target = Vector((x, surface_y - (0.004 + depth) * ratio, z))
        hidden = Vector((x, surface_y + 0.110 * ratio, z))
        return hidden, target

    for side in ("left", "right"):
        center = centers[side]
        # Texture votes cluster on the saturated outer iris rim.  The visual
        # eye centre is slightly nearer the nose; correcting that bias keeps
        # the closed lid over the pupil instead of leaving an inner blue arc.
        center_x = head.x + (center.x - head.x) * 0.80
        center_z = center.z - (0.010 if fallback_landmarks else 0.045) * ratio
        start = len(vertices)
        hidden, target = positions(center_x, center_z)
        vertices.append(tuple(hidden))
        lid_alphas.append(1.0)
        targets[side][start] = target

        ring_starts: list[int] = []
        for ring_scale, alpha in ((0.78, 1.0), (0.90, 0.42), (1.0, 0.0)):
            ring_starts.append(len(vertices))
            for index in range(segments):
                angle = math.tau * index / segments
                cosine = math.cos(angle)
                toward_nose = cosine * (-1.0 if center_x > head.x else 1.0) > 0.0
                horizontal_scale = 1.22 if toward_nose else 0.94
                x = center_x + cosine * radius_x * horizontal_scale * ring_scale
                sine = math.sin(angle)
                radius_z = radius_z_top if sine >= 0.0 else radius_z_bottom
                z = center_z + sine * radius_z * ring_scale
                vertex_index = len(vertices)
                hidden, target = positions(x, z)
                vertices.append(tuple(hidden))
                lid_alphas.append(alpha)
                targets[side][vertex_index] = target
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append((start, ring_starts[0] + index, ring_starts[0] + next_index))
            material_indices.append(0)
            for inner_start, outer_start in zip(ring_starts, ring_starts[1:]):
                faces.append(
                    (
                        inner_start + index,
                        outer_start + index,
                        outer_start + next_index,
                        inner_start + next_index,
                    )
                )
                material_indices.append(0)

        # A slim curved lash/crease keeps the closed eye readable.  It is part
        # of the same morph and is equally hidden in the neutral basis.
        lash_steps = 10
        lash_start = len(vertices)
        for index in range(lash_steps + 1):
            normalized_x = -0.82 + 1.64 * index / lash_steps
            x = center_x + normalized_x * 0.065 * ratio
            curve_z = center_z - 0.001 * ratio + (1.0 - normalized_x * normalized_x) * 0.005 * ratio
            for offset_z in (-0.0030 * ratio, 0.0030 * ratio):
                vertex_index = len(vertices)
                # Keep the crease above the most convex point of the lid; the
                # reconstructed cornea otherwise occludes half of this strip.
                hidden, target = positions(x, curve_z + offset_z, depth=0.004)
                vertices.append(tuple(hidden))
                lid_alphas.append(1.0)
                targets[side][vertex_index] = target
        for index in range(lash_steps):
            a = lash_start + index * 2
            b = a + 2
            faces.append((a, b, b + 1, a + 1))
            material_indices.append(1)

    mesh = bpy.data.meshes.new("FacialBlinkOverlay")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    lid_mask = mesh.color_attributes.new(name="LidMask", type="FLOAT_COLOR", domain="POINT")
    for entry, alpha in zip(lid_mask.data, lid_alphas, strict=True):
        entry.color = (
            skin_color[0] * 0.65,
            skin_color[1] * 0.55,
            skin_color[2] * 0.46,
            alpha,
        )
    overlay = bpy.data.objects.new("FacialBlinkOverlay", mesh)
    bpy.context.collection.objects.link(overlay)

    lid_material = bpy.data.materials.new("EyelidSkin")
    lid_material.use_nodes = True
    lid_node = lid_material.node_tree.nodes.get("Principled BSDF")
    # The source texture already contains soft eye-socket shading. A flat
    # material using the raw forehead sample reads too bright, so match that
    # local baked value while preserving each character's hue.
    lid_node.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    lid_node.inputs["Roughness"].default_value = 0.72
    # Dithered transparency has stable depth ordering where the two oversized
    # lids approach the nose.  Back-face culling prevents the far lid from
    # showing through the head at three-quarter/profile angles.
    lid_material.surface_render_method = "DITHERED"
    lid_material.use_backface_culling = True
    lid_mask_node = lid_material.node_tree.nodes.new("ShaderNodeVertexColor")
    lid_mask_node.layer_name = "LidMask"
    lid_material.node_tree.links.new(lid_mask_node.outputs["Color"], lid_node.inputs["Base Color"])
    lid_material.node_tree.links.new(lid_mask_node.outputs["Alpha"], lid_node.inputs["Alpha"])
    lash_material = bpy.data.materials.new("Eyelash")
    lash_material.use_nodes = True
    lash_node = lash_material.node_tree.nodes.get("Principled BSDF")
    lash_node.inputs["Base Color"].default_value = (0.012, 0.006, 0.004, 1.0)
    lash_node.inputs["Roughness"].default_value = 0.8
    lash_material.use_backface_culling = True
    mesh.materials.append(lid_material)
    mesh.materials.append(lash_material)
    for polygon, material_index in zip(mesh.polygons, material_indices, strict=True):
        polygon.material_index = material_index
        polygon.use_smooth = True

    overlay.shape_key_add(name="Basis", from_mix=False)
    blink_left = overlay.shape_key_add(name="Blink_L", from_mix=False)
    blink_right = overlay.shape_key_add(name="Blink_R", from_mix=False)
    blink_left.value = 0.0
    blink_right.value = 0.0
    for side, shape_key in (("left", blink_left), ("right", blink_right)):
        for vertex_index, target in targets[side].items():
            shape_key.data[vertex_index].co = target

    overlay.parent = armature
    modifier = overlay.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    group = overlay.vertex_groups.new(name="Head")
    group.add([vertex.index for vertex in mesh.vertices], 1.0, "REPLACE")
    overlay["facialOverlayContract"] = "market-blink-v1"
    return overlay


def add_mouth_overlay(
    armature: bpy.types.Object,
    face_mesh: bpy.types.Object,
    mouth_z: float,
    character_height: float,
) -> bpy.types.Object:
    """Create a surface-conforming mouth cavity for readable expressions.

    The PNG face remains the exact neutral basis.  All overlay vertices are
    collapsed to a zero-area point at rest and expand only through expression
    morphs, so smiles and open mouths gain real depth, teeth and tongue without
    smearing the baked facial texture.
    """

    ratio = character_height / 1.803
    head = armature.data.bones["Head"].head_local
    samples = [
        vertex.co.copy()
        for vertex in face_mesh.data.vertices
        if vertex.co.y < head.y and abs(vertex.co.x - head.x) < 0.18 * ratio
    ]

    def front_surface_y(x: float, z: float) -> float:
        distances = [((point.x - x) ** 2 + (point.z - z) ** 2, point.y) for point in samples]
        nearest = min(distance for distance, _ in distances)
        tolerance = (0.020 * ratio) ** 2
        return min(y for distance, y in distances if distance <= nearest + tolerance)

    center_x = head.x
    center_y = front_surface_y(center_x, mouth_z) - 0.0045 * ratio
    basis_point = Vector((center_x, center_y, mouth_z))
    segments = 28
    vertices = [tuple(basis_point) for _ in range(1 + segments + 8)]
    faces: list[tuple[int, ...]] = []
    material_indices: list[int] = []
    for index in range(segments):
        faces.append((0, 1 + index, 1 + (index + 1) % segments))
        material_indices.append(0)
    teeth_start = 1 + segments
    tongue_start = teeth_start + 4
    faces.append(tuple(range(teeth_start, teeth_start + 4)))
    material_indices.append(1)
    faces.append(tuple(range(tongue_start, tongue_start + 4)))
    material_indices.append(2)

    mesh = bpy.data.meshes.new("FacialMouthOverlay")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    overlay = bpy.data.objects.new("FacialMouthOverlay", mesh)
    bpy.context.collection.objects.link(overlay)

    colors = (
        ("MouthInterior", (0.075, 0.008, 0.006, 1.0), 0.68),
        ("Teeth", (0.88, 0.80, 0.65, 1.0), 0.52),
        ("Tongue", (0.50, 0.055, 0.065, 1.0), 0.76),
    )
    for name, color, roughness in colors:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        node = material.node_tree.nodes.get("Principled BSDF")
        node.inputs["Base Color"].default_value = color
        node.inputs["Roughness"].default_value = roughness
        if name == "MouthInterior":
            node.inputs["Emission Color"].default_value = color
            node.inputs["Emission Strength"].default_value = 0.22
            if "Specular IOR Level" in node.inputs:
                node.inputs["Specular IOR Level"].default_value = 0.0
        material.use_backface_culling = True
        mesh.materials.append(material)
    for polygon, material_index in zip(mesh.polygons, material_indices, strict=True):
        polygon.material_index = material_index
        polygon.use_smooth = True

    overlay.shape_key_add(name="Basis", from_mix=False)

    def expression_key(
        name: str,
        width: float,
        height: float,
        *,
        center_drop: float = 0.0,
        corner_lift: float = 0.0,
        asymmetry: float = 0.0,
        show_teeth: bool = False,
        show_tongue: bool = False,
    ) -> None:
        key = overlay.shape_key_add(name=name, from_mix=False)
        key.value = 0.0
        center_z = mouth_z + center_drop * ratio
        expression_y = front_surface_y(center_x, center_z) - 0.0065 * ratio
        key.data[0].co = Vector((center_x, expression_y, center_z))
        for index in range(segments):
            angle = math.tau * index / segments
            normalized_x = math.cos(angle)
            x = center_x + normalized_x * width * ratio
            z = (
                center_z
                + math.sin(angle) * height * ratio
                + corner_lift * ratio * normalized_x * normalized_x
                + asymmetry * ratio * normalized_x
            )
            key.data[1 + index].co = Vector((x, expression_y, z))

        # Vertex order traces each quad around its perimeter.  Both are
        # slightly in front of the cavity, but remain zero-area in Basis.
        teeth_coords = (
            (-0.58, 0.10),
            (0.58, 0.10),
            (0.48, 0.56),
            (-0.48, 0.56),
        )
        tongue_coords = (
            (-0.52, -0.62),
            (0.52, -0.62),
            (0.44, -0.28),
            (-0.44, -0.28),
        )
        for start, coordinates, depth, visible in (
            (teeth_start, teeth_coords, 0.0100, show_teeth),
            (tongue_start, tongue_coords, 0.0095, show_tongue),
        ):
            if not visible:
                for index in range(4):
                    key.data[start + index].co = basis_point
                continue
            for index, (x_factor, z_factor) in enumerate(coordinates):
                x = center_x + x_factor * width * ratio
                z = center_z + z_factor * height * ratio + corner_lift * ratio * x_factor * x_factor
                y = expression_y - (depth - 0.0065) * ratio
                key.data[start + index].co = Vector((x, y, z))

    # Closed-mouth emotions keep the exact PNG lips and use the anatomical
    # morphs on the face itself.  The cavity exists only for genuinely open
    # states, avoiding a sticker-like second smile over the authored mouth.
    expression_key(
        "MouthOpen",
        0.066,
        0.038,
        center_drop=-0.004,
        show_teeth=True,
        show_tongue=True,
    )
    expression_key("JawOpen", 0.045, 0.025, center_drop=-0.008)
    expression_key("Surprise", 0.044, 0.038, center_drop=-0.005)

    overlay.parent = armature
    modifier = overlay.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    group = overlay.vertex_groups.new(name="Head")
    group.add([vertex.index for vertex in mesh.vertices], 1.0, "REPLACE")
    overlay["facialOverlayContract"] = "market-mouth-v1"
    return overlay


def add_facial_morphs(
    armature: bpy.types.Object,
    character_meshes: list[bpy.types.Object],
    character_height: float,
) -> list[bpy.types.Object]:
    """Author the runtime facial contract directly on the reconstructed face.

    The PNG texture and sculpt stay untouched in Basis. Expression keys use
    smooth, compact anatomical falloffs, so eyes, brows and mouth deform with
    the face instead of receiving floating decals.
    """

    ratio = character_height / 1.803
    head = armature.data.bones["Head"].head_local
    face_limit = head.y - 0.070 * ratio

    def falloff(value: float) -> float:
        value = max(0.0, min(1.0, value))
        return value * value * (3.0 - 2.0 * value)

    overlays: list[bpy.types.Object] = []
    for mesh_object in character_meshes:
        mesh = mesh_object.data
        if len(mesh.vertices) < 500 or mesh.uv_layers.active is None:
            continue
        # Locate the irises in the baked PNG-derived texture rather than
        # assuming adult anthropometric offsets.  Children in the kit have
        # deliberately oversized eyes and a much taller cranium; a fixed
        # offset deformed their nose while leaving the painted eyes open.
        iris_samples: dict[str, list[Vector]] = {"left": [], "right": []}
        material = next((item for item in mesh.materials if item and item.use_nodes), None)
        image = None
        if material and material.node_tree:
            image = next(
                (node.image for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image),
                None,
            )
        if image is not None:
            width, height = image.size
            pixels = list(image.pixels[:])

            def loop_rgb(loop_index: int) -> tuple[float, float, float]:
                uv = mesh.uv_layers.active.data[loop_index].uv
                x = min(width - 1, max(0, round((uv.x % 1.0) * (width - 1))))
                y = min(height - 1, max(0, round((uv.y % 1.0) * (height - 1))))
                offset = (y * width + x) * 4
                linear = tuple(pixels[offset + index] for index in range(3))
                return tuple(
                    12.92 * value if value <= 0.0031308 else 1.055 * value ** (1.0 / 2.4) - 0.055
                    for value in linear
                )

            for polygon in mesh.polygons:
                points = [mesh.vertices[index].co for index in polygon.vertices]
                point = sum(points, points[0] * 0.0) / len(points)
                if (
                    point.y >= head.y - 0.035 * ratio
                    or point.z < head.z + 0.17 * ratio
                    or point.z > head.z + 0.55 * ratio
                ):
                    continue
                blue_votes = 0
                for loop_index in polygon.loop_indices:
                    hue, saturation, brightness = colorsys.rgb_to_hsv(*loop_rgb(loop_index))
                    # The woman reference has teal/grey irises with softer
                    # saturation than the adult man and children.  Keep the
                    # blue/green hue gate, but admit those real low-saturation
                    # pixels so both eyelids are derived from the actual PNG
                    # landmark instead of a generic fallback.
                    if 0.40 <= hue <= 0.75 and saturation >= 0.12 and brightness >= 0.04:
                        blue_votes += 1
                if blue_votes:
                    iris_samples["left" if point.x < head.x else "right"].append(point)

        fallback_landmarks = not (iris_samples["left"] and iris_samples["right"])
        if not fallback_landmarks:
            left_x = statistics.median(point.x for point in iris_samples["left"])
            right_x = statistics.median(point.x for point in iris_samples["right"])
            eye_x = (abs(left_x - head.x) + abs(right_x - head.x)) * 0.5
            eye_z = statistics.median(
                point.z for side in iris_samples.values() for point in side
            )
            eye_centers = {
                side: Vector(
                    (
                        statistics.median(point.x for point in points),
                        statistics.median(point.y for point in points),
                        statistics.median(point.z for point in points),
                    )
                )
                for side, points in iris_samples.items()
            }
            print(
                f"FACE_LANDMARKS {mesh_object.name}: eye_x={eye_x:.5f} "
                f"eye_z={eye_z:.5f} samples={sum(map(len, iris_samples.values()))}"
            )
        else:
            eye_x = 0.065 * ratio
            eye_z = head.z + 0.245 * ratio
            eye_centers = {
                "left": Vector((-eye_x, head.y - 0.145 * ratio, eye_z)),
                "right": Vector((eye_x, head.y - 0.145 * ratio, eye_z)),
            }
            print(f"FACE_LANDMARKS fallback for {mesh_object.name}")
        brow_z = eye_z + 0.062 * ratio
        mouth_z = eye_z - 0.178 * ratio
        basis = mesh_object.shape_key_add(name="Basis", from_mix=False)

        def key(name: str) -> bpy.types.ShapeKey:
            result = mesh_object.shape_key_add(name=name, from_mix=False)
            # Blender 5/glTF can otherwise serialize a newly authored morph at
            # weight 1.0.  Every expression is opt-in at runtime; neutral must
            # be the exact reconstructed PNG face on first paint.
            result.value = 0.0
            return result

        blink_left = key("Blink_L")
        blink_right = key("Blink_R")
        eye_wide_left = key("EyeWide_L")
        eye_wide_right = key("EyeWide_R")
        brow_up_left = key("BrowUp_L")
        brow_up_right = key("BrowUp_R")
        brow_down_left = key("BrowDown_L")
        brow_down_right = key("BrowDown_R")
        smile = key("Smile")
        cheek_up = key("CheekUp")
        frown = key("Frown")
        jaw_open = key("JawOpen")
        mouth_open = key("MouthOpen")
        mouth_narrow = key("MouthNarrow")
        surprise = key("Surprise")
        confused = key("Confused")

        for vertex in mesh.vertices:
            source = basis.data[vertex.index].co
            if source.y >= face_limit:
                continue

            for side, center_x, blink_key, wide_key, up_key, down_key in (
                (-1.0, -eye_x, blink_left, eye_wide_left, brow_up_left, brow_down_left),
                (1.0, eye_x, blink_right, eye_wide_right, brow_up_right, brow_down_right),
            ):
                eye_distance = (
                    ((source.x - center_x) / (0.096 * ratio)) ** 2
                    + ((source.z - eye_z) / (0.055 * ratio)) ** 2
                )
                if eye_distance < 1.0:
                    weight = falloff(1.0 - eye_distance)
                    # Blink_L/R on the reconstructed face intentionally stays
                    # neutral.  The UV-baked iris cannot be collapsed without
                    # smearing; the surface-conforming lid overlay owns the
                    # blink while these names keep the shared runtime contract.
                    wide_key.data[vertex.index].co.z += (source.z - eye_z) * 0.32 * weight

                brow_distance = (
                    ((source.x - center_x) / (0.072 * ratio)) ** 2
                    + ((source.z - brow_z) / (0.038 * ratio)) ** 2
                )
                if brow_distance < 1.0:
                    weight = falloff(1.0 - brow_distance)
                    up_key.data[vertex.index].co.z += 0.024 * ratio * weight
                    down_key.data[vertex.index].co.z -= 0.020 * ratio * weight
                    if side < 0:
                        confused.data[vertex.index].co.z += 0.021 * ratio * weight
                    else:
                        confused.data[vertex.index].co.z -= 0.010 * ratio * weight

            mouth_distance = (
                (source.x / (0.105 * ratio)) ** 2
                + ((source.z - mouth_z) / (0.060 * ratio)) ** 2
            )
            if mouth_distance < 1.0:
                weight = falloff(1.0 - mouth_distance)
                corner = min(1.0, abs(source.x) / (0.105 * ratio))
                smile.data[vertex.index].co.z += 0.028 * ratio * corner * weight
                smile.data[vertex.index].co.x += 0.010 * ratio * (1.0 if source.x >= 0 else -1.0) * weight
                frown.data[vertex.index].co.z -= 0.022 * ratio * corner * weight
                mouth_narrow.data[vertex.index].co.x += -source.x * 0.18 * weight
                if source.z <= mouth_z:
                    jaw_open.data[vertex.index].co.z -= 0.040 * ratio * weight
                    mouth_open.data[vertex.index].co.z -= 0.030 * ratio * weight
                    surprise.data[vertex.index].co.z -= 0.034 * ratio * weight
                else:
                    mouth_open.data[vertex.index].co.z += 0.012 * ratio * weight
                    surprise.data[vertex.index].co.z += 0.015 * ratio * weight
                jaw_open.data[vertex.index].co.y -= 0.012 * ratio * weight

            for cheek_center in (-0.100 * ratio, 0.100 * ratio):
                cheek_distance = (
                    ((source.x - cheek_center) / (0.072 * ratio)) ** 2
                    + ((source.z - (mouth_z + 0.055 * ratio)) / (0.060 * ratio)) ** 2
                )
                if cheek_distance < 1.0:
                    cheek_up.data[vertex.index].co.z += 0.014 * ratio * falloff(1.0 - cheek_distance)

        mesh_object["facialMorphContract"] = "market-face-v2"
        skin_color = reconstructed_skin_color([mesh_object], armature, character_height)
        overlays.extend(
            (
                add_blink_overlay(
                    armature,
                    mesh_object,
                    eye_centers,
                    character_height,
                    skin_color,
                    fallback_landmarks,
                ),
                add_mouth_overlay(
                    armature,
                    mesh_object,
                    mouth_z,
                    character_height,
                ),
            )
        )
    return overlays


def ground_action(
    armature: bpy.types.Object,
    action: bpy.types.Action,
    character_meshes: list[bpy.types.Object],
) -> None:
    """Bake per-frame root height so at least one rigid shoe touches z=0."""

    animation = armature.animation_data_create()
    animation.action = action
    if action.slots:
        animation.action_slot = action.slots[0]
    foot_vertices: dict[bpy.types.Object, list[int]] = {}
    for mesh in character_meshes:
        group_indices = {
            group.index
            for name in ("Foot_L", "Foot_R")
            if (group := mesh.vertex_groups.get(name)) is not None
        }
        foot_vertices[mesh] = [
            vertex.index
            for vertex in mesh.data.vertices
            if any(
                membership.group in group_indices and membership.weight > 0.45
                for membership in vertex.groups
            )
        ]

    first = int(round(action.frame_range[0]))
    last = int(round(action.frame_range[1]))
    root = armature.pose.bones["Root"]
    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        minimum = float("inf")
        for source_mesh, indices in foot_vertices.items():
            evaluated = source_mesh.evaluated_get(depsgraph)
            evaluated_mesh = evaluated.to_mesh()
            try:
                for index in indices:
                    point = evaluated.matrix_world @ evaluated_mesh.vertices[index].co
                    minimum = min(minimum, point.z)
            finally:
                evaluated.to_mesh_clear()
        if minimum == float("inf"):
            raise RuntimeError("Could not find weighted shoe vertices for grounding")
        root_matrix = root.matrix.copy()
        root_matrix.translation.z -= minimum
        root.matrix = root_matrix
        bpy.context.view_layer.update()
        root.keyframe_insert(data_path="location", frame=frame, group="Root")
    animation.action = None


def bake_action(
    source: bpy.types.Object,
    target: bpy.types.Object,
    source_action: bpy.types.Action,
    output_name: str,
    bone_map: dict[str, str],
    prefix: str,
    reference_rotations: dict[str, object] | None = None,
) -> bpy.types.Action:
    """Bake each semantic bone's armature-space rotation onto the target rig.

    Copying Euler channels directly only works when both rigs have identical
    bone rolls.  SkinTokens predicts a sound anatomical rig but its local axes
    differ from the authored source; applying the armature-space rest delta
    preserves the actual knee, ankle, pelvis and shoulder motion.
    """

    missing_source = [name for name in bone_map.values() if source.pose.bones.get(name) is None]
    missing_target = [name for name in bone_map if target.pose.bones.get(name) is None]
    if missing_source or missing_target:
        raise KeyError(f"Retarget contract mismatch: source={missing_source}, target={missing_target}")

    source_animation = source.animation_data_create()
    target_animation = target.animation_data_create()
    source_animation.action = source_action
    if source_action.slots:
        source_animation.action_slot = source_action.slots[0]

    baked = bpy.data.actions.new(f"{prefix}{output_name}")
    baked.use_fake_user = True
    slot = baked.slots.new(id_type="OBJECT", name=target.name)
    target_animation.action = baked
    target_animation.action_slot = slot

    first = int(round(source_action.frame_range[0]))
    last = int(round(source_action.frame_range[1]))
    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        reset_pose(target)
        for target_name, source_name in bone_map.items():
            source_pose = source.pose.bones[source_name]
            target_pose = target.pose.bones[target_name]
            source_pose_rotation = source_pose.matrix.to_quaternion()
            if (
                reference_rotations is not None
                and target_name.startswith(("Rig_Arm_", "Forearm_", "Hand_"))
            ):
                armature_delta = source_pose_rotation @ reference_rotations[source_name].inverted()
            else:
                source_rest_rotation = source_pose.bone.matrix_local.to_quaternion()
                armature_delta = source_pose_rotation @ source_rest_rotation.inverted()
            target_rest_rotation = target_pose.bone.matrix_local.to_quaternion()
            desired_armature_rotation = armature_delta @ target_rest_rotation

            if target_pose.parent is None:
                basis_rotation = target_rest_rotation.inverted() @ desired_armature_rotation
            else:
                parent_rest = target_pose.parent.bone.matrix_local
                target_rest_relative = (
                    parent_rest.inverted_safe() @ target_pose.bone.matrix_local
                ).to_quaternion()
                desired_relative = (
                    target_pose.parent.matrix.to_quaternion().inverted()
                    @ desired_armature_rotation
                )
                basis_rotation = target_rest_relative.inverted() @ desired_relative
            target_pose.rotation_quaternion = basis_rotation.normalized()
            target_pose.location = source_pose.location
            target_pose.scale = (1.0, 1.0, 1.0)
            bpy.context.view_layer.update()
            target_pose.keyframe_insert(data_path="location", frame=frame, group=target_name)
            target_pose.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=target_name)
            target_pose.keyframe_insert(data_path="scale", frame=frame, group=target_name)
        bpy.context.view_layer.update()

    for layer in baked.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fcurve in bag.fcurves:
                    for point in fcurve.keyframe_points:
                        point.interpolation = "LINEAR"
    source_animation.action = None
    target_animation.action = None
    reset_pose(target)
    return baked


def retarget_actions(
    source: bpy.types.Object,
    target: bpy.types.Object,
    source_actions: list[bpy.types.Action],
) -> list[bpy.types.Action]:
    bone_map = {name: name for name in RETARGET_BONES}
    return [
        bake_action(source, target, action, action.name, bone_map, "__retarget__")
        for action in source_actions
    ]


def main() -> None:
    source = Path(option("animation-source"))
    rigged = Path(option("rigged"))
    output = Path(option("output"))
    locomotion_source = Path(option("locomotion-source")) if option("locomotion-source") else None
    height = float(option("height", "1.803"))
    replaceable_hair = option("replaceable-hair", "1") == "1"
    hair_prepared = option("hair-prepared", "0") == "1"
    guided_rig = option("guided-rig", "0") == "1"
    if not source.is_file() or not rigged.is_file():
        raise FileNotFoundError((source, rigged))

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    source_armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    source_objects = set(bpy.context.scene.objects)
    source_actions = list(bpy.data.actions)
    if not source_actions:
        raise RuntimeError(f"No animations found in {source}")

    bpy.ops.import_scene.gltf(filepath=str(rigged), import_pack_images=True)
    imported_objects = set(bpy.context.scene.objects) - source_objects
    armature = next(obj for obj in imported_objects if obj.type == "ARMATURE")
    meshes = [obj for obj in imported_objects if obj.type == "MESH"]
    # SkinTokens includes a tiny rig-debug icosphere in its export.  It is
    # armature-bound, but it is not part of the character and its unit bounds
    # would corrupt normalization, grounding, shadows and camera framing.
    character_meshes = [
        obj
        for obj in meshes
        if obj.find_armature() == armature
        and len(obj.data.vertices) > 500
        and any(material is not None for material in obj.data.materials)
    ]
    for helper in set(meshes) - set(character_meshes):
        bpy.data.objects.remove(helper, do_unlink=True)
    if not character_meshes:
        raise RuntimeError("SkinTokens output has no skinned character mesh")
    removed_floor_faces = sum(
        remove_floor_reconstruction_artifact(mesh)
        for mesh in character_meshes
    )
    if removed_floor_faces:
        print(f"Removed {removed_floor_faces} reconstruction floor faces")

    rename_contract = GUIDED_RENAME if guided_rig else RENAME
    for old_name, new_name in rename_contract.items():
        bone = armature.data.bones.get(old_name)
        if bone is None:
            raise KeyError(f"Missing predicted bone {old_name}")
        bone.name = new_name

    if not guided_rig:
        bpy.context.view_layer.objects.active = armature
        armature.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        hips = armature.data.edit_bones["Hips"]
        root = armature.data.edit_bones.new("Root")
        root.head = (0.0, 0.0, min(point.z for obj in character_meshes for point in [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]))
        root.tail = root.head + Vector((0.0, 0.0, 0.06))
        hips.parent = root
        bpy.ops.object.mode_set(mode="OBJECT")

    bpy.context.view_layer.update()
    minimum, maximum = bounds(character_meshes)
    scale = height / (maximum.z - minimum.z)
    normalize = Matrix.Translation((0.0, 0.0, -minimum.z * scale)) @ Matrix.Scale(scale, 4)
    armature.data.transform(normalize)
    for obj in character_meshes:
        obj.data.transform(normalize)
        obj.data.update()
    bpy.context.view_layer.update()
    if replaceable_hair and not hair_prepared:
        scalp_color = reconstructed_skin_color(character_meshes, armature, height)
        remove_textured_head_hair(character_meshes, armature, height)
        character_meshes.append(add_anatomical_scalp(armature, height, scalp_color))
    elif replaceable_hair and not any("scalp" in mesh.name.lower() for mesh in character_meshes):
        raise RuntimeError("--hair-prepared=1 requires a skinned anatomical scalp mesh")
    character_meshes.extend(
        add_facial_morphs(
            armature,
            [mesh for mesh in character_meshes if mesh.name != "AnatomicalScalp"],
            height,
        )
    )
    stabilize_foot_weights(armature, character_meshes)
    character_meshes.extend(
        add_closed_footwear_soles(armature, character_meshes, height)
    )

    armature.name = "MarketCharacterRig"
    armature.data.name = "MarketCharacterRig"
    armature["assetPipeline"] = "market-character-multiview-v2"
    armature["sourceReference"] = option("reference", "PNG kit")
    armature["metersHigh"] = height
    armature["headSocketBone"] = "Head"
    armature["leftGripBone"] = "Hand_L"
    armature["rightGripBone"] = "Hand_R"
    armature["footEvents"] = "Walk:LeftFootDown@0.00,RightFootDown@0.50;Run:LeftFootDown@0.00,RightFootDown@0.50"

    baked_actions = retarget_actions(source_armature, armature, source_actions)
    if locomotion_source is not None:
        if not locomotion_source.is_file():
            raise FileNotFoundError(locomotion_source)
        objects_before_motion = set(bpy.context.scene.objects)
        actions_before_motion = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=str(locomotion_source), import_pack_images=True)
        motion_objects = set(bpy.context.scene.objects) - objects_before_motion
        motion_actions = set(bpy.data.actions) - actions_before_motion
        motion_armature = next(obj for obj in motion_objects if obj.type == "ARMATURE")
        actions_by_name = {action.name: action for action in motion_actions}
        motion_animation = motion_armature.animation_data_create()
        neutral_action = actions_by_name["Idle_Loop"]
        motion_animation.action = neutral_action
        if neutral_action.slots:
            motion_animation.action_slot = neutral_action.slots[0]
        bpy.context.scene.frame_set(int(neutral_action.frame_range[0]))
        bpy.context.view_layer.update()
        motion_reference_rotations = {
            source_name: motion_armature.pose.bones[source_name].matrix.to_quaternion().copy()
            for target_name, source_name in QUATERNIUS_BONE_MAP.items()
            if target_name.startswith(("Rig_Arm_", "Forearm_", "Hand_"))
        }
        for output_name, source_name in LOCOMOTION_ACTIONS.items():
            source_action = actions_by_name.get(source_name)
            if source_action is None:
                raise KeyError(f"Missing locomotion action {source_name}")
            motion_bone_map = {
                target_name: source_bone
                for target_name, source_bone in QUATERNIUS_BONE_MAP.items()
                if armature.pose.bones.get(target_name) is not None
            }
            replacement = bake_action(
                motion_armature,
                armature,
                source_action,
                output_name,
                motion_bone_map,
                "__motion__",
                motion_reference_rotations,
            )
            ground_action(armature, replacement, character_meshes)
            old = next(action for action in baked_actions if action.name == f"__retarget__{output_name}")
            index = baked_actions.index(old)
            bpy.data.actions.remove(old)
            baked_actions[index] = replacement
        for action in motion_actions:
            bpy.data.actions.remove(action)
        for obj in motion_objects:
            if obj.name in bpy.context.scene.objects:
                bpy.data.objects.remove(obj, do_unlink=True)
        armature["locomotionSource"] = "Quaternius Universal Animation Library (CC0)"
    else:
        # Retargeting preserves the source rotations, but each reconstructed
        # body has different shoe volume and leg proportions.  Re-ground every
        # locomotion-derived clip on the target mesh so neither foot sinks into
        # the floor nor the whole character hovers between contacts.
        for output_name in LOCOMOTION_ACTIONS:
            action = next(
                item for item in baked_actions
                if item.name == f"__retarget__{output_name}"
            )
            ground_action(armature, action, character_meshes)

    for source_action in source_actions:
        bpy.data.actions.remove(source_action)
    for action in baked_actions:
        action.name = action.name.removeprefix("__retarget__")
        action.name = action.name.removeprefix("__motion__")
    for obj in source_objects:
        if obj.name in bpy.context.scene.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    animation_data = armature.animation_data_create()
    idle = bpy.data.actions.get("Idle") or baked_actions[0]
    animation_data.action = idle
    if idle.slots:
        animation_data.action_slot = idle.slots[0]
    bpy.context.scene.frame_set(int(idle.frame_range[0]))

    # Reassert neutral after all animation evaluation.  Shape-key defaults are
    # stored independently from armature actions and must never inherit the
    # temporary values used by QA or importers.
    for mesh in character_meshes:
        if mesh.data.shape_keys is None:
            continue
        for shape_key in mesh.data.shape_keys.key_blocks:
            if shape_key.name != "Basis":
                shape_key.value = 0.0

    # The rigging importer can retain a unit icosphere as a custom bone-shape
    # dependency.  Blender's glTF exporter follows that reference even when
    # the helper is unselected, producing a two-metre invisible object in the
    # final asset.  Strip all authoring helpers before the production export.
    for data_object in list(bpy.data.objects):
        if data_object.type != "ARMATURE":
            continue
        for pose_bone in data_object.pose.bones:
            pose_bone.custom_shape = None
    keep_objects = {armature, *character_meshes}
    # Work from bpy.data rather than only the active scene: SkinTokens exports
    # its debug icosphere as a custom-shape dependency, which can be unlinked
    # from the scene yet still be pulled into glTF through the armature.
    for obj in list(bpy.data.objects):
        if obj not in keep_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    unexpected = set(bpy.data.objects) - keep_objects
    if unexpected:
        raise RuntimeError(f"Unexpected export dependencies remain: {[obj.name for obj in unexpected]}")

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in character_meshes:
        for material in obj.data.materials:
            if material is not None:
                material.use_backface_culling = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    output.parent.mkdir(parents=True, exist_ok=True)
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
        export_extras=True,
        export_loglevel=-1,
    )
    print(f"EXPORTED {output} with {len(baked_actions)} retargeted actions")


if __name__ == "__main__":
    main()

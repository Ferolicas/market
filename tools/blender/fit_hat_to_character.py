"""Fit an animal hood to one character and close it with an anatomical lining."""

from __future__ import annotations

import colorsys
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector


HOOD_COLORS = {
    "red-panda": "#641f09",
    "red-fox": "#712305",
    "chicken": "#8b7654",
    "owl": "#321707",
    "elephant": "#363b3f",
    "rhino": "#3b4044",
    "giraffe": "#6b5003",
    "panda": "#837c6c",
    "frog": "#244a08",
    "cow": "#827a68",
    "rabbit": "#837e72",
    "capybara": "#51230c",
}


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def vector_option(name: str, default: str) -> Vector:
    return Vector(tuple(float(value) for value in option(name, default).split(",")))


def head_weight(mesh_object: bpy.types.Object, vertex_index: int) -> float:
    group = mesh_object.vertex_groups.get("Head")
    if group is None:
        return 0.0
    membership = next(
        (item for item in mesh_object.data.vertices[vertex_index].groups if item.group == group.index),
        None,
    )
    return membership.weight if membership is not None else 0.0


def linear_color(value: str) -> tuple[float, float, float, float]:
    value = value.lstrip("#")

    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    return tuple(linear(int(value[index : index + 2], 16) / 255) for index in (0, 2, 4)) + (1.0,)


def build_hood_lining(
    character_mesh: bpy.types.Object,
    head_origin: Vector,
    hat: str,
) -> bpy.types.Object:
    source = character_mesh.data
    weighted_points = [
        character_mesh.matrix_world @ vertex.co
        for vertex in source.vertices
        if head_weight(character_mesh, vertex.index) >= 0.58
    ]
    top = max(point.z for point in weighted_points) - head_origin.z
    half_width = max(abs(point.x - head_origin.x) for point in weighted_points)
    bottom = top - 0.405
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    vertex_map: dict[int, int] = {}
    for polygon in source.polygons:
        if min(head_weight(character_mesh, index) for index in polygon.vertices) < 0.56:
            continue
        world_points = [character_mesh.matrix_world @ source.vertices[index].co for index in polygon.vertices]
        center = sum(world_points, Vector()) / len(world_points) - head_origin
        if center.z < bottom:
            continue
        # The lining closes the rear and crown but leaves the authored face
        # aperture open.  Temple strips stay covered so the hood has a real
        # wearable thickness instead of ending like a rigid mask.
        front_opening = (
            center.y < -0.025
            and center.z < top - 0.115
            and abs(center.x) < half_width * 0.88
        )
        if front_opening:
            continue
        face: list[int] = []
        for source_index, world_point in zip(polygon.vertices, world_points):
            if source_index not in vertex_map:
                local = world_point - head_origin
                radial = Vector((local.x, local.y, max(0.025, local.z - bottom)))
                local += radial.normalized() * 0.0035
                vertex_map[source_index] = len(vertices)
                vertices.append(tuple(local))
            face.append(vertex_map[source_index])
        faces.append(tuple(face))

    mesh = bpy.data.meshes.new("HoodAnatomicalLining")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    lining = bpy.data.objects.new("HoodAnatomicalLining", mesh)
    bpy.context.collection.objects.link(lining)
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    material = bpy.data.materials.new("HoodLining")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = linear_color(HOOD_COLORS[hat])
    principled.inputs["Roughness"].default_value = 0.88
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.12
    mesh.materials.append(material)
    lining["anatomicalHoodLining"] = True
    lining["hatStyle"] = hat
    return lining


def image_texture(material: bpy.types.Material | None) -> bpy.types.Image | None:
    if material is None or not material.use_nodes or material.node_tree is None:
        return None
    node = next(
        (node for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image),
        None,
    )
    return node.image if node is not None else None


def linear_to_srgb(channel: float) -> float:
    return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1.0 / 2.4) - 0.055


def repair_reconstruction_skin(
    obj: bpy.types.Object,
    hood_material: bpy.types.Material,
) -> int:
    """Replace mannequin-skin atlas islands accidentally baked into the rear."""

    if obj.type != "MESH" or obj.data.uv_layers.active is None:
        return 0
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    images = [image_texture(material) for material in mesh.materials]
    pixels_by_image: dict[bpy.types.Image, list[float]] = {}
    if hood_material.name not in mesh.materials:
        mesh.materials.append(hood_material)
    repair_index = next(
        index for index, material in enumerate(mesh.materials) if material == hood_material
    )
    repaired = 0
    for polygon in mesh.polygons:
        center = obj.matrix_world @ polygon.center
        # The face aperture is authored and must stay open; the false skin
        # islands occur on the crown and rear of the generated mannequin.
        if center.y <= 0.018:
            continue
        if center.y >= 0.055:
            polygon.material_index = repair_index
            repaired += 1
            continue
        image = images[polygon.material_index] if polygon.material_index < len(images) else None
        if image is None:
            continue
        if image not in pixels_by_image:
            pixels_by_image[image] = list(image.pixels[:])
        pixels = pixels_by_image[image]
        width, height = image.size
        samples: list[tuple[float, float, float]] = []
        for loop_index in polygon.loop_indices:
            uv = uv_layer.data[loop_index].uv
            x = min(width - 1, max(0, round((uv.x % 1.0) * (width - 1))))
            y = min(height - 1, max(0, round((uv.y % 1.0) * (height - 1))))
            start = (y * width + x) * 4
            samples.append(tuple(linear_to_srgb(pixels[start + channel]) for channel in range(3)))
        color = tuple(sum(sample[channel] for sample in samples) / len(samples) for channel in range(3))
        _, saturation, value = colorsys.rgb_to_hsv(*color)
        warm_neutral = color[0] >= color[1] * 0.94 and color[1] >= color[2] * 0.86
        if value >= 0.58 and saturation <= 0.75 and warm_neutral:
            polygon.material_index = repair_index
            repaired += 1
    return repaired


def main() -> None:
    character = Path(option("character"))
    source_hat = Path(option("hat"))
    output = Path(option("output"))
    hat = option("style", source_hat.stem)
    scale = vector_option("scale", "1,1,1")
    offset = vector_option("offset", "0,0,0")
    rotation = vector_option("rotation", "0,0,0")
    if not character.is_file() or not source_hat.is_file() or hat not in HOOD_COLORS:
        raise FileNotFoundError((character, source_hat, hat))

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(character), import_pack_images=True)
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    head_origin = armature.matrix_world @ armature.data.bones["Head"].head_local
    character_mesh = max(
        (
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH" and obj.vertex_groups.get("Head") is not None
        ),
        key=lambda obj: len(obj.data.vertices),
    )
    lining = build_hood_lining(character_mesh, head_origin, hat)

    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source_hat), import_pack_images=True)
    hat_objects = set(bpy.context.scene.objects) - before
    fit = (
        Matrix.Translation(offset)
        @ Euler(rotation, "XYZ").to_matrix().to_4x4()
        @ Matrix.Diagonal((*scale, 1.0))
    )
    for obj in hat_objects:
        obj.matrix_world = fit @ obj.matrix_world
        if obj.type == "MESH":
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
            repaired = repair_reconstruction_skin(obj, lining.data.materials[0])
            if repaired:
                obj["repairedMannequinSkinFaces"] = repaired

    bpy.ops.object.select_all(action="DESELECT")
    lining.select_set(True)
    for obj in hat_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = lining
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=True,
        export_loglevel=-1,
    )
    print(
        f"EXPORTED {output}: style={hat} lining_vertices={len(lining.data.vertices)} "
        f"lining_faces={len(lining.data.polygons)}"
    )


if __name__ == "__main__":
    main()

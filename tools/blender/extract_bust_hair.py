"""Extract a textured, head-conforming hair shell from a TRELLIS mannequin bust."""

from __future__ import annotations

import colorsys
import statistics
import sys
from pathlib import Path

import bmesh
import bpy


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def texture_image(material: bpy.types.Material) -> bpy.types.Image:
    if not material.use_nodes or material.node_tree is None:
        raise RuntimeError(f"{material.name} does not have a node texture")
    node = next(
        (node for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image),
        None,
    )
    if node is None:
        raise RuntimeError(f"{material.name} has no image texture")
    return node.image


def is_hair(rgb: tuple[float, float, float]) -> bool:
    def linear_to_srgb(channel: float) -> float:
        return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1.0 / 2.4) - 0.055

    srgb = tuple(linear_to_srgb(channel) for channel in rgb)
    _, saturation, value = colorsys.rgb_to_hsv(*srgb)
    return value < 0.58 or saturation > 0.39


def sampled_color(
    pixels: list[float],
    width: int,
    height: int,
    uv: tuple[float, float],
) -> tuple[float, float, float]:
    x = min(width - 1, max(0, round((uv[0] % 1.0) * (width - 1))))
    y = min(height - 1, max(0, round((uv[1] % 1.0) * (height - 1))))
    offset = (y * width + x) * 4
    return pixels[offset], pixels[offset + 1], pixels[offset + 2]


def srgb_color(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    def linear_to_srgb(channel: float) -> float:
        return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1.0 / 2.4) - 0.055

    return tuple(linear_to_srgb(channel) for channel in rgb)


def palette_distance(
    color: tuple[float, float, float],
    palette: list[tuple[float, float, float]],
) -> float:
    return min(sum((value - sample[index]) ** 2 for index, value in enumerate(color)) for sample in palette)


def srgb_to_linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def filtered_palette(
    samples: list[tuple[float, float, float]],
    *,
    keep_bright: bool,
) -> list[tuple[float, float, float]]:
    """Return deterministic seed colors without UV-seam/shadow outliers."""

    ranked = sorted(samples, key=lambda color: colorsys.rgb_to_hsv(*color)[2])
    pivot = int(len(ranked) * (0.62 if keep_bright else 0.78))
    filtered = ranked[pivot:] if keep_bright else ranked[: max(1, pivot)]
    unique = list(dict.fromkeys(tuple(round(channel, 4) for channel in color) for color in filtered))
    stride = max(1, len(unique) // 256)
    return unique[::stride][:256]


def create_under_cap(
    hair_palette: list[tuple[float, float, float]],
) -> bpy.types.Object:
    """Build a recessed anatomical cap behind the reconstructed strands.

    The generated bust supplies the visible style silhouette, but sparse
    triangle reconstruction can leave pinholes that expose bald skin.  This
    cap lives behind the strands and ends above the forehead, so it fills only
    reconstruction gaps instead of changing the authored hairline.
    """

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=48,
        ring_count=28,
        location=(0.0, 0.0, 0.185),
        scale=(0.150, 0.185, 0.110),
    )
    cap = bpy.context.object
    cap.name = "HairUnderCap"
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)

    bm = bmesh.new()
    bm.from_mesh(cap.data)
    discarded = []
    for face in bm.faces:
        point = face.calc_center_median()
        below_nape = point.z < 0.070
        hairline_z = 0.185 - 0.035 * min(1.0, abs(point.x) / 0.150)
        below_front_hairline = point.y < -0.055 and point.z < hairline_z
        below_temple = abs(point.x) > 0.105 and point.y < 0.020 and point.z < 0.130
        if below_nape or below_front_hairline or below_temple:
            discarded.append(face)
    bmesh.ops.delete(bm, geom=discarded, context="FACES")
    loose = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(cap.data)
    bm.free()
    cap.data.update()

    median_srgb = tuple(statistics.median(sample[index] for sample in hair_palette) for index in range(3))
    # The cap is recessed shadow/root fill, not a second shiny hairstyle.
    # Keeping it darker than the visible strands prevents studio key lights
    # from producing a pale helmet highlight through the crown gaps.
    color = tuple(srgb_to_linear(value) * 0.10 for value in median_srgb) + (1.0,)
    material = bpy.data.materials.new("HairUnderCap")
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = 0.88
    if "Specular IOR Level" in node.inputs:
        node.inputs["Specular IOR Level"].default_value = 0.12
    cap.data.materials.append(material)
    for polygon in cap.data.polygons:
        polygon.use_smooth = True
    cap["generatedHairUnderCap"] = True
    return cap


def main() -> None:
    source = Path(option("source"))
    output = Path(option("output"))
    style = option("style", source.stem)
    if not source.is_file():
        raise FileNotFoundError(source)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    mesh_object = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
    mesh = mesh_object.data
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise RuntimeError("Bust mesh has no UV layer")
    image = texture_image(mesh.materials[0])
    width, height = image.size
    pixels = list(image.pixels[:])

    minimum_z = min(vertex.co.z for vertex in mesh.vertices)
    maximum_z = max(vertex.co.z for vertex in mesh.vertices)
    minimum_x = min(vertex.co.x for vertex in mesh.vertices)
    maximum_x = max(vertex.co.x for vertex in mesh.vertices)
    minimum_y = min(vertex.co.y for vertex in mesh.vertices)
    maximum_y = max(vertex.co.y for vertex in mesh.vertices)
    hair_palette: list[tuple[float, float, float]] = []
    skin_palette: list[tuple[float, float, float]] = []
    for polygon in mesh.polygons:
        vertices = [mesh.vertices[index].co for index in polygon.vertices]
        centroid = sum(vertices, vertices[0] * 0.0) / len(vertices)
        destination = None
        if centroid.z > maximum_z - 0.070:
            destination = hair_palette
        elif -0.015 < centroid.z < 0.180 and centroid.y < -0.105 and abs(centroid.x) < 0.105:
            destination = skin_palette
        if destination is None:
            continue
        for loop_index in polygon.loop_indices:
            uv = uv_layer.data[loop_index].uv
            destination.append(srgb_color(sampled_color(pixels, width, height, (uv.x, uv.y))))
    if not hair_palette or not skin_palette:
        raise RuntimeError("Could not derive crown-hair and facial-skin texture palettes")
    # UV seams occasionally point at unrelated dark atlas islands.  Use the
    # brighter portion of the facial seed as skin and the darker portion of
    # the crown seed as hair; this retains blonde highlights through the
    # remaining seed range while rejecting those atlas outliers.
    hair_palette = filtered_palette(hair_palette, keep_bright=False)
    skin_palette = filtered_palette(skin_palette, keep_bright=True)
    print(
        "PALETTES",
        style,
        "hair",
        tuple(round(statistics.median(sample[index] for sample in hair_palette), 4) for index in range(3)),
        "skin",
        tuple(round(statistics.median(sample[index] for sample in skin_palette), 4) for index in range(3)),
    )

    selected_faces: set[int] = set()
    classified_skin_points = []
    short_styles = {"side-part", "fade", "waves", "swept", "messy", "curls", "short-fringe", "quiff"}
    for polygon in mesh.polygons:
        vertices = [mesh.vertices[index].co for index in polygon.vertices]
        centroid_z = sum(vertex.z for vertex in vertices) / len(vertices)
        centroid_x = sum(vertex.x for vertex in vertices) / len(vertices)
        centroid_y = sum(vertex.y for vertex in vertices) / len(vertices)
        if centroid_z < -0.19:
            continue
        if style in short_styles and centroid_z < 0.055:
            continue
        if style not in short_styles and centroid_z < 0.015 and abs(centroid_x) < 0.115:
            continue
        # Preserve the complete upper/back crown geometrically.  Generated
        # UV atlases contain baked shadows and seams, which made a pure color
        # classifier punch holes through low curls and swept backs.  The only
        # upper-head area that can be skin is the central forward forehead;
        # there we keep the authored, higher hairline and still let texture
        # votes recover fringe strands below it.
        z_span = maximum_z - minimum_z
        front_face = (
            centroid_y < minimum_y + (maximum_y - minimum_y) * 0.27
            and abs(centroid_x) < (maximum_x - minimum_x) * 0.42
        )
        crown_floor = maximum_z - z_span * 0.32
        front_hairline = maximum_z - z_span * 0.23
        if centroid_z > crown_floor and (not front_face or centroid_z > front_hairline):
            selected_faces.add(polygon.index)
            continue
        back_crown = (
            centroid_y > minimum_y + (maximum_y - minimum_y) * 0.50
            and centroid_z > minimum_z + z_span * 0.40
            and abs(centroid_x) < (maximum_x - minimum_x) * 0.46
        )
        if back_crown:
            selected_faces.add(polygon.index)
            continue
        # Eyes, eyebrows and beard share dark pixels with the hair palette but
        # occupy the central forward face below the hairline.
        # TRELLIS rounds the blank mannequin face into a shallow oval, so its
        # central surface can sit behind y=-0.075 and inherit dark hair-shadow
        # texels.  Exclude the complete facial core geometrically.  Side locks,
        # ears and long styles live outside the narrow x envelope; the actual
        # hairline starts above this z limit.
        # The reference busts are intentionally faceless, so texture distance
        # is the reliable separator at the forehead.  A former broad z<.248
        # exclusion erased the real crown and fringe on low-profile styles
        # (fade, curls, quiff) and left only a synthetic cap.  Keep only the
        # lower facial core out of consideration; the classifier below decides
        # the authored hairline from the source texture itself.
        if (
            abs(centroid_x) < 0.142
            and centroid_y < 0.080
            and centroid_z < 0.095
        ):
            continue
        votes = 0
        skin_votes = 0
        for loop_index in polygon.loop_indices:
            uv = uv_layer.data[loop_index].uv
            raw_color = sampled_color(pixels, width, height, (uv.x, uv.y))
            color = srgb_color(raw_color)
            hair_distance = palette_distance(color, hair_palette)
            skin_distance = palette_distance(color, skin_palette)
            if hair_distance < skin_distance * 0.90 or (
                hair_distance < 0.020 and is_hair(raw_color)
            ):
                votes += 1
            if skin_distance < hair_distance * 0.90:
                skin_votes += 1
        if skin_votes >= max(1, len(polygon.loop_indices) // 2):
            classified_skin_points.extend(vertices)
        if votes >= max(1, len(polygon.loop_indices) // 2):
            selected_faces.add(polygon.index)

    if classified_skin_points:
        skin_min = tuple(min(point[index] for point in classified_skin_points) for index in range(3))
        skin_max = tuple(max(point[index] for point in classified_skin_points) for index in range(3))
        print(
            "SKIN_BOUNDS",
            style,
            tuple(round(value, 4) for value in skin_min),
            tuple(round(value, 4) for value in skin_max),
        )

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    discarded = [face for face in bm.faces if face.index not in selected_faces]
    bmesh.ops.delete(bm, geom=discarded, context="FACES")
    loose_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_vertices:
        bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    if not mesh.polygons:
        raise RuntimeError("Texture segmentation produced an empty hair mesh")
    print("SEGMENTED", style, len(mesh.vertices), len(mesh.polygons))
    mesh_object.name = "Hair"
    mesh.name = "Hair"
    mesh.materials[0].name = "Hair"
    mesh_object["assetPipeline"] = "market-hair-bust-extraction-v1"
    mesh_object["sourceReference"] = "KIT MARKET/PEINADOS.png"
    under_cap = create_under_cap(hair_palette) if option("under-cap", "true") == "true" else None

    bpy.ops.object.select_all(action="DESELECT")
    mesh_object.select_set(True)
    if under_cap is not None:
        under_cap.select_set(True)
    bpy.context.view_layer.objects.active = mesh_object
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
    print(f"EXPORTED {output}: {len(mesh.vertices)} vertices, {len(mesh.polygons)} polygons")


if __name__ == "__main__":
    main()

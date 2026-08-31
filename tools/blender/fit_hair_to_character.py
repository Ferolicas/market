"""Build a body-specific hairstyle with an anatomical scalp underlay.

The visible hairstyle is reconstructed from the kit reference.  A thin copy
of the character's own cranium sits underneath it, so sparse reconstruction
gaps reveal hair roots instead of bald skin.  The underlay is an exact fit to
each head; it is not a generic helmet sphere.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


PULLED_STYLES = {"bun", "ponytail", "pigtails", "braid", "high-ponytail"}
WAVY_STYLES = {"waves", "long-wavy", "bob", "blunt-bob"}
SHORT_TEXTURE_STYLES = {"fade", "curls", "quiff", "short-fringe", "messy"}
REFERENCE_ROOT_COLORS = {
    "side-part": "#252326",
    "fade": "#2d2929",
    "waves": "#3a2a24",
    "swept": "#2c2c30",
    "bob": "#49382f",
    "ponytail": "#8f5b2c",
    "long-wavy": "#83401f",
    "bun": "#3b2d28",
    "messy": "#352a26",
    "curls": "#3d2e27",
    "short-fringe": "#6b4527",
    "quiff": "#9a5d25",
    "blunt-bob": "#49362f",
    "pigtails": "#3d302d",
    "braid": "#82411f",
    "high-ponytail": "#8b572a",
}


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def vector_option(name: str, default: str) -> Vector:
    return Vector(tuple(float(value) for value in option(name, default).split(",")))


def reference_root_color(style: str) -> tuple[float, float, float, float]:
    value = REFERENCE_ROOT_COLORS.get(style, "#302824").lstrip("#")
    srgb = tuple(int(value[index : index + 2], 16) / 255 for index in (0, 2, 4))

    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    return tuple(linear(channel) for channel in srgb) + (1.0,)


def head_weight(mesh_object: bpy.types.Object, vertex_index: int) -> float:
    group = mesh_object.vertex_groups.get("Head")
    if group is None:
        return 0.0
    membership = next(
        (item for item in mesh_object.data.vertices[vertex_index].groups if item.group == group.index),
        None,
    )
    return membership.weight if membership is not None else 0.0


def root_ridge(style: str, local: Vector, half_width: float, top: float) -> float:
    """Return a subtle outward displacement that reads as directional roots.

    This is deliberately geometric rather than a procedural Blender material:
    the grooves therefore survive glTF export and remain visible under the
    game's runtime hair tint.  The phase follows the construction of each
    hairstyle: tied hair converges at the back, waves meander, and short cuts
    keep much smaller broken-up clumps.
    """

    width = max(0.001, half_width)
    x = local.x / width
    y = local.y / width
    crown = max(0.0, min(1.0, (local.z - (top - 0.43)) / 0.43))
    if style in PULLED_STYLES:
        phase = math.atan2(local.x, max(0.018, 0.34 - local.y)) * 29.0
        amplitude = 0.00125
    elif style in WAVY_STYLES:
        phase = x * math.pi * 8.5 + math.sin(y * 4.2) * 1.25
        amplitude = 0.00105
    elif style in SHORT_TEXTURE_STYLES:
        phase = x * math.pi * 10.5 + y * 8.0 + math.sin((x - y) * 5.0)
        amplitude = 0.00070
    else:
        phase = x * math.pi * 8.0 + y * 3.2
        amplitude = 0.00090
    ridge = 0.5 + 0.5 * math.cos(phase)
    return amplitude * ridge * (0.42 + 0.58 * crown)


def build_scalp(
    character_mesh: bpy.types.Object,
    head_origin: Vector,
    style: str,
) -> bpy.types.Object:
    source = character_mesh.data
    weighted_points = [
        character_mesh.matrix_world @ vertex.co
        for vertex in source.vertices
        if head_weight(character_mesh, vertex.index) >= 0.60
    ]
    top = max(point.z for point in weighted_points) - head_origin.z
    half_width = max(abs(point.x - head_origin.x) for point in weighted_points)
    short_root_styles = {"fade", "curls", "quiff", "short-fringe", "messy"}
    center_hairline = top - (0.145 if style in short_root_styles else 0.170)
    back_floor = top - (0.380 if style in short_root_styles else 0.420)

    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    vertex_map: dict[int, int] = {}
    for polygon in source.polygons:
        if min(head_weight(character_mesh, index) for index in polygon.vertices) < 0.58:
            continue
        world_points = [character_mesh.matrix_world @ source.vertices[index].co for index in polygon.vertices]
        center = sum(world_points, Vector()) / len(world_points) - head_origin
        temple_drop = 0.050 * min(1.0, abs(center.x) / max(0.001, half_width * 0.82))
        front_hairline = center_hairline - temple_drop
        on_front = center.y < -0.025
        if (on_front and center.z < front_hairline) or (not on_front and center.z < back_floor):
            continue
        face = []
        for source_index, world_point in zip(polygon.vertices, world_points):
            if source_index not in vertex_map:
                local = world_point - head_origin
                # The source surface is already the exact cranium.  A tiny
                # radial displacement prevents z-fighting without inflating
                # the silhouette into a helmet.
                radial = Vector((local.x, local.y, max(0.0, local.z - (top - 0.33)) * 0.22))
                if radial.length_squared > 1e-8:
                    local += radial.normalized() * (0.0022 + root_ridge(style, local, half_width, top))
                vertex_map[source_index] = len(vertices)
                vertices.append(tuple(local))
            face.append(vertex_map[source_index])
        faces.append(tuple(face))

    scalp_mesh = bpy.data.meshes.new("HairScalp")
    scalp_mesh.from_pydata(vertices, [], faces)
    scalp_mesh.update()
    scalp = bpy.data.objects.new("HairScalp", scalp_mesh)
    bpy.context.collection.objects.link(scalp)
    for polygon in scalp_mesh.polygons:
        polygon.use_smooth = True

    material = bpy.data.materials.new("HairScalp")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = reference_root_color(style)
    principled.inputs["Roughness"].default_value = 0.78
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.16
    scalp_mesh.materials.append(material)
    scalp["anatomicalScalpUnderlay"] = True
    scalp["directionalRootGeometry"] = True
    scalp["hairStyle"] = style
    return scalp


def build_root_strands(scalp: bpy.types.Object, style: str) -> bpy.types.Object | None:
    """Add broad, head-conforming locks over the reconstructed crown.

    Single-view reconstruction often preserves the silhouette but leaves part
    of the hair across the crown as a nearly featureless head surface.
    These locks are sampled directly from the anatomical scalp, so they follow
    each character's skull instead of forming a generic helmet.
    """

    points = [vertex.co.copy() for vertex in scalp.data.vertices]
    if not points:
        return None
    half_width = max(abs(point.x) for point in points)
    front = min(point.y for point in points)
    back = max(point.y for point in points)
    top = max(point.z for point in points)

    bottom = min(point.z for point in points)

    def surface_point(x: float, y: float, z: float) -> Vector:
        nearest = min(
            points,
            key=lambda point: (point.x - x) ** 2 + (point.y - y) ** 2 + (point.z - z) ** 2 * 0.72,
        )
        radial = Vector((nearest.x, nearest.y, max(0.02, nearest.z - bottom)))
        return nearest + radial.normalized() * 0.0032

    curve_data = bpy.data.curves.new("HairPulledRootStrands", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 2
    curve_data.bevel_depth = 0.0052 if style in PULLED_STYLES else 0.0045
    curve_data.bevel_resolution = 2
    curve_data.resolution_u = 2
    strand_count = 11 if style in PULLED_STYLES else 13
    convergence = 0.84 if style in PULLED_STYLES else 0.24
    for strand_index in range(strand_count):
        across = (strand_index / (strand_count - 1)) * 2.0 - 1.0
        start_x = across * half_width * 0.82
        spline = curve_data.splines.new("NURBS")
        samples = 9
        spline.points.add(samples - 1)
        for sample_index in range(samples):
            progress = sample_index / (samples - 1)
            eased = progress * progress * (3.0 - 2.0 * progress)
            y = max(-0.060, front + 0.105) * (1.0 - eased) + min(0.245, back - 0.020) * eased
            x = start_x * (1.0 - eased * convergence)
            if style in WAVY_STYLES or style in {"messy", "curls"}:
                x += math.sin(progress * math.pi * 2.0 + strand_index * 0.72) * half_width * 0.025
            elif style in {"side-part", "swept"}:
                x += half_width * 0.10 * eased
            end_z = top - (0.15 if style in PULLED_STYLES else 0.36)
            crown_z = top + 0.008
            start_z = top - 0.16
            target_z = (
                (1.0 - progress) ** 2 * start_z
                + 2.0 * (1.0 - progress) * progress * crown_z
                + progress**2 * end_z
            )
            point = surface_point(x, y, target_z)
            spline.points[sample_index].co = (*point, 1.0)
        spline.use_endpoint_u = True
        spline.order_u = min(4, samples)

    strands = bpy.data.objects.new("HairPulledRootStrands", curve_data)
    bpy.context.collection.objects.link(strands)
    curve_data.materials.append(scalp.data.materials[0])
    bpy.context.view_layer.objects.active = strands
    strands.select_set(True)
    bpy.ops.object.convert(target="MESH")
    strands = bpy.context.object
    strands.name = "HairPulledRootStrands"
    for polygon in strands.data.polygons:
        polygon.use_smooth = True
    strands["anatomicalScalpStrands"] = True
    strands["hairStyle"] = style
    return strands


def normalize_hair_materials(objects: set[bpy.types.Object], style: str) -> None:
    """Use clean PBR color instead of reconstruction-baked studio lighting.

    The reconstructed atlas contains the mannequin's light, skin reflections
    and occasional black UV islands.  Keeping that baked illumination makes a
    hairstyle change color as the character turns and prevents the runtime
    tint from behaving like real hair dye.  Geometry supplies the strand
    relief; a single physically lit base color remains stable from every side.
    """

    base_color = reference_root_color(style)
    seen: set[bpy.types.Material] = set()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for material in obj.data.materials:
            if material is None or material in seen:
                continue
            seen.add(material)
            material.name = "Hair"
            material.use_nodes = True
            principled = material.node_tree.nodes.get("Principled BSDF")
            if principled is None:
                continue
            for link in tuple(material.node_tree.links):
                if link.to_node == principled and link.to_socket == principled.inputs["Base Color"]:
                    material.node_tree.links.remove(link)
            principled.inputs["Base Color"].default_value = base_color
            principled.inputs["Roughness"].default_value = 0.58
            if "Specular IOR Level" in principled.inputs:
                principled.inputs["Specular IOR Level"].default_value = 0.28


def clean_hair_geometry(objects: set[bpy.types.Object]) -> None:
    """Weld reconstruction triangles and remove detached segmentation noise."""

    for obj in objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00003)
        bm.faces.ensure_lookup_table()
        remaining = set(bm.faces)
        components: list[list[bmesh.types.BMFace]] = []
        while remaining:
            seed = remaining.pop()
            component = [seed]
            stack = [seed]
            while stack:
                face = stack.pop()
                for edge in face.edges:
                    for neighbor in edge.link_faces:
                        if neighbor in remaining:
                            remaining.remove(neighbor)
                            component.append(neighbor)
                            stack.append(neighbor)
            components.append(component)
        discarded = [face for component in components if len(component) < 8 for face in component]
        if discarded:
            bmesh.ops.delete(bm, geom=discarded, context="FACES")
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        boundary = {
            vertex
            for edge in bm.edges
            if len(edge.link_faces) == 1
            for vertex in edge.verts
        }
        for _ in range(2):
            if boundary:
                bmesh.ops.smooth_vert(
                    bm,
                    verts=list(boundary),
                    factor=0.16,
                    use_axis_x=True,
                    use_axis_y=True,
                    use_axis_z=True,
                )
        if bm.faces:
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        # The atlas has deliberately been removed; stale UVs only increase the
        # download and can make optimizers retain an otherwise unused texture.
        while mesh.uv_layers:
            mesh.uv_layers.remove(mesh.uv_layers[0])


def main() -> None:
    character = Path(option("character"))
    hair = Path(option("hair"))
    output = Path(option("output"))
    style = option("style", hair.stem)
    scale = vector_option("scale", "1,1,1")
    offset = vector_option("offset", "0,0,0")
    if not character.is_file() or not hair.is_file():
        raise FileNotFoundError((character, hair))

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
    scalp = build_scalp(character_mesh, head_origin, style)
    root_strands = build_root_strands(scalp, style)

    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(hair), import_pack_images=True)
    hair_objects = set(bpy.context.scene.objects) - before
    clean_hair_geometry(hair_objects)
    normalize_hair_materials(hair_objects, style)
    local_fit = Matrix.Translation(offset) @ Matrix.Diagonal((*scale, 1.0))
    for obj in hair_objects:
        obj.matrix_world = local_fit @ obj.matrix_world
        if obj.type == "MESH":
            for polygon in obj.data.polygons:
                polygon.use_smooth = True

    bpy.ops.object.select_all(action="DESELECT")
    scalp.select_set(True)
    if root_strands is not None:
        root_strands.select_set(True)
    for obj in hair_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = scalp
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
        f"EXPORTED {output}: style={style} scalp_vertices={len(scalp.data.vertices)} "
        f"scalp_faces={len(scalp.data.polygons)}"
    )


if __name__ == "__main__":
    main()

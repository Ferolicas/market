"""Combine a reconstructed mesh with the game's proven humanoid skeleton guide."""

from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assemble_trellis_character import (
    add_anatomical_scalp,
    reconstructed_skin_color,
    remove_textured_head_hair,
)


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def remove_flat_reconstruction_artifacts(mesh_object: bpy.types.Object) -> int:
    """Remove disconnected view-plane ribbons without touching body islands."""

    mesh = mesh_object.data
    overall_height = max(vertex.co.z for vertex in mesh.vertices) - min(vertex.co.z for vertex in mesh.vertices)
    vertex_faces: dict[int, list[int]] = {vertex.index: [] for vertex in mesh.vertices}
    for polygon in mesh.polygons:
        for vertex_index in polygon.vertices:
            vertex_faces[vertex_index].append(polygon.index)

    unseen = set(range(len(mesh.polygons)))
    discarded: set[int] = set()
    while unseen:
        seed = unseen.pop()
        component = {seed}
        frontier = [seed]
        component_vertices: set[int] = set(mesh.polygons[seed].vertices)
        while frontier:
            polygon_index = frontier.pop()
            for vertex_index in mesh.polygons[polygon_index].vertices:
                component_vertices.add(vertex_index)
                for neighbor in vertex_faces[vertex_index]:
                    if neighbor in unseen:
                        unseen.remove(neighbor)
                        component.add(neighbor)
                        frontier.append(neighbor)
        points = [mesh.vertices[index].co for index in component_vertices]
        extents = Vector(
            tuple(max(point[axis] for point in points) - min(point[axis] for point in points) for axis in range(3))
        )
        component_center = sum(points, points[0] * 0.0) / len(points)
        is_view_ribbon = (
            extents.z < overall_height * 0.16
            and max(extents.x, extents.y) > overall_height * 0.23
        )
        is_distant_floater = (
            len(component) < 80
            and max(abs(component_center.x), abs(component_center.y)) > overall_height * 0.35
        )
        if is_view_ribbon or is_distant_floater:
            discarded.update(component)

    if not discarded:
        return 0
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(
        bm,
        geom=[face for face in bm.faces if face.index in discarded],
        context="FACES",
    )
    loose = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return len(discarded)


def main() -> None:
    skeleton_source = Path(option("skeleton-source"))
    mesh_source = Path(option("mesh-source"))
    output = Path(option("output"))
    height = float(option("height"))
    clean_artifacts = option("clean-artifacts", "1") == "1"
    replaceable_hair = option("replaceable-hair", "0") == "1"
    if not skeleton_source.is_file() or not mesh_source.is_file():
        raise FileNotFoundError((skeleton_source, mesh_source))

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    bpy.ops.import_scene.gltf(filepath=str(skeleton_source), import_pack_images=True)
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    skeleton_objects = set(bpy.context.scene.objects)
    for obj in list(skeleton_objects):
        if obj.type == "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    before_mesh = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(mesh_source), import_pack_images=True)
    imported = set(bpy.context.scene.objects) - before_mesh
    meshes = [obj for obj in imported if obj.type == "MESH" and len(obj.data.vertices) > 500]
    if not meshes:
        raise RuntimeError(f"No production mesh in {mesh_source}")
    removed_artifacts = (
        sum(remove_flat_reconstruction_artifacts(mesh) for mesh in meshes)
        if clean_artifacts
        else 0
    )
    print(f"Removed {removed_artifacts} flat reconstruction faces from {mesh_source.name}")

    minimum, maximum = bounds(meshes)
    scale = height / (maximum.z - minimum.z)
    center_x = (minimum.x + maximum.x) * 0.5
    center_y = (minimum.y + maximum.y) * 0.5
    normalize = (
        Matrix.Translation((-center_x * scale, -center_y * scale, -minimum.z * scale))
        @ Matrix.Scale(scale, 4)
    )
    for mesh in meshes:
        mesh.data.transform(normalize)
        mesh.data.update()

    if replaceable_hair:
        scalp_color = reconstructed_skin_color(meshes, armature, height)
        remove_textured_head_hair(meshes, armature, height)
        meshes.append(add_anatomical_scalp(armature, height, scalp_color))

    for mesh in meshes:
        for modifier in list(mesh.modifiers):
            mesh.modifiers.remove(modifier)
        for group in list(mesh.vertex_groups):
            mesh.vertex_groups.remove(group)
        root_name = "Root" if armature.data.bones.get("Root") else armature.data.bones[0].name
        root_group = mesh.vertex_groups.new(name=root_name)
        root_group.add([vertex.index for vertex in mesh.data.vertices], 1.0, "REPLACE")
        # glTF only serializes joints referenced by the skin. Give every guide
        # bone one sacrificial vertex so the complete authored hierarchy reaches
        # SkinTokens; these placeholder weights are replaced by its skin pass.
        guide_vertex = 0
        for bone in armature.data.bones:
            if bone.name == root_name:
                continue
            vertex_index = guide_vertex % len(mesh.data.vertices)
            root_group.remove([vertex_index])
            bone_group = mesh.vertex_groups.new(name=bone.name)
            bone_group.add([vertex_index], 1.0, "REPLACE")
            guide_vertex += 1
        mesh.parent = armature
        armature_modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
        armature_modifier.object = armature
        mesh["skeletonGuideOnly"] = True

    for obj in list(bpy.context.scene.objects):
        if obj not in {armature, *meshes}:
            bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="EXPORT",
        export_animations=False,
        export_skins=True,
        export_all_influences=False,
        export_influence_nb=4,
        export_extras=True,
        export_loglevel=-1,
    )
    print(f"EXPORTED GUIDE {output}: {len(armature.data.bones)} bones, height={height}")


if __name__ == "__main__":
    main()

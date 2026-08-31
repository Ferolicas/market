"""Create a smooth, uniformly sampled production surface from a dense sculpt."""

from __future__ import annotations

import sys
from pathlib import Path

import bmesh
import bpy


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def main() -> None:
    source = Path(option("source"))
    output = Path(option("output"))
    voxel_size = float(option("voxel-size", "0.005"))
    smooth_iterations = int(option("smooth-iterations", "2"))
    target_faces = int(option("target-faces", "160000"))
    if not source.is_file():
        raise FileNotFoundError(source)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected one dense mesh in {source}, found {len(meshes)}")
    subject = meshes[0]
    bpy.context.view_layer.objects.active = subject
    subject.select_set(True)

    dense_faces = len(subject.data.polygons)
    subject.data.remesh_voxel_size = voxel_size
    subject.data.remesh_voxel_adaptivity = 0.0
    subject.data.use_remesh_preserve_volume = True
    bpy.ops.object.voxel_remesh()

    if smooth_iterations:
        smooth = subject.modifiers.new(name="Surface fairing", type="SMOOTH")
        smooth.factor = 0.18
        smooth.iterations = smooth_iterations
        bpy.ops.object.modifier_apply(modifier=smooth.name)

    # Voxel Remesh emits quads while glTF stores triangles. Triangulate before
    # computing the reduction ratio so the requested budget is the real web
    # triangle count rather than half of it.
    triangulate = subject.modifiers.new(name="Runtime triangles", type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=triangulate.name)

    if len(subject.data.polygons) > target_faces:
        decimate = subject.modifiers.new(name="Production density", type="DECIMATE")
        decimate.decimate_type = "COLLAPSE"
        decimate.ratio = target_faces / len(subject.data.polygons)
        decimate.use_collapse_triangulate = False
        bpy.ops.object.modifier_apply(modifier=decimate.name)

    # Aggressive production decimation can leave zero-area edges that Blender
    # previews but glTF correctly flags as invalid.  Clean the final topology
    # before UV generation, skin transfer and morph authoring.
    bm = bmesh.new()
    bm.from_mesh(subject.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-8)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(subject.data)
    bm.free()
    subject.data.update()

    for polygon in subject.data.polygons:
        polygon.use_smooth = True
    subject.data.materials.clear()

    bpy.ops.object.select_all(action="DESELECT")
    subject.select_set(True)
    bpy.context.view_layer.objects.active = subject
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="NONE",
        export_animations=False,
        export_skins=False,
        export_normals=True,
        export_loglevel=-1,
    )
    print(
        f"RETOPOLOGIZED {source.name}: {dense_faces:,} -> "
        f"{len(subject.data.polygons):,} faces at voxel {voxel_size}; {output}"
    )


if __name__ == "__main__":
    main()

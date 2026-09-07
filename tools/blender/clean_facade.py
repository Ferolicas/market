"""Clear reconstruction debris from a facade and add lightweight glass panes.

Tripo joined some wisps to the back frame and also split valid mouldings into
small islands, so component-size cleanup damages the facade.  The reliable
boundary is architectural: both window apertures must be empty.  Faces whose
centres fall inside those apertures are scan debris and can be removed without
touching the sill, jambs, header or centre post.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import bmesh
import bpy


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def clear_apertures(obj: bpy.types.Object) -> tuple[int, int]:
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    before = len(bm.faces)
    discarded = []
    for face in bm.faces:
        centre = face.calc_center_median()
        inside_left = -41.52 < centre.x < -1.52
        inside_right = 1.52 < centre.x < 42.02
        if (inside_left or inside_right) and 12.25 < centre.z < 52.25:
            discarded.append(face)
    bmesh.ops.delete(bm, geom=discarded, context="FACES")
    loose_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_vertices:
        bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return before, len(mesh.polygons)


def glass_material() -> bpy.types.Material:
    material = bpy.data.materials.new("FacadeGlass")
    material.use_nodes = True
    material.diffuse_color = (0.37, 0.66, 0.75, 0.18)
    material.use_backface_culling = False
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    elif hasattr(material, "blend_method"):
        material.blend_method = "BLEND"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.37, 0.66, 0.75, 0.18)
    bsdf.inputs["Roughness"].default_value = 0.12
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Alpha"].default_value = 0.18
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.62
    return material


def add_glass(name: str, x: float, width: float, material: bpy.types.Material) -> bpy.types.Object:
    # A very thin box renders correctly from both sides in glTF/WebGL and costs
    # only twelve triangles.  It sits just behind the front frame.
    bpy.ops.mesh.primitive_cube_add(location=(x, -11.08, 32.45))
    pane = bpy.context.object
    pane.name = name
    pane.scale = (width * 0.5, 0.045, 19.35)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    pane.data.materials.append(material)
    for polygon in pane.data.polygons:
        polygon.use_smooth = False
    return pane


def main() -> None:
    source = Path(option("source")).resolve()
    output = Path(option("output")).resolve()
    blend_output = option("blend-output")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected one facade mesh, found {len(meshes)}")

    facade = meshes[0]
    facade.name = "FacadeFrame"
    facade.data.name = "FacadeFrameMesh"
    before, after = clear_apertures(facade)

    material = glass_material()
    add_glass("FacadeGlassLeft", -21.50, 39.35, material)
    add_glass("FacadeGlassRight", 21.50, 39.35, material)

    if blend_output:
        blend_path = Path(blend_output).resolve()
        blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_materials="EXPORT",
        export_yup=True,
    )
    print(
        f"FACADE_CLEANED removed={before - after} "
        f"triangles={before}->{after + 24} bytes={os.path.getsize(output)} output={output}"
    )


if __name__ == "__main__":
    main()

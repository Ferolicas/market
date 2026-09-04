"""Decimate a rebuilt mosaic object to its runtime budget and install it.

The builder exports Tripo's full reconstruction -- 11 to 27 MB per object, where
the assets already shipping are 0.3 to 1 MB. Dropping those into StreamingAssets
would take the WebGL bundle from 133 MB to well over a gigabyte and it would no
longer load in a browser, so each object is collapsed to the triangle budget its
catalogue entry records before being written into place.
"""
from __future__ import annotations

import json, os, sys
import bpy


def opt(name, default=""):
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = f"--{name}="
    return next((a.removeprefix(p) for a in args if a.startswith(p)), default)


SOURCE = opt("source")
TARGET = int(opt("tris", "50000"))
OUTPUT = opt("output")
GLASS  = [g for g in opt("glass", "").split(",") if g]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SOURCE)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
before = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)

# Weld first. The builder writes a mesh with three vertices per triangle, and on
# that topology collapse has almost nothing to merge and the exporter has nothing
# to share -- the file comes out at three times the size for the same detail.
import bmesh
welded = 0
for o in meshes:
    bm = bmesh.new(); bm.from_mesh(o.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    welded += n0 - len(bm.verts)
    bm.to_mesh(o.data); bm.free(); o.data.update()

if before > TARGET:
    ratio = TARGET / before
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        m = o.modifiers.new("budget", type="DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = ratio
        # Collapse keeps material assignment, so the per-region colours survive.
        bpy.ops.object.modifier_apply(modifier=m.name)

# Shade smooth by angle before writing. The builder shades flat, which forces
# every triangle to own its vertices and triples the file: 4.2 MB for a 50k
# object where the assets already shipping are 1 MB at the same budget. Smoothing
# by angle keeps the hard edges hard and lets the rest share vertices.
for o in meshes:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    # glTF import stores custom split normals, and they override use_smooth, so
    # the exporter keeps three vertices per triangle no matter what is set.
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception:
        pass
    for poly in o.data.polygons:
        poly.use_smooth = True
    o.data.update()
    try:
        # 48 degrees: the reference reads as soft moulded plastic, so the shading
        # has to round over the small facets Tripo leaves and keep only the real
        # creases. At 30 the mesh still shows every scan facet as a hard edge.
        bpy.ops.object.shade_auto_smooth(angle=0.8378)
    except Exception:
        pass

# Soften the surface response. A matte, slightly waxy dielectric reads as the
# delicate moulded plastic of the reference; at the roughness the builder used
# every panel caught a hard specular band and looked 3D printed.
for o in meshes:
    for slot in o.data.materials:
        if not slot or not slot.use_nodes:
            continue
        bsdf = slot.node_tree.nodes.get("Principled BSDF")
        if not bsdf:
            continue
        glassy = any(g and g in slot.name for g in GLASS)
        bsdf.inputs["Roughness"].default_value = 0.09 if glassy else 0.82
        bsdf.inputs["Metallic"].default_value = 0.0
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.62 if glassy else 0.28
        if glassy:
            # Real glass, not a pale opaque panel: an opaque leaf reads as a
            # curtain hung in the doorway. Alpha blend plus a tight specular is
            # what makes a pane look like a pane.
            bsdf.inputs["Alpha"].default_value = 0.26
            slot.blend_method = "BLEND"
            if hasattr(slot, "shadow_method"):
                slot.shadow_method = "HASHED"
            base = bsdf.inputs["Base Color"].default_value
            bsdf.inputs["Base Color"].default_value = (base[0], base[1], base[2], 0.26)

after = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUTPUT, export_format="GLB", use_selection=True,
                          export_materials="EXPORT", export_yup=True)
size = os.path.getsize(OUTPUT) if os.path.exists(OUTPUT) else 0
print(f"INSTALADO {os.path.basename(OUTPUT)} tris {before}->{after} soldados {welded} bytes {size}")

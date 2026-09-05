"""Far LOD for a character: the approved LOD2 mesh decimated, morph targets dropped.

    blender -b -P tools/character_pipeline/build_far_lod.py -- <LOD2.glb> <LOD3.glb> [ratio=0.12]

Skin weights survive the collapse (vertex groups are interpolated) and the
armature and bone names are untouched, so the runtime rebinds it to the Motion
rig exactly as it does the LOD2. Only characters near the player show the
LOD2; this one draws everyone else at a tenth of the triangles.
"""
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
ratio = float(dict(o.split("=", 1) for o in argv[2:]).get("ratio", 0.12))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
before = after = 0
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    bpy.context.view_layer.objects.active = o
    if o.data.shape_keys:
        # decimate refuses a mesh with shape keys; the far LOD has no face to animate
        for key in list(o.data.shape_keys.key_blocks)[::-1]:
            o.shape_key_remove(key)
    o.data.calc_loop_triangles(); before += len(o.data.loop_triangles)
    mod = o.modifiers.new("far", "DECIMATE"); mod.decimate_type = "COLLAPSE"; mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.calc_loop_triangles(); after += len(o.data.loop_triangles)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_yup=True,
                          export_skins=True, export_morph=False, export_animations=False, export_apply=False)
bones = sum(1 for o in bpy.data.objects if o.type == "ARMATURE" for b in o.data.bones)
print(f"LOD_LEJANO {os.path.basename(src)}: {before} -> {after} triangulos, huesos {bones}, {os.path.getsize(dst)/1e6:.1f} MB")

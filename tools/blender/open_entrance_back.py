"""Open the back of the entrance's doorway.

The delivered shell closes the passage with a flat slab at the back of the
block -- 254 faces, all on one plane. It went unnoticed while the panes were
rendering opaque; once the glass actually blends, that slab is what fills the
doorway and reads as a backdrop hung behind the door. Only faces inside the
opening are removed, so the wall behind the piers is untouched.
"""
import bpy, sys, bmesh

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = opts["source"]
OUT = opts["out"]
SHELL = opts.get("shell", "tripo_part_3")
HALF = float(opts.get("half", 0.66))       # the opening, a shade wider than the frame
BACK = float(opts.get("back", 0.60))       # anything behind this is the slab
LOW = float(opts.get("low", -0.80))
BAND = float(opts.get("band", 0.10))   # how far off the plane a face may sit
HIGH = float(opts.get("high", 0.45))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
shell = bpy.data.objects[SHELL]

bpy.context.view_layer.objects.active = shell
bpy.ops.object.select_all(action="DESELECT")
shell.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
mesh = bmesh.from_edit_mesh(shell.data)
bpy.ops.mesh.select_all(action="DESELECT")

# A plain volumetric cut: everything the shell carries behind the door's own
# plane and inside the opening goes. Flood filling along the slab looked
# tidier on paper, but the surface is crinkled enough that the traversal
# either stopped early and left a fringe or spilled onto the piers and tore
# spikes out of them.
world = shell.matrix_world
picked = 0
for face in mesh.faces:
    centre = world @ face.calc_center_median()
    if abs(centre.x) < HALF and centre.y > BACK and LOW < centre.z < HIGH:
        face.select = True
        picked += 1
bmesh.update_edit_mesh(shell.data)
if picked:
    bpy.ops.mesh.delete(type="FACE")
bpy.ops.object.mode_set(mode="OBJECT")
print(f"QUITADAS {picked} caras")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True,
                          export_apply=False, export_materials="EXPORT",
                          use_selection=True, export_animations=False)

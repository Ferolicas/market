"""Give the right pier the same thickness the left one already has.

The earlier widening used a single pivot of 0.645 for both sides, but the
opening is not centred: its edges sit at -0.637 and +0.670. That pivot fell
between them, so the left jamb stayed put and the wall behind it moved out --
the pier grew -- while on the right the jamb itself was past the pivot and
travelled with the wall. The right pier kept its original 0.187 and simply
slid outward, leaving a half-unit void between the pane and the jamb.

This brings that jamb back to where it started. The outer face does not move,
so the faces spanning the two stretch and the pier thickens, exactly as the
left one did. Nothing else in the file is touched: not the bollards, not the
left side, not the frame or the glass.
"""
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

# The void measured on the right side of tripo_part_3: solid up to 0.64, then
# nothing until 1.15. Anything in this window is the displaced jamb.
LOW, HIGH, SHIFT = 0.90, 1.205, 0.50

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

shell = bpy.data.objects["tripo_part_3"]
mw = shell.matrix_world
inv = mw.inverted()
moved = 0
for v in shell.data.vertices:
    p = mw @ v.co
    if LOW < p.x < HIGH:
        p.x -= SHIFT
        v.co = inv @ p
        moved += 1
print(f"jamba derecha movida: {moved} vertices")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=False)

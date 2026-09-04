"""Widen the wall either side of the entrance's opening.

The pier beside the doorway is 0.428 wide on the delivered mesh while a leaf
with its frame half is 0.648, so a door that opens far enough to clear its own
opening always leaves a fifth of itself hanging past the building. The shell is
widened outward from the pier's inner edge: everything outboard of the opening
moves out bodily, so the doorway, the sign and the frame keep their size and
place and only the wall grows.
"""
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = opts["source"]
OUT = opts["out"]
GROW = float(opts.get("grow", 0.24))
SHELL = opts.get("shell", "tripo_part_3")
# Where the opening ends and the pier begins, measured on the delivered mesh.
INNER = float(opts.get("inner", 0.40))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
shell = bpy.data.objects[SHELL]

before = [v.co.x for v in shell.data.vertices]
moved = 0
for v in shell.data.vertices:
    world = shell.matrix_world @ v.co
    if world.x > INNER:
        v.co.x += GROW; moved += 1
    elif world.x < -INNER:
        v.co.x -= GROW; moved += 1
shell.data.update()

pts = [shell.matrix_world @ v.co for v in shell.data.vertices]
print(f"MOVIDOS {moved} de {len(shell.data.vertices)}")
print(f"ANCHO x=[{min(p.x for p in pts):+.3f},{max(p.x for p in pts):+.3f}]")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True,
                          export_apply=False, export_materials="EXPORT",
                          use_selection=True, export_animations=False)

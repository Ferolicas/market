"""Thicken the wall either side of the entrance's opening.

The pier beside the doorway is 0.457 thick on the delivered mesh while a leaf
with its frame half is 0.648, so a door open far enough to clear its own
opening always leaves a fifth of itself hanging past the building.

The pier is stretched away from the opening rather than moved: the inner edge
stays exactly where it is, so the doorway keeps its width, and only the wall
grows outward. Moving the whole outboard block instead widens the opening and
leaves the wall as thin as it was. The bollards travel through the same
mapping, so they stay in the recesses the plinth carries for them.
"""
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = opts["source"]
OUT = opts["out"]
# Where the opening ends and the pier begins. Measured off a render of the
# shell rather than off the vertices: the shell carries material right across
# the doorway -- reveal, threshold, soffit -- so an x histogram cannot tell the
# pier from the hole, and filtering "x greater than a guess" only ever returns
# the guess. The opening runs -0.637 to +0.670.
INNER = float(opts.get("inner", 0.60))
# How much plain wall to insert. The pier is 0.216 thick as delivered and a
# leaf with its frame half is 0.648, so it needs about half a unit more.
GROW = float(opts.get("grow", 0.50))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)

def remap(x):
    """Carry everything outboard of the opening bodily outward.

    Rigidly, not proportionally: a proportional stretch pulls the mouldings and
    the bollard sockets out of shape along with the wall. Moving the outer
    block instead leaves every profile as it was and lets the flat faces that
    cross the cut do the stretching, which is the wall getting longer.
    """
    if x > INNER:
        return x + GROW
    if x < -INNER:
        return x - GROW
    return x


# Only the shell is stretched. The frame, the panes, the sign and its letters
# reach past the opening too, and stretching those would widen the door and the
# sign along with the wall.
SHELL = opts.get("shell", "tripo_part_3")
# The bollards go through the same mapping as the shell, vertex by vertex.
# Carrying them bodily instead leaves them round inside sockets the stretch has
# turned oval, and the ground shows through the gap around each one.
ALSO = [n for n in opts.get("also", "tripo_part_29,tripo_part_30").split(",") if n]

touched = {}
for name in [SHELL] + ALSO:
    obj = bpy.data.objects.get(name)
    if not obj:
        continue
    moved = 0
    for v in obj.data.vertices:
        world = obj.matrix_world @ v.co
        wanted = remap(world.x)
        if abs(wanted - world.x) < 1e-6:
            continue
        v.co.x += wanted - world.x
        moved += 1
    if moved:
        obj.data.update()
        touched[name] = moved

print(f"ENSANCHADO +{GROW} desde {INNER}, piezas tocadas: {touched}")
pts = [o.matrix_world @ v.co for o in bpy.data.objects if o.type == "MESH"
       for v in o.data.vertices]
print(f"ANCHO x=[{min(p.x for p in pts):+.3f},{max(p.x for p in pts):+.3f}]")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True,
                          export_apply=False, export_materials="EXPORT",
                          use_selection=True, export_animations=False)

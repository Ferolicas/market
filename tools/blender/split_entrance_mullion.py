"""Split the entrance's central mullion out of the fixed frame.

The frame arrives as one mesh holding both jambs, the head and the centre post.
A sliding door cannot leave a post standing in the middle of its own opening,
so the centre is separated into two halves -- one per leaf -- which the runtime
then parents to the leaves so they travel with them. No vertex is moved: the
union of the pieces is the frame that came in.
"""
import bpy, sys, bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = opts["source"]
OUT = opts["out"]
FRAME = opts.get("frame", "tripo_part_31")
HALF_WIDTH = float(opts.get("halfwidth", 0.14))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
frame = bpy.data.objects[FRAME]
before = set(bpy.data.objects)


def separate(obj, keep):
    """Pull the faces whose centre satisfies keep() into their own object."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    mesh = bmesh.from_edit_mesh(obj.data)
    for face in mesh.faces:
        face.select = keep(obj.matrix_world @ face.calc_center_median())
    bmesh.update_edit_mesh(obj.data)
    picked = any(f.select for f in mesh.faces)
    if picked:
        bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    return picked


made = separate(frame, lambda p: abs(p.x) < HALF_WIDTH)
if not made:
    raise SystemExit("no se encontro columna central en el marco")
centre = next(o for o in bpy.data.objects if o not in before)
centre.name = "EntranceMullion"

before = set(bpy.data.objects)
separate(centre, lambda p: p.x >= 0)
right = next((o for o in bpy.data.objects if o not in before), None)
centre.name = "EntranceMullionLeft"
if right:
    right.name = "EntranceMullionRight"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True,
                          export_apply=False, export_materials="EXPORT",
                          use_selection=True, export_animations=False)

def span(o):
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    return (min(p.x for p in pts), max(p.x for p in pts), len(o.data.polygons))

for name in ("EntranceMullionLeft", "EntranceMullionRight", FRAME):
    o = bpy.data.objects.get(name)
    if o:
        lo, hi, faces = span(o)
        print(f"PIEZA {name} x=[{lo:+.3f},{hi:+.3f}] caras={faces}")

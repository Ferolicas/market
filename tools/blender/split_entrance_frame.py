"""Give each glass leaf its own frame.

The entrance arrives with the door frame as a single fixed piece -- jambs, head,
sill and centre post in one mesh -- while only the panes are separate. Slide the
panes and the whole grid stays planted in the opening, which is not how a
sliding door behaves. The frame is cut down the line where the two panes meet,
so each half can travel with its own glass. No vertex moves: the two halves put
together are the frame that came in.
"""
import bpy, sys, bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = opts["source"]
OUT = opts["out"]
FRAME = opts.get("frame", "tripo_part_31")
PANES = opts.get("panes", "tripo_part_27,tripo_part_47").split(",")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)


def span(name):
    o = bpy.data.objects[name]
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    return min(p.x for p in pts), max(p.x for p in pts)

# The seam is where the two panes meet, so each half keeps the stile that
# belongs to its own leaf.
edges = sorted(span(p) for p in PANES)
seam = (edges[0][1] + edges[1][0]) * .5
print(f"COSTURA x={seam:+.4f}")

frame = bpy.data.objects[FRAME]
before = set(bpy.data.objects)
bpy.context.view_layer.objects.active = frame
bpy.ops.object.select_all(action="DESELECT")
frame.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
mesh = bmesh.from_edit_mesh(frame.data)
# Cut cleanly along the seam first, so no face straddles it.
bmesh.ops.bisect_plane(mesh, geom=list(mesh.verts) + list(mesh.edges) + list(mesh.faces),
                       plane_co=Vector((seam, 0, 0)), plane_no=Vector((1, 0, 0)),
                       clear_inner=False, clear_outer=False)
bmesh.update_edit_mesh(frame.data)
mesh = bmesh.from_edit_mesh(frame.data)
for face in mesh.faces:
    face.select = (frame.matrix_world @ face.calc_center_median()).x >= seam
bmesh.update_edit_mesh(frame.data)
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")

right = next(o for o in bpy.data.objects if o not in before)
frame.name = "EntranceFrameLeft"
right.name = "EntranceFrameRight"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True,
                          export_apply=False, export_materials="EXPORT",
                          use_selection=True, export_animations=False)

for name in ("EntranceFrameLeft", "EntranceFrameRight"):
    o = bpy.data.objects[name]
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    print(f"PIEZA {name} x=[{min(p.x for p in pts):+.3f},{max(p.x for p in pts):+.3f}] "
          f"caras={len(o.data.polygons)}")

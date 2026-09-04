"""Cut the back wall behind the left pier, and patch the torn pavement.

Two leftovers of the widening.

The back wall goes entirely, between the two piers' outer faces. Cutting only
the model's -x half moved the grey behind the panes by eight levels out of
255, which says the half still standing is the one the camera sees through the
glass: the import does not mirror x the way the layout helper does, so the
side named in a coordinate is not the side on screen. Measuring the render
settles it where reasoning about the axis did not.

The pavement is laid as separate tile patches rather than one welded sheet.
The widening moved whichever patches lay past its pivot and left the rest, so
a piece of the step is missing beside each bollard, and the ground shows pink
through it. The holes were found by walking the slab's upward-facing faces on
a grid rather than by eye: roughly x 0.65 to 1.42 and x -1.41 to -0.64, from
y -0.52 forward to -0.29, with a ragged edge that is squarer to cover than to
trace. Two guesses at this missed. The first patch sat where the slab was
already solid and covered nothing; the second was measured against a file that
still carried the first, which reported that same sound slab back.
Each hole is filled with a quad in the slab's own material, two thousandths
above the surface so the two never fight for the same plane.
"""
import bpy, bmesh, sys
from math import radians

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

BACK = 0.60
INNER_CUT = (-1.34, 1.38)          # between the outer faces of the two piers
CUT_Z = (-0.82, 0.46)
# x0, x1, y0, y1 per hole, each reaching a little into the sound slab around it
HOLES = ((0.640, 1.430, -0.530, -0.277),
         (-1.420, -0.635, -0.530, -0.277))
LIFT = 0.002
FONT = "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

shell = bpy.data.objects["tripo_part_3"]
mw = shell.matrix_world
mats = [m.name if m else "" for m in shell.data.materials]
top_slot = mats.index("losa_superficie")
kerb_slot = mats.index("losa_canto")  # kept: the kerb is sound, only the top tore

bm = bmesh.new(); bm.from_mesh(shell.data); bm.faces.ensure_lookup_table()

doomed = [f for f in bm.faces
          if (c := mw @ f.calc_center_median()).y > BACK
          and INNER_CUT[0] < c.x < INNER_CUT[1] and CUT_Z[0] < c.z < CUT_Z[1]]
bmesh.ops.delete(bm, geom=doomed, context="FACES")
print(f"pared del fondo: {len(doomed)} caras fuera")

# Height of the slab surface and of its kerb, read off the mesh rather than
# assumed: the top sits where the tiles that survived sit.
tops = [(mw @ v.co).z for f in bm.faces if f.material_index == top_slot
        for v in f.verts if -0.75 < (mw @ v.co).y < -0.45]
top_z = max(tops)
bottoms = [(mw @ v.co).z for f in bm.faces if f.material_index == kerb_slot for v in f.verts]
low_z = min(bottoms)
print(f"losa: superficie z={top_z:+.3f}  canto hasta z={low_z:+.3f}")

inv = mw.inverted()
def quad(pts, slot):
    vs = [bm.verts.new(inv @ p) for p in pts]
    f = bm.faces.new(vs)
    f.material_index = slot
    return f

from mathutils import Vector
z = top_z + LIFT
made = [quad([Vector((x0, y0, z)), Vector((x1, y0, z)),
              Vector((x1, y1, z)), Vector((x0, y1, z))], top_slot)
        for x0, x1, y0, y1 in HOLES]
# Normals are set by hand, not recalculated. recalc_face_normals has no
# neighbouring shell to agree with on an isolated quad and turned the first
# attempt face down, which culls it: the patch was in the file and the pink
# still showed through.
nm = mw.to_3x3().inverted().transposed()
for f in made:
    if (nm @ f.normal).z < 0:
        f.normal_flip()
bm.normal_update()
print("parches de acera: " + ", ".join(
    f"{'arriba' if (nm @ f.normal).z > 0.5 else 'MAL'}" for f in made))

bm.to_mesh(shell.data); bm.free(); shell.data.update()

# --- the sign ---
# The delivered word is a 378-face scan of letters with chipped edges. It is
# replaced by type set from a font, kept to the same footprint so it lands
# where it did on the plate: 0.7765 wide, 0.1114 tall, centred on x +0.0284
# and z +0.6342, a hair proud of the panel it sits on.
old = bpy.data.objects["Text"]
pts = [old.matrix_world @ v.co for v in old.data.vertices]
tx = (min(p.x for p in pts), max(p.x for p in pts))
tz = (min(p.z for p in pts), max(p.z for p in pts))
ty = min(p.y for p in pts)
letters = old.data.materials[0]
bpy.data.objects.remove(old, do_unlink=True)

curve = bpy.data.curves.new("EntradaWord", type="FONT")
curve.body = "ENTRADA"
curve.font = bpy.data.fonts.load(FONT)
curve.align_x = "CENTER"; curve.align_y = "CENTER"
curve.extrude = 0.00075
word = bpy.data.objects.new("Text", curve)
bpy.context.collection.objects.link(word)
bpy.context.view_layer.objects.active = word
word.select_set(True)
bpy.ops.object.convert(target="MESH")
word.rotation_euler = (radians(90), 0, 0)          # face the street, -y
bpy.context.view_layer.update()

pts = [word.matrix_world @ v.co for v in word.data.vertices]
w = max(p.x for p in pts) - min(p.x for p in pts)
h = max(p.z for p in pts) - min(p.z for p in pts)
print(f"palabra: proporcion tipografica {w/h:.2f}, la del original {(tx[1]-tx[0])/(tz[1]-tz[0]):.2f}")
# The rotation is applied after the scale, so the height of the word on the
# wall is governed by the object's local y, not its z.
word.scale = ((tx[1]-tx[0]) / w, (tz[1]-tz[0]) / h, 1.0)
bpy.context.view_layer.update()
pts = [word.matrix_world @ v.co for v in word.data.vertices]
word.location = (word.location.x + (tx[0]+tx[1])/2 - (min(p.x for p in pts)+max(p.x for p in pts))/2,
                 ty - 0.004,
                 word.location.z + (tz[0]+tz[1])/2 - (min(p.z for p in pts)+max(p.z for p in pts))/2)
word.data.materials.clear(); word.data.materials.append(letters)
bpy.context.view_layer.update()
pts = [word.matrix_world @ v.co for v in word.data.vertices]
print(f"palabra colocada: x[{min(p.x for p in pts):+.4f},{max(p.x for p in pts):+.4f}] "
      f"z[{min(p.z for p in pts):+.4f},{max(p.z for p in pts):+.4f}] "
      f"y={min(p.y for p in pts):+.4f}  {len(word.data.polygons)} caras")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=False)

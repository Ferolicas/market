"""Open the doorway's back wall and put the bollards back together.

Two independent repairs, both consequences of the pier widening.

The back wall is the flat face at y = +0.67: 2180 triangles carrying 4.34 of
area, where nothing else behind y = 0.30 reaches 0.28. It closes the recess
half a unit behind the glass, which is the slab seen through the panes. Only
the part inside the doorway goes; the cut is bounded by that one plane, so the
bevels that wrap the block are left alone. An earlier attempt cut from y > 0.20
and took those bevels with it, which is what left a torn edge.

The bollards were stretched rather than moved: the widening shifted whatever
lay past its pivot, and their inner edge fell short of it. Each is 0.782 wide
against an original 0.282. Shifting the part that stayed puts them back at
their true width, half a unit out, in the socket the pavement already has.
"""
import bpy, bmesh, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

BACK = 0.60                       # the wall plane sits at 0.67; nothing else is this deep
OPEN_X = (-0.68, 0.71)            # the jambs measure -0.640 and +0.672
OPEN_Z = (-0.82, 0.46)            # floor slab to the top of the frame at +0.43
SHIFT = 0.50

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

shell = bpy.data.objects["tripo_part_3"]
mw = shell.matrix_world
bm = bmesh.new(); bm.from_mesh(shell.data); bm.faces.ensure_lookup_table()
doomed = []
for f in bm.faces:
    c = mw @ f.calc_center_median()
    if c.y > BACK and OPEN_X[0] < c.x < OPEN_X[1] and OPEN_Z[0] < c.z < OPEN_Z[1]:
        doomed.append(f)
bmesh.ops.delete(bm, geom=doomed, context="FACES")
bm.to_mesh(shell.data); bm.free()
shell.data.update()
print(f"vano abierto: {len(doomed)} caras del fondo fuera")

# Right bollard grew outward, left one inward-mirrored; move whichever half
# stayed behind so each becomes rigid again.
for name, keep, step in (("tripo_part_29", lambda x: x < 1.0, +SHIFT),
                         ("tripo_part_30", lambda x: x > -1.0, -SHIFT)):
    ob = bpy.data.objects[name]
    m, inv = ob.matrix_world, ob.matrix_world.inverted()
    n = 0
    for v in ob.data.vertices:
        p = m @ v.co
        if keep(p.x):
            p.x += step; v.co = inv @ p; n += 1
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    xs = [p.x for p in pts]
    print(f"{name}: {n} vertices recolocados, ancho {max(xs)-min(xs):.3f}, "
          f"x[{min(xs):+.3f},{max(xs):+.3f}]")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=False)

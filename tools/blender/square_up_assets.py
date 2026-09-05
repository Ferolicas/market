"""Square each mosaic asset up to the nearest axis in plan.

The catalogue was modelled at an isometric yaw: every piece sits rotated a few
tens of degrees in plan. Placement gives most objects a target box, and fitting
an angled scan into an axis-aligned box shears it, which is what made the walls
and shelves look melted. The fix is a rotation about the vertical only, applied
to the mesh, so no vertex, triangle, UV or texture changes -- just which way the
piece faces.

The angle comes from the covariance of the vertices in plan, which is only
meaningful when the footprint has a long side to speak of, so pieces rounder
than the elongation floor are left exactly as they are.

The correction is the smallest one that lands the long side on an axis, never
the one that lands it on X. Turning everything to X quarter-turns any piece
already lying along Z -- a fence, a counter -- and the placement code, which
rotates those itself where it wants them crosswise, would then face them wrong.
"""
import bpy, sys, math
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
MIN_ELONGATION = 1.35
MIN_OFF_AXIS = 6.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
if not pts:
    print("SIN MALLA"); raise SystemExit

n = len(pts)
mx = sum(p.x for p in pts) / n
my = sum(p.y for p in pts) / n
xx = yy = xy = 0.0
for p in pts:
    dx, dy = p.x - mx, p.y - my
    xx += dx * dx; yy += dy * dy; xy += dx * dy
yaw = 0.5 * math.atan2(2 * xy, xx - yy)
tr, det = (xx + yy) / n, (xx * yy - xy * xy) / (n * n)
disc = max(tr * tr / 4 - det, 0.0) ** 0.5
big, small = tr / 2 + disc, max(tr / 2 - disc, 1e-12)
elong = (big / small) ** 0.5
deg = math.degrees(yaw)
off = min(abs(deg % 90), 90 - abs(deg % 90))

# Smallest turn onto an axis: fold the angle into [-45, 45).
delta = math.radians((deg + 45) % 90 - 45)

if elong < MIN_ELONGATION or off < MIN_OFF_AXIS:
    print(f"SIN CAMBIO  alargamiento={elong:.2f} desvio={off:.1f}")
else:
    rot = Matrix.Rotation(-delta, 4, "Z")
    for o in meshes:
        o.matrix_world = rot @ o.matrix_world
    bpy.context.view_layer.update()
    print(f"GIRADA {-math.degrees(delta):+.1f} grados  alargamiento={elong:.2f} desvio previo={off:.1f}")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True)

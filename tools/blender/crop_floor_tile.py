"""Crop a scanned floor tile down to the largest rectangle it actually fills.

The delivered floor pieces are scans with a ragged outline: seen from above
FloorTileBeige covers 58.7% of its own bounding box and FloorTileWhite 56.3%,
and neither has a single full row or column. No spacing can make shapes like
that meet, which is why laying them left the bed showing through in bands.

So the piece is cut, not imitated: rasterise it from above, find the largest
axis-aligned rectangle that is solid throughout, and bisect away everything
outside it. Every vertex, triangle, UV and texture inside that rectangle is the
designer's, untouched -- what goes is only the ragged fringe that could never
have tiled. The result reports its own coverage so the cut can be trusted.
"""
import bpy, bmesh, sys
import numpy as np
from mathutils.geometry import intersect_point_tri_2d

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
GRID = 200
MARGIN = 1          # cells trimmed off each side, so the cut clears the fringe

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
obj = meshes[0]
mw = obj.matrix_world
mesh = obj.data
mesh.calc_loop_triangles()
V = np.array([[(mw @ v.co)[i] for i in range(3)] for v in mesh.vertices])
lo, hi = V.min(0), V.max(0)

xs = np.linspace(lo[0], hi[0], GRID)
ys = np.linspace(lo[1], hi[1], GRID)
cov = np.zeros((GRID, GRID), bool)
for t in mesh.loop_triangles:
    p = [(V[i][0], V[i][1]) for i in t.vertices]
    i0 = max(0, int((min(q[0] for q in p) - lo[0]) / (hi[0] - lo[0]) * (GRID - 1)))
    i1 = min(GRID - 1, int((max(q[0] for q in p) - lo[0]) / (hi[0] - lo[0]) * (GRID - 1)) + 1)
    j0 = max(0, int((min(q[1] for q in p) - lo[1]) / (hi[1] - lo[1]) * (GRID - 1)))
    j1 = min(GRID - 1, int((max(q[1] for q in p) - lo[1]) / (hi[1] - lo[1]) * (GRID - 1)) + 1)
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            if not cov[i, j] and intersect_point_tri_2d((xs[i], ys[j]), *p):
                cov[i, j] = True
print(f"cobertura del original: {100 * cov.mean():.1f}% de su caja")

# Largest all-true rectangle, by the usual histogram sweep over rows.
best = (0, 0, 0, 0, 0)
heights = np.zeros(GRID, int)
for j in range(GRID):
    heights = np.where(cov[:, j], heights + 1, 0)
    stack = []
    for i in range(GRID + 1):
        h = heights[i] if i < GRID else 0
        start = i
        while stack and stack[-1][1] >= h:
            s, sh = stack.pop()
            area = sh * (i - s)
            if area > best[0]:
                best = (area, s, j - sh + 1, i - 1, j)
            start = s
        stack.append((start, h))
area, i0, j0, i1, j1 = best
i0 += MARGIN; j0 += MARGIN; i1 -= MARGIN; j1 -= MARGIN
x0, x1 = xs[i0], xs[i1]
y0, y1 = ys[j0], ys[j1]
print(f"rectangulo lleno  x [{x0:+.4f},{x1:+.4f}]  fondo [{y0:+.4f},{y1:+.4f}]")
print(f"   = {100*(x1-x0)/(hi[0]-lo[0]):.1f}% del ancho y {100*(y1-y0)/(hi[1]-lo[1]):.1f}% del fondo")

for o in meshes:
    bm = bmesh.new(); bm.from_mesh(o.data)
    inv = o.matrix_world.inverted()
    # Normals point out of the piece that is kept: bisect_plane clears the
    # side its normal faces, so an inward normal would take the tile and leave
    # the fringe.
    for point, normal in (((x0, 0, 0), (-1, 0, 0)), ((x1, 0, 0), (1, 0, 0)),
                          ((0, y0, 0), (0, -1, 0)), ((0, y1, 0), (0, 1, 0))):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                               plane_co=inv @ __import__("mathutils").Vector(point),
                               plane_no=(inv.to_3x3() @ __import__("mathutils").Vector(normal)).normalized(),
                               clear_outer=True, use_snap_center=False)
    bm.to_mesh(o.data); bm.free(); o.data.update()

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True)

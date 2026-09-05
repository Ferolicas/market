"""Build a runtime floor tile from the original mosaic part.

The kit is modelled at an isometric yaw, so every piece sits turned in plan and
its axis-aligned box is far bigger than the piece: the beige floor fills only
58.7% of its own box and has not one full row or column. That is why laying
these as tiles always left the ground showing between them.

Here the part is turned back by the angle of its minimum-area rectangle -- the
honest measure for a square-ish piece, where the dominant-axis one says nothing
-- then cut to the largest rectangle it fills solid, so copies of it meet edge
to edge. Colour is the designer's own: the tile's top face is lifted off the
catalogue sheet square on and mapped straight down onto it.
"""
import bpy, bmesh, sys, math, os
import numpy as np
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_point_tri_2d

argv = sys.argv[sys.argv.index("--") + 1:]
src, part, texture, dst, budget = argv[0], argv[1], argv[2], argv[3], int(argv[4])
GRID = 200

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
keep = bpy.data.objects[part]
for o in [o for o in bpy.data.objects if o.type == "MESH" and o is not keep]:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.objects.active = keep
keep.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def plan(o):
    return np.array([[v.co.x, v.co.y] for v in o.data.vertices])

def hull(P):
    P = P[np.lexsort((P[:, 1], P[:, 0]))]
    def half(pts):
        h = []
        for p in pts:
            while len(h) >= 2 and np.cross(h[-1] - h[-2], p - h[-2]) <= 0:
                h.pop()
            h.append(p)
        return h
    return np.array(half(P)[:-1] + half(P[::-1])[:-1])

H = hull(plan(keep))
best = (1e9, 0.0)
for i in range(len(H)):
    e = H[(i + 1) % len(H)] - H[i]
    a = math.atan2(e[1], e[0])
    c, s = math.cos(-a), math.sin(-a)
    X = H[:, 0] * c - H[:, 1] * s
    Y = H[:, 0] * s + H[:, 1] * c
    area = (X.max() - X.min()) * (Y.max() - Y.min())
    if area < best[0]:
        best = (area, a)
turn = -best[1]
deg = math.degrees(turn) % 90
if deg > 45:
    deg -= 90
keep.data.transform(Matrix.Rotation(math.radians(deg), 4, "Z"))
keep.data.update()
print(f"enderezada {deg:+.2f} grados")

mesh = keep.data
mesh.calc_loop_triangles()
V = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
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
print(f"cubre {100 * cov.mean():.1f}% de su caja ya recta")

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
            if sh * (i - s) > best[0]:
                best = (sh * (i - s), s, j - sh + 1, i - 1, j)
            start = s
        stack.append((start, h))
_, i0, j0, i1, j1 = best
i0 += 1; j0 += 1; i1 -= 1; j1 -= 1
x0, x1, y0, y1 = xs[i0], xs[i1], ys[j0], ys[j1]
print(f"rectangulo lleno {x1-x0:.4f} x {y1-y0:.4f}  ({100*(x1-x0)/(hi[0]-lo[0]):.0f}% x {100*(y1-y0)/(hi[1]-lo[1]):.0f}% de la caja)")

bm = bmesh.new(); bm.from_mesh(mesh)
for co, no in (((x0, 0, 0), (-1, 0, 0)), ((x1, 0, 0), (1, 0, 0)),
               ((0, y0, 0), (0, -1, 0)), ((0, y1, 0), (0, 1, 0))):
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                           plane_co=Vector(co), plane_no=Vector(no), clear_outer=True)
bm.to_mesh(mesh); bm.free(); mesh.update()

before = len(mesh.polygons)
if before > budget:
    mod = keep.modifiers.new("dec", "DECIMATE")
    mod.ratio = budget / before
    bpy.ops.object.modifier_apply(modifier=mod.name)
print(f"caras {before} -> {len(mesh.polygons)}")

# Centre on the origin and stand it on z = 0.
V = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
lo, hi = V.min(0), V.max(0)
mesh.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
mesh.update()

# Straight down projection, so the sheet's own grid lands square on the tile.
V = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
lo2, hi2 = V.min(0), V.max(0)
uv = mesh.uv_layers.new(name="UVMap") if not mesh.uv_layers else mesh.uv_layers[0]
for loop in mesh.loops:
    co = mesh.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = ((co.x - lo2[0]) / (hi2[0] - lo2[0]),
                              (co.y - lo2[1]) / (hi2[1] - lo2[1]))

mat = bpy.data.materials.new(os.path.basename(dst)[:-4])
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.78
bsdf.inputs["Metallic"].default_value = 0.0
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(texture)
mat.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
mesh.materials.clear()
mesh.materials.append(mat)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True)
V = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
print(f"final {V.max(0)[0]-V.min(0)[0]:.4f} x {V.max(0)[1]-V.min(0)[1]:.4f} x {V.max(0)[2]-V.min(0)[2]:.4f}")

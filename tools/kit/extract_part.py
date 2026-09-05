"""Take one part out of a kit mosaic, stand it straight, and give it its colour.

Nothing is cut away and nothing is invented. The kit is modelled at an
isometric yaw, so the piece is turned back by the angle of its own minimum-area
rectangle -- the only measure that means anything on a square-ish piece -- and
then centred and stood on z = 0. Its colour is the designer's: the face is
lifted off the catalogue sheet square on and mapped straight down.
"""
import bpy, bmesh, sys, math, os
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, part, texture, dst, budget = argv[0], argv[1], argv[2], argv[3], int(argv[4])
flat_top = len(argv) > 5 and argv[5] == "plano"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
keep = bpy.data.objects[part]
for o in [o for o in bpy.data.objects if o.type == "MESH" and o is not keep]:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.objects.active = keep
keep.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

P = np.array([[v.co.x, v.co.y] for v in keep.data.vertices])
P = np.unique(P, axis=0)
P = P[np.lexsort((P[:, 1], P[:, 0]))]
def half(pts):
    h = []
    for p in pts:
        while len(h) >= 2 and np.cross(h[-1] - h[-2], p - h[-2]) <= 1e-12:
            h.pop()
        h.append(p)
    return h
H = np.array(half(P)[:-1] + half(P[::-1])[:-1])
best = (1e9, 0.0)
for i in range(len(H)):
    e = H[(i + 1) % len(H)] - H[i]
    a = math.atan2(e[1], e[0])
    c, s = math.cos(-a), math.sin(-a)
    X, Y = H[:, 0] * c - H[:, 1] * s, H[:, 0] * s + H[:, 1] * c
    area = (X.max() - X.min()) * (Y.max() - Y.min())
    if area < best[0]:
        best = (area, a)
deg = math.degrees(-best[1]) % 90
if deg > 45:
    deg -= 90
keep.data.transform(Matrix.Rotation(math.radians(deg), 4, "Z"))
keep.data.update()

# The scan's outline bows in a few thousandths along each side, which is what
# leaves slivers between two pieces laid side by side. The bow is pushed back
# out to the straight line: only the vertices already within the bow's depth of
# an edge move, and they move outwards by at most that depth. Nothing is cut
# and nothing beyond the rim is touched.
mesh = keep.data
V = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
lo2, hi2 = V.min(0), V.max(0)
def bow(values, coords, at_min):
    out = []
    bins = np.linspace(coords.min(), coords.max(), 61)
    for k in range(60):
        m = (coords >= bins[k]) & (coords < bins[k + 1])
        if m.sum() < 3:
            continue
        out.append(values[m].min() - values.min() if at_min else values.max() - values[m].max())
    return np.array(out) if out else np.array([0.0])
def fill_ratio():
    Q = np.unique(np.array([[v.co.x, v.co.y] for v in mesh.vertices]), axis=0)
    Q = Q[np.lexsort((Q[:, 1], Q[:, 0]))]
    def h2(pts):
        h = []
        for q in pts:
            while len(h) >= 2 and np.cross(h[-1] - h[-2], q - h[-2]) <= 1e-12:
                h.pop()
            h.append(q)
        return h
    H = np.array(h2(Q)[:-1] + h2(Q[::-1])[:-1])
    x, y = H[:, 0], H[:, 1]
    a = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    return a / ((Q[:, 0].max() - Q[:, 0].min()) * (Q[:, 1].max() - Q[:, 1].min()))

# Widen the margin until the outline really is the rectangle. One pass is not
# always enough: where the bow is deeper than the first estimate, the vertices
# that stayed behind keep the corner rounded.
depth = max(np.median(bow(V[:, 0], V[:, 1], True)), np.median(bow(V[:, 0], V[:, 1], False)),
            np.median(bow(V[:, 1], V[:, 0], True)), np.median(bow(V[:, 1], V[:, 0], False)))
cap = 0.10 * min(hi2 - lo2)
tol = min(depth * 2.0, cap)
moved = 0
for _ in range(6):
    V = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
    lo2, hi2 = V.min(0), V.max(0)
    for v in mesh.vertices:
        was = (v.co.x, v.co.y)
        if v.co.x - lo2[0] < tol: v.co.x = lo2[0]
        elif hi2[0] - v.co.x < tol: v.co.x = hi2[0]
        if v.co.y - lo2[1] < tol: v.co.y = lo2[1]
        elif hi2[1] - v.co.y < tol: v.co.y = hi2[1]
        if (v.co.x, v.co.y) != was: moved += 1
    mesh.update()
    if fill_ratio() >= 0.995 or tol >= cap:
        break
    tol = min(tol * 1.6, cap)
print(f"   bordes enderezados: comba {depth:.4f}, margen {tol:.4f}, {moved} vertices a la recta, llena {100*fill_ratio():.1f}%")

# Planar first: it merges faces that already lie in the same plane, so a flat
# panel loses its triangles without losing its shape. Collapsing straight to a
# ratio bends every flat face a little, which on a floor reads as a rippled
# surface and a chewed edge.
before = len(mesh.polygons)
mod = keep.modifiers.new("plano", "DECIMATE")
mod.decimate_type = "DISSOLVE"
mod.angle_limit = math.radians(2.5)
bpy.ops.object.modifier_apply(modifier=mod.name)
flat = len(mesh.polygons)
if budget and len(mesh.polygons) > budget:
    mod = keep.modifiers.new("dec", "DECIMATE")
    mod.ratio = budget / len(mesh.polygons)
    bpy.ops.object.modifier_apply(modifier=mod.name)
print(f"   caras {before} -> {flat} tras fundir lo plano -> {len(mesh.polygons)}")

# The scan is not watertight and decimating opens more: every hole shows as a
# speck of whatever lies under the piece. Weld the seams and close the loops.
bm = bmesh.new(); bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
holes = [e for e in bm.edges if len(e.link_faces) < 2]
if holes:
    bmesh.ops.holes_fill(bm, edges=holes)
    holes2 = [e for e in bm.edges if len(e.link_faces) < 2]
    if holes2:
        bmesh.ops.triangle_fill(bm, edges=holes2, use_beauty=True)
# A filled hole inherits no winding, so half of the new faces point into the
# piece and render as dark flecks all over it. Point them all outwards and drop
# anything with no area, which shades as noise too.
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
degenerate = [f for f in bm.faces if f.calc_area() < 1e-12]
if degenerate:
    bmesh.ops.delete(bm, geom=degenerate, context="FACES")
bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
open_after = len([e for e in bm.edges if len(e.link_faces) < 2])
bm.to_mesh(mesh); bm.free(); mesh.update()
mesh.shade_smooth()
print(f"   agujeros: {len(holes)} aristas abiertas -> {open_after}, {len(degenerate)} caras sin area fuera")

if flat_top:
    # A floor has to be flat. The scan's top wanders by a quarter of the tile's
    # own thickness and sits higher at the rim than in the middle, which at
    # floor scale is a visible swell: neighbouring tiles then read as sitting at
    # different heights and the joints stop lining up. Everything in the top
    # band is brought onto one plane. The joints are in the texture, so they
    # stay.
    V = np.array([v.co.z for v in mesh.vertices])
    height = V.max() - V.min()
    ceiling = float(np.percentile(V[V > V.max() - height * 0.25], 60))
    lifted = 0
    for v in mesh.vertices:
        if v.co.z > V.max() - height * 0.28:
            v.co.z = ceiling
            lifted += 1
    mesh.update()
    W = np.array([v.co.z for v in mesh.vertices])
    band = W[W > W.max() - height * 0.28]
    print(f"   cara superior aplanada: {lifted} vertices a z={ceiling:.4f}, ondula {band.max()-band.min():.5f}")

V = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
lo, hi = V.min(0), V.max(0)
mesh.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
mesh.update()

V = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
lo2, hi2 = V.min(0), V.max(0)
uv = mesh.uv_layers[0] if mesh.uv_layers else mesh.uv_layers.new(name="UVMap")
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
b = V.max(0) - V.min(0)
print(f"{part}: girada {deg:+.2f}  caras {before} -> {len(mesh.polygons)}  mide {b[0]:.4f} x {b[1]:.4f} x {b[2]:.4f}")

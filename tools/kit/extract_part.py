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
opts = argv[5:]
flat_top = "plano" in opts
square_elev = "alzado" in opts
flat_front = any(o.startswith("frentePlano") for o in opts)
front_cut = next((float(o.split("=")[1]) for o in opts if o.startswith("frentePlano=")), 1.0)
band_uv = "uvAltura" in opts
fill_grooves = "sinSurcos" in opts
extra_turn = next((float(o.split("=")[1]) for o in opts if o.startswith("giro=")), 0.0)
shear_deg = next((float(o.split("=")[1]) for o in opts if o.startswith("cizalla=")), 0.0)
tex_joints = {}
for o in opts:
    if o.startswith("textura="):
        for spec in o[len("textura="):].split(";"):
            axis, vals = spec.split(":")
            tex_joints[axis] = [float(v) for v in vals.split(",")]
repeat = next((tuple(int(v) for v in o.split("=")[1].split(",")) for o in opts if o.startswith("repite=")), None)
grid = {}
for o in opts:
    if o.startswith("rejilla="):
        for spec in o[len("rejilla="):].split(";"):
            axis, vals = spec.split(":")
            meas = [float(v) for v in vals.split(",")]
            n = len(meas)
            grid[axis] = (meas, [k / (n + 1) for k in range(1, n + 1)])

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
keep.data.transform(Matrix.Rotation(math.radians(deg + extra_turn), 4, "Z"))
keep.data.update()
if shear_deg:
    # A scan can come out sheared, with its two joint families not at right
    # angles. Once one family is upright, sliding x with y by the residual angle
    # squares the other. Every vertex keeps its neighbours; only the lean goes.
    Vs = np.array([[v.co.x, v.co.y] for v in keep.data.vertices])
    cy = (Vs[:, 1].min() + Vs[:, 1].max()) / 2
    k = math.tan(math.radians(shear_deg))
    for v in keep.data.vertices:
        v.co.x += k * (v.co.y - cy)
    keep.data.update()
    print(f"   cizalla corregida: {shear_deg:+.2f} grados")

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

if square_elev:
    # A wall module has to meet the next one: its scanned outline is bitten
    # on all four sides, so modules fitted to their box leave gaps. Every
    # vertex within the bite's depth of a side, the base or the top is pushed
    # onto that bound; in plan the same was already done for the rim.
    V3 = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
    l3, h3 = V3.min(0), V3.max(0); ext = h3 - l3
    tx, tz = 0.05 * ext[0], 0.05 * ext[2]
    moved3 = 0
    for v in mesh.vertices:
        was = (v.co.x, v.co.z)
        if v.co.x - l3[0] < tx: v.co.x = l3[0]
        elif h3[0] - v.co.x < tx: v.co.x = h3[0]
        if v.co.z - l3[2] < tz: v.co.z = l3[2]
        elif h3[2] - v.co.z < tz: v.co.z = h3[2]
        if (v.co.x, v.co.z) != was: moved3 += 1
    mesh.update()
    print(f"   alzado enderezado: {moved3} vertices a los bordes")
if flat_front:
    # The scanned front bulges by a good part of the module's depth. Anything
    # in the front half is brought onto one plane, the plane of its bulk.
    V3 = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
    l3, h3 = V3.min(0), V3.max(0); depth = h3[1] - l3[1]
    # Below the cut the front is one plane; above it (the cap) another, its
    # own, so the cap keeps standing proud as the sheet shows it.
    zcut = l3[2] + (h3[2] - l3[2]) * front_cut
    sel = (V3[:, 1] < l3[1] + depth * 0.45)
    body = V3[sel & (V3[:, 2] < zcut)][:, 1]; cap = V3[sel & (V3[:, 2] >= zcut)][:, 1]
    front = float(np.percentile(body, 50)); capfront = float(np.percentile(cap, 15)) if len(cap) else front
    n = 0
    for v in mesh.vertices:
        if v.co.y < l3[1] + depth * 0.45:
            v.co.y = front if v.co.z < zcut else capfront; n += 1
    mesh.update()
    print(f"   frente aplanado: {n} vertices; cuerpo a y={front:.4f}, coronacion a y={capfront:.4f} (saliente {front-capfront:+.4f})")

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
    # A floor has to be flat, and the scan is not: its top wanders by a quarter
    # of the tile's own thickness and swells at the rim, which at floor scale is
    # about a unit and makes neighbouring tiles read as sitting at different
    # heights. Every vertex standing above the plane of the panels is brought
    # down onto it. Nothing below it moves, so the joints stay the grooves they
    # are -- flat face, sharp joint.
    Z = np.array([v.co.z for v in mesh.vertices])
    span = Z.max() - Z.min()
    band = Z[Z > Z.max() - span * 0.30]
    plane = float(np.percentile(band, 35))
    clamped = 0
    for v in mesh.vertices:
        if v.co.z > plane:
            v.co.z = plane
            clamped += 1
    mesh.update()
    if fill_grooves:
        # The scan cut its grooves crooked: on the beige the horizontal one
        # steps up by a panel's worth of error where it crosses the vertical.
        # No remap straightens a step. The grooves are filled back up to the
        # plane and the joints left to the sheet's own texture, which draws
        # them straight and is already keyed to exact fractions.
        raised = 0
        for v in mesh.vertices:
            if plane - span * 0.50 < v.co.z < plane:
                v.co.z = plane
                raised += 1
        mesh.update()
        print(f"   surcos rellenados: {raised} vertices subidos al plano")
    # Flattening squashes the grooves' walls into faces with no area whose
    # normals still point sideways, and those shade as a dark line where the
    # groove was. Drop them and point everything up again.
    bmc = bmesh.new(); bmc.from_mesh(mesh)
    bmesh.ops.remove_doubles(bmc, verts=bmc.verts, dist=1e-6)
    dead = [f for f in bmc.faces if f.calc_area() < 1e-11]
    if dead: bmesh.ops.delete(bmc, geom=dead, context="FACES")
    bmesh.ops.dissolve_degenerate(bmc, dist=1e-6, edges=bmc.edges)
    bmesh.ops.recalc_face_normals(bmc, faces=bmc.faces)
    bmc.to_mesh(mesh); bmc.free(); mesh.update()
    # The mesh is an open shell, so recalc cannot settle a consistent
    # orientation and leaves the flattened groove walls facing down, which
    # shades a dark line along every groove. Anything lying in the top plane
    # faces up, no exceptions.
    bmu = bmesh.new(); bmu.from_mesh(mesh); bmu.faces.ensure_lookup_table()
    turned = 0
    for f in bmu.faces:
        c = f.calc_center_median()
        if abs(c.z - plane) < span * 0.015 and f.normal.z < 0:
            f.normal_flip(); turned += 1
    bmu.to_mesh(mesh); bmu.free(); mesh.update()
    print(f"   limpieza tras aplanar: {len(dead)} caras sin area fuera, {turned} caras del plano giradas hacia arriba")
    W = np.array([v.co.z for v in mesh.vertices])
    top = W[W > plane - span * 0.02]
    print(f"   cara recortada al plano z={plane:.4f}: {clamped} vertices bajados, "
          f"la cara varia {top.max()-top.min():.6f}")
    # The scan's top is riddled with small holes that no fill closes cleanly,
    # and each one shows whatever lies under the floor. With the face now a
    # true plane, a single quad a hair beneath it, inside the piece and in the
    # same material, sits behind every hole and shows the same tile through
    # it. It is part of the tile, not a bed under it.
    bmq = bmesh.new(); bmq.from_mesh(mesh)
    Vq = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
    qlo, qhi = Vq.min(0), Vq.max(0)
    # Reaching past the outline: where two tiles meet, the face's edge and the
    # quad's edge otherwise fall on one line, and a sub-pixel crack in that line
    # shows the ground. Overlapping the neighbour by this much puts the quad
    # under the crack. Tiles are laid at alternating heights so the overlaps
    # never share a plane.
    margin = 0.006 * max(qhi - qlo)
    qlo = qlo - margin; qhi = qhi + margin
    zq = plane - span * 0.012
    vs = [bmq.verts.new((qlo[0], qlo[1], zq)), bmq.verts.new((qhi[0], qlo[1], zq)),
          bmq.verts.new((qhi[0], qhi[1], zq)), bmq.verts.new((qlo[0], qhi[1], zq))]
    fq = bmq.faces.new(vs)
    fq.normal_update()
    if fq.normal.z < 0: fq.normal_flip()
    bmq.to_mesh(mesh); bmq.free(); mesh.update()
    print(f"   respaldo interior bajo la cara a z={zq:.4f}")

uv_before = None
if grid:
    # The texture must travel with the vertices, or the joint painted on it
    # stays where the scan had it while the groove in the mesh moves: two
    # lines instead of one. The fraction each vertex had before the remap is
    # what it samples afterwards.
    Vb = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
    lb, hb = Vb.min(0), Vb.max(0)
    uv_before = {v.index: ((v.co.x - lb[0]) / (hb[0] - lb[0]), (v.co.y - lb[1]) / (hb[1] - lb[1]))
                 for v in mesh.vertices}
if grid:
    # The scan's panels are not evenly spaced: the beige carries its joints at
    # 0.325 / 0.668 across and 0.370 / 0.708 deep. Copies laid side by side then
    # step 0.370, 0.338, 0.292, 0.370 ... and the grid never lines up. Each axis
    # is stretched piecewise so the measured joints land on exact fractions;
    # the panels keep their pixels, only their widths even out.
    V = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
    lo2, hi2 = V.min(0), V.max(0)
    for axis, (meas, targ) in grid.items():
        i = 0 if axis == "x" else 1
        src_knots = [0.0] + meas + [1.0]
        dst_knots = [0.0] + targ + [1.0]
        for v in mesh.vertices:
            u = (v.co[i] - lo2[i]) / (hi2[i] - lo2[i])
            v.co[i] = lo2[i] + float(np.interp(u, src_knots, dst_knots)) * (hi2[i] - lo2[i])
        print(f"   rejilla {axis}: surcos {meas} -> {['%.3f' % t for t in targ]}")
    mesh.update()

V = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
lo, hi = V.min(0), V.max(0)
mesh.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
mesh.update()

V = np.array([[v.co.x, v.co.y] for v in mesh.vertices])
lo2, hi2 = V.min(0), V.max(0)
uv = mesh.uv_layers[0] if mesh.uv_layers else mesh.uv_layers.new(name="UVMap")
# Where the sheet paints its joints and where the scan cut its grooves do not
# coincide -- on the beige they sit 5% apart -- so the texture is keyed to the
# grooves: the fraction of the tile at which a groove now lies samples the
# fraction of the image at which the painted joint lies, and the panels between
# stretch to fit. Image rows are measured from the top; Blender's v runs from
# the bottom, hence the flip.
if tex_joints and grid:
    kx_m = [0.0] + grid["x"][1] + [1.0]
    kx_t = [0.0] + tex_joints["x"] + [1.0]
    ky_m = [0.0] + grid["y"][1] + [1.0]
    ky_t = [0.0] + sorted(1.0 - v for v in tex_joints["y"]) + [1.0]
if band_uv:
    # Bands by height: v runs from the foot (0) to the cap's top (1), u is
    # simply the position along the module. Every face gets the same strip.
    Vz = np.array([v.co.z for v in mesh.vertices]); zlo, zhi = Vz.min(), Vz.max()
    Vx = np.array([v.co.x for v in mesh.vertices]); xlo, xhi = Vx.min(), Vx.max()
for loop in mesh.loops:
    if band_uv:
        co = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - xlo) / (xhi - xlo), (co.z - zlo) / (zhi - zlo))
    elif repeat:
        # One panel repeated across the tile: the texture is periodic, so the
        # tile's edges show half a joint each and meet the next tile's as one.
        co = mesh.vertices[loop.vertex_index].co
        fx = (co.x - lo2[0]) / (hi2[0] - lo2[0]); fy = (co.y - lo2[1]) / (hi2[1] - lo2[1])
        uv.data[loop.index].uv = (fx * repeat[0], fy * repeat[1])
    elif tex_joints and grid:
        co = mesh.vertices[loop.vertex_index].co
        fx = (co.x - lo2[0]) / (hi2[0] - lo2[0]); fy = (co.y - lo2[1]) / (hi2[1] - lo2[1])
        uv.data[loop.index].uv = (float(np.interp(fx, kx_m, kx_t)), float(np.interp(fy, ky_m, ky_t)))
    elif uv_before is not None:
        uv.data[loop.index].uv = uv_before[loop.vertex_index]
    else:
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
tex.extension = "REPEAT"
mat.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
mesh.materials.clear()
mesh.materials.append(mat)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True)
V = np.array([[v.co.x, v.co.y, v.co.z] for v in mesh.vertices])
b = V.max(0) - V.min(0)
print(f"{part}: girada {deg:+.2f}  caras {before} -> {len(mesh.polygons)}  mide {b[0]:.4f} x {b[1]:.4f} x {b[2]:.4f}")

"""Split one projected piece into two GLBs by a box, keeping texture and UVs.

    blender -b -P tools/kit/split_piece.py -- <in.glb> <outA.glb> <outB.glb>
        caja=x0,x1,z0,z1

Faces whose every vertex lies inside the box (file units, y free) go to B, the
rest to A. Faces are copied one by one into fresh meshes rather than handed to
the separate operator, which converts the selection through vertex mode and
took half the piece with it. Each output is centred on x and y with its base
on zero, and B's offset from A's centre is reported so the caller can stand it
back where it stood.
"""
import bpy, bmesh, sys, os, json
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, outA, outB = argv[0], argv[1], argv[2]
opts = dict(o.split("=", 1) for o in argv[3:])
x0, x1, z0, z1 = (float(v) for v in opts["caja"].split(","))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o = [x for x in bpy.data.objects if x.type == "MESH"][0]
bpy.context.view_layer.objects.active = o; o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
materials = list(o.data.materials)

bm = bmesh.new(); bm.from_mesh(o.data)
uv = bm.loops.layers.uv.active
def inside(v): return x0 <= v.co.x <= x1 and z0 <= v.co.z <= z1
grupos = {"B": [f for f in bm.faces if all(inside(v) for v in f.verts)]}
grupos["A"] = [f for f in bm.faces if f not in set(grupos["B"])]
if opts.get("solo_mayor") == "1":
    # A box also catches scan crumbs floating nearby; keep only the piece that
    # is actually connected, and give the crumbs back to A.
    resto = set(grupos["B"]); islas = []
    while resto:
        semilla = resto.pop(); isla = {semilla}; pila = [semilla]
        while pila:
            f = pila.pop()
            for e in f.edges:
                for g in e.link_faces:
                    if g in resto: resto.discard(g); isla.add(g); pila.append(g)
        islas.append(isla)
    mayor = max(len(i) for i in islas)
    print("ISLAS_EN_CAJA "+json.dumps(sorted((len(i) for i in islas), reverse=True)[:8]))
    umbral = float(opts.get("min_isla", "0.25"))
    guarda = [i for i in islas if len(i) >= mayor * umbral]      # el letrero y su pie, no las migas
    grupos["A"] += [f for isla in islas if isla not in guarda for f in isla]
    grupos["B"] = [f for isla in guarda for f in isla]
if not grupos["B"]: raise SystemExit("la caja no contiene ninguna cara")

def build(faces, name):
    nb = bmesh.new()
    nuv = nb.loops.layers.uv.new("UVMap")
    vmap = {}
    for f in faces:
        vs = []
        for v in f.verts:
            if v not in vmap: vmap[v] = nb.verts.new(v.co)
            vs.append(vmap[v])
        try: nf = nb.faces.new(vs)
        except ValueError: continue
        nf.material_index = f.material_index
        if uv:
            for l, nl in zip(f.loops, nf.loops): nl[nuv].uv = l[uv].uv
    mesh = bpy.data.meshes.new(name); nb.to_mesh(mesh); nb.free()
    for m in materials: mesh.materials.append(m)
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    return obj

report = {}
for key, path in (("A", outA), ("B", outB)):
    obj = build(grupos[key], os.path.basename(path)[:-4])
    P = np.array([[v.co.x, v.co.y, v.co.z] for v in obj.data.vertices])
    lo, hi = P.min(0), P.max(0)
    obj.data.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
    obj.data.update()
    report[key] = {"tam": (hi - lo).round(4).tolist(), "centro": ((lo + hi) / 2).round(4).tolist(),
                   "base": round(float(lo[2]), 4), "caras": len(obj.data.polygons)}
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True)
bm.free()
report["desfase"] = [round(report["B"]["centro"][i] - report["A"]["centro"][i], 4) for i in range(3)]
print("CORTE " + json.dumps(report))

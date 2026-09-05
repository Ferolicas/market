"""A floor slab carrying the kit tile's own face.

The mosaic piece is a photogrammetric reconstruction of the catalogue image, so
its top wanders by a quarter of its own thickness and its outline is ragged.
That is invisible on a shelf and glaring on a floor, which is seen flat and
repeated across the whole shop. This lays the tile's face -- lifted off the
catalogue sheet square on, the designer's own pixels -- on a slab that is
actually flat, with the dark plinth the sheet shows under it.
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
texture, dst = argv[0], argv[1]
width, depth, thick = float(argv[2]), float(argv[3]), float(argv[4])
edge = tuple(int(argv[5][i:i+2], 16) / 255 for i in (0, 2, 4))

bpy.ops.wm.read_factory_settings(use_empty=True)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.mesh.primitive_cube_add(size=1)
slab = bpy.context.active_object
slab.scale = (width / 2, depth / 2, thick / 2)
bpy.ops.object.transform_apply(scale=True)
slab.data.transform(__import__("mathutils").Matrix.Translation((0, 0, thick / 2)))
slab.data.update()

face = bpy.data.materials.new("cara")
face.use_nodes = True
b = face.node_tree.nodes["Principled BSDF"]
b.inputs["Roughness"].default_value = 0.82
b.inputs["Metallic"].default_value = 0.0
img = face.node_tree.nodes.new("ShaderNodeTexImage")
img.image = bpy.data.images.load(texture)
face.node_tree.links.new(b.inputs["Base Color"], img.outputs["Color"])

side = bpy.data.materials.new("canto")
side.use_nodes = True
s = side.node_tree.nodes["Principled BSDF"]
s.inputs["Base Color"].default_value = (*edge, 1)
s.inputs["Roughness"].default_value = 0.9

slab.data.materials.append(face)
slab.data.materials.append(side)
mesh = slab.data
uv = mesh.uv_layers.new(name="UVMap")
for poly in mesh.polygons:
    up = poly.normal.z > 0.9
    poly.material_index = 0 if up else 1
    for li in poly.loop_indices:
        co = mesh.vertices[mesh.loops[li].vertex_index].co
        uv.data[li].uv = ((co.x + width / 2) / width, (co.y + depth / 2) / depth) if up else (0.5, 0.5)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True)
print(f"{os.path.basename(dst)}: losa {width} x {depth} x {thick}, {len(mesh.polygons)} caras")

"""Put the delivered Mixamo clips on a character, and nothing else.

These clips arrive on the very skeleton the cast already uses -- 41 bones,
root "Root" -- so nothing is retargeted here: the curves are copied as they
are. Everything the character carried before is discarded, including the
presets that shipped inside CLIENTEMUJER1.
"""
import bpy, sys, json, math
from pathlib import Path
from mathutils import Quaternion, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = Path(opts["source"])
CLIPDIR = Path(opts["clips"])
OUT = Path(opts["out"])
NAME = opts["name"]
SEX = opts.get("sex", "male")

RENAME = {
    "Hip": "Hips",
    "L_Thigh": "Rig_Leg_L", "L_Calf": "Shin_L", "L_Foot": "Foot_L", "L_ToeBase": "Toe_L",
    "R_Thigh": "Rig_Leg_R", "R_Calf": "Shin_R", "R_Foot": "Foot_R", "R_ToeBase": "Toe_R",
    "Spine01": "Spine", "Spine02": "Chest", "NeckTwist01": "Neck",
    "L_Upperarm": "Rig_Arm_L", "L_Forearm": "Forearm_L", "L_Hand": "Hand_L",
    "R_Upperarm": "Rig_Arm_R", "R_Forearm": "Forearm_R", "R_Hand": "Hand_R",
}

# The angry/arms-crossed/waiting/frustrated file is one long performance with
# two distinct stances in it, so it is cut where the pose changes over.
SEGMENTS = {
    "ENOJADO_BRAZOSCRUZADOS_SINPRODUCTO_ESPERANDO_FRUSTRADO": {
        "brazos_cruzados": (60, 530),
        "manos_cadera": (640, 1140),
    },
}

# Which delivered motion stands behind each name the runtime plays.
MAPPING = {
    "brazos_cruzados": ["Idle", "LookAround", "CarryIdle", "Wait", "Queue", "Browse"],
    "manos_cadera":    ["Impatient", "Confused"],
    "CAMINAR":         ["Walk", "Enter", "Exit", "CarryWalk"],
    "CORRER":          ["Run"],
    "SALUDAR":         ["Wave", "Happy", "Talk", "ReceiveOrder", "ReceiveBag"],
    # AGACHARSE_LEVANTARCAJA squats and takes the box with both hands, so it
    # covers the lift as well. LEVANTARCAJA is the same action reaching with one
    # arm only and is not used; mirroring its working arm was tried twice, by
    # quaternion convention and by reflecting the world matrix, and both left
    # the far arm folded through the torso.
    "AGACHARSE_LEVANTARCAJA": ["PickupLow", "HarvestLow", "StockLow", "Plant",
                               "Harvest", "LiftBox", "CarryBox", "CarryBasket"],
    "ALCANZARALTO":    ["PickupHigh", "HarvestHigh", "StockHigh", "StockMid", "ReachShelf"],
    "GESTODECAJA":     ["CheckoutScan", "CheckoutItem", "CheckoutBag", "ScanItem", "Pay"],
}
# Both box clips reach with one arm only; the idle one stays behind the back.

def channels(action):
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    yield from bag.fcurves
    else:
        yield from action.fcurves


def rename_bones(arm):
    for old, new in RENAME.items():
        bone = arm.data.bones.get(old)
        if bone:
            bone.name = new


def retarget_paths(action):
    for curve in channels(action):
        path = curve.data_path
        if not path.startswith('pose.bones["'):
            continue
        bone = path.split('"')[1]
        if bone in RENAME:
            curve.data_path = path.replace(f'pose.bones["{bone}"]',
                                           f'pose.bones["{RENAME[bone]}"]', 1)


def reset_pose(arm):
    for bone in arm.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


bpy.ops.wm.read_factory_settings(use_empty=True)

before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=str(SOURCE))
owned = [o for o in bpy.data.objects if o not in before]
arm = next(o for o in owned if o.type == "ARMATURE")
mesh = next(o for o in owned if o.type == "MESH")
rename_bones(arm)
arm.name = arm.data.name = f"{NAME}_RuntimeRig"
mesh.name = mesh.data.name = f"{NAME}_Body"
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
if not arm.animation_data:
    arm.animation_data_create()

walk_file = "CAMINARMUJER" if SEX == "female" else "CAMINARHOMBRE"
wanted = {}
for stem in ("ENOJADO_BRAZOSCRUZADOS_SINPRODUCTO_ESPERANDO_FRUSTRADO", walk_file,
             "CORRER", "SALUDAR", "AGACHARSE_LEVANTARCAJA", "ALCANZARALTO",
             "GESTODECAJA"):
    wanted[stem] = CLIPDIR / f"{stem}.fbx"

library = {}
for stem, path in wanted.items():
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=str(path))
    arrived_objects = [o for o in bpy.data.objects if o not in before_objects]
    arrived = [a for a in bpy.data.actions if a not in before_actions]
    label = "CAMINAR" if stem in ("CAMINARHOMBRE", "CAMINARMUJER") else stem
    for action in arrived:
        retarget_paths(action)
        if stem in SEGMENTS:
            for piece, (first, last) in SEGMENTS[stem].items():
                cut = action.copy()
                cut.name = f"__{piece}"
                # Blender keeps the whole curve; the window is carried on the
                # action's own frame range, which is what the exporter samples.
                cut.use_frame_range = True
                cut.frame_start, cut.frame_end = first, last
                cut.use_fake_user = True
                library[piece] = cut
        else:
            action.name = f"__{label}"
            action.use_fake_user = True
            library[label] = action
    for action in arrived:
        if stem in SEGMENTS:
            bpy.data.actions.remove(action)
    for obj in arrived_objects:
        bpy.data.objects.remove(obj, do_unlink=True)


produced = []
for source_label, targets in MAPPING.items():
    source = library.get(source_label)
    if not source:
        continue
    for target in targets:
        copy = source.copy()
        copy.name = target
        copy.use_fake_user = True
        if source.use_frame_range:
            copy.use_frame_range = True
            copy.frame_start, copy.frame_end = source.frame_start, source.frame_end
        produced.append(target)

for action in list(bpy.data.actions):
    if action.name not in produced:
        bpy.data.actions.remove(action)
for obj in list(bpy.data.objects):
    if obj is not arm and obj is not mesh:
        bpy.data.objects.remove(obj, do_unlink=True)

OUT.mkdir(parents=True, exist_ok=True)
common = dict(export_format="GLB", export_yup=True, export_apply=False,
              export_skins=True, export_morph=True, export_materials="EXPORT",
              use_selection=True, export_bake_animation=True,
              export_optimize_animation_size=False,
              export_force_sampling=True, export_reset_pose_bones=True)


def export(path, animations):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True); mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=str(path), export_animations=animations,
                              export_animation_mode="ACTIONS", **common)


export(OUT / "LOD0.glb", True)
export(OUT / "LOD2.glb", False)

print("JSON_START" + json.dumps({
    "name": NAME, "sex": SEX,
    "clips": sorted(produced),
    "fuentes": sorted(library),
    "verts": len(mesh.data.vertices),
    "faces": len(mesh.data.polygons),
}) + "JSON_END")

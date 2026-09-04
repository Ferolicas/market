"""Turn the delivered FBX cast into the runtime's three GLB files per character.

The mesh is never touched: face, body and clothing ship exactly as delivered.
Only the skeleton is renamed to the names the runtime already looks up, and the
clips that live on CLIENTEMUJER1 are copied onto every character's own rig.
"""
import bpy, sys, json, math, statistics
from pathlib import Path
from mathutils import Quaternion, Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = Path(opts["source"])          # the character's own .fbx
CLIPS = Path(opts["clips"])            # CLIENTEMUJER1.fbx, the one carrying actions
RUN = opts.get("run")                  # optional Motion.glb to lift Run from
OUT = Path(opts["out"])                # destination folder
NAME = opts["name"]

# The runtime resolves bones by name (CharacterSockets, CharacterFactory's
# rebind). Renaming here keeps every existing script working untouched.
RENAME = {
    "Hip": "Hips",
    "L_Thigh": "Rig_Leg_L", "L_Calf": "Shin_L", "L_Foot": "Foot_L", "L_ToeBase": "Toe_L",
    "R_Thigh": "Rig_Leg_R", "R_Calf": "Shin_R", "R_Foot": "Foot_R", "R_ToeBase": "Toe_R",
    "Spine01": "Spine", "Spine02": "Chest", "NeckTwist01": "Neck",
    "L_Upperarm": "Rig_Arm_L", "L_Forearm": "Forearm_L", "L_Hand": "Hand_L",
    "R_Upperarm": "Rig_Arm_R", "R_Forearm": "Forearm_R", "R_Hand": "Hand_R",
}

# One delivered motion can stand in for several of the names the game plays.
# Everything the delivery does not cover falls back to the nearest motion so an
# actor never freezes mid-action; those are reported, not hidden.
CLIP_MAP = {
    "idle":              ["Idle", "LookAround", "CarryIdle"],
    "walk":              ["Walk", "CarryWalk", "Enter", "Exit"],
    "wait":              ["Wait", "Queue", "Browse", "ReachShelf"],
    "angry_01":          ["Impatient"],
    "fold_arms":         ["Confused", "CarryBasket", "CarryBox"],
    "greet_02":          ["Talk", "ReceiveOrder", "ReceiveBag"],
    "make_a_call_02":    ["Phone", "ScanItem", "CheckoutScan", "CheckoutItem", "CheckoutBag", "Pay"],
    "wave_goodbye_02":   ["Wave", "Happy"],
}
# No crouch, reach or lift was delivered; these read as the standing motion.
FALLBACK = {
    "idle": ["PickupLow", "PickupHigh", "HarvestLow", "HarvestHigh", "Harvest",
             "StockLow", "StockMid", "StockHigh", "Plant", "LiftBox"],
}


def load(path):
    if str(path).lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=str(path))
    else:
        bpy.ops.import_scene.gltf(filepath=str(path))


def armature_of(objects):
    return next(o for o in objects if o.type == "ARMATURE")


def rename_bones(arm):
    for old, new in RENAME.items():
        bone = arm.data.bones.get(old)
        if bone:
            bone.name = new


def action_channels(action):
    """Blender 5 keeps curves under layers/strips/channelbags."""
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    yield from bag.fcurves
    else:
        yield from action.fcurves


def preset_name(action):
    return action.name.split(":")[-1].split(".")[0]


def retarget_paths(action):
    """Rewrite bone names inside an action's data paths."""
    for curve in action_channels(action):
        path = curve.data_path
        if not path.startswith('pose.bones["'):
            continue
        bone = path.split('"')[1]
        if bone in RENAME:
            curve.data_path = path.replace(f'pose.bones["{bone}"]',
                                           f'pose.bones["{RENAME[bone]}"]', 1)



bpy.ops.wm.read_factory_settings(use_empty=True)

# --- the character itself, geometry untouched -------------------------------
before = set(bpy.data.objects)
load(SOURCE)
character = [o for o in bpy.data.objects if o not in before]
arm = armature_of(character)
mesh = next(o for o in character if o.type == "MESH")
rename_bones(arm)
arm.name = f"{NAME}_RuntimeRig"
arm.data.name = f"{NAME}_RuntimeRig"
mesh.name = f"{NAME}_Body"
mesh.data.name = f"{NAME}_Body"

# --- the clip library -------------------------------------------------------
before = set(bpy.data.objects)
load(CLIPS)
donors = [o for o in bpy.data.objects if o not in before]
donor_arm = armature_of(donors)

library = {}
for action in list(bpy.data.actions):
    if not any(action_channels(action)):
        continue
    retarget_paths(action)
    library[preset_name(action)] = action

if RUN:
    # Run was never delivered with this cast, so it is lifted from the rig the
    # game shipped with. Renaming the channels is not enough: the two rigs hold
    # their bones at different rest orientations, and the same local rotation
    # then folds the legs backwards. Each frame is transferred through both rest
    # poses instead, so the limb ends up where the donor put it in space.
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    load(RUN)
    arrived_objects = [o for o in bpy.data.objects if o not in before_objects]
    arrived = [a for a in bpy.data.actions if a not in before_actions]
    donor_run = next((o for o in arrived_objects if o.type == "ARMATURE"), None)
    source_run = next((a for a in arrived if preset_name(a).lower() in ("run", "tripo_run")), None)
    if donor_run and source_run:
        pairs = [(old, new) for old, new in RENAME.items()] + [("Root", "Root"), ("Head", "Head")]
        pairs = [(old, new) for old, new in pairs if donor_run.pose.bones.get(new) and arm.pose.bones.get(new)]
        if not donor_run.animation_data:
            donor_run.animation_data_create()
        donor_run.animation_data.action = source_run
        if hasattr(source_run, "slots") and source_run.slots:
            donor_run.animation_data.action_slot = source_run.slots[0]
        if not arm.animation_data:
            arm.animation_data_create()
        target = bpy.data.actions.new("__run_source")
        arm.animation_data.action = target
        rest_donor = {new: donor_run.data.bones[new].matrix_local.to_3x3()
                      for _, new in pairs}
        rest_target = {new: arm.data.bones[new].matrix_local.to_3x3()
                       for _, new in pairs}
        first, last = (int(v) for v in source_run.frame_range)
        for frame in range(first, last + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            for _, name in pairs:
                donor_bone = donor_run.pose.bones[name]
                delta = donor_bone.matrix.to_3x3() @ rest_donor[name].inverted()
                bone = arm.pose.bones[name]
                keep = bone.matrix.to_translation()
                bone.matrix = (Matrix.Translation(keep)
                               @ (delta @ rest_target[name]).to_4x4())
                bone.keyframe_insert("rotation_quaternion", frame=frame)
            hips = arm.pose.bones.get("Hips")
            if hips:
                hips.keyframe_insert("location", frame=frame)
        arm.animation_data.action = None
        library["run"] = target
        CLIP_MAP.setdefault("run", []).append("Run")
    for action in arrived:
        bpy.data.actions.remove(action)
    for obj in arrived_objects:
        bpy.data.objects.remove(obj, do_unlink=True)

for obj in donors:
    bpy.data.objects.remove(obj, do_unlink=True)

# --- write one animation per name the runtime asks for ----------------------
if not arm.animation_data:
    arm.animation_data_create()

produced, missing = [], []
plan = []
for preset, names in CLIP_MAP.items():
    for target in names:
        plan.append((preset, target))
for preset, names in FALLBACK.items():
    for target in names:
        plan.append((preset, target))

for preset, target in plan:
    source = library.get(preset)
    if not source:
        missing.append(target)
        continue
    copy = source.copy()
    copy.name = target
    copy.use_fake_user = True
    produced.append(target)

# The presets and the donor's copies stay in the file otherwise, and the
# exporter writes every action it finds -- 95 animations instead of 39.
for action in list(bpy.data.actions):
    if action.name not in produced:
        bpy.data.actions.remove(action)

# The Run donor drags the old rig's helper geometry in with it.
for obj in list(bpy.data.objects):
    if obj is not arm and obj is not mesh:
        bpy.data.objects.remove(obj, do_unlink=True)

OUT.mkdir(parents=True, exist_ok=True)

# Every animation is baked whole and none is size-optimised. Left to its
# defaults the exporter drops channels it judges constant and reuses the pose
# it left behind, so two copies of the same clip came out different: Walk and
# CarryWalk are the same motion and measured seven and six degrees of lean.
common = dict(export_format="GLB", export_yup=True, export_apply=False,
              export_skins=True, export_morph=True, export_materials="EXPORT",
              use_selection=True, export_bake_animation=True,
              export_optimize_animation_size=False,
              export_force_sampling=True, export_reset_pose_bones=True)

def export(path, objects, animations):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path), export_animations=animations,
                              export_animation_mode="ACTIONS" if animations else "ACTIONS",
                              **common)

export(OUT / "LOD0.glb", [arm, mesh], True)
export(OUT / "LOD2.glb", [arm, mesh], False)

print("JSON_START" + json.dumps({
    "name": NAME,
    "clips": sorted(produced),
    "missing": sorted(set(missing)),
    "verts": len(mesh.data.vertices),
    "faces": len(mesh.data.polygons),
    "bones": len(arm.data.bones),
}) + "JSON_END")

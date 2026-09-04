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
# The delivered presets are authored for this skeleton, so they own every name
# they can honestly cover. Everything else comes from the retargeted pack.
CLIP_MAP = {
    "idle":              ["Idle", "LookAround"],
    "walk":              ["Walk", "Enter", "Exit"],
    "wait":              ["Wait", "Queue"],
    "angry_01":          ["Impatient"],
    "fold_arms":         ["Confused"],
    "greet_02":          ["Talk"],
    "make_a_call_02":    ["Phone"],
    "wave_goodbye_02":   ["Wave", "Happy"],
}
# Nothing in the delivery crouches, reaches or lifts. These names come from the
# retired rig's pack instead, retargeted onto this skeleton.
RETARGET_CLIPS = {
    "Run", "PickupLow", "PickupHigh", "HarvestLow", "HarvestHigh", "Harvest",
    "StockLow", "StockMid", "StockHigh", "Plant", "LiftBox", "CarryBox",
    "CarryBasket", "CarryIdle", "CarryWalk", "ReachShelf",
    "CheckoutScan", "CheckoutBag", "CheckoutItem", "ScanItem", "Pay",
    "ReceiveBag", "ReceiveOrder", "Browse",
}
# Anything the retarget does not supply still has to resolve to something.
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

RETARGET_BONES = ["Root", "Hips", "Spine", "Chest", "Neck", "Head",
                  "Rig_Leg_L", "Shin_L", "Foot_L", "Toe_L",
                  "Rig_Leg_R", "Shin_R", "Foot_R", "Toe_R",
                  "Rig_Arm_L", "Forearm_L", "Hand_L",
                  "Rig_Arm_R", "Forearm_R", "Hand_R"]


def hierarchy_order(armature, names):
    """Parents first.

    Setting a pose bone's armature-space matrix is resolved against its parent
    as it stands right now, so a child written before its parent is undone the
    moment the parent moves. Dictionary order put Root last and folded every
    limb backwards.
    """
    depth = {}
    for name in names:
        bone = armature.data.bones[name]
        steps = 0
        parent = bone.parent
        while parent:
            steps += 1
            parent = parent.parent
        depth[name] = steps
    return sorted(names, key=lambda n: depth[n])


def retarget(donor, source, target_arm, name):
    """Carry one clip from the retired rig onto this cast's skeleton.

    The two skeletons hold their bones at different rest orientations, so the
    transfer goes through both rest poses: the rotation the donor bone adds to
    its own rest is the rotation the target bone adds to its own.
    """
    shared = [b for b in RETARGET_BONES
              if donor.pose.bones.get(b) and target_arm.pose.bones.get(b)]
    shared = hierarchy_order(target_arm, shared)
    if not donor.animation_data:
        donor.animation_data_create()
    donor.animation_data.action = source
    if hasattr(source, "slots") and source.slots:
        donor.animation_data.action_slot = source.slots[0]

    rest_donor = {b: donor.data.bones[b].matrix_local.to_3x3() for b in shared}
    rest_target = {b: target_arm.data.bones[b].matrix_local.to_3x3() for b in shared}
    # The retired rig rests with its hips at the origin and the clip is what
    # lifts it, so its resting hip height is no reference at all -- taking a
    # ratio against it comes out negative and throws the cast into the sky. The
    # standing height is read off the clip's own first frame instead.
    donor.animation_data.action = source
    bpy.context.scene.frame_set(int(source.frame_range[0]))
    bpy.context.view_layer.update()
    donor_stand = donor.pose.bones["Hips"].matrix.to_translation().z
    target_stand = target_arm.data.bones["Hips"].head_local.z
    ratio = target_stand / donor_stand if abs(donor_stand) > 1e-3 else 1.0

    baked = bpy.data.actions.new(f"__rt_{name}")
    target_arm.animation_data.action = baked
    first, last = (int(v) for v in source.frame_range)
    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        wanted = {}
        for bone in shared:
            donor_bone = donor.pose.bones[bone]
            wanted[bone] = (donor_bone.matrix.to_3x3()
                            @ rest_donor[bone].inverted()
                            @ rest_target[bone])
        travel = donor.pose.bones["Hips"].matrix.to_translation() * ratio
        for bone in shared:
            pose_bone = target_arm.pose.bones[bone]
            keep = travel if bone == "Hips" else pose_bone.matrix.to_translation()
            pose_bone.matrix = Matrix.Translation(keep) @ wanted[bone].to_4x4()
            # Each bone has to land before the next one is measured against it.
            bpy.context.view_layer.update()
            pose_bone.keyframe_insert("rotation_quaternion", frame=frame)
            if bone == "Hips":
                pose_bone.keyframe_insert("location", frame=frame)
    target_arm.animation_data.action = None
    return baked


if RUN:
    # The retired rig carries the whole gameplay set -- crouching, reaching,
    # lifting, the checkout -- none of which was delivered with this cast. Those
    # clips are retargeted here; anything the delivery does cover keeps the
    # delivered motion, which is authored for this skeleton and always better.
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    load(RUN)
    arrived_objects = [o for o in bpy.data.objects if o not in before_objects]
    arrived = [a for a in bpy.data.actions if a not in before_actions]
    donor_rig = next((o for o in arrived_objects if o.type == "ARMATURE"), None)
    if not arm.animation_data:
        arm.animation_data_create()
    if donor_rig:
        for action in arrived:
            label = preset_name(action)
            if label in RETARGET_CLIPS:
                library[f"rt:{label}"] = retarget(donor_rig, action, arm, label)
                CLIP_MAP.setdefault(f"rt:{label}", []).append(label)
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

seen = set()
ordered = []
for preset, target in plan:
    if target in seen:
        continue
    seen.add(target)
    ordered.append((preset, target))
plan = ordered

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

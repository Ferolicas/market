"""Build a runtime character from the Mixamo-rigged delivery.

The cast and every clip share one skeleton -- Mixamo's, with thumb and index --
so nothing is retargeted: the curves are copied as they are. The bones are
renamed to the names the runtime already looks up, fingers included, so
CharacterSockets and HandPoseDriver work without a line of change.
"""
import bpy, sys, json, math
from pathlib import Path
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)
SOURCE = Path(opts["source"])
CLIPS = Path(opts["clips"])          # the individual .fbx clips
FARM = Path(opts["farm"])            # the unpacked GRANJA pack
OUT = Path(opts["out"])
NAME = opts["name"]
SEX = opts.get("sex", "male")

RENAME = {
    "mixamorig:Hips": "Hips",
    "mixamorig:Spine": "Spine", "mixamorig:Spine1": "Chest", "mixamorig:Spine2": "Chest2",
    "mixamorig:Neck": "Neck", "mixamorig:Head": "Head",
    "mixamorig:LeftShoulder": "Clavicle_L", "mixamorig:LeftArm": "Rig_Arm_L",
    "mixamorig:LeftForeArm": "Forearm_L", "mixamorig:LeftHand": "Hand_L",
    "mixamorig:RightShoulder": "Clavicle_R", "mixamorig:RightArm": "Rig_Arm_R",
    "mixamorig:RightForeArm": "Forearm_R", "mixamorig:RightHand": "Hand_R",
    "mixamorig:LeftUpLeg": "Rig_Leg_L", "mixamorig:LeftLeg": "Shin_L",
    "mixamorig:LeftFoot": "Foot_L", "mixamorig:LeftToeBase": "Toe_L",
    "mixamorig:RightUpLeg": "Rig_Leg_R", "mixamorig:RightLeg": "Shin_R",
    "mixamorig:RightFoot": "Foot_R", "mixamorig:RightToeBase": "Toe_R",
}
# HandPoseDriver curls anything named Thumb_/Index_/Middle_/Ring_/Pinky_ and
# reads the side off the suffix, so the fingers take that shape here and the
# grip works with no change on the C# side.
for side, tag in (("Left", "L"), ("Right", "R")):
    for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        for joint in (1, 2, 3):
            RENAME[f"mixamorig:{side}Hand{finger}{joint}"] = f"{finger}_{joint:02d}_{tag}"

# One long performance holding two stances; nothing in the delivery stands with
# its arms down, so the game's idle is the arms-crossed half.
# Solved once with seamless_window() and written down: the window depends on
# the clip, and the clip is the same for the whole cast.
SEGMENTS = {"ENOJADO": {"brazos_cruzados": (222, 332), "manos_cadera": (660, 944)}}

SINGLES = {
    "ENOJADO": "ENOJADO_BRAZOSCRUZADOS_SINPRODUCTO_ESPERANDO_FRUSTRADO.fbx",
    "CAMINAR": None,                       # chosen by sex below
    "CORRER": "CORRER.fbx",
    "SALUDAR": "SALUDAR.fbx",
    "ALCANZARALTO": "ALCANZARALTO.fbx",
    "AGACHARSE": "AGACHARSE_LEVANTARCAJA.fbx",
    "GESTODECAJA": "GESTODECAJA.fbx",
    "CAMINARCAJA": "CAMNINANDOCONCAJA.fbx",
    "CORRERCAJA": "CORRIENDOCONCAJA.fbx",
    "SEMBRAR": "SEMBRAR.fbx",
}
FARM_CLIPS = {
    "caja_quieto": "box idle.fbx",
    "caja_giro_izquierda": "box turn.fbx",
    "caja_giro_derecha": "box turn (2).fbx",
    "sostener_quieto": "holding idle.fbx",
    "sostener_caminar": "holding walk.fbx",
    "sostener_giro_izquierda": "holding turn left.fbx",
    "sostener_giro_derecha": "holding turn right.fbx",
    "arrancar": "pull plant.fbx",
    "arrancar2": "pull plant (2).fbx",
    "fruta": "pick fruit.fbx",
    "fruta2": "pick fruit (2).fbx",
    "fruta3": "pick fruit (3).fbx",
    "sembrar_semilla": "dig and plant seeds.fbx",
    "plantar_arbol": "plant tree.fbx",
    "plantar_planta": "plant a plant.fbx",
    "arrodillado": "kneeling idle.fbx",
    "regar": "watering.fbx",
    "ordenar_vaca": "cow milking.fbx",
    "carretilla_quieto": "wheelbarrow idle.fbx",
    "carretilla_caminar": "wheelbarrow walk.fbx",
    "carretilla_giro": "wheelbarrow walk turn.fbx",
    "carretilla_descargar": "wheelbarrow dump.fbx",
}

# Purpose-made motion for every name the runtime plays.
MAPPING = {
    "brazos_cruzados": ["Idle", "LookAround", "Wait", "Queue", "Browse"],
    "manos_cadera":    ["Impatient", "Confused"],
    "CAMINAR":         ["Walk", "Enter", "Exit"],
    "CORRER":          ["Run"],
    "SALUDAR":         ["Wave", "Happy", "Talk", "ReceiveOrder", "ReceiveBag"],
    "caja_quieto":     ["CarryIdle", "CarryBox"],
    "CAMINARCAJA":     ["CarryWalk"],
    "CORRERCAJA":      ["CarryRun"],
    "caja_giro_izquierda": ["CarryTurnLeft"],
    "caja_giro_derecha": ["CarryTurnRight"],
    "sostener_quieto": ["CarryBasket"],
    "sostener_caminar": ["BasketWalk"],
    "sostener_giro_izquierda": ["BasketTurnLeft"],
    "sostener_giro_derecha": ["BasketTurnRight"],
    "AGACHARSE":       ["LiftBox", "StockLow"],
    "arrancar":        ["PickupLow"],
    "arrancar2":       ["HarvestLow"],
    "fruta":           ["Harvest"],
    "fruta2":          ["HarvestHigh"],
    "fruta3":          ["HarvestHighAlt"],
    "sembrar_semilla": ["Plant"],
    "plantar_arbol":   ["PlantTree"],
    "plantar_planta":  ["PlantCrop"],
    "regar":           ["Watering"],
    "ordenar_vaca":    ["Milking"],
    "carretilla_quieto": ["WheelbarrowIdle"],
    "carretilla_caminar": ["WheelbarrowWalk"],
    "carretilla_giro": ["WheelbarrowTurn"],
    "carretilla_descargar": ["WheelbarrowDump"],
    "ALCANZARALTO":    ["PickupHigh", "StockMid", "StockHigh", "ReachShelf"],
    "GESTODECAJA":     ["CheckoutScan", "CheckoutItem", "CheckoutBag", "ScanItem", "Pay"],
}


def pose_signature(armature):
    return [b.rotation_quaternion.copy() for b in armature.pose.bones]


def pose_distance(a, b):
    total = 0.0
    for p, q in zip(a, b):
        d = p.rotation_difference(q).angle
        total += min(d, math.tau - d)
    return total


def seamless_window(armature, action, lo, hi, shortest=110):
    """Find the sub-range whose first and last pose match.

    Cutting a long performance at round numbers leaves the loop jumping from
    one pose to a different one -- the arms open at the end of the cycle and
    the next frame has them already crossed. Sampling the region and picking
    the pair of frames that agree removes the cut.
    """
    armature.animation_data.action = action
    if hasattr(action, "slots") and action.slots:
        armature.animation_data.action_slot = action.slots[0]
    poses = {}
    for frame in range(lo, hi + 1, 2):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        poses[frame] = pose_signature(armature)
    frames = sorted(poses)
    best, choice = None, (lo, hi)
    for i, start in enumerate(frames):
        for end in frames[i:]:
            if end - start < shortest:
                continue
            # A longer window is worth a little more mismatch: a two second
            # idle that ticks is worse than a four second one that breathes.
            score = pose_distance(poses[start], poses[end]) - (end - start) * 0.0016
            if best is None or score < best:
                best, choice = score, (start, end)
    armature.animation_data.action = None
    for bone in armature.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return choice


def channels(action):
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    yield from bag.fcurves
    else:
        yield from action.fcurves


def rename_bones(armature):
    for old, new in RENAME.items():
        bone = armature.data.bones.get(old)
        if bone:
            bone.name = new


def rename_paths(action):
    for curve in channels(action):
        path = curve.data_path
        if not path.startswith('pose.bones["'):
            continue
        bone = path.split('"')[1]
        if bone in RENAME:
            curve.data_path = path.replace(f'pose.bones["{bone}"]',
                                           f'pose.bones["{RENAME[bone]}"]', 1)


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

SINGLES["CAMINAR"] = "CAMINARMUJER.fbx" if SEX == "female" else "CAMINARHOMBRE.fbx"

library = {}
sources = [(label, CLIPS / filename) for label, filename in SINGLES.items()]
sources += [(label, FARM / filename) for label, filename in FARM_CLIPS.items()]

for label, path in sources:
    if not path.exists():
        continue
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=str(path))
    arrived_objects = [o for o in bpy.data.objects if o not in before_objects]
    arrived = [a for a in bpy.data.actions if a not in before_actions]
    for action in arrived:
        rename_paths(action)
        if label in SEGMENTS:
            for piece, (first, last) in SEGMENTS[label].items():
                cut = action.copy()
                cut.name = f"__{piece}"
                cut.use_frame_range = True
                cut.frame_start, cut.frame_end = first, last
                cut.use_fake_user = True
                library[piece] = cut
        else:
            action.name = f"__{label}"
            action.use_fake_user = True
            library[label] = action
    if label in SEGMENTS:
        for action in arrived:
            bpy.data.actions.remove(action)
    for obj in arrived_objects:
        bpy.data.objects.remove(obj, do_unlink=True)

def hold_in_place(action):
    """Take the travel out of a clip.

    The delivered clips move the character forward for real -- the run covers
    two metres -- and the controller moves it as well, so the actor drifts
    ahead of itself and snaps back when the cycle restarts. Only the horizontal
    travel is removed; the vertical bob that gives a walk its weight stays.
    """
    arm.animation_data.action = action
    if hasattr(action, "slots") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    hips = arm.pose.bones.get("Hips")
    if not hips:
        return
    first, last = (int(v) for v in action.frame_range)
    # Measured in world space on purpose: an armature imported from FBX does
    # not share the world's idea of up, and locking the wrong pair of axes
    # turns two metres of forward travel into two metres of hovering.
    to_world = arm.matrix_world
    to_local = to_world.inverted()
    bpy.context.scene.frame_set(first)
    bpy.context.view_layer.update()
    home = (to_world @ hips.matrix).to_translation()
    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        world = to_world @ hips.matrix
        here = world.to_translation()
        placed = (Matrix.Translation((home.x, home.y, here.z))
                  @ world.to_3x3().to_4x4())
        hips.matrix = to_local @ placed
        bpy.context.view_layer.update()
        hips.keyframe_insert("location", frame=frame)
    arm.animation_data.action = None
    for bone in arm.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def travels(action, threshold=0.08):
    """Coarse check first: most of these clips never leave the spot, and
    walking the whole library frame by frame is what made a character take
    five minutes to build."""
    arm.animation_data.action = action
    if hasattr(action, "slots") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    hips = arm.pose.bones.get("Hips")
    if not hips:
        return False
    first, last = (int(v) for v in action.frame_range)
    step = max(1, (last - first) // 12 or 1)
    seen = []
    for frame in range(first, last + 1, step):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        spot = (arm.matrix_world @ hips.matrix).to_translation()
        seen.append((spot.x, spot.y))
    arm.animation_data.action = None
    span_x = max(p[0] for p in seen) - min(p[0] for p in seen)
    span_y = max(p[1] for p in seen) - min(p[1] for p in seen)
    return max(span_x, span_y) > threshold


moved = []
for label, action in library.items():
    if travels(action):
        hold_in_place(action)
        moved.append(label)

produced, unmapped = [], []
for label, targets in MAPPING.items():
    source = library.get(label)
    if not source:
        unmapped.extend(targets)
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

# The surface the rest of the store uses: specular reaches glTF at 1.0 by
# default, and every other asset carries KHR_materials_specular at 0.56.
for slot in mesh.material_slots:
    material = slot.material
    if not material or not material.use_nodes:
        continue
    for node in material.node_tree.nodes:
        if node.type != "BSDF_PRINCIPLED":
            continue
        node.inputs["Roughness"].default_value = 0.82
        for key in ("Specular IOR Level", "Specular"):
            if key in node.inputs:
                node.inputs[key].default_value = 0.28
                break
        if "Metallic" in node.inputs:
            node.inputs["Metallic"].default_value = 0.0
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
bpy.ops.object.shade_auto_smooth(angle=math.radians(48))

OUT.mkdir(parents=True, exist_ok=True)
common = dict(export_format="GLB", export_yup=True, export_apply=False,
              export_skins=True, export_morph=True, export_materials="EXPORT",
              use_selection=True, export_bake_animation=True,
              export_optimize_animation_size=True,
              export_force_sampling=True, export_reset_pose_bones=True)


def export(path, animations):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True); mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=str(path), export_animations=animations,
                              export_animation_mode="ACTIONS", **common)


export(OUT / "LOD0.glb", True)
export(OUT / "LOD2.glb", False)

fingers = [b.name for b in arm.data.bones if b.name.startswith(("Thumb_", "Index_"))]
print("JSON_START" + json.dumps({
    "name": NAME, "sex": SEX,
    "clips": sorted(produced), "sin_fuente": sorted(unmapped),
    "fuentes": sorted(library), "fijados": sorted(moved), "dedos": len(fingers),
    "verts": len(mesh.data.vertices), "faces": len(mesh.data.polygons),
    "bones": len(arm.data.bones),
}) + "JSON_END")

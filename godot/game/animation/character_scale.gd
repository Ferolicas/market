class_name CharacterScale
extends RefCounted
## Port of src/game/animation/CharacterScale.ts.

## The currently approved boy is the minimum world height. Adults are only
## ten percent taller, so every actor still belongs to the same visual scale.
const CHILD_CHARACTER_SCENE_SCALE := 1.65
const ADULT_CHARACTER_SCENE_SCALE := CHILD_CHARACTER_SCENE_SCALE / 0.9

## Customer GLBs have per-body calibration values that matched the former
## 1.10 owner scale. Preserve those corrections while moving the whole adult
## cast to the shared scale above.
const CUSTOMER_ADULT_SCALE_FACTOR := ADULT_CHARACTER_SCENE_SCALE / 1.1

static func character_scene_scale(body: String) -> float:
	return CHILD_CHARACTER_SCENE_SCALE if (body == "boy" or body == "girl") else ADULT_CHARACTER_SCENE_SCALE

static func adult_customer_scene_scale(calibrated_scale: float) -> float:
	return calibrated_scale * CUSTOMER_ADULT_SCALE_FACTOR

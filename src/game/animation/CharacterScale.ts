import type { CharacterId } from "../types";

/**
 * The currently approved boy is the minimum world height. Adults are only
 * ten percent taller, so every actor still belongs to the same visual scale.
 */
export const CHILD_CHARACTER_SCENE_SCALE = 1.65;
export const ADULT_CHARACTER_SCENE_SCALE = CHILD_CHARACTER_SCENE_SCALE / 0.9;

// Customer GLBs have per-body calibration values that matched the former
// 1.10 owner scale. Preserve those corrections while moving the whole adult
// cast to the shared scale above.
export const CUSTOMER_ADULT_SCALE_FACTOR = ADULT_CHARACTER_SCENE_SCALE / 1.1;

export function characterSceneScale(body: CharacterId) {
  return body === "boy" || body === "girl"
    ? CHILD_CHARACTER_SCENE_SCALE
    : ADULT_CHARACTER_SCENE_SCALE;
}

export function adultCustomerSceneScale(calibratedScale: number) {
  return calibratedScale * CUSTOMER_ADULT_SCALE_FACTOR;
}

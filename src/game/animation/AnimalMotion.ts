export type FarmAnimalKind = "chicken" | "cow";
export type FarmAnimalClip = "Idle" | "Walk" | "Peck" | "Graze";

/** Short lane in front of the shelter; movement has one visual owner. */
export function animalMotion(kind: FarmAnimalKind, seconds: number, active: boolean) {
  const duration = kind === "cow" ? 1.3 : 0.8;
  const stride = kind === "cow" ? 0.075 : 0.055;
  const speed = 4 * stride / duration;
  const distance = speed * 1.6;
  const phase = ((seconds % 22) + 22) % 22;
  let x = -distance / 2;
  let yaw = 0;
  let clip: FarmAnimalClip = active ? kind === "cow" ? "Graze" : "Peck" : "Idle";
  if (phase < 1.6) { x += speed * phase; clip = "Walk"; }
  else if (phase < 10) x = distance / 2;
  else if (phase < 11) { x = distance / 2; yaw = Math.PI * (phase - 10); clip = "Idle"; }
  else if (phase < 12.6) { x = distance / 2 - speed * (phase - 11); yaw = Math.PI; clip = "Walk"; }
  else if (phase < 21) yaw = Math.PI;
  else { yaw = Math.PI * (22 - phase); clip = "Idle"; }
  return { x, yaw, clip, speed: clip === "Walk" ? speed : 0 };
}

/**
 * Ids the engine mints must come from the state, never from a random source:
 * the same command stream on two machines has to produce the same snapshot,
 * byte for byte, so a server can replay what a client claims happened.
 */
function fnv1a(input: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Final avalanche so neighbouring keys do not share high bits.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

const LANES = [0x811c9dc5, 0x9e3779b9, 0x7f4a7c15, 0x2545f491] as const;

/** RFC 4122 v4-shaped UUID derived from the parts, so schemas that demand a
 * UUID keep accepting it while equal inputs always yield the same id. */
export function deterministicUuid(...parts: readonly (string | number)[]): string {
  const key = parts.map(String).join("\u001f");
  const hex = LANES.map((lane) => fnv1a(key, lane).toString(16).padStart(8, "0")).join("");
  const chars = hex.split("");
  chars[12] = "4";
  chars[16] = ["8", "9", "a", "b"][parseInt(chars[16], 16) % 4];
  const digest = chars.join("");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
}

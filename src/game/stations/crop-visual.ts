function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Selects evenly distributed, deterministic fruit slots for the remaining
 * harvest. A full bed uses every authored slot; a partial bed preserves the
 * same density ratio without bunching all remaining produce into one corner.
 */
export function cropVisualSlotIndices(availableInput: number, yieldCapacityInput: number, slotCountInput: number) {
  const available = nonNegativeInteger(availableInput);
  const slotCount = nonNegativeInteger(slotCountInput);
  if (available < 1 || slotCount < 1) return [];

  const yieldCapacity = Math.max(1, nonNegativeInteger(yieldCapacityInput), available);
  const visibleCount = Math.min(slotCount, Math.max(1, Math.round(slotCount * available / yieldCapacity)));
  if (visibleCount === slotCount) return Array.from({ length: slotCount }, (_, index) => index);

  return Array.from({ length: visibleCount }, (_, index) => (
    Math.min(slotCount - 1, Math.floor((index + 0.5) * slotCount / visibleCount))
  ));
}

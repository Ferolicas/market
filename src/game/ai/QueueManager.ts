export interface QueueSlot {
  index: number;
  customerId: string | null;
}

export class QueueManager {
  private readonly slots: QueueSlot[];
  constructor(count: number) {
    this.slots = Array.from({ length: Math.max(1, count) }, (_, index) => ({ index, customerId: null }));
  }

  reserve(customerId: string) {
    const existing = this.slots.find((slot) => slot.customerId === customerId);
    if (existing) return existing.index;
    const available = [...this.slots].reverse().find((slot) => slot.customerId === null);
    if (!available) return null;
    available.customerId = customerId;
    return available.index;
  }

  release(customerId: string) {
    const slot = this.slots.find((candidate) => candidate.customerId === customerId);
    if (!slot) return false;
    slot.customerId = null;
    this.advance();
    return true;
  }

  advance() {
    const customers = this.slots.filter((slot) => slot.customerId !== null).sort((a, b) => a.index - b.index).map((slot) => slot.customerId!);
    this.slots.forEach((slot) => { slot.customerId = null; });
    customers.forEach((customerId, index) => { this.slots[index].customerId = customerId; });
  }

  first() { return this.slots[0].customerId; }
  positionOf(customerId: string) { return this.slots.find((slot) => slot.customerId === customerId)?.index ?? null; }
  snapshot() { return this.slots.map((slot) => ({ ...slot })); }
}

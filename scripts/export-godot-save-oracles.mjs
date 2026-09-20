import { writeFile } from 'node:fs/promises';
import { createInitialGame, createCampaignGame, applyGameAction, advanceSimulation } from '../src/game/engine.ts';
import { validateSaveTransition } from '../src/game/persistence/SaveAuthority.ts';
import { validatePendingEvents } from '../src/game/persistence/Snapshot.ts';
const cases = [];
const clone = structuredClone;
function add(name, current, next, events = [], options = {}) {
  cases.push({ name, current: clone(current), next: clone(next), events: clone(events), options, expected: validateSaveTransition(current, next, events, options) });
}
const current = createInitialGame();
const country = applyGameAction(current, { type: 'SET_COUNTRY', countryCode: 'CO' });
add('initial country conversion', current, country.state, country.events);
const order = applyGameAction(current, { type: 'ORDER', supplierId: 'campo', productId: 'wheat', quantity: 1 });
for (const id of ['forged-branch', current.franchises[1].id]) add(`invalid origin ${id}`, current, order.state, order.events.map(e => ({ ...e, franchiseId: id })));
const build = applyGameAction(current, { type: 'CONTRIBUTE_BUILD', amountMinor: 500 });
add('forged balance', current, { ...build.state, balanceMinor: build.state.balanceMinor + 1 }, build.events);
add('replayed sequence', current, build.state, build.events.map(e => ({ ...e, sequence: 10 })));
const inventory = clone(build.state); inventory.franchises[0].warehouse.tomatoes = -1;
add('negative inventory', current, inventory, build.events);
const carryCases = [
  { capacity: 3, items: { tomatoes: 2, wheat: 2 } },
  { capacity: 3, items: { tomatoes: -1 } },
  { capacity: 3, items: { potatoes: 1 } },
  { capacity: 21, items: {} },
];
for (const [i, carry] of carryCases.entries()) { const next = clone(current); next.franchises[0].carry = carry; add(`invalid player carry ${i}`, current, next); }
const hiringState = createInitialGame(); hiringState.level = 5;
const hired = applyGameAction(hiringState, { type: 'HIRE', role: 'stocker' });
if (!hired.ok) throw new Error(hired.message);
add('employee hired', hiringState, hired.state, hired.events);
for (const [i, carry] of [...carryCases.slice(0, 3), { capacity: 2 }].entries()) { const next = clone(hired.state); next.franchises[0].employees[0].runtime.carry = carry; add(`invalid employee carry ${i}`, hiringState, next, hired.events); }
const ordered = applyGameAction(current, { type: 'ORDER', supplierId: 'campo', productId: 'wheat', quantity: 10 });
const delivered = advanceSimulation(ordered.state, 80);
const picked = applyGameAction(delivered.state, { type: 'PICKUP_WAREHOUSE' });
const stocked = applyGameAction(picked.state, { type: 'STOCK', productId: 'wheat', quantity: 3, source: 'carry' });
if (![ordered, delivered, picked, stocked].every(r => r.ok)) throw new Error('Original supply scenario failed');
add('supplier delivery and capacity-safe pickup', current, stocked.state, ordered.events);
const registration = applyGameAction(current, { type: 'SET_COUNTRY', countryCode: 'ES' });
add('registered country cannot change', registration.state, { ...registration.state, countryCode: 'US', currency: 'USD' });
const jump = clone(current); jump.level = 30; jump.progression.completedLevels = Array.from({ length: 29 }, (_, i) => i + 1); jump.franchises[0].storeRank = 4;
add('forged level jump', current, jump);
const campaign = createCampaignGame();
add('unchanged campaign', campaign, campaign);
const forgedPurchase = clone(campaign); forgedPurchase.franchises[0].purchases.purchased.push('farmer-1');
add('unpaid purchase', campaign, forgedPurchase);
for (const cash of [0, 100, 100000000]) {
 const next = clone(current); next.franchises[0].registerCashMinor[0] = cash;
 add(`unexplained drawer ${cash}`, current, next);
}
const eventId = '44444444-4444-4444-8444-444444444444';
const sale = { franchiseId: 'barrio', category: 'sales', description: 'Venta', amountMinor: 100, eventId, sequence: 1, occurredAt: '1970-01-01T00:00:00.000Z', type: 'sales', payload: { transactionId: 'test-sale', lane: 0 }, idempotencyKey: eventId };
const sold = clone(current); sold.franchises[0].registerCashMinor[0] = 100; sold.eventSequence = 1; sold.processedEventIds = [eventId];
add('sale enters correct drawer', current, sold, [sale]);
const switched = clone(sold); switched.franchises[0].registerCashMinor = [0, 100, 0];
add('sale cannot move to another drawer', current, switched, [sale]);
const counterfeit = clone(sold); counterfeit.franchises[0].registerCashMinor[0] = 100000000;
add('counterfeit sale with balanced ledger', current, counterfeit, [{ ...sale, amountMinor: 100000000 }]);
const collected = clone(sold); collected.balanceMinor += 100; collected.franchises[0].registerCashMinor[0] = 0; collected.eventSequence = 2; const id2 = '55555555-5555-4555-8555-555555555555'; collected.processedEventIds.push(id2);
const collection = { ...sale, eventId: id2, idempotencyKey: id2, sequence: 2, category: 'cash_collection', type: 'cash_collection', amountMinor: 0, payload: { lane: 0, collectedMinor: 100 } };
add('cash collection conserves money', sold, collected, [collection]);
add('duplicate sale id', current, sold, [sale, sale]);
const validations = [[], [sale], [sale, sale], [{ ...sale, occurredAt: '2025-02-29T12:00Z' }], [{ ...sale, occurredAt: '2024-02-29T12:00Z' }], [{ ...sale, eventId: 'not-a-uuid' }], [{ ...sale, sequence: 1.5 }], [{ ...sale, amountMinor: 0.1 }], [{ ...sale, payload: [] }], [{ ...sale, description: '😀'.repeat(81) }]].map(events => ({ events, expected: validatePendingEvents(events) }));
await writeFile(new URL('../godot/tests/fixtures/save-oracles.json', import.meta.url), JSON.stringify({ cases, validations }) + '\n');
console.log(`${cases.length} source save transitions and ${validations.length} event validation cases`);

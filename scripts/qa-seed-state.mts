// Writes a deep campaign state (every level of the first store closed by the
// headless owner) that browser QA can seed through the recovery key, so
// render budgets are measured on the fullest store, not on day one.
// `pnpm exec tsx scripts/qa-seed-state.mts [output.json] [level]`
import { writeFile } from "node:fs/promises";
import { createCampaignGame, normalizeGameState } from "../src/game/engine";
import { runCampaignBot } from "../src/game/testing/CampaignBot";
import { BUSINESS_DAY_OPEN_MINUTE } from "../src/game/time/BusinessDay";

const output = process.argv[2] ?? "/tmp/market-seed-state.json";
const level = Number(process.argv[3] ?? 30);
const run = runCampaignBot(normalizeGameState(createCampaignGame("ES")), { targetLevel: level, maxTicks: 60_000 });
if (run.level < level) throw new Error(`El bot se quedó en el nivel ${run.level}`);
const state = run.state;
// Country chosen, doors shut at opening time and an empty floor: the QA opens
// the store itself and the shoppers arrive as the campaign allows.
state.tutorialStep = 1;
state.minuteOfDay = BUSINESS_DAY_OPEN_MINUTE;
for (const franchise of state.franchises) {
  franchise.open = false;
  franchise.lightsOn = false;
  franchise.businessMinute = BUSINESS_DAY_OPEN_MINUTE;
  franchise.customers = [];
  franchise.checkoutTransactions = [];
  franchise.queueCustomerIds = [];
}
await writeFile(output, JSON.stringify(state));
console.log(JSON.stringify({ output, level: run.level, ticks: run.ticks, employees: state.franchises[0].employees.length, bytes: JSON.stringify(state).length }));

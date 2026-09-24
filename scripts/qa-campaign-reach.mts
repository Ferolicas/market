// Plays the whole campaign headlessly: every level of every store, with the
// real engine and no browser, and reports how long each store took. Slower
// than the unit test (five minutes of CPU for the six stores), so it runs on
// demand: `pnpm qa:campaign-reach [stores] [maxTicks] [output.json]`.
import { writeFile } from "node:fs/promises";
import { createCampaignGame, normalizeGameState } from "../src/game/engine";
import { CAMPAIGN_LEVEL_COUNT } from "../src/game/progression/LevelCatalog";
import { runCampaignBot } from "../src/game/testing/CampaignBot";

const stores = Number(process.argv[2] ?? 6);
const maxTicks = Number(process.argv[3] ?? 600_000);
const output = process.argv[4] ?? "/tmp/market-campaign-reach.json";
const started = performance.now();
const run = runCampaignBot(normalizeGameState(createCampaignGame("ES")), { targetLevel: CAMPAIGN_LEVEL_COUNT, targetStores: stores, maxTicks });
const wallMs = Math.round(performance.now() - started);
const report = {
  generatedAt: new Date().toISOString(),
  stores, maxTicks, finishedStores: run.finishedStores, ticks: run.ticks, wallMs,
  perTickMs: +(wallMs / Math.max(1, run.ticks)).toFixed(3),
  balanceMinor: run.state.balanceMinor,
  commands: run.commands.length,
  reached: Object.fromEntries(Object.entries(run.reached).map(([id, levels]) => [id, { firstTick: levels[1]?.tick, level30Tick: levels[CAMPAIGN_LEVEL_COUNT]?.tick, level30Day: levels[CAMPAIGN_LEVEL_COUNT]?.day }])),
};
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (run.finishedStores.length < stores) {
  console.error(`Solo ${run.finishedStores.length} de ${stores} locales llegaron al nivel ${CAMPAIGN_LEVEL_COUNT} en ${maxTicks} ticks`);
  process.exit(1);
}

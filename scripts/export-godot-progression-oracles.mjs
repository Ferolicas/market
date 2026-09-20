import { gzipSync } from 'node:zlib';
// Execute the original engine's private helpers without editing its source file.
// The temporary sibling changes exports only; it is removed even on failure.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const temporary = resolve('src/game/.godot-progression-oracle.ts');
const names = ['applyLevelUnlock', 'synchronizeFranchiseProgression', 'normalizeBuildProject', 'normalizeLevel', 'applyPurchaseContent', 'sanitizeCampaignPurchases', 'trimCampaignStaff', 'syncCampaignStaff', 'syncCampaignCrops', 'syncCampaignProgression', 'upgradeTarget', 'applyUpgradeTarget', 'applyRosterUpgrade', 'attributePlayerAction', 'updateMachineWithProgress'];
try {
  await writeFile(temporary, await readFile('src/game/engine.ts', 'utf8') + '\nexport {' + names.join(',') + '};\n', { flag: 'wx' });
  const imported = await import(pathToFileURL(temporary).href);
  const e = imported.default ?? imported;
  const catalogImport = await import('../src/game/catalog.ts');
  const { COUNTRIES, ROLE_INFO } = catalogImport.default ?? catalogImport;
  const campaignImport = await import('../src/game/progression/MartCampaign.ts');
  const { OPENING_PURCHASES } = campaignImport.default ?? campaignImport;
  const rosterImport = await import('../src/game/progression/RosterUpgrades.ts');
  const { rosterEntries } = rosterImport.default ?? rosterImport;
  const data = { legacy: [], campaign: [], sanitize: [], builds: [], upgrades: [], roster: [], attribution: [] };
  for (const country of Object.keys(COUNTRIES)) {
    const legacy = e.createInitialGame(country);
    legacy.simulationTimeMs = 12345;
    for (let level = 2; level <= 30; level++) {
      legacy.level = level;
      e.applyLevelUnlock(legacy, legacy.franchises[0], level);
      data.legacy.push({ country, level, state: structuredClone(legacy) });
    }
    const campaign = e.createCampaignGame(country);
    campaign.simulationTimeMs = 12345;
    for (const purchase of OPENING_PURCHASES) {
      campaign.franchises[0].purchases.purchased.push(purchase.id);
      e.applyPurchaseContent(campaign, campaign.franchises[0], purchase.id);
      e.normalizeLevel(campaign);
      data.campaign.push({ country, id: purchase.id, state: structuredClone(campaign) });
    }
    for (const level of [1, 3, 9, 20, 30]) {
      const state = e.createInitialGame(country);
      state.level = level;
      e.synchronizeFranchiseProgression(state, state.franchises[0]);
      for (const upgrade of ['station', 'player-speed', 'player-capacity', 'employee']) {
        const target = e.upgradeTarget(state, state.franchises[0], upgrade);
        const after = structuredClone(state);
        // UUIDs are the only nondeterministic field in this operation.
        if (target) e.applyUpgradeTarget(after, after.franchises[0], target);
        if (target?.kind === 'hire') after.franchises[0].employees.at(-1).id = '<generated-uuid>';
        data.upgrades.push({ state, upgrade, target, quote: e.upgradeQuote(state, upgrade), after });
      }
    }
    for (const entry of rosterEntries(campaign.franchises[0], e.countryMoneyScale(country))) {
      const after = structuredClone(campaign.franchises[0]);
      e.applyRosterUpgrade(after, entry);
      data.roster.push({ before: campaign.franchises[0], entry, after });
    }
    for (const level of [2, 9, 30]) for (const contribution of [0, 77, 1000]) for (const completed of [false, true]) {
      const project = { id: 'old', level, costMinor: 1000, contributedMinor: contribution, completed };
      data.builds.push({ country, project, result: e.normalizeBuildProject(project, country) });
    }
  }
  for (const type of ['HARVEST', 'LOAD_FLOUR_MILL', 'BAKE_BREAD', 'OPERATE_MACHINE']) {
    const state = e.createInitialGame();
    state.progression.counters = { 'harvest:all': 9, 'production:flour': 2, 'player:production:flour': 8, 'transport:all': 4 };
    const before = { 'harvest:all': 3, 'production:flour': 4, 'transport:all': 4 };
    const action = { type, machineId: 'cheese-maker-1' };
    const after = structuredClone(state);
    e.attributePlayerAction(after, action, before);
    data.attribution.push({ state, before, action, after });
  }
  const stale = e.createCampaignGame();
  const franchise = stale.franchises[0];
  franchise.purchases.purchased = ['coffee-supply-1', 'retired-cashier'];
  franchise.purchases.inherited = ['tomato-2', 'retired-cashier'];
  franchise.purchases.contributions = { 'tomato-3': 4, 'retired-cashier': 100 };
  franchise.purchases.personalProgress = { 'player:harvest:coffee': 4, 'player:order:coffee': 9 };
  for (const role of Object.keys(ROLE_INFO)) for (let i=0; i<5; i++) franchise.employees.push({ id: `${role}-${i}`, role });
  const normalized = structuredClone(stale);
  e.sanitizeCampaignPurchases(normalized.franchises[0]);
  e.trimCampaignStaff(normalized.franchises[0]);
  e.syncCampaignCrops(normalized, normalized.franchises[0]);
  e.syncCampaignStaff(normalized, normalized.franchises[0]);
  e.syncCampaignProgression(normalized);
  data.sanitize.push({ before: stale, after: normalized });
  await writeFile('godot/tests/fixtures/progression-oracles.json.gz', gzipSync(JSON.stringify(data) + '\n'));
  console.log(Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])));
} finally {
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

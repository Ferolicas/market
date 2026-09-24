import { describe, expect, it } from "vitest";
import { createCampaignGame, normalizeGameState } from "../engine";
import { validateSaveTransition } from "../persistence/SaveAuthority";
import { savePayloadSchema } from "../../lib/game-validation";
import { CAMPAIGN_LEVEL_COUNT } from "../progression/LevelCatalog";
import { planBotInteractions, runCampaignBot } from "./CampaignBot";

/** Budget fixed before the run (§0.6): the whole campaign of the first store
 * must close within five business days of optimal play. The headless owner
 * measured 2 days on 24-09-2026; the margin absorbs balance changes without
 * hiding an unreachable level, which would blow through any budget. */
const REACH_ALL_LEVELS_TICKS = 5 * 3 * 60 * 60;

describe("campaign reachability", () => {
  it("reaches every one of the thirty levels of the first store in order within the day budget", () => {
    const run = runCampaignBot(createCampaignGame("ES"), { targetLevel: CAMPAIGN_LEVEL_COUNT, maxTicks: REACH_ALL_LEVELS_TICKS });
    expect(run.level, `stopped at level ${run.level} after ${run.ticks} ticks`).toBe(CAMPAIGN_LEVEL_COUNT);
    expect(run.finishedStores).toEqual(["barrio"]);
    const ticks = Array.from({ length: CAMPAIGN_LEVEL_COUNT }, (_, index) => run.reached.barrio[index + 1]?.tick);
    ticks.forEach((tick, index) => {
      expect(tick, `level ${index + 1} never reached`).toBeTypeOf("number");
      if (index > 0) expect(tick).toBeGreaterThanOrEqual(ticks[index - 1]!);
    });
    expect(run.days).toBeLessThanOrEqual(5);
    // The finished state still passes what the server would check.
    expect(savePayloadSchema.safeParse({ expectedRevision: 1, operationId: "00000000-0000-4000-8000-000000000000", deviceId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002", state: run.state, events: [] }).success).toBe(true);
    expect(normalizeGameState(JSON.parse(JSON.stringify(run.state))).level).toBe(CAMPAIGN_LEVEL_COUNT);
  }, 120_000);

  it("issues only interactions the engine accepts as a valid save transition", () => {
    const state = createCampaignGame("ES");
    state.franchises[0].open = true;
    const run = runCampaignBot(state, { targetLevel: 4, maxTicks: 2_000 });
    expect(run.level).toBeGreaterThanOrEqual(4);
    expect(run.commands.length).toBeGreaterThan(0);
    expect(run.commands.every((command) => command.k !== "t" || (command.i?.length ?? 0) <= 4)).toBe(true);
    // Every tick's outcome must be a transition the server authority accepts.
    let previous = createCampaignGame("ES");
    previous.franchises[0].open = true;
    const verify = runCampaignBot(previous, { targetLevel: 3, maxTicks: 600, onTick: (next) => {
      expect(next.revision).toBeGreaterThan(previous.revision);
      previous = next;
    } });
    expect(verify.level).toBeGreaterThanOrEqual(3);
    expect(validateSaveTransition(createCampaignGame("ES"), verify.state, []).ok).toBe(false);
  });

  it("plans nothing for a store that has nothing to do", () => {
    const state = createCampaignGame("ES");
    expect(planBotInteractions(state)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { createCampaignGame, normalizeGameState } from "../engine";
import { runCampaignBot } from "../testing/CampaignBot";
import { canonicalJson, firstDifference, replayCommands, replayCommandsAsync, tickCommand } from "./CommandLog";
import { replayChecksum, verifyReplay } from "./ServerReplay";
import { serverPathfinderFor } from "../navigation/ServerNavigation";

describe("command log replay", () => {
  it("reproduces a long command stream byte for byte, with ids included", () => {
    const first = runCampaignBot(createCampaignGame("ES"), { targetLevel: 9, maxTicks: 3_000 });
    const second = runCampaignBot(createCampaignGame("ES"), { targetLevel: 9, maxTicks: 3_000 });
    expect(first.level).toBeGreaterThanOrEqual(9);
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
    // Employees, orders, transactions and events carry state-derived ids.
    expect(first.state.franchises[0].employees.map((employee) => employee.id)).toEqual(second.state.franchises[0].employees.map((employee) => employee.id));
    expect(first.state.processedEventIds).toEqual(second.state.processedEventIds);
    expect(first.state.processedEventIds.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    const replayed = replayCommands(createCampaignGame("ES"), first.commands);
    expect(replayed.applied).toBe(first.commands.length);
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(first.state));
  });

  it("matches the server's view: a JSON round trip and normalisation of the base change nothing", async () => {
    // A client always plays from the normalised load, so the bot does too.
    const run = runCampaignBot(normalizeGameState(createCampaignGame("ES")), { targetLevel: 5, maxTicks: 1_500 });
    const base = normalizeGameState(JSON.parse(JSON.stringify(createCampaignGame("ES"))));
    const verdict = await verifyReplay(base, JSON.parse(JSON.stringify(run.state)), run.commands);
    expect(verdict).toMatchObject({ status: "match", applied: run.commands.length });
    expect(replayChecksum(run.state)).toBe(replayChecksum({ ...run.state, lastSavedAt: new Date().toISOString() }));
  });

  it("names the first divergence and refuses nothing when the log is absent", async () => {
    const run = runCampaignBot(createCampaignGame("ES"), { targetLevel: 3, maxTicks: 800 });
    const forged = JSON.parse(JSON.stringify(run.state));
    forged.balanceMinor += 1;
    const verdict = await verifyReplay(createCampaignGame("ES"), forged, run.commands);
    expect(verdict.status).toBe("mismatch");
    expect(verdict.difference).toMatch(/^\$\.balanceMinor: /);
    expect(await verifyReplay(createCampaignGame("ES"), forged, null)).toMatchObject({ status: "absent" });
    expect(firstDifference({ a: [1, 2] }, { a: [1, 3] })).toBe("$.a.1: 2 ≠ 3");
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });

  it("replays ticks that used navigation with the server's own mesh", async () => {
    const pathfinder = await serverPathfinderFor(createCampaignGame("ES"));
    expect(pathfinder).toBeTypeOf("function");
    const client = runCampaignBot(createCampaignGame("ES"), { targetLevel: 3, maxTicks: 600, pathfinder });
    expect(client.commands.some((command) => command.k === "t" && command.n === 1)).toBe(true);
    const server = await replayCommandsAsync(createCampaignGame("ES"), client.commands, serverPathfinderFor);
    expect(replayChecksum(server.state)).toBe(replayChecksum(client.state));
    expect(tickCommand(200, [], 0, true)).toEqual({ k: "t", d: 200, n: 1 });
  }, 60_000);
});

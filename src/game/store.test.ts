import { afterEach, describe, expect, it, vi } from "vitest";
import { applyGameAction, createInitialGame } from "./engine";
import { useMarketStore } from "./store";

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => { entries.delete(key); },
    setItem: (key, value) => { entries.set(key, String(value)); },
  };
}

describe("market store world queue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useMarketStore.setState({ game: null, saveRevision: 0, saveStatus: "idle", message: "", messageRevision: 0, pendingEvents: [] });
  });

  it("consumes proximity pulses once while a slow save is in flight", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());

    let releaseSave!: (response: Response) => void;
    const slowSave = new Promise<Response>((resolve) => { releaseSave = resolve; });
    const fetchMock = vi.fn(() => slowSave);
    vi.stubGlobal("fetch", fetchMock);

    const game = createInitialGame();
    game.tutorialStep = 1;
    const crop = game.franchises[0].crops.find((candidate) => candidate.id === "crop-tomato-1")!;
    Object.assign(crop, { status: "READY", available: 1, readyAt: 0 });
    useMarketStore.setState({ game, saveRevision: 4, saveStatus: "dirty", message: "", pendingEvents: [] });

    const saving = useMarketStore.getState().saveGame();
    expect(useMarketStore.getState().saveStatus).toBe("saving");

    useMarketStore.getState().queueInteraction({ type: "HARVEST", cropId: crop.id, productId: crop.productId });
    useMarketStore.getState().tickWorld(100);
    const duringSave = useMarketStore.getState();
    expect(duringSave.saveStatus).toBe("saving");
    expect(duringSave.game!.franchises[0].carry.items.tomatoes).toBe(1);
    expect(duringSave.game!.franchises[0].crops.find((candidate) => candidate.id === crop.id)).toMatchObject({ status: "GROWING", available: 0 });

    // A second autosave request must not start while the first one is pending.
    await useMarketStore.getState().saveGame();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseSave(new Response(JSON.stringify({ saveRevision: 5 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await saving;

    const final = useMarketStore.getState();
    expect(final.game!.franchises[0].carry.items.tomatoes).toBe(1);
    expect(final.saveRevision).toBe(5);
    expect(final.saveStatus).toBe("dirty");
  });

  it("preserves live mutations and pending events instead of rolling back on a 409", async () => {
    const local = memoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", memoryStorage());

    let releaseSave!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { releaseSave = resolve; })));

    const game = createInitialGame();
    game.tutorialStep = 1;
    const crop = game.franchises[0].crops.find((candidate) => candidate.id === "crop-tomato-1")!;
    Object.assign(crop, { status: "READY", available: 1, readyAt: 0 });
    const authoritative = structuredClone(game);
    useMarketStore.setState({ game, saveRevision: 4, saveStatus: "dirty", message: "", pendingEvents: [] });

    const saving = useMarketStore.getState().saveGame();
    useMarketStore.getState().queueInteraction({ type: "HARVEST", cropId: crop.id, productId: crop.productId });
    useMarketStore.getState().tickWorld(100);
    useMarketStore.getState().dispatch({ type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1 });
    expect(useMarketStore.getState().game!.franchises[0].carry.items.tomatoes).toBe(1);

    releaseSave(new Response(JSON.stringify({ state: authoritative, saveRevision: 9 }), { status: 409, headers: { "Content-Type": "application/json" } }));
    await saving;

    const preserved = useMarketStore.getState();
    expect(preserved.game!.franchises[0].carry.items.tomatoes).toBe(1);
    expect(preserved.pendingEvents.length).toBeGreaterThan(0);
    expect(preserved).toMatchObject({ saveRevision: 4, saveStatus: "conflict" });
    expect(preserved.message).toContain("no fue sustituido");
  });

  it("publishes a new occurrence for repeated text-identical offline transitions", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const game = createInitialGame();
    useMarketStore.setState({ game, saveRevision: 4, saveStatus: "dirty", message: "", messageRevision: 0, pendingEvents: [] });

    await useMarketStore.getState().saveGame();
    const first = useMarketStore.getState();
    expect(first).toMatchObject({
      saveRevision: 4,
      saveStatus: "offline",
      message: "Sin conexión: los cambios siguen protegidos en este dispositivo",
      messageRevision: 1,
    });

    useMarketStore.setState({ saveStatus: "dirty" });
    await useMarketStore.getState().saveGame();
    const second = useMarketStore.getState();
    expect(second.message).toBe(first.message);
    expect(second.messageRevision).toBe(2);
  });

  it("restores a deterministic franchise origin for legacy pending events while offline", async () => {
    const local = memoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const initial = createInitialGame("ES");
    const ordered = applyGameAction(initial, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1 });
    const legacyEvent = structuredClone(ordered.events[0]) as unknown as Record<string, unknown>;
    delete legacyEvent.franchiseId;
    local.setItem("mini-market-recovery-campaign-30-20260915", JSON.stringify({
      state: ordered.state,
      saveRevision: 4,
      pendingEvents: [legacyEvent],
    }));

    await useMarketStore.getState().loadGame();

    expect(useMarketStore.getState().saveStatus).toBe("offline");
    expect(useMarketStore.getState().pendingEvents).toHaveLength(1);
    expect(useMarketStore.getState().pendingEvents[0].franchiseId).toBe(initial.currentFranchiseId);
  });
});

describe("market store conflict resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useMarketStore.setState({ game: null, saveRevision: 0, saveStatus: "idle", message: "", messageRevision: 0, pendingEvents: [] });
  });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("adopts this device's copy at the server's current revision without an event chain", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    const calls: { method: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") return Promise.resolve(json({ state: createInitialGame(), saveRevision: 363, recoveryScope: "test" }));
      return Promise.resolve(json({ ok: true, saveRevision: 364 }));
    }));

    const game = createInitialGame();
    game.tutorialStep = 1;
    game.balanceMinor = 1_920;
    const pendingEvents = applyGameAction(game, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1 }).events;
    useMarketStore.setState({ game, saveRevision: 361, saveStatus: "conflict", message: "", pendingEvents });

    await useMarketStore.getState().adoptLocalCopy();

    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.body).toMatchObject({ adoptLocal: true, expectedRevision: 363, events: [] });
    expect((put.body!.state as { balanceMinor: number }).balanceMinor).toBe(1_920);
    expect(useMarketStore.getState()).toMatchObject({ saveRevision: 364, saveStatus: "saved", pendingEvents: [] });
    expect(useMarketStore.getState().game!.balanceMinor).toBe(1_920);
  });

  it("takes the server's copy and drops the local one on request", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    const server = createInitialGame();
    server.balanceMinor = 24_900;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ state: server, saveRevision: 363, recoveryScope: "test" }))));
    const local = createInitialGame();
    local.balanceMinor = 1_920;
    useMarketStore.setState({ game: local, saveRevision: 361, saveStatus: "conflict", message: "", pendingEvents: [] });

    await useMarketStore.getState().restoreServerCopy();

    expect(useMarketStore.getState()).toMatchObject({ saveRevision: 363, saveStatus: "saved", pendingEvents: [] });
    expect(useMarketStore.getState().game!.balanceMinor).toBe(24_900);
  });

  it("rebuilds a rejected attempt instead of replaying the refused body forever", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    const bodies: Record<string, unknown>[] = [];
    let status = 400;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(status === 400 ? json({ error: "INVALID_SAVE", issues: [{ path: ["state", "franchises", 0, "purchases", "purchased", 0], message: "Invalid option" }] }, 400) : json({ ok: true, saveRevision: 5 }));
    }));
    const game = createInitialGame();
    game.tutorialStep = 1;
    useMarketStore.setState({ game, saveRevision: 4, saveStatus: "dirty", message: "", pendingEvents: [] });

    await useMarketStore.getState().saveGame();
    expect(useMarketStore.getState().saveStatus).toBe("error");
    expect(useMarketStore.getState().message).toContain("purchases.purchased.0");

    status = 200;
    useMarketStore.setState({ saveStatus: "dirty" });
    await useMarketStore.getState().saveGame();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].operationId).not.toBe(bodies[0].operationId);
    expect(useMarketStore.getState()).toMatchObject({ saveRevision: 5, saveStatus: "saved" });
  });
});

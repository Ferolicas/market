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

  it("backs up mutations made during a slow save before accepting a 409", async () => {
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

    const conflictKey = Array.from({ length: local.length }, (_, index) => local.key(index)).find((key) => key?.startsWith("mini-market-conflict-"));
    expect(conflictKey).toBeTruthy();
    const backup = JSON.parse(local.getItem(conflictKey!)!) as { state: typeof game; pendingEvents: unknown[]; saveRevision: number; serverSaveRevision: number };
    expect(backup.state.franchises[0].carry.items.tomatoes).toBe(1);
    expect(backup.pendingEvents.length).toBeGreaterThan(0);
    expect(backup).toMatchObject({ saveRevision: 4, serverSaveRevision: 9 });
    expect(useMarketStore.getState()).toMatchObject({ saveRevision: 9, saveStatus: "conflict", pendingEvents: [] });
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
    local.setItem("mini-market-recovery-v1", JSON.stringify({
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

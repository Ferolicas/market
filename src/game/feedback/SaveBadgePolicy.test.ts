import { describe, expect, it } from "vitest";
import { SAVE_BADGE_STALE_MS, saveBadgePresentation } from "./SaveBadgePolicy";

describe("save badge", () => {
  it("reads GUARDADO while the last confirmed save is fresh, even though the world keeps marking the game dirty", () => {
    const confirmedAt = 1_000_000;
    expect(saveBadgePresentation("dirty", confirmedAt, confirmedAt + 100)).toEqual({ label: "GUARDADO", tone: "saved" });
    expect(saveBadgePresentation("dirty", confirmedAt, confirmedAt + 45_000)).toEqual({ label: "GUARDADO", tone: "saved" });
    expect(saveBadgePresentation("saved", confirmedAt, confirmedAt + 100)).toEqual({ label: "GUARDADO", tone: "saved" });
  });

  it("reads SIN GUARDAR only once the autosave has clearly stalled", () => {
    const confirmedAt = 1_000_000;
    expect(saveBadgePresentation("dirty", confirmedAt, confirmedAt + SAVE_BADGE_STALE_MS + 1)).toEqual({ label: "SIN GUARDAR", tone: "dirty" });
    expect(saveBadgePresentation("dirty", 0, 5_000)).toEqual({ label: "SIN GUARDAR", tone: "dirty" });
  });

  it("keeps the degraded states visible", () => {
    expect(saveBadgePresentation("saving", 1, 2).label).toBe("GUARDANDO");
    expect(saveBadgePresentation("offline", 1, 2).label).toBe("COPIA LOCAL");
    expect(saveBadgePresentation("conflict", 1, 2).label).toBe("CONFLICTO");
    expect(saveBadgePresentation("error", 1, 2).label).toBe("ERROR");
  });
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EQUIPMENT_ASSET_IDS, EXPOSURE_ASSET_IDS, FARM_ASSET_IDS, MARKET_ASSETS, MARKET_REFERENCE_ROOT } from "./AssetRegistry";

describe("AssetRegistry", () => {
  it("registra las 14 exposiciones, 22 equipos y 25 piezas de huerta", () => {
    expect(EXPOSURE_ASSET_IDS).toHaveLength(14);
    expect(EQUIPMENT_ASSET_IDS).toHaveLength(22);
    expect(FARM_ASSET_IDS).toHaveLength(25);
    expect(new Set(MARKET_ASSETS.map((asset) => asset.id)).size).toBe(MARKET_ASSETS.length);
  });

  it("apunta únicamente a GLB reales y aprobados", () => {
    const sourcePngsAreMounted = existsSync(MARKET_REFERENCE_ROOT);
    for (const asset of MARKET_ASSETS) {
      expect(asset.status).toBe("approved");
      expect(existsSync(join(process.cwd(), "public", asset.asset))).toBe(true);
      expect(asset.referenceImages.length).toBeGreaterThan(0);
      expect(asset.referenceImages.every((reference) => reference.startsWith(`${MARKET_REFERENCE_ROOT}/`))).toBe(true);
      // The original kit is intentionally external to the public repository.
      // Validate the actual PNG files whenever that private source mount exists.
      if (sourcePngsAreMounted) expect(asset.referenceImages.every(existsSync)).toBe(true);
    }
  });
});

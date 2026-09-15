import { describe, expect, it, vi } from "vitest";
import { CAMPAIGN_RELEASE, CAMPAIGN_SAVE_SLOT } from "./CampaignRelease";
import { LEGACY_RECOVERY_KEY, RECOVERY_SCOPE_KEY, readRecoverySnapshot } from "./RecoveryStorage";

describe("campaign reset isolation", () => {
  it("uses a different server slot and does not import old local progress offline", async () => {
    expect(CAMPAIGN_SAVE_SLOT).toBe(2);
    expect(LEGACY_RECOVERY_KEY).toContain(CAMPAIGN_RELEASE);
    expect(RECOVERY_SCOPE_KEY).toContain(CAMPAIGN_RELEASE);
    const reads: string[] = [];
    vi.stubGlobal("localStorage", { getItem: (key: string) => { reads.push(key); return null; } });
    try {
      expect(await readRecoverySnapshot()).toBeNull();
      expect(reads).not.toContain("mini-market-recovery-v1");
      expect(reads).not.toContain("mini-market-recovery-scope-v1");
    } finally { vi.unstubAllGlobals(); }
  });
});

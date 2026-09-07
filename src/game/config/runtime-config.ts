export const runtimeConfig = Object.freeze({
  schemaVersion: 1,
  version: "2026-09-07.1",
  flags: Object.freeze({
    seasonalEvents: false,
    experimentalNpc: false,
    remoteContent: false,
    premiumStore: false,
  }),
  tuning: Object.freeze({
    localSaveIntervalSeconds: 10,
    remoteSaveIntervalSeconds: 1800,
  }),
});

export type RuntimeConfig = typeof runtimeConfig;


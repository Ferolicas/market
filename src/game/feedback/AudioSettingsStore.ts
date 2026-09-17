"use client";

import { create } from "zustand";
import { AUDIO_SETTINGS_KEY, DEFAULT_AUDIO_SETTINGS, normalizeAudioSettings, parseAudioSettings, serializeAudioSettings, type AudioSettings } from "./AudioSettings";

interface AudioSettingsStore extends AudioSettings {
  hydrated: boolean;
  /** Reads the device preference once the page is on the client. */
  hydrate: () => void;
  update: (change: Partial<AudioSettings>) => void;
}

function readStored(): AudioSettings {
  try { return parseAudioSettings(window.localStorage.getItem(AUDIO_SETTINGS_KEY)); } catch { return { ...DEFAULT_AUDIO_SETTINGS }; }
}

function writeStored(settings: AudioSettings) {
  try { window.localStorage.setItem(AUDIO_SETTINGS_KEY, serializeAudioSettings(settings)); } catch { /* private mode or blocked storage: the session keeps the value */ }
}

export function audioSettingsOf(store: AudioSettings): AudioSettings {
  return { music: store.music, effects: store.effects, vibration: store.vibration };
}

export const useAudioSettings = create<AudioSettingsStore>((set, get) => ({
  ...DEFAULT_AUDIO_SETTINGS,
  hydrated: false,
  hydrate: () => { if (!get().hydrated) set({ ...readStored(), hydrated: true }); },
  update: (change) => {
    const next = normalizeAudioSettings({ ...audioSettingsOf(get()), ...change });
    writeStored(next);
    set(next);
  },
}));

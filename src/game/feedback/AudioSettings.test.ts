import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIO_SETTINGS, normalizeAudioSettings, parseAudioSettings, serializeAudioSettings, volumeGain } from "./AudioSettings";

describe("ajustes de sonido", () => {
  it("usa los valores por defecto cuando no hay nada guardado o está corrupto", () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings("{not json")).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings("[1,2]")).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
  it("recorta los volúmenes a 0..1 y conserva la vibración solo si es booleana", () => {
    expect(normalizeAudioSettings({ music: 1.7, effects: -3, vibration: "yes" })).toEqual({ music: 1, effects: 0, vibration: true });
    expect(normalizeAudioSettings({ music: "0.25", effects: Number.NaN, vibration: false })).toEqual({ music: 0.25, effects: DEFAULT_AUDIO_SETTINGS.effects, vibration: false });
  });
  it("sobrevive a un viaje por localStorage", () => {
    const stored = serializeAudioSettings({ music: 0.333, effects: 0, vibration: false });
    expect(parseAudioSettings(stored)).toEqual({ music: 0.33, effects: 0, vibration: false });
  });
  it("convierte el deslizador en ganancia perceptual", () => {
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBe(0.25);
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(Number.NaN)).toBe(0);
  });
});

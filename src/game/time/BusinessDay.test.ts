import { describe, expect, it } from "vitest";
import {
  BUSINESS_DAY_DUSK_MINUTE,
  BUSINESS_DAY_GAME_MINUTES,
  BUSINESS_DAY_NIGHT_MINUTE,
  BUSINESS_DAY_OPEN_MINUTE,
  BUSINESS_DAY_REAL_DURATION_MS,
  businessDayIsClosing,
  businessMinutesForRealMs,
  daylightPresentation,
} from "./BusinessDay";

describe("business day clock", () => {
  it("maps exactly three active real hours from opening to 21:00", () => {
    expect(BUSINESS_DAY_OPEN_MINUTE + businessMinutesForRealMs(BUSINESS_DAY_REAL_DURATION_MS)).toBe(BUSINESS_DAY_NIGHT_MINUTE);
    expect(businessMinutesForRealMs(BUSINESS_DAY_REAL_DURATION_MS / 2)).toBe(BUSINESS_DAY_GAME_MINUTES / 2);
    expect(businessDayIsClosing(BUSINESS_DAY_NIGHT_MINUTE - 0.01)).toBe(false);
    expect(businessDayIsClosing(BUSINESS_DAY_NIGHT_MINUTE)).toBe(true);
  });

  it("stays fully daylight until 18:00 and reaches night at 21:00", () => {
    const opening = daylightPresentation(BUSINESS_DAY_OPEN_MINUTE);
    const dusk = daylightPresentation(BUSINESS_DAY_DUSK_MINUTE);
    const sunset = daylightPresentation((BUSINESS_DAY_DUSK_MINUTE + BUSINESS_DAY_NIGHT_MINUTE) / 2);
    const night = daylightPresentation(BUSINESS_DAY_NIGHT_MINUTE);

    expect(opening).toEqual(dusk);
    expect(opening.phase).toBe("day");
    expect(sunset.phase).toBe("sunset");
    expect(night.phase).toBe("night");
    expect(night.ambientIntensity).toBeLessThan(sunset.ambientIntensity);
    expect(sunset.ambientIntensity).toBeLessThan(opening.ambientIntensity);
  });
});

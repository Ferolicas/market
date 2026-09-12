"use client";

import { createContext, useContext } from "react";
import { marketRenderProfileForCapabilities, type MarketRenderProfile } from "@/game/render/AdaptiveQuality";

const DEFAULT_MARKET_RENDER_PROFILE = marketRenderProfileForCapabilities({ width: 1440, coarsePointer: false, devicePixelRatio: 1 });

/** The renderer policy chosen once per page before the WebGL context exists.
 * Scene components read it to skip presentation work the profile forbids. */
export const MarketRenderProfileContext = createContext<MarketRenderProfile>(DEFAULT_MARKET_RENDER_PROFILE);

export function useMarketRenderProfile() {
  return useContext(MarketRenderProfileContext);
}

/** Authored transmission for thin glass, or 0 where the profile disables the
 * separate transmission scene pass. Tint, opacity, clearcoat and environment
 * reflections are unaffected. */
export function useGlassTransmission(amount: number) {
  return useMarketRenderProfile().glassTransmission ? amount : 0;
}

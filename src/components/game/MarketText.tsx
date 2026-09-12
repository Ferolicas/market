"use client";

import { Text, type TextProps } from "@react-three/drei";

const MARKET_FONT_URL = "/fonts/OpenSans-SemiBold.ttf";

/**
 * Textos 3D autosuficientes. El fallback de Troika consulta una fuente externa;
 * la CSP de producción la bloquea y una promesa pendiente puede suspender toda
 * la escena. Esta fuente viaja con la PWA y siempre cumple la política `self`.
 */
export function MarketText(props: TextProps) {
  return <Text {...props} font={MARKET_FONT_URL} />;
}

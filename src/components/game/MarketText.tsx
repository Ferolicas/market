"use client";

import { Text, type TextProps } from "@react-three/drei";
import { memo } from "react";

const MARKET_FONT_URL = "/fonts/OpenSans-SemiBold.ttf";

/**
 * Textos 3D autosuficientes. El fallback de Troika consulta una fuente externa;
 * la CSP de producción la bloquea y una promesa pendiente puede suspender toda
 * la escena. Esta fuente viaja con la PWA y siempre cumple la política `self`.
 *
 * Drei's Text re-runs `troikaMesh.sync()` after every render, which posts a
 * layout job to the worker and re-uploads the glyph geometry. Fixture and
 * building components re-render on world ticks with identical props, so the
 * wrapper only lets a render through when a prop actually changed (array
 * props such as `position` are compared by value).
 */
export const MarketText = memo(function MarketText(props: TextProps) {
  return <Text {...props} font={MARKET_FONT_URL} />;
}, sameTextProps);

function sameTextProps(previous: TextProps, next: TextProps) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (!sameTextValue((previous as Record<string, unknown>)[key], (next as Record<string, unknown>)[key])) return false;
  }
  return true;
}

function sameTextValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameTextValue(value, right[index]));
  }
  return false;
}

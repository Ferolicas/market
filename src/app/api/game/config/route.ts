import { runtimeConfig } from "@/game/config/runtime-config";

// Public by design: it contains only kill switches and tuning bounds. Never
// place credentials, prices, entitlements or user-specific decisions here.
export const dynamic = "force-static";

export function GET() {
  return Response.json(runtimeConfig, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}


import { db } from "@/lib/db";
import { CAMPAIGN_RELEASE } from "@/game/persistence/CampaignRelease";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", service: "market", database: "ok", release: CAMPAIGN_RELEASE, build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" });
  } catch {
    return Response.json({ status: "degraded", service: "market", database: "error" }, { status: 503 });
  }
}

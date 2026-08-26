import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", service: "market", database: "ok" });
  } catch {
    return Response.json({ status: "degraded", service: "market", database: "error" }, { status: 503 });
  }
}

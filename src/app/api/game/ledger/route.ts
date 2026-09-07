import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { consumeApiRateLimit, rateLimitExceeded } from "@/lib/api-rate-limit";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const rateLimit = await consumeApiRateLimit({ scope: "ledger:read", subject: session.user.id, limit: 60, windowSeconds: 60 });
  if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);
  const entries = await db.ledgerEntry.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return Response.json({ entries: entries.map((entry) => ({ ...entry, amountMinor: entry.amountMinor.toString() })) });
}

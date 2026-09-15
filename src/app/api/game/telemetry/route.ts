import { auth } from "@/lib/auth";
import { consumeApiRateLimit, rateLimitExceeded } from "@/lib/api-rate-limit";
import { db } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const telemetrySchema = z.object({
  kind: z.enum(["error", "performance", "webgl", "save"]),
  name: z.string().min(1).max(100),
  severity: z.enum(["info", "warning", "error"]).default("info"),
  message: z.string().max(1_000).optional(),
  route: z.string().max(300).optional(),
  deviceId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  payload: z.record(z.string().max(80), z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const rateLimit = await consumeApiRateLimit({ scope: "telemetry:write", subject: session.user.id, limit: 12, windowSeconds: 60 });
  if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_000) return Response.json({ error: "TELEMETRY_TOO_LARGE" }, { status: 413 });
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 32_000) return Response.json({ error: "TELEMETRY_TOO_LARGE" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = telemetrySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "INVALID_TELEMETRY" }, { status: 400 });

  await db.clientTelemetry.create({
    data: {
      userId: session.user.id,
      kind: parsed.data.kind,
      name: parsed.data.name,
      severity: parsed.data.severity,
      message: parsed.data.message,
      route: parsed.data.route,
      deviceId: parsed.data.deviceId,
      sessionId: parsed.data.sessionId,
      payload: parsed.data.payload,
    },
  });
  if (Math.random() < 0.01) {
    await db.clientTelemetry.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) } } });
  }
  return Response.json({ ok: true }, { status: 201 });
}

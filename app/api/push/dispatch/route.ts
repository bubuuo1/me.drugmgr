import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchDuePushNotifications } from "@/lib/push-server";

function secretsMatch(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.PUSH_DISPATCH_SECRET?.trim();
  if (!expectedSecret) {
    return Response.json(
      { ok: false, error: "Push dispatcher is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const suppliedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!suppliedSecret || !secretsMatch(suppliedSecret, expectedSecret)) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const result = await dispatchDuePushNotifications(expectedSecret);
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "Push dispatch failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return Response.json(
      { ok: false, error: "Push dispatch failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

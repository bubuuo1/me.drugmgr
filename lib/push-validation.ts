import type { PushSubscriptionPayload } from "@/lib/push-contracts";

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("알림 구독 정보 형식이 올바르지 않습니다.");
  }
  return value as Record<string, unknown>;
}

function isSupportedPushEndpoint(endpoint: URL): boolean {
  const hostname = endpoint.hostname.toLowerCase();
  return (
    hostname === "fcm.googleapis.com" ||
    hostname === "web.push.apple.com" ||
    hostname === "updates.push.services.mozilla.com" ||
    hostname.endsWith(".notify.windows.com")
  );
}

function decodedByteLength(value: string): number {
  return Math.floor((value.replace(/=+$/, "").length * 6) / 8);
}

function validatedKey(
  value: unknown,
  label: string,
  expectedByteLength: number
): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > MAX_KEY_LENGTH ||
    !BASE64_URL_PATTERN.test(value) ||
    decodedByteLength(value) !== expectedByteLength
  ) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

export function validatePushSubscription(
  value: unknown
): PushSubscriptionPayload {
  const input = asObject(value);
  if (
    typeof input.endpoint !== "string" ||
    input.endpoint.length === 0 ||
    input.endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    throw new Error("알림 구독 주소가 올바르지 않습니다.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    throw new Error("알림 구독 주소가 올바르지 않습니다.");
  }
  if (endpoint.protocol !== "https:" || !isSupportedPushEndpoint(endpoint)) {
    throw new Error("지원하지 않는 알림 서비스입니다.");
  }

  const keys = asObject(input.keys);
  const expirationTime = input.expirationTime;
  if (
    expirationTime !== null &&
    expirationTime !== undefined &&
    (typeof expirationTime !== "number" ||
      !Number.isSafeInteger(expirationTime) ||
      expirationTime < 0)
  ) {
    throw new Error("알림 구독 만료 시각이 올바르지 않습니다.");
  }

  return {
    endpoint: endpoint.href,
    expirationTime: expirationTime ?? null,
    keys: {
      p256dh: validatedKey(keys.p256dh, "알림 공개 키", 65),
      auth: validatedKey(keys.auth, "알림 인증 키", 16),
    },
  };
}

export function expirationTimeToIso(expirationTime: number | null): string | null {
  if (expirationTime === null) return null;
  const date = new Date(expirationTime);
  if (Number.isNaN(date.getTime())) {
    throw new Error("알림 구독 만료 시각이 올바르지 않습니다.");
  }
  return date.toISOString();
}

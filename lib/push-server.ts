import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  sendNotification,
  WebPushError,
  type PushSubscription as WebPushSubscription,
} from "web-push";
import type {
  DuePushNotification,
  PushMessagePayload,
  PushSubscriptionPayload,
} from "@/lib/push-contracts";
import type { Database } from "@/lib/types";
import {
  expirationTimeToIso,
  validatePushSubscription,
} from "@/lib/push-validation";

type VapidConfiguration = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`알림 서버 설정 오류: ${name}이 필요합니다.`);
  return value;
}

function pushDatabase(): SupabaseClient<Database> {
  const url = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!publicKey) {
    throw new Error(
      "알림 서버 설정 오류: Supabase publishable key가 필요합니다."
    );
  }
  return createClient<Database>(url, publicKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function vapidConfiguration(): VapidConfiguration {
  const subject = requiredEnvironment("VAPID_SUBJECT");
  if (!subject.startsWith("https://") && !subject.startsWith("mailto:")) {
    throw new Error("알림 서버 설정 오류: VAPID_SUBJECT 형식이 올바르지 않습니다.");
  }
  return {
    subject,
    publicKey: requiredEnvironment("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    privateKey: requiredEnvironment("VAPID_PRIVATE_KEY"),
  };
}

function dispatchSecret(): string {
  return requiredEnvironment("PUSH_DISPATCH_SECRET");
}

function webPushSubscription(
  subscription: PushSubscriptionPayload | DuePushNotification
): WebPushSubscription {
  const keys =
    "p256dh" in subscription
      ? { p256dh: subscription.p256dh, auth: subscription.auth }
      : subscription.keys;
  return {
    endpoint: subscription.endpoint,
    keys,
  };
}

function statusCodeOf(error: unknown): number | null {
  if (error instanceof WebPushError) return error.statusCode;
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return null;
}

function isExpiredSubscriptionStatus(status: number | null): boolean {
  return status === 404 || status === 410;
}

function scheduleReminderMessage(databaseTitle: string): {
  title: string;
  body: string;
} {
  const suffix = " 예정";
  const scheduleAndMedication = databaseTitle.endsWith(suffix)
    ? databaseTitle.slice(0, -suffix.length)
    : databaseTitle;
  return {
    title: `${scheduleAndMedication} 투약 기록 확인`,
    body: `${scheduleAndMedication} 투약 기록을 확인해 주세요.`,
  };
}

async function deliverPush(
  subscription: WebPushSubscription,
  payload: PushMessagePayload,
  topic: string,
  ttl: number
): Promise<number> {
  const result = await sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: vapidConfiguration(),
    TTL: ttl,
    urgency: "high",
    topic: createHash("sha256").update(topic).digest("base64url").slice(0, 32),
    timeout: 10_000,
  });
  return result.statusCode;
}

export async function registerPushSubscription(value: unknown): Promise<void> {
  const subscription = validatePushSubscription(value);
  const { error } = await pushDatabase().rpc("register_push_subscription", {
    p_auth: subscription.keys.auth,
    p_dispatch_secret: dispatchSecret(),
    p_endpoint: subscription.endpoint,
    p_expiration_time: expirationTimeToIso(subscription.expirationTime),
    p_p256dh: subscription.keys.p256dh,
  });
  if (error) throw new Error(`알림 기기 등록 실패: ${error.message}`);
}

export async function unregisterPushSubscription(value: unknown): Promise<void> {
  const subscription = validatePushSubscription(value);
  const { error } = await pushDatabase().rpc("unregister_push_subscription", {
    p_auth: subscription.keys.auth,
    p_dispatch_secret: dispatchSecret(),
    p_endpoint: subscription.endpoint,
  });
  if (error) throw new Error(`알림 기기 해제 실패: ${error.message}`);
}

export async function sendTestPush(value: unknown): Promise<void> {
  const requested = validatePushSubscription(value);
  const client = pushDatabase();
  const { data, error } = await client
    .rpc("get_push_subscription_for_test", {
      p_auth: requested.keys.auth,
      p_dispatch_secret: dispatchSecret(),
      p_endpoint: requested.endpoint,
    })
    .maybeSingle();
  if (error) throw new Error(`테스트 알림 준비 실패: ${error.message}`);
  if (!data) throw new Error("이 기기의 알림 등록을 찾지 못했습니다.");

  try {
    await deliverPush(
      { endpoint: data.endpoint, keys: { p256dh: data.p256dh, auth: data.auth } },
      {
        title: "알림 테스트",
        body: "이 기기에서 약별 투약 일정 알림을 받을 수 있습니다.",
        icon: "/icon-192x192.png",
        url: "/",
        tag: "medicine-push-test",
      },
      "medicine-push-test",
      120
    );
  } catch (error) {
    const status = statusCodeOf(error);
    if (isExpiredSubscriptionStatus(status)) {
      await unregisterPushSubscription(requested).catch(() => undefined);
      throw new Error("알림 등록이 만료되었습니다. 알림을 다시 켜 주세요.");
    }
    throw new Error("테스트 알림을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function dispatchDuePushNotifications(
  dispatchSecret: string,
  now = new Date()
): Promise<{
  claimed: number;
  accepted: number;
  failed: number;
  expired: number;
  skipped: number;
  superseded: number;
}> {
  const client = pushDatabase();
  const { data, error } = await client.rpc("claim_due_push_notifications", {
    p_dispatch_secret: dispatchSecret,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`발송 대상 조회 실패: ${error.message}`);

  const results = await Promise.all(
    data.map(async (claimedItem) => {
      const prepared = await client
        .rpc("prepare_push_delivery_for_send", {
          p_attempt_count: claimedItem.attempt_count,
          p_delivery_id: claimedItem.delivery_id,
          p_dispatch_secret: dispatchSecret,
          p_now: now.toISOString(),
        })
        .maybeSingle();
      if (prepared.error) {
        throw new Error(`발송 직전 확인 실패: ${prepared.error.message}`);
      }
      if (!prepared.data) {
        return {
          success: false,
          expired: false,
          skipped: true,
          superseded: false,
        };
      }

      const item = prepared.data;
      const message = scheduleReminderMessage(item.title);
      let success = false;
      let expired = false;
      let responseStatus: number | null = null;
      let errorCode: string | null = null;
      try {
        responseStatus = await deliverPush(
          webPushSubscription(item),
          {
            title: message.title,
            body: message.body,
            icon: "/icon-192x192.png",
            url: item.url,
            tag: item.tag,
          },
          item.tag,
          0
        );
        success = true;
      } catch (caught) {
        responseStatus = statusCodeOf(caught);
        expired = isExpiredSubscriptionStatus(responseStatus);
        errorCode = responseStatus ? `web_push_${responseStatus}` : "web_push_error";
      }

      const completed = await client.rpc("complete_push_delivery", {
        p_attempt_count: item.attempt_count,
        p_delivery_id: item.delivery_id,
        p_disable_subscription: expired,
        p_dispatch_secret: dispatchSecret,
        p_error_code: errorCode,
        p_response_status: responseStatus,
        p_success: success,
      });
      if (completed.error) {
        throw new Error(`발송 결과 저장 실패: ${completed.error.message}`);
      }
      return {
        success,
        expired,
        skipped: false,
        superseded: completed.data !== true,
      };
    })
  );

  return {
    claimed: data.length,
    accepted: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success && !result.skipped).length,
    expired: results.filter((result) => result.expired).length,
    skipped: results.filter((result) => result.skipped).length,
    superseded: results.filter((result) => result.superseded).length,
  };
}

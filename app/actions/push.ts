"use server";

import type { PushActionResult } from "@/lib/push-contracts";
import {
  registerPushSubscription,
  sendTestPush,
  unregisterPushSubscription,
} from "@/lib/push-server";

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "알림 요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

export async function subscribeToPush(value: unknown): Promise<PushActionResult> {
  try {
    await registerPushSubscription(value);
    return { ok: true, message: "이 기기의 일정 알림을 켰습니다." };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export async function unsubscribeFromPush(
  value: unknown
): Promise<PushActionResult> {
  try {
    await unregisterPushSubscription(value);
    return { ok: true, message: "이 기기의 일정 알림을 껐습니다." };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export async function sendTestNotification(
  value: unknown
): Promise<PushActionResult> {
  try {
    await sendTestPush(value);
    return { ok: true, message: "테스트 알림을 보냈습니다." };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

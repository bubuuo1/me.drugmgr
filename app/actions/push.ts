"use server";

import type {
  PushActionResult,
  PushStatusActionResult,
} from "@/lib/push-contracts";
import {
  hasRegisteredPushSubscription,
  registerPushSubscription,
  sendTestPush,
  unregisterAllPushSubscriptions,
  unregisterPushSubscription,
} from "@/lib/push-server";
import { createClient } from "@/lib/supabase/server";

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "알림 요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

async function authenticatedClient() {
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;
  if (
    error ||
    typeof claims?.sub !== "string" ||
    claims.role !== "authenticated" ||
    claims.is_anonymous === true
  ) {
    throw new Error("로그인 상태를 확인한 뒤 다시 시도해 주세요.");
  }
  return client;
}

export async function subscribeToPush(
  careSpaceId: unknown,
  value: unknown
): Promise<PushActionResult> {
  try {
    const client = await authenticatedClient();
    await registerPushSubscription(client, careSpaceId, value);
    return { ok: true, message: "선택한 가족 공간의 일정 알림을 켰습니다." };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export async function unsubscribeFromPush(
  careSpaceId: unknown,
  value: unknown
): Promise<PushActionResult> {
  try {
    const client = await authenticatedClient();
    await unregisterPushSubscription(client, careSpaceId, value);
    return { ok: true, message: "선택한 가족 공간의 일정 알림을 껐습니다." };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export async function unsubscribeAllFromPush(
  value: unknown
): Promise<PushActionResult> {
  try {
    const client = await authenticatedClient();
    await unregisterAllPushSubscriptions(client, value);
    return { ok: true, message: "이 기기의 모든 가족 알림을 해제했습니다." };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export async function sendTestNotification(
  careSpaceId: unknown,
  value: unknown
): Promise<PushActionResult> {
  try {
    const client = await authenticatedClient();
    await sendTestPush(client, careSpaceId, value);
    return { ok: true, message: "테스트 알림을 보냈습니다." };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

export async function getPushNotificationStatus(
  careSpaceId: unknown,
  value: unknown
): Promise<PushStatusActionResult> {
  try {
    const client = await authenticatedClient();
    const registered = await hasRegisteredPushSubscription(
      client,
      careSpaceId,
      value
    );
    return { ok: true, registered };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
}

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
  const message = error instanceof Error ? error.message : "";
  const safeInputMessages = [
    "알림 구독 정보 형식이 올바르지 않습니다.",
    "알림 구독 주소가 올바르지 않습니다.",
    "지원하지 않는 알림 서비스입니다.",
    "알림 구독 만료 시각이 올바르지 않습니다.",
    "알림 공개 키 형식이 올바르지 않습니다.",
    "알림 인증 키 형식이 올바르지 않습니다.",
    "알림을 받을 가족 공간을 확인하지 못했습니다.",
    "이 기기의 알림 등록을 찾지 못했습니다.",
    "알림 등록이 만료되었습니다. 알림을 다시 켜 주세요.",
    "테스트 알림을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
  ];
  if (safeInputMessages.includes(message)) return message;
  if (message.startsWith("로그인 상태를 확인")) {
    return "로그인 상태를 확인한 뒤 다시 시도해 주세요.";
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("설정 오류")) {
    return "알림 서버 설정을 확인하지 못했습니다. 관리자에게 문의해 주세요.";
  }
  if (
    normalized.includes("permission") ||
    normalized.includes("row-level security") ||
    normalized.includes("insufficient privilege")
  ) {
    return "이 복약 공간의 알림을 변경할 권한이 없습니다.";
  }
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("fetch failed")
  ) {
    return "알림 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
  }
  return "알림 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
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

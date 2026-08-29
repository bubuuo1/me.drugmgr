"use server";

import "server-only";

import {
  assertInviteEmailConfiguration,
  sendInviteEmail,
} from "@/lib/invite-email";
import { createClient } from "@/lib/supabase/server";

export type SendCareSpaceInviteEmailResult = {
  ok: boolean;
  message: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DELIVERY_FAILURE_MESSAGE =
  "초대 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";

function result(ok: boolean, message: string): SendCareSpaceInviteEmailResult {
  return { ok, message };
}

function logServerFailure(scope: string, error: unknown): void {
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;

  console.error(scope, errorCode ? { code: errorCode } : undefined);
}

function inviteDispatchSecret(): string {
  const value = process.env.PUSH_DISPATCH_SECRET?.trim();
  if (!value) throw new Error("초대 메일 서버 인증 설정이 필요합니다.");
  return value;
}

export async function sendCareSpaceInviteEmail(
  inviteId: string
): Promise<SendCareSpaceInviteEmailResult> {
  if (typeof inviteId !== "string" || inviteId.length > 100) {
    return result(false, "유효한 가족 초대를 선택해 주세요.");
  }

  const normalizedInviteId = inviteId.trim();

  // Browser E2E uses local mock identifiers and must never contact Supabase or
  // an external SMTP server.
  if (process.env.NEXT_PUBLIC_USE_MOCK_DB === "true") {
    return normalizedInviteId
      ? result(true, "초대 메일을 보냈습니다.")
      : result(false, "유효한 가족 초대를 선택해 주세요.");
  }

  if (!UUID_PATTERN.test(normalizedInviteId)) {
    return result(false, "유효한 가족 초대를 선택해 주세요.");
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || user.is_anonymous === true) {
      return result(false, "로그인이 필요합니다.");
    }

    // The invite SELECT policy only exposes rows to the care-space owner. The
    // explicit membership lookup below is a second authorization check rather
    // than relying on UI visibility or the invite id supplied by the client.
    const { data: invite, error: inviteError } = await supabase
      .from("care_space_invites")
      .select("care_space_id, email, status, expires_at")
      .eq("id", normalizedInviteId)
      .maybeSingle();

    if (inviteError) {
      logServerFailure("care-space invite lookup failed", inviteError);
      return result(false, DELIVERY_FAILURE_MESSAGE);
    }
    if (!invite) {
      return result(
        false,
        "이 초대를 보낼 권한이 없거나 초대를 찾을 수 없습니다."
      );
    }

    const { data: ownerMembership, error: membershipError } = await supabase
      .from("care_space_members")
      .select("user_id")
      .eq("care_space_id", invite.care_space_id)
      .eq("user_id", user.id)
      .eq("role", "owner")
      .maybeSingle();

    if (membershipError) {
      logServerFailure("care-space owner lookup failed", membershipError);
      return result(false, DELIVERY_FAILURE_MESSAGE);
    }
    if (!ownerMembership) {
      return result(
        false,
        "이 초대를 보낼 권한이 없거나 초대를 찾을 수 없습니다."
      );
    }

    if (invite.status !== "pending") {
      return result(false, "대기 중인 초대만 메일로 보낼 수 있습니다.");
    }

    const expiresAt = Date.parse(invite.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return result(
        false,
        "만료된 초대입니다. 새 초대를 만든 뒤 다시 보내 주세요."
      );
    }

    let dispatchSecret: string;
    try {
      assertInviteEmailConfiguration();
      dispatchSecret = inviteDispatchSecret();
    } catch (error) {
      logServerFailure("care-space invite email configuration failed", error);
      return result(false, DELIVERY_FAILURE_MESSAGE);
    }

    const { data: emailClaim, error: emailClaimError } = await supabase.rpc(
      "claim_care_space_invite_email_send",
      {
        p_dispatch_secret: dispatchSecret,
        p_invite_id: normalizedInviteId,
      }
    );
    if (emailClaimError) {
      logServerFailure("care-space invite email claim failed", emailClaimError);
      return result(false, DELIVERY_FAILURE_MESSAGE);
    }
    if (emailClaim === "cooldown") {
      return result(false, "같은 초대 메일은 1분 후에 다시 보낼 수 있습니다.");
    }
    if (emailClaim === "daily_limit") {
      return result(
        false,
        "오늘 보낼 수 있는 초대 메일 수를 모두 사용했습니다. 내일 다시 시도해 주세요."
      );
    }
    if (emailClaim === "global_limit") {
      return result(
        false,
        "오늘 전체 초대 메일 발송 한도에 도달했습니다. 내일 다시 시도해 주세요."
      );
    }
    if (emailClaim === "recipient_limit") {
      return result(
        false,
        "해당 주소로 오늘 보낼 수 있는 초대 메일 수를 모두 사용했습니다. 내일 다시 시도해 주세요."
      );
    }
    if (emailClaim === "not_pending") {
      return result(false, "대기 중인 초대만 메일로 보낼 수 있습니다.");
    }
    if (emailClaim === "expired") {
      return result(
        false,
        "만료된 초대입니다. 새 초대를 만든 뒤 다시 보내 주세요."
      );
    }
    if (emailClaim !== "claimed") {
      return result(false, DELIVERY_FAILURE_MESSAGE);
    }

    try {
      await sendInviteEmail({
        recipientEmail: invite.email,
      });
    } catch (error) {
      // SMTP errors can include provider response text. Keep those details in
      // server logs and return only a stable, non-sensitive client message.
      logServerFailure("care-space invite email delivery failed", error);
      return result(false, DELIVERY_FAILURE_MESSAGE);
    }

    return result(true, "초대 메일을 보냈습니다.");
  } catch (error) {
    logServerFailure("care-space invite email action failed", error);
    return result(false, DELIVERY_FAILURE_MESSAGE);
  }
}

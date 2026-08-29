"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ConfirmDialog,
  ErrorBanner,
  FieldError,
  LoadingState,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import { useOnlineStatus } from "@/app/components/use-online-status";
import { useDb } from "@/lib/store";
import type {
  CareSpaceInviteRole,
  CareSpaceMemberWithProfile,
  CareSpaceRole,
} from "@/lib/types";

function roleLabel(role: CareSpaceRole): string {
  if (role === "owner") return "소유자";
  if (role === "caregiver") return "보호자 · 기록 가능";
  return "조회 전용";
}

function formattedExpiry(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "가족 공유 요청을 처리하지 못했습니다.";
}

export default function FamilyPage() {
  const online = useOnlineStatus();
  const {
    selectedCareSpace,
    careSpaceMembers,
    careSpaceInvites,
    pendingCareSpaceInvites,
    canManageSettings,
    loading,
    error,
    clearError,
    refreshFamily,
    createCareSpaceInvite,
    acceptCareSpaceInvite,
    declineCareSpaceInvite,
    revokeCareSpaceInvite,
    removeCareSpaceMember,
  } = useDb();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CareSpaceInviteRole>("caregiver");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removeCandidate, setRemoveCandidate] =
    useState<CareSpaceMemberWithProfile | null>(null);

  useEffect(() => {
    if (!selectedCareSpace) return;
    void refreshFamily().catch(() => undefined);
  }, [refreshFamily, selectedCareSpace]);

  const activeInvites = useMemo(
    () => careSpaceInvites.filter((invite) => invite.status === "pending"),
    [careSpaceInvites]
  );

  async function submitInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || pendingAction) return;
    setPendingAction("invite");
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      const invite = await createCareSpaceInvite({ email, role });
      setEmail("");
      setMessage(`${invite.email} 계정에 보낼 초대를 만들었습니다.`);
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function respondToInvite(inviteId: string, accept: boolean) {
    if (!online || pendingAction) return;
    setPendingAction(inviteId);
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      if (accept) {
        await acceptCareSpaceInvite(inviteId);
        setMessage("가족 공간 초대를 수락했습니다.");
      } else {
        await declineCareSpaceInvite(inviteId);
        setMessage("가족 공간 초대를 거절했습니다.");
      }
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!online || pendingAction) return;
    setPendingAction(inviteId);
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      await revokeCareSpaceInvite(inviteId);
      setMessage("대기 중인 초대를 취소했습니다.");
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmMemberRemoval() {
    if (!removeCandidate || !online || pendingAction) return;
    setPendingAction(removeCandidate.user_id);
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      await removeCareSpaceMember(removeCandidate.user_id);
      setMessage("가족 구성원의 접근 권한을 제거했습니다.");
      setRemoveCandidate(null);
    } catch (caught) {
      setLocalError(errorMessage(caught));
      setRemoveCandidate(null);
    } finally {
      setPendingAction(null);
    }
  }

  if (loading && !selectedCareSpace) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader title="가족 공유" />
        <LoadingState label="가족 공간을 불러오는 중입니다." />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-7">
      <PageHeader title="가족 공유" />

      <ErrorBanner
        message={localError ?? error}
        onDismiss={() => {
          setLocalError(null);
          clearError();
        }}
        onRetry={selectedCareSpace ? refreshFamily : undefined}
      />

      {!online && (
        <Notice tone="warning">
          인터넷 연결이 없어 초대를 처리할 수 없습니다.
        </Notice>
      )}
      {message && <Notice tone="success">{message}</Notice>}

      {pendingCareSpaceInvites.length > 0 && (
        <section aria-labelledby="received-invites-title">
          <h2 id="received-invites-title" className="text-xl font-bold text-ink">
            받은 초대
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {pendingCareSpaceInvites.map((invite) => (
              <li
                key={invite.id}
                className="rounded-2xl border border-hairline bg-canvas px-5 py-4"
              >
                <p className="text-lg font-bold text-ink">
                  {invite.care_space_name}
                </p>
                <p className="mt-1 text-base text-body">
                  {invite.inviter_display_name
                    ? `${invite.inviter_display_name} 님의 초대`
                    : "가족 구성원의 초대"}
                  {" · "}
                  {roleLabel(invite.role)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formattedExpiry(invite.expires_at)}까지 수락 가능
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={!online || pendingAction !== null}
                    onClick={() => void respondToInvite(invite.id, false)}
                    className="min-h-12 rounded-full border border-hairline bg-canvas px-4 text-base font-bold text-body disabled:bg-surface-soft"
                  >
                    거절
                  </button>
                  <button
                    type="button"
                    disabled={!online || pendingAction !== null}
                    onClick={() => void respondToInvite(invite.id, true)}
                    className="min-h-12 rounded-full bg-primary-active px-4 text-base font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
                  >
                    {pendingAction === invite.id ? "처리 중" : "수락"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selectedCareSpace ? (
        <>
          <section
            aria-labelledby="members-title"
            className="rounded-2xl border border-hairline bg-canvas px-5 py-5"
          >
            <h2 id="members-title" className="text-xl font-bold text-ink">
              {selectedCareSpace.name} 구성원
            </h2>
            <p className="mt-2 text-base leading-relaxed text-body">
              소유자는 약·일정과 가족을 관리하고, 보호자는 투약·상태 기록을
              함께 작성할 수 있습니다. 조회 전용 구성원은 기록만 봅니다.
            </p>
            {careSpaceMembers.length === 0 && loading ? (
              <div className="mt-4">
                <LoadingState label="구성원을 불러오는 중입니다." />
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {careSpaceMembers.map((member) => (
                  <li
                    key={member.user_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-soft px-4 py-3"
                  >
                    <div>
                      <p className="text-lg font-bold text-ink">
                        {member.profile?.display_name || "이름 미등록 사용자"}
                      </p>
                      <p className="text-base text-body">{roleLabel(member.role)}</p>
                    </div>
                    {canManageSettings && member.role !== "owner" && (
                      <button
                        type="button"
                        disabled={!online || pendingAction !== null}
                        onClick={() => setRemoveCandidate(member)}
                        className="min-h-10 rounded-full border border-warning bg-canvas px-4 text-sm font-bold text-warning disabled:bg-surface-strong"
                      >
                        접근 제거
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canManageSettings && (
            <section
              aria-labelledby="invite-title"
              className="rounded-2xl border border-hairline bg-canvas px-5 py-5"
            >
              <h2 id="invite-title" className="text-xl font-bold text-ink">
                가족 초대
              </h2>
              <p className="mt-2 text-base leading-relaxed text-body">
                상대방이 Google 로그인에 사용하는 이메일을 입력하세요. 초대는
                그 계정으로 로그인했을 때 이 화면에 표시됩니다.
              </p>
              <form className="mt-5 flex flex-col gap-4" onSubmit={submitInvite}>
                <label
                  htmlFor="family-invite-email"
                  className="text-base font-bold text-body"
                >
                  Google 계정 이메일
                </label>
                <input
                  id="family-invite-email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={pendingAction !== null}
                  className="min-h-14 w-full rounded-xl border border-hairline bg-canvas px-4 text-lg text-ink disabled:bg-surface-soft"
                />
                <label
                  htmlFor="family-invite-role"
                  className="text-base font-bold text-body"
                >
                  권한
                </label>
                <select
                  id="family-invite-role"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as CareSpaceInviteRole)
                  }
                  disabled={pendingAction !== null}
                  className="min-h-14 w-full rounded-xl border border-hairline bg-canvas px-4 text-lg text-ink disabled:bg-surface-soft"
                >
                  <option value="caregiver">보호자 · 기록 가능</option>
                  <option value="viewer">조회 전용</option>
                </select>
                {!online && (
                  <FieldError>연결 후 초대를 만들 수 있습니다.</FieldError>
                )}
                <button
                  type="submit"
                  disabled={!online || pendingAction !== null}
                  className="min-h-14 rounded-xl bg-primary-active px-5 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
                >
                  {pendingAction === "invite" ? "초대 만드는 중" : "초대 만들기"}
                </button>
              </form>

              {activeInvites.length > 0 && (
                <div className="mt-7 border-t border-hairline pt-5">
                  <h3 className="text-lg font-bold text-ink">응답 대기 중</h3>
                  <ul className="mt-3 flex flex-col gap-3">
                    {activeInvites.map((invite) => (
                      <li
                        key={invite.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-soft px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="break-all text-base font-bold text-ink">
                            {invite.email}
                          </p>
                          <p className="text-sm text-muted">
                            {roleLabel(invite.role)} · {formattedExpiry(invite.expires_at)}까지
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!online || pendingAction !== null}
                          onClick={() => void revokeInvite(invite.id)}
                          className="min-h-10 rounded-full border border-hairline bg-canvas px-4 text-sm font-bold text-body disabled:bg-surface-strong"
                        >
                          {pendingAction === invite.id ? "처리 중" : "초대 취소"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <Notice tone="warning">
          접근 가능한 가족 공간이 없습니다. 로그인 상태를 다시 확인해 주세요.
        </Notice>
      )}

      {removeCandidate && (
        <ConfirmDialog
          title="가족 접근을 제거할까요?"
          description={
            <p>
              <strong className="text-ink">
                {removeCandidate.profile?.display_name || "이 구성원"}
              </strong>
              은(는) 더 이상 {selectedCareSpace?.name ?? "이 공간"}의 복약 기록을
              보거나 알림을 받을 수 없습니다.
            </p>
          }
          confirmLabel="접근 권한 제거"
          destructive
          pending={pendingAction === removeCandidate.user_id}
          onCancel={() => setRemoveCandidate(null)}
          onConfirm={confirmMemberRemoval}
        />
      )}
    </main>
  );
}

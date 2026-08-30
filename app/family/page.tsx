"use client";

import { useEffect, useMemo, useState } from "react";
import { sendCareSpaceInviteEmail } from "@/app/actions/family";
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
  CareSpaceMemberWithProfile,
  CareSpaceRole,
} from "@/lib/types";

function roleLabel(role: CareSpaceRole): string {
  if (role === "owner") return "소유자";
  if (role === "caregiver") return "보호자 · 기록·투약 설정 가능";
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
    : "가족 기록 관리 요청을 처리하지 못했습니다.";
}

export default function FamilyPage() {
  const online = useOnlineStatus();
  const {
    careSpaces,
    selectedCareSpace,
    careSpaceMembers,
    careSpaceInvites,
    pendingCareSpaceInvites,
    canManageFamily,
    loading,
    error,
    refresh,
    clearError,
    refreshFamily,
    createCareSpaceInvite,
    acceptCareSpaceInvite,
    declineCareSpaceInvite,
    revokeCareSpaceInvite,
    removeCareSpaceMember,
  } = useDb();
  const [email, setEmail] = useState("");
  const [managedSpaceByInvite, setManagedSpaceByInvite] = useState<
    Record<string, string>
  >({});
  const [managementConsentByInvite, setManagementConsentByInvite] = useState<
    Record<string, boolean>
  >({});
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
  const ownerCareSpaces = useMemo(
    () => careSpaces.filter((space) => space.role === "owner"),
    [careSpaces]
  );

  async function submitInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || pendingAction) return;
    setPendingAction("invite");
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      const invite = await createCareSpaceInvite({
        email,
        role: "caregiver",
      });
      setEmail("");
      const delivery = await sendCareSpaceInviteEmail(invite.id);
      if (delivery.ok) {
        setMessage(
          `${invite.email} 주소로 복약 기록 관리 요청을 보냈습니다. 상대방이 자기 복약 공간을 선택하고 동의해 수락하면 내가 그 공간의 보호자로 추가됩니다.`
        );
      } else {
        setLocalError(
          `관리 요청은 저장했지만 ${delivery.message} 응답 대기 목록에서 다시 보낼 수 있습니다.`
        );
      }
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function respondToInvite(inviteId: string, accept: boolean) {
    if (!online || pendingAction) return;
    const managedCareSpaceId = managedSpaceByInvite[inviteId] ?? null;
    if (
      accept &&
      (!managedCareSpaceId || !managementConsentByInvite[inviteId])
    ) {
      setLocalError(
        "관리 대상으로 공유할 내 복약 공간을 선택하고 보호자 권한 공유에 동의해 주세요."
      );
      return;
    }
    setPendingAction(inviteId);
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      if (accept) {
        await acceptCareSpaceInvite(inviteId, managedCareSpaceId);
        setMessage(
          "복약 기록 관리 요청을 수락했습니다. 초대한 사람이 선택한 내 복약 공간을 보호자로 관리할 수 있습니다."
        );
      } else {
        await declineCareSpaceInvite(inviteId);
        setMessage("복약 기록 관리 요청을 거절했습니다.");
      }
      setManagedSpaceByInvite((current) => {
        const next = { ...current };
        delete next[inviteId];
        return next;
      });
      setManagementConsentByInvite((current) => {
        const next = { ...current };
        delete next[inviteId];
        return next;
      });
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
      setMessage("대기 중인 관리 요청을 취소했습니다.");
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function resendInvite(inviteId: string) {
    if (!online || pendingAction) return;
    setPendingAction(`email-${inviteId}`);
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      const delivery = await sendCareSpaceInviteEmail(inviteId);
      if (!delivery.ok) {
        setLocalError(delivery.message);
        return;
      }
      setMessage(delivery.message);
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
        <PageHeader
          title="가족 기록 관리"
          backHref="/settings"
          backLabel="환경설정"
        />
        <LoadingState label="가족 공간을 불러오는 중입니다." />
      </main>
    );
  }

  if (error && !selectedCareSpace) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader
          title="가족 기록 관리"
          backHref="/settings"
          backLabel="환경설정"
        />
        <ErrorBanner message={error} onRetry={refresh} />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-7">
      <PageHeader
        title="가족 기록 관리"
        backHref="/settings"
        backLabel="환경설정"
      />

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
          인터넷 연결이 없어 관리 요청을 처리할 수 없습니다.
        </Notice>
      )}
      {message && <Notice tone="success">{message}</Notice>}

      {pendingCareSpaceInvites.length > 0 && (
        <section aria-labelledby="received-invites-title">
          <h2 id="received-invites-title" className="text-xl font-bold text-ink">
            받은 관리 요청
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {pendingCareSpaceInvites.map((invite) => (
              <li
                key={invite.id}
                className="rounded-2xl border border-hairline bg-canvas px-5 py-4"
              >
                <p className="text-lg font-bold text-ink">
                  복약 기록 관리 요청
                </p>
                <p className="mt-1 text-base text-body">
                  {invite.inviter_display_name
                    ? `${invite.inviter_display_name} 님이 내 기록의 보호자 권한을 요청했습니다.`
                    : "가족 구성원이 내 기록의 보호자 권한을 요청했습니다."}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formattedExpiry(invite.expires_at)}까지 수락 가능
                </p>
                <div className="mt-4 rounded-xl bg-surface-soft px-4 py-4">
                    <p className="text-base font-bold text-ink">
                      내 기록 보호자 권한 요청
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-body">
                      수락하면 초대한 사람이 아래에서 선택한 내 복약 공간의
                      보호자가 됩니다. 보호자는 약·일정·투약·상태 기록을
                      조회하고 변경할 수 있습니다.
                    </p>
                    <label
                      htmlFor={`managed-space-${invite.id}`}
                      className="mt-4 block text-sm font-bold text-body"
                    >
                      관리 대상으로 공유할 내 복약 공간
                    </label>
                    <select
                      id={`managed-space-${invite.id}`}
                      value={managedSpaceByInvite[invite.id] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setManagedSpaceByInvite((current) => ({
                          ...current,
                          [invite.id]: value,
                        }));
                        setManagementConsentByInvite((current) => ({
                          ...current,
                          [invite.id]: false,
                        }));
                      }}
                      disabled={!online || pendingAction !== null}
                      className="mt-2 min-h-12 w-full rounded-xl border border-hairline bg-canvas px-3 text-base text-ink disabled:bg-surface-strong"
                    >
                      <option value="">내 공간 선택</option>
                      {ownerCareSpaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.name}
                        </option>
                      ))}
                    </select>
                    {ownerCareSpaces.length === 0 && (
                      <div className="mt-2">
                        <FieldError>
                          공유할 수 있는 본인 소유 복약 공간이 없습니다.
                        </FieldError>
                      </div>
                    )}
                    <label className="mt-4 flex items-start gap-3 text-sm leading-relaxed text-body">
                      <input
                        type="checkbox"
                        checked={managementConsentByInvite[invite.id] ?? false}
                        onChange={(event) =>
                          setManagementConsentByInvite((current) => ({
                            ...current,
                            [invite.id]: event.target.checked,
                          }))
                        }
                        disabled={
                          !online ||
                          pendingAction !== null ||
                          !managedSpaceByInvite[invite.id]
                        }
                        className="mt-1 size-5 shrink-0 accent-primary-active"
                      />
                      <span>
                        선택한 공간의 복약 기록 관리 권한을 초대한 사람에게
                        공유하는 데 동의합니다.
                      </span>
                    </label>
                  </div>
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
                    disabled={
                      !online ||
                      pendingAction !== null ||
                      !managedSpaceByInvite[invite.id] ||
                      !managementConsentByInvite[invite.id]
                    }
                    onClick={() => void respondToInvite(invite.id, true)}
                    className="min-h-12 rounded-full bg-primary-active px-4 text-base font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
                  >
                    {pendingAction === invite.id
                      ? "처리 중"
                      : "동의하고 수락"}
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
              소유자는 가족과 초대를 관리합니다. 보호자는 이 공간의 정보와
              기록을 보고 약·일정을 함께 설정할 수 있습니다. 조회 전용
              구성원은 정보와 기록만 봅니다.
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
                    {canManageFamily && member.role !== "owner" && (
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

          {canManageFamily && (
            <section
              aria-labelledby="invite-title"
              className="rounded-2xl border border-hairline bg-canvas px-5 py-5"
            >
              <h2 id="invite-title" className="text-xl font-bold text-ink">
                가족 기록 관리 요청
              </h2>
              <p className="mt-2 text-base leading-relaxed text-body">
                Gmail·네이버 등 메일을 받을 주소를 입력하세요. 상대방은 같은
                주소로 만든 Google 계정으로 로그인해 자기 복약 공간을 직접
                선택하고 동의해야 합니다. 수락 전에는 상대방 기록을 볼 수
                없습니다.
              </p>
              <form className="mt-5 flex flex-col gap-4" onSubmit={submitInvite}>
                <label
                  htmlFor="family-invite-email"
                  className="text-base font-bold text-body"
                >
                  관리 요청을 보낼 이메일
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
                <Notice>
                  상대방이 수락하면 나는 선택된 공간의 보호자가 되어 약·일정과
                  투약·상태 기록을 조회하고 변경할 수 있습니다. 상대방은 내
                  공간에 자동으로 추가되지 않습니다.
                </Notice>
                {!online && (
                  <FieldError>연결 후 초대를 만들 수 있습니다.</FieldError>
                )}
                <button
                  type="submit"
                  disabled={!online || pendingAction !== null}
                  className="min-h-14 rounded-xl bg-primary-active px-5 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
                >
                  {pendingAction === "invite"
                    ? "요청 보내는 중"
                    : "관리 요청 메일 보내기"}
                </button>
              </form>

              {activeInvites.length > 0 && (
                <div className="mt-7 border-t border-hairline pt-5">
                  <h3 className="text-lg font-bold text-ink">응답 대기 중</h3>
                  <ul className="mt-3 flex flex-col gap-3">
                    {activeInvites.map((invite) => (
                      <li key={invite.id} className="rounded-xl bg-surface-soft px-4 py-3">
                        <div className="min-w-0">
                          <p className="break-all text-base font-bold text-ink">
                            {invite.email}
                          </p>
                          <p className="text-sm text-muted">
                            보호자 권한 요청 · {formattedExpiry(invite.expires_at)}까지
                          </p>
                          <p className="mt-1 text-sm text-body">
                            상대방이 자기 복약 공간을 선택하고 동의하면 관리 가능
                          </p>
                        </div>
                        <div className="mt-3 grid gap-2 min-[360px]:grid-cols-2">
                          <button
                            type="button"
                            disabled={!online || pendingAction !== null}
                            onClick={() => void resendInvite(invite.id)}
                            className="min-h-12 rounded-full border border-ink bg-canvas px-3 text-sm font-bold text-ink disabled:bg-surface-strong"
                          >
                            {pendingAction === `email-${invite.id}`
                              ? "다시 보내는 중"
                              : "이메일 다시 보내기"}
                          </button>
                          <button
                            type="button"
                            disabled={!online || pendingAction !== null}
                            onClick={() => void revokeInvite(invite.id)}
                            className="min-h-12 rounded-full border border-hairline bg-canvas px-3 text-sm font-bold text-body disabled:bg-surface-strong"
                          >
                            {pendingAction === invite.id ? "처리 중" : "요청 취소"}
                          </button>
                        </div>
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

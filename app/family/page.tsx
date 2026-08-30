"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  FamilyRelationship,
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
    familyRelationships,
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
    upgradeFamilyRelationshipToReciprocal,
    endFamilyRelationship,
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
  const [endCandidate, setEndCandidate] =
    useState<FamilyRelationship | null>(null);
  const [upgradeSpaceByRelationship, setUpgradeSpaceByRelationship] = useState<
    Record<string, string>
  >({});
  const [upgradeConsentByRelationship, setUpgradeConsentByRelationship] =
    useState<Record<string, boolean>>({});

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
          `${invite.email} 주소로 양방향 복약 관리 요청을 보냈습니다. 상대방이 자기 복약 공간을 선택하고 동의하면 서로 상대 공간의 보호자로 추가됩니다.`
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
        "서로 관리할 내 복약 공간을 선택하고 양방향 보호자 권한에 동의해 주세요."
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
          "양방향 가족 관계를 수락했습니다. 이제 두 사람 모두 상대의 복약 기록을 보호자로 관리할 수 있습니다."
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

  async function upgradeRelationship(relationshipId: string) {
    if (!online || pendingAction) return;
    const careSpaceId = upgradeSpaceByRelationship[relationshipId] ?? "";
    if (!careSpaceId || !upgradeConsentByRelationship[relationshipId]) {
      setLocalError(
        "상대에게 공유할 내 복약 공간을 선택하고 양방향 전환에 동의해 주세요."
      );
      return;
    }
    setPendingAction(`upgrade-${relationshipId}`);
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      await upgradeFamilyRelationshipToReciprocal(
        relationshipId,
        careSpaceId
      );
      setMessage(
        "기존 가족 관계를 양방향으로 전환했습니다. 이제 서로의 복약 기록을 관리할 수 있습니다."
      );
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmRelationshipEnd() {
    if (!endCandidate || !online || pendingAction) return;
    setPendingAction(`end-${endCandidate.id}`);
    setLocalError(null);
    setMessage(null);
    clearError();
    try {
      await endFamilyRelationship(endCandidate.id);
      setMessage(
        "가족 관계를 종료했습니다. 복약 기록은 삭제되지 않고 서로의 접근 권한만 제거되었습니다."
      );
      setEndCandidate(null);
    } catch (caught) {
      setLocalError(errorMessage(caught));
      setEndCandidate(null);
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
                    ? `${invite.inviter_display_name} 님이 서로의 복약 기록을 관리하는 가족 관계를 요청했습니다.`
                    : "가족 구성원이 양방향 복약 기록 관리 관계를 요청했습니다."}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formattedExpiry(invite.expires_at)}까지 수락 가능
                </p>
                <div className="mt-4 rounded-xl bg-surface-soft px-4 py-4">
                  <p className="text-base font-bold text-ink">
                    양방향 보호자 권한 요청
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-body">
                    수락하면 초대한 사람은 아래에서 선택한 내 공간을, 나는
                    초대한 사람의 요청 공간을 각각 보호자로 관리합니다. 두
                    사람 모두 약·일정·투약·상태 기록을 조회하고 변경할 수
                    있습니다.
                  </p>
                    <label
                      htmlFor={`managed-space-${invite.id}`}
                      className="mt-4 block text-sm font-bold text-body"
                    >
                      서로 관리할 내 복약 공간
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
                        선택한 내 공간을 상대에게 공유하고, 나도 상대의 요청
                        공간을 보호자로 관리하는 양방향 권한에 동의합니다.
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

      {familyRelationships.length > 0 && (
        <section aria-labelledby="accepted-family-title">
          <h2
            id="accepted-family-title"
            className="text-xl font-bold text-ink"
          >
            수락한 가족
          </h2>
          <p className="mt-2 text-base leading-relaxed text-body">
            상대의 복약 공간은 기록 대상을 전환해 관리할 수 있습니다. 가족
            관계를 종료해도 저장된 복약 기록은 삭제되지 않습니다.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {familyRelationships.map((relationship) => {
              const reciprocal =
                relationship.caller_can_manage_other_records &&
                relationship.other_can_manage_caller_records;
              const upgradeSpaceId =
                upgradeSpaceByRelationship[relationship.id] ?? "";
              const upgradeConsent =
                upgradeConsentByRelationship[relationship.id] ?? false;
              return (
                <li
                  key={relationship.id}
                  className="rounded-2xl border border-hairline bg-canvas px-5 py-4"
                >
                  <p className="text-lg font-bold text-ink">
                    {relationship.other_display_name}
                  </p>
                  <p className="mt-1 text-sm font-bold text-primary-active">
                    {reciprocal
                      ? "서로 복약 기록 관리 중"
                      : relationship.caller_can_manage_other_records
                        ? "내가 상대 기록만 관리 중"
                        : relationship.other_can_manage_caller_records
                          ? "상대만 내 기록을 관리 중"
                          : "관리 권한 확인 필요"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {formattedExpiry(relationship.started_at)}부터 가족
                  </p>

                  {relationship.caller_can_manage_other_records &&
                    relationship.manageable_care_space_id && (
                      <Link
                        href={`/?space=${encodeURIComponent(relationship.manageable_care_space_id)}`}
                        className="mt-4 flex min-h-12 items-center justify-center rounded-full bg-primary-active px-4 text-base font-bold text-on-primary"
                      >
                        {relationship.manageable_care_space_name
                          ? `${relationship.manageable_care_space_name} 관리`
                          : "상대 복약 기록 관리"}
                      </Link>
                    )}

                  {relationship.can_upgrade_to_reciprocal && (
                    <div className="mt-4 rounded-xl bg-surface-soft px-4 py-4">
                      <p className="text-base font-bold text-ink">
                        서로 관리하도록 전환
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-body">
                        현재는 나만 상대 기록을 관리합니다. 내 공간을 선택해
                        공유하면 상대도 내 기록을 보호자로 관리할 수 있습니다.
                      </p>
                      <label
                        htmlFor={`upgrade-space-${relationship.id}`}
                        className="mt-4 block text-sm font-bold text-body"
                      >
                        상대에게 공유할 내 복약 공간
                      </label>
                      <select
                        id={`upgrade-space-${relationship.id}`}
                        value={upgradeSpaceId}
                        onChange={(event) => {
                          const value = event.target.value;
                          setUpgradeSpaceByRelationship((current) => ({
                            ...current,
                            [relationship.id]: value,
                          }));
                          setUpgradeConsentByRelationship((current) => ({
                            ...current,
                            [relationship.id]: false,
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
                      <label className="mt-4 flex items-start gap-3 text-sm leading-relaxed text-body">
                        <input
                          type="checkbox"
                          checked={upgradeConsent}
                          onChange={(event) =>
                            setUpgradeConsentByRelationship((current) => ({
                              ...current,
                              [relationship.id]: event.target.checked,
                            }))
                          }
                          disabled={
                            !online ||
                            pendingAction !== null ||
                            !upgradeSpaceId
                          }
                          className="mt-1 size-5 shrink-0 accent-primary-active"
                        />
                        <span>
                          선택한 내 공간의 약·일정·투약·상태 기록을 상대가
                          보호자로 조회하고 변경하는 데 동의합니다.
                        </span>
                      </label>
                      <button
                        type="button"
                        disabled={
                          !online ||
                          pendingAction !== null ||
                          !upgradeSpaceId ||
                          !upgradeConsent
                        }
                        onClick={() =>
                          void upgradeRelationship(relationship.id)
                        }
                        className="mt-4 min-h-12 w-full rounded-full border border-ink bg-canvas px-4 text-base font-bold text-ink disabled:bg-surface-strong"
                      >
                        {pendingAction === `upgrade-${relationship.id}`
                          ? "전환 중"
                          : "양방향 관리로 전환"}
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!online || pendingAction !== null}
                    onClick={() => setEndCandidate(relationship)}
                    className="mt-4 min-h-12 w-full rounded-full border border-warning bg-canvas px-4 text-base font-bold text-warning disabled:bg-surface-strong"
                  >
                    가족 관계 종료
                  </button>
                </li>
              );
            })}
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
                    {canManageFamily &&
                      member.role !== "owner" &&
                      !familyRelationships.some(
                        (relationship) =>
                          relationship.other_user_id === member.user_id &&
                          relationship.caller_shared_care_space_id ===
                            selectedCareSpace.id &&
                          relationship.other_can_manage_caller_records
                      ) && (
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
                선택하고 양방향 관리에 동의해야 합니다. 수락 전에는 서로의
                기록을 볼 수 없습니다.
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
                  상대방이 수락하면 나는 상대가 선택한 공간을, 상대방은 현재
                  요청을 보내는 내 공간을 각각 보호자로 관리할 수 있습니다.
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
                            양방향 보호자 요청 · {formattedExpiry(invite.expires_at)}까지
                          </p>
                          <p className="mt-1 text-sm text-body">
                            상대방이 자기 공간을 선택하고 동의하면 서로 관리 가능
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

      {endCandidate && (
        <ConfirmDialog
          title="가족 관계를 종료할까요?"
          description={
            <p>
              <strong className="text-ink">
                {endCandidate.other_display_name}
              </strong>
              님과 연결된 보호자 접근 권한이 제거됩니다. 양방향 관계라면 두
              방향 권한을 함께 제거하며, 저장된 약·투약·상태 기록은 삭제하지
              않습니다. 다시 연결하려면 새 요청과 동의가 필요합니다.
            </p>
          }
          confirmLabel="가족 관계 종료"
          destructive
          pending={pendingAction === `end-${endCandidate.id}`}
          onCancel={() => setEndCandidate(null)}
          onConfirm={confirmRelationshipEnd}
        />
      )}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { unsubscribeAllFromPush } from "@/app/actions/push";
import {
  registerPushServiceWorker,
  serializePushSubscription,
  supportsWebPush,
} from "@/lib/push-client";
import { useDb } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { CareSpaceAccess, CareSpaceRole } from "@/lib/types";

function roleLabel(role: CareSpaceRole): string {
  if (role === "owner") return "소유자";
  if (role === "caregiver") return "보호자";
  return "조회 전용";
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "기록 대상을 변경하지 못했습니다.";
}

type CareSpaceNameFormProps = {
  disabled: boolean;
  space: CareSpaceAccess;
  updateCareSpaceName(name: string): Promise<CareSpaceAccess>;
};

function CareSpaceNameForm({
  disabled,
  space,
  updateCareSpaceName,
}: CareSpaceNameFormProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [name, setName] = useState(space.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || pending) return;

    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("복약 공간 이름을 입력해 주세요.");
      setSuccess(null);
      return;
    }
    if (normalizedName.length > 100) {
      setError("복약 공간 이름은 100자 이하로 입력해 주세요.");
      setSuccess(null);
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateCareSpaceName(normalizedName);
      setName(updated.name);
      setSuccess("복약 공간 이름을 변경했습니다.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label="복약 공간 이름 변경"
      className="mt-5 rounded-xl bg-surface-soft px-4 py-4"
      onSubmit={(event) => void submit(event)}
    >
      <label htmlFor={inputId} className="block text-base font-bold text-body">
        복약 공간 이름
      </label>
      <div className="mt-2 flex flex-col gap-2 min-[400px]:flex-row">
        <input
          id={inputId}
          value={name}
          maxLength={100}
          disabled={disabled || pending}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
            setSuccess(null);
          }}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-hairline bg-canvas px-4 text-base font-semibold text-ink disabled:bg-surface-strong"
        />
        <button
          type="submit"
          disabled={disabled || pending || name.trim() === space.name}
          className="min-h-12 rounded-xl bg-primary-active px-5 text-base font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
        >
          {pending ? "변경 중" : "이름 변경"}
        </button>
      </div>
      <p id={hintId} className="mt-2 text-sm leading-relaxed text-muted">
        복약 공간 이름은 소유자만 변경할 수 있습니다.
      </p>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 text-sm font-semibold text-error"
        >
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-sm font-semibold text-success">
          {success}
        </p>
      )}
    </form>
  );
}

export function AccountSettingsCard() {
  const {
    careSpaces,
    selectedCareSpace,
    pendingCareSpaceInvites,
    loading,
    selectCareSpace,
    updateCareSpaceName,
    purgeSensitiveState,
  } = useDb();
  const [switching, setSwitching] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function changeRecordSubject(id: string) {
    if (switching || id === selectedCareSpace?.id) return;
    setSwitching(true);
    setLocalError(null);
    try {
      await selectCareSpace(id);
    } catch (error) {
      setLocalError(messageOf(error));
    } finally {
      setSwitching(false);
    }
  }

  async function safelySignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setLocalError(null);

    try {
      if (supportsWebPush()) {
        const registration = await registerPushServiceWorker();
        const displayedNotifications = await registration.getNotifications();
        displayedNotifications.forEach((notification) => notification.close());
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const payload = serializePushSubscription(subscription);
          const [serverCleanup, browserCleanup] = await Promise.all([
            unsubscribeAllFromPush(payload).catch(() => ({
              ok: false as const,
              message: "알림 서버 연결에 실패했습니다.",
            })),
            subscription.unsubscribe().catch(() => false),
          ]);
          if (!serverCleanup.ok && !browserCleanup) {
            setLocalError(
              "이 기기의 가족 알림을 안전하게 해제하지 못했습니다. 인터넷 연결을 확인한 뒤 로그아웃을 다시 눌러 주세요."
            );
            setSigningOut(false);
            return;
          }
        }
      }
    } catch {
      setLocalError(
        "이 기기의 알림 상태를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 로그아웃을 다시 눌러 주세요."
      );
      setSigningOut(false);
      return;
    }

    purgeSensitiveState();

    try {
      await signOut();
    } catch {
      // The browser client below still clears and broadcasts the local session.
    }

    try {
      await supabase?.auth.signOut({ scope: "local" }).catch(() => undefined);
    } finally {
      globalThis.location.replace("/login");
    }
  }

  return (
    <section
      aria-labelledby="account-settings-title"
      className="rounded-2xl border border-hairline bg-canvas px-4 py-5 min-[400px]:px-5"
    >
      <h2 id="account-settings-title" className="text-xl font-bold text-ink">
        계정과 가족
      </h2>

      {selectedCareSpace && careSpaces.length > 0 ? (
        <label className="mt-5 block text-base font-bold text-body">
          기록 대상
          <select
            value={selectedCareSpace.id}
            disabled={loading || switching || signingOut}
            onChange={(event) => void changeRecordSubject(event.target.value)}
            className="mt-2 min-h-14 w-full rounded-xl border border-hairline bg-canvas px-4 text-base font-bold text-ink disabled:bg-surface-strong"
          >
            {careSpaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name} · {roleLabel(space.role)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-4 rounded-xl bg-surface-soft px-4 py-3 text-base font-semibold text-body">
          {loading
            ? "기록 대상을 확인하고 있습니다."
            : "접근 가능한 기록 대상이 없습니다."}
        </p>
      )}

      {switching && (
        <p role="status" className="mt-2 text-sm font-semibold text-body">
          기록 대상을 변경하고 있습니다.
        </p>
      )}
      {localError && (
        <p role="alert" className="mt-2 text-sm font-semibold text-error">
          {localError}
        </p>
      )}

      {selectedCareSpace?.role === "owner" && (
        <CareSpaceNameForm
          key={selectedCareSpace.id}
          space={selectedCareSpace}
          disabled={loading || switching || signingOut}
          updateCareSpaceName={updateCareSpaceName}
        />
      )}

      <Link
        href="/family"
        replace
        className="mt-5 flex min-h-14 w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-canvas px-4 text-base font-bold text-ink active:bg-surface-soft"
      >
        <span>가족 관리</span>
        {pendingCareSpaceInvites.length > 0 && (
          <span className="rounded-full bg-surface-soft px-3 py-1 text-sm text-primary-active">
            받은 초대 {pendingCareSpaceInvites.length}개
          </span>
        )}
      </Link>

      <div className="mt-6 border-t border-hairline-soft pt-5">
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void safelySignOut()}
          className="flex min-h-14 w-full items-center justify-center rounded-xl border border-hairline bg-canvas px-5 text-base font-bold text-body disabled:bg-surface-strong"
        >
          {signingOut ? "로그아웃 중" : "로그아웃"}
        </button>
      </div>
    </section>
  );
}

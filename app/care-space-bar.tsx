"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/actions/auth";
import { unsubscribeFromPush } from "@/app/actions/push";
import {
  registerPushServiceWorker,
  serializePushSubscription,
  supportsWebPush,
} from "@/lib/push-client";
import { useDb } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { CareSpaceRole } from "@/lib/types";

function roleLabel(role: CareSpaceRole): string {
  if (role === "owner") return "소유자";
  if (role === "caregiver") return "보호자";
  return "조회 전용";
}

export function CareSpaceBar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    careSpaces,
    selectedCareSpace,
    pendingCareSpaceInvites,
    loading,
    selectCareSpace,
    purgeSensitiveState,
  } = useDb();
  const [switching, setSwitching] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (
    pathname === "/login" ||
    pathname.startsWith("/auth/")
  ) {
    return null;
  }

  async function safelySignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const accessibleSpaces = [...careSpaces];
    purgeSensitiveState();
    try {
      if (supportsWebPush()) {
        const registration = await registerPushServiceWorker();
        const displayedNotifications = await registration.getNotifications();
        displayedNotifications.forEach((notification) => notification.close());
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const payload = serializePushSubscription(subscription);
          const unregistering = Promise.allSettled(
            accessibleSpaces.map((space) =>
              unsubscribeFromPush(space.id, payload)
            )
          );
          await Promise.race([
            unregistering,
            new Promise<void>((resolve) =>
              globalThis.setTimeout(resolve, 3_000)
            ),
          ]);
          await subscription.unsubscribe().catch(() => false);
        }
      }
    } catch {
      // Push cleanup is best-effort; the browser subscription can expire later.
    }
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

  if (!selectedCareSpace || careSpaces.length === 0) {
    return (
      <nav
        aria-label="계정"
        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface-soft px-4 py-4"
      >
        <p className="text-base font-semibold text-body">
          {loading
            ? "사용할 가족 공간을 확인하고 있습니다."
            : "접근 가능한 가족 공간이 없습니다."}
        </p>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void safelySignOut()}
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-hairline bg-canvas px-4 text-sm font-bold text-body disabled:bg-surface-strong"
        >
          {signingOut ? "로그아웃 중" : "로그아웃"}
        </button>
      </nav>
    );
  }

  return (
    <nav
      aria-label="가족 공간과 계정"
      className="mb-6 rounded-2xl border border-hairline bg-surface-soft px-4 py-4"
    >
      <div className="flex items-end gap-3">
        <label className="min-w-0 flex-1 text-sm font-bold text-body">
          누구의 기록인가요?
          <select
            value={selectedCareSpace.id}
            disabled={loading || switching}
            onChange={(event) => {
              const id = event.target.value;
              setSwitching(true);
              void selectCareSpace(id)
                .then(() => router.replace("/"))
                .finally(() => setSwitching(false));
            }}
            className="mt-1 min-h-12 w-full rounded-xl border border-hairline bg-canvas px-3 text-base font-bold text-ink disabled:bg-surface-strong"
          >
            {careSpaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name} · {roleLabel(space.role)}
              </option>
            ))}
          </select>
        </label>
        <Link
          href="/family"
          className="inline-flex min-h-12 shrink-0 flex-col items-center justify-center rounded-full border border-hairline bg-canvas px-4 text-base font-bold text-ink"
        >
          <span>가족 관리</span>
          {pendingCareSpaceInvites.length > 0 && (
            <span className="text-sm text-primary-active">
              받은 초대 {pendingCareSpaceInvites.length}개
            </span>
          )}
        </Link>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm leading-relaxed text-muted">
          기록을 추가하거나 수정하기 전에 선택한 이름을 확인해 주세요.
        </p>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void safelySignOut()}
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full px-3 text-sm font-bold text-body underline decoration-hairline underline-offset-4 disabled:text-muted"
        >
          {signingOut ? "로그아웃 중" : "로그아웃"}
        </button>
      </div>
    </nav>
  );
}

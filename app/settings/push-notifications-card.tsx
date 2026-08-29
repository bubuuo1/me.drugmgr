"use client";

import { useCallback, useEffect, useState } from "react";
import {
  sendTestNotification,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/app/actions/push";
import {
  isIosDevice,
  isStandaloneApp,
  registerPushServiceWorker,
  serializePushSubscription,
  subscribeBrowserToPush,
  supportsWebPush,
} from "@/lib/push-client";

type PushState =
  | "checking"
  | "needs-install"
  | "unsupported"
  | "not-configured"
  | "denied"
  | "off"
  | "on"
  | "error";

type PendingAction = "enable" | "disable" | "test" | null;

const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";

function statusText(state: PushState): string {
  switch (state) {
    case "checking":
      return "알림 사용 가능 여부를 확인하고 있습니다.";
    case "needs-install":
      return "홈 화면에 추가한 앱에서 알림을 켤 수 있습니다.";
    case "unsupported":
      return "이 브라우저에서는 일정 알림을 사용할 수 없습니다.";
    case "not-configured":
      return "알림 서버 설정을 확인하고 있습니다.";
    case "denied":
      return "휴대폰 설정에서 이 앱의 알림을 허용해 주세요.";
    case "on":
      return "이 기기의 일정 알림이 켜져 있습니다.";
    case "error":
      return "알림 상태를 확인하지 못했습니다.";
    default:
      return "이 기기의 일정 알림이 꺼져 있습니다.";
  }
}

export function PushNotificationsCard({ online }: { online: boolean }) {
  const [state, setState] = useState<PushState>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  const showMessage = useCallback(
    (text: string, tone: "success" | "error") => {
      setMessage(text);
      setMessageTone(tone);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    async function checkPushState() {
      if (isIosDevice() && !isStandaloneApp()) {
        if (!cancelled) setState("needs-install");
        return;
      }
      if (!supportsWebPush()) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (!publicVapidKey) {
        if (!cancelled) setState("not-configured");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      try {
        const registration = await registerPushServiceWorker();
        const current = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setSubscription(current);
        setState(current ? "on" : "off");
        if (current && online) {
          const result = await subscribeToPush(serializePushSubscription(current));
          if (!result.ok && !cancelled) {
            setState("error");
            showMessage(result.message, "error");
          }
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }
    void checkPushState();
    return () => {
      cancelled = true;
    };
  }, [online, showMessage]);

  async function enableNotifications() {
    if (!online || pending || !publicVapidKey) return;
    setPending("enable");
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        showMessage("알림 권한이 허용되지 않았습니다.", "error");
        return;
      }
      const registration = await registerPushServiceWorker();
      const nextSubscription = await subscribeBrowserToPush(
        registration,
        publicVapidKey
      );
      const result = await subscribeToPush(
        serializePushSubscription(nextSubscription)
      );
      if (!result.ok) throw new Error(result.message);
      setSubscription(nextSubscription);
      setState("on");
      showMessage(result.message, "success");
    } catch (error) {
      setState("error");
      showMessage(
        error instanceof Error
          ? error.message
          : "알림을 켜지 못했습니다. 다시 시도해 주세요.",
        "error"
      );
    } finally {
      setPending(null);
    }
  }

  async function disableNotifications() {
    if (!online || pending || !subscription) return;
    setPending("disable");
    setMessage(null);
    try {
      const result = await unsubscribeFromPush(
        serializePushSubscription(subscription)
      );
      if (!result.ok) throw new Error(result.message);
      await subscription.unsubscribe();
      setSubscription(null);
      setState("off");
      showMessage(result.message, "success");
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : "알림을 끄지 못했습니다. 다시 시도해 주세요.",
        "error"
      );
    } finally {
      setPending(null);
    }
  }

  async function testNotifications() {
    if (!online || pending || !subscription) return;
    setPending("test");
    setMessage(null);
    try {
      const result = await sendTestNotification(
        serializePushSubscription(subscription)
      );
      if (!result.ok) throw new Error(result.message);
      showMessage(result.message, "success");
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : "테스트 알림을 보내지 못했습니다.",
        "error"
      );
    } finally {
      setPending(null);
    }
  }

  const canEnable = state === "off" || state === "error";

  return (
    <section
      aria-labelledby="push-notification-title"
      className="rounded-2xl border border-hairline bg-canvas px-5 py-5"
    >
      <div className="flex flex-col gap-2">
        <h2 id="push-notification-title" className="text-xl font-bold text-ink">
          투약 일정 알림
        </h2>
        <p className="text-base leading-relaxed text-body">
          활성 일정의 예정 시각부터 해당 날짜의 같은 일정 기록이 생길 때까지
          5분마다 이 기기로 알림을 보냅니다.
        </p>
        <p className="text-base font-semibold text-ink" role="status">
          {statusText(state)}
        </p>
      </div>

      {state === "needs-install" && (
        <p className="mt-4 rounded-xl bg-surface-soft px-4 py-4 text-base leading-relaxed text-body">
          Safari의 공유 버튼에서 <strong className="text-ink">홈 화면에 추가</strong>한
          뒤, 홈 화면 아이콘으로 앱을 열어 주세요.
        </p>
      )}

      {state === "on" && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void testNotifications()}
            disabled={!online || pending !== null}
            className="flex min-h-12 items-center justify-center rounded-full bg-primary-active px-4 text-base font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
          >
            {pending === "test" ? "보내는 중입니다" : "테스트 알림"}
          </button>
          <button
            type="button"
            onClick={() => void disableNotifications()}
            disabled={!online || pending !== null}
            className="flex min-h-12 items-center justify-center rounded-full border border-hairline bg-canvas px-4 text-base font-bold text-body"
          >
            {pending === "disable" ? "끄는 중입니다" : "알림 끄기"}
          </button>
        </div>
      )}

      {canEnable && (
        <button
          type="button"
          onClick={() => void enableNotifications()}
          disabled={!online || pending !== null}
          className="mt-5 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary-active px-5 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
        >
          {pending === "enable"
            ? "알림을 켜는 중입니다"
            : online
              ? "이 기기에서 알림 받기"
              : "연결 후 알림 설정 가능"}
        </button>
      )}

      {message && (
        <p
          role={messageTone === "error" ? "alert" : "status"}
          className={`mt-4 text-base font-semibold ${
            messageTone === "error" ? "text-error" : "text-success"
          }`}
        >
          {message}
        </p>
      )}

      <p className="mt-4 text-sm leading-relaxed text-muted">
        알림은 네트워크, 집중 모드와 절전 설정에 따라 늦게 도착할 수 있습니다.
      </p>
    </section>
  );
}

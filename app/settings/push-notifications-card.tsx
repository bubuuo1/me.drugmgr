"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getPushNotificationStatus,
  sendTestNotification,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/app/actions/push";
import {
  dismissCareSpaceNotifications,
  isIosDevice,
  isStandaloneApp,
  registerPushServiceWorker,
  serializePushSubscription,
  subscribeBrowserToPush,
  supportsWebPush,
} from "@/lib/push-client";
import { useDb } from "@/lib/store";
import type { CareSpaceAccess } from "@/lib/types";

type DeviceState =
  | "checking"
  | "needs-install"
  | "unsupported"
  | "not-configured"
  | "denied"
  | "offline"
  | "ready"
  | "error";

type SpacePushState = "checking" | "off" | "on" | "error";
type PendingKind = "enable" | "disable" | "test";
type PendingAction = { careSpaceId: string; kind: PendingKind } | null;
type SpaceMessage = { text: string; tone: "success" | "error" };

const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";

function deviceStatusText(state: DeviceState): string {
  switch (state) {
    case "checking":
      return "이 기기의 알림 사용 가능 여부를 확인하고 있습니다.";
    case "needs-install":
      return "홈 화면에 추가한 앱에서 알림을 켤 수 있습니다.";
    case "unsupported":
      return "이 브라우저에서는 일정 알림을 사용할 수 없습니다.";
    case "not-configured":
      return "알림 서버 설정을 확인하고 있습니다.";
    case "denied":
      return "휴대폰 설정에서 이 앱의 알림을 허용해 주세요.";
    case "offline":
      return "인터넷 연결 후 가족 공간별 알림 설정을 확인하거나 변경할 수 있습니다.";
    case "error":
      return "이 기기의 알림 상태를 확인하지 못했습니다.";
    default:
      return "한 기기에서 가족 공간별로 알림 수신 여부를 선택할 수 있습니다.";
  }
}

function spaceStatusText(
  state: SpacePushState,
  deviceState: DeviceState
): string {
  if (deviceState === "offline") {
    if (state === "on") return "마지막 확인 상태: 알림 받는 중";
    if (state === "off") return "알림 꺼짐 · 연결 후 켤 수 있음";
    return "인터넷 연결 후 알림 상태를 확인할 수 있습니다.";
  }
  if (deviceState !== "ready") {
    return "기기 알림 설정을 마친 뒤 확인할 수 있습니다.";
  }
  switch (state) {
    case "checking":
      return "알림 수신 여부를 확인하고 있습니다.";
    case "on":
      return "이 기기에서 알림 받는 중";
    case "error":
      return "알림 상태를 확인하지 못했습니다.";
    default:
      return "이 기기에서 알림 꺼짐";
  }
}

function roleText(role: CareSpaceAccess["role"]): string {
  switch (role) {
    case "owner":
      return "소유자";
    case "caregiver":
      return "보호자";
    default:
      return "조회자";
  }
}

function checkingStates(
  careSpaces: CareSpaceAccess[]
): Record<string, SpacePushState> {
  return Object.fromEntries(
    careSpaces.map((space) => [space.id, "checking" as const])
  );
}

export function PushNotificationsCard({ online }: { online: boolean }) {
  const { careSpaces, selectedCareSpace } = useDb();
  const [deviceState, setDeviceState] = useState<DeviceState>("checking");
  const [spaceStates, setSpaceStates] = useState<
    Record<string, SpacePushState>
  >({});
  const [subscription, setSubscription] =
    useState<PushSubscription | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [spaceMessages, setSpaceMessages] = useState<
    Record<string, SpaceMessage | undefined>
  >({});
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [checkVersion, setCheckVersion] = useState(0);

  const showSpaceMessage = useCallback(
    (careSpaceId: string, text: string, tone: SpaceMessage["tone"]) => {
      setSpaceMessages((current) => ({
        ...current,
        [careSpaceId]: { text, tone },
      }));
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function checkPushState() {
      setDeviceState("checking");
      setGlobalMessage(null);
      setSpaceMessages({});
      setSpaceStates(checkingStates(careSpaces));

      if (careSpaces.length === 0) {
        setDeviceState("ready");
        return;
      }
      if (isIosDevice() && !isStandaloneApp()) {
        setDeviceState("needs-install");
        return;
      }
      if (!supportsWebPush()) {
        setDeviceState("unsupported");
        return;
      }
      if (!publicVapidKey) {
        setDeviceState("not-configured");
        return;
      }
      if (Notification.permission === "denied") {
        setDeviceState("denied");
        return;
      }

      try {
        const registration = await registerPushServiceWorker();
        const current = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setSubscription(current);

        if (!current) {
          setSpaceStates(
            Object.fromEntries(
              careSpaces.map((space) => [space.id, "off" as const])
            )
          );
          setDeviceState(online ? "ready" : "offline");
          return;
        }
        if (!online) {
          setDeviceState("offline");
          return;
        }

        setDeviceState("ready");
        const serialized = serializePushSubscription(current);
        const results = await Promise.all(
          careSpaces.map(async (space) => ({
            space,
            result: await getPushNotificationStatus(space.id, serialized),
          }))
        );
        if (cancelled) return;
        setSpaceStates(
          Object.fromEntries(
            results.map(({ space, result }) => [
              space.id,
              result.ok ? (result.registered ? "on" : "off") : "error",
            ])
          )
        );
        setSpaceMessages(
          Object.fromEntries(
            results.flatMap(({ space, result }) =>
              result.ok
                ? []
                : [
                    [
                      space.id,
                      { text: result.message, tone: "error" as const },
                    ],
                  ]
            )
          )
        );
      } catch (error) {
        if (cancelled) return;
        setDeviceState("error");
        setSpaceStates(
          Object.fromEntries(
            careSpaces.map((space) => [space.id, "error" as const])
          )
        );
        setGlobalMessage(
          error instanceof Error
            ? error.message
            : "알림 상태를 확인하지 못했습니다. 다시 시도해 주세요."
        );
      }
    }

    void checkPushState();
    return () => {
      cancelled = true;
    };
  }, [careSpaces, checkVersion, online, showSpaceMessage]);

  async function enableNotifications(space: CareSpaceAccess) {
    if (!online || pending || !publicVapidKey || deviceState !== "ready") return;
    setPending({ careSpaceId: space.id, kind: "enable" });
    setSpaceMessages((current) => ({ ...current, [space.id]: undefined }));
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDeviceState(permission === "denied" ? "denied" : "ready");
        showSpaceMessage(
          space.id,
          "알림 권한이 허용되지 않았습니다.",
          "error"
        );
        return;
      }
      const registration = await registerPushServiceWorker();
      const nextSubscription = await subscribeBrowserToPush(
        registration,
        publicVapidKey
      );
      setSubscription(nextSubscription);
      const result = await subscribeToPush(
        space.id,
        serializePushSubscription(nextSubscription)
      );
      if (!result.ok) throw new Error(result.message);
      setSpaceStates((states) => ({ ...states, [space.id]: "on" }));
      showSpaceMessage(
        space.id,
        `${space.name}의 일정 알림을 켰습니다.`,
        "success"
      );
    } catch (error) {
      setSpaceStates((states) => ({ ...states, [space.id]: "error" }));
      showSpaceMessage(
        space.id,
        error instanceof Error
          ? error.message
          : "알림을 켜지 못했습니다. 다시 시도해 주세요.",
        "error"
      );
    } finally {
      setPending(null);
    }
  }

  async function disableNotifications(space: CareSpaceAccess) {
    if (!online || pending || !subscription || deviceState !== "ready") return;
    setPending({ careSpaceId: space.id, kind: "disable" });
    setSpaceMessages((current) => ({ ...current, [space.id]: undefined }));
    try {
      const result = await unsubscribeFromPush(
        space.id,
        serializePushSubscription(subscription)
      );
      if (!result.ok) throw new Error(result.message);
      await dismissCareSpaceNotifications(space.id);
      setSpaceStates((states) => ({ ...states, [space.id]: "off" }));
      showSpaceMessage(
        space.id,
        `${space.name}의 일정 알림을 껐습니다.`,
        "success"
      );
    } catch (error) {
      showSpaceMessage(
        space.id,
        error instanceof Error
          ? error.message
          : "알림을 끄지 못했습니다. 다시 시도해 주세요.",
        "error"
      );
    } finally {
      setPending(null);
    }
  }

  async function testNotifications(space: CareSpaceAccess) {
    if (!online || pending || !subscription || deviceState !== "ready") return;
    setPending({ careSpaceId: space.id, kind: "test" });
    setSpaceMessages((current) => ({ ...current, [space.id]: undefined }));
    try {
      const result = await sendTestNotification(
        space.id,
        serializePushSubscription(subscription)
      );
      if (!result.ok) throw new Error(result.message);
      showSpaceMessage(
        space.id,
        `${space.name} 테스트 알림을 보냈습니다.`,
        "success"
      );
    } catch (error) {
      showSpaceMessage(
        space.id,
        error instanceof Error
          ? error.message
          : "테스트 알림을 보내지 못했습니다.",
        "error"
      );
    } finally {
      setPending(null);
    }
  }

  const deviceBlocked =
    deviceState !== "ready" && deviceState !== "offline";

  return (
    <section
      aria-labelledby="push-notification-title"
      className="rounded-2xl border border-hairline bg-canvas px-4 py-5 sm:px-5"
    >
      <div className="flex flex-col gap-2">
        <h2 id="push-notification-title" className="text-xl font-bold text-ink">
          투약 일정 알림
        </h2>
        <p className="text-base leading-relaxed text-body">
          이 기기에서 알림을 받을 가족 공간을 각각 선택할 수 있습니다. 가족
          초대를 수락해도 알림은 자동으로 켜지지 않습니다.
        </p>
        <p className="text-base leading-relaxed text-body">
          등록한 각 복용·알림 시간부터 5분마다 반복하고, 해당 시간의 기록이
          생기거나 시간을 끄거나 삭제하면 반복을 중단합니다.
        </p>
        <p
          role={deviceState === "error" ? "alert" : "status"}
          className="text-base font-semibold text-ink"
        >
          {deviceStatusText(deviceState)}
        </p>
      </div>

      {deviceState === "needs-install" && (
        <p className="mt-4 rounded-xl bg-surface-soft px-4 py-4 text-base leading-relaxed text-body">
          Safari의 공유 버튼에서{" "}
          <strong className="text-ink">홈 화면에 추가</strong>한 뒤, 홈 화면
          아이콘으로 앱을 열어 주세요.
        </p>
      )}

      {deviceState === "error" && (
        <button
          type="button"
          onClick={() => setCheckVersion((version) => version + 1)}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-hairline bg-canvas px-4 text-base font-bold text-body"
        >
          알림 상태 다시 확인
        </button>
      )}

      {globalMessage && (
        <p role="alert" className="mt-3 text-base font-semibold text-error">
          {globalMessage}
        </p>
      )}

      {careSpaces.length === 0 ? (
        <p className="mt-5 rounded-xl bg-surface-soft px-4 py-4 text-base leading-relaxed text-body">
          알림을 설정할 수 있는 가족 공간이 없습니다.
        </p>
      ) : (
        <ul
          className="mt-5 flex flex-col gap-4"
          aria-label="가족 공간별 알림 설정"
        >
          {careSpaces.map((space) => {
            const state = spaceStates[space.id] ?? "checking";
            const message = spaceMessages[space.id];
            const isCurrent = selectedCareSpace?.id === space.id;
            const isPending = pending?.careSpaceId === space.id;
            const controlsDisabled =
              !online || pending !== null || deviceState !== "ready";
            const titleId = `push-space-${space.id}-title`;
            const statusId = `push-space-${space.id}-status`;

            return (
              <li
                key={space.id}
                aria-labelledby={titleId}
                aria-busy={state === "checking" || isPending}
                className="min-w-0 rounded-xl border border-hairline bg-surface-soft px-4 py-4"
              >
                <div className="min-w-0">
                  <h3
                    id={titleId}
                    className="break-words text-lg font-bold text-ink"
                  >
                    {space.name}
                  </h3>
                  <p className="mt-1 text-sm font-semibold text-muted">
                    {roleText(space.role)}
                    {isCurrent ? " · 현재 기록 대상" : ""}
                  </p>
                  <p
                    id={statusId}
                    className="mt-2 text-base font-semibold text-body"
                  >
                    {spaceStatusText(state, deviceState)}
                  </p>
                </div>

                {(deviceState === "ready" || deviceState === "offline") &&
                  state === "on" && (
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => void testNotifications(space)}
                        disabled={controlsDisabled}
                        aria-describedby={statusId}
                        className="flex min-h-12 w-full items-center justify-center rounded-full bg-primary-active px-4 text-base font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
                      >
                        {isPending && pending.kind === "test"
                          ? "보내는 중입니다"
                          : "테스트 알림 보내기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void disableNotifications(space)}
                        disabled={controlsDisabled}
                        aria-describedby={statusId}
                        className="flex min-h-12 w-full items-center justify-center rounded-full border border-hairline bg-canvas px-4 text-base font-bold text-body disabled:text-muted-soft"
                      >
                        {isPending && pending.kind === "disable"
                          ? "끄는 중입니다"
                          : "이 공간 알림 끄기"}
                      </button>
                    </div>
                  )}

                {(deviceState === "ready" || deviceState === "offline") &&
                  (state === "off" || state === "error") && (
                    <button
                      type="button"
                      onClick={() => void enableNotifications(space)}
                      disabled={controlsDisabled}
                      aria-describedby={statusId}
                      className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary-active px-4 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
                    >
                      {isPending && pending.kind === "enable"
                        ? "알림을 켜는 중입니다"
                        : online
                          ? `${space.name} 알림 받기`
                          : "연결 후 알림 설정 가능"}
                    </button>
                  )}

                {message && (
                  <p
                    role={message.tone === "error" ? "alert" : "status"}
                    className={`mt-3 break-words text-base font-semibold ${
                      message.tone === "error"
                        ? "text-error"
                        : "text-success"
                    }`}
                  >
                    {message.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deviceBlocked && deviceState !== "checking" && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          기기 알림 설정을 사용할 수 있게 되면 각 가족 공간의 수신 여부를 선택할
          수 있습니다.
        </p>
      )}

      <p className="mt-4 text-sm leading-relaxed text-muted">
        알림은 네트워크, 집중 모드와 절전 설정에 따라 늦게 도착할 수 있습니다.
      </p>
    </section>
  );
}

import type { PushSubscriptionPayload } from "@/lib/push-contracts";

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(normalized);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function supportsWebPush(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandaloneApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export function serializePushSubscription(
  subscription: PushSubscription
): PushSubscriptionPayload {
  const serialized = subscription.toJSON();
  const p256dh = serialized.keys?.p256dh;
  const auth = serialized.keys?.auth;
  if (!serialized.endpoint || !p256dh || !auth) {
    throw new Error("브라우저의 알림 구독 정보를 확인하지 못했습니다.");
  }
  return {
    endpoint: serialized.endpoint,
    expirationTime: serialized.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

export async function subscribeBrowserToPush(
  registration: ServiceWorkerRegistration,
  publicKey: string
): Promise<PushSubscription> {
  const current = await registration.pushManager.getSubscription();
  if (current) return current;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

export async function dismissScheduleNotifications(
  scheduleIds: string | string[],
  dateKey?: string
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const ids = Array.isArray(scheduleIds) ? scheduleIds : [scheduleIds];
  const logicalTagPrefixes = ids.map(
    (id) => `schedule-${id.replace(/-/g, "")}-`
  );
  const logicalTags = dateKey
    ? logicalTagPrefixes.map((prefix) => `${prefix}${dateKey.replace(/-/g, "")}`)
    : null;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;

    const notifications = await registration.getNotifications();
    for (const notification of notifications) {
      const logicalTag =
        typeof notification.data?.logicalTag === "string"
          ? notification.data.logicalTag
          : notification.tag;
      const matches = logicalTags
        ? logicalTags.includes(logicalTag)
        : logicalTagPrefixes.some((prefix) => logicalTag.startsWith(prefix));
      if (matches) {
        notification.close();
      }
    }
  } catch {
    // Closing an already displayed notification is a best-effort UI cleanup.
  }
}

export async function dismissCareSpaceNotifications(
  careSpaceId: string
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;

    const notifications = await registration.getNotifications();
    for (const notification of notifications) {
      const requestedPath = notification.data?.url;
      if (typeof requestedPath !== "string") continue;

      try {
        const url = new URL(requestedPath, window.location.origin);
        if (
          url.origin === window.location.origin &&
          url.searchParams.get("space") === careSpaceId
        ) {
          notification.close();
        }
      } catch {
        // Ignore malformed notification URLs and continue checking the rest.
      }
    }
  } catch {
    // Closing already displayed notifications is a best-effort UI cleanup.
  }
}

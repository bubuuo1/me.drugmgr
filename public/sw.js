/*
 * 온라인 전용 앱의 푸시 알림 서비스 워커.
 * fetch 핸들러와 앱/API 캐시는 의도적으로 두지 않는다.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("medicine-app-"))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

let notificationDisplayQueue = Promise.resolve();

async function displayPushNotification(payload) {
  try {
    const notifications = await self.registration.getNotifications();
    for (const notification of notifications) {
      const logicalTag = notification.data?.logicalTag;
      if (logicalTag === payload.tag || notification.tag === payload.tag) {
        notification.close();
      }
    }
  } catch {
    // Existing-notification cleanup is best effort; the new alert must still show.
  }

  await self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: payload.icon,
    badge: "/notification-badge.png",
    silent: false,
    vibrate: [300, 150, 300, 150, 500],
    data: { url: payload.url, logicalTag: payload.tag },
  });
}

self.addEventListener("push", (event) => {
  let payload = {
    title: "투약 기록 확인",
    body: "등록한 약의 투약 기록을 확인해 주세요.",
    icon: "/icon-192x192.png",
    url: "/",
    tag: "medicine-schedule",
  };

  if (event.data) {
    try {
      const received = event.data.json();
      payload = {
        title: typeof received.title === "string" ? received.title : payload.title,
        body: typeof received.body === "string" ? received.body : payload.body,
        icon: typeof received.icon === "string" ? received.icon : payload.icon,
        url: typeof received.url === "string" ? received.url : payload.url,
        tag: typeof received.tag === "string" ? received.tag : payload.tag,
      };
    } catch {
      // Use the neutral fallback notification above.
    }
  }

  notificationDisplayQueue = notificationDisplayQueue
    .catch(() => undefined)
    .then(() => displayPushNotification(payload));
  event.waitUntil(notificationDisplayQueue);
});

async function closeNotificationGroup(clickedNotification) {
  clickedNotification.close();
  const logicalTag =
    typeof clickedNotification.data?.logicalTag === "string"
      ? clickedNotification.data.logicalTag
      : clickedNotification.tag;
  if (!logicalTag) return;

  try {
    const notifications = await self.registration.getNotifications();
    for (const notification of notifications) {
      const candidateTag =
        typeof notification.data?.logicalTag === "string"
          ? notification.data.logicalTag
          : notification.tag;
      if (candidateTag === logicalTag) notification.close();
    }
  } catch {
    // The clicked notification was already closed above.
  }
}

self.addEventListener("notificationclick", (event) => {
  const requestedPath = event.notification.data?.url;
  const target = new URL(
    typeof requestedPath === "string" ? requestedPath : "/",
    self.location.origin
  );
  const safeTarget =
    target.origin === self.location.origin
      ? target
      : new URL("/", self.location.origin);

  event.waitUntil(
    Promise.all([
      closeNotificationGroup(event.notification),
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then(async (windows) => {
          const current = windows[0];
          if (current) {
            if ("navigate" in current) await current.navigate(safeTarget.href);
            return current.focus();
          }
          return self.clients.openWindow(safeTarget.href);
        }),
    ])
  );
});

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

self.addEventListener("push", (event) => {
  let payload = {
    title: "투약 일정 알림",
    body: "투약 기록을 확인해 주세요.",
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

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      tag: payload.tag,
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
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
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const current = windows[0];
        if (current) {
          if ("navigate" in current) await current.navigate(safeTarget.href);
          return current.focus();
        }
        return self.clients.openWindow(safeTarget.href);
      })
  );
});

/* 투약 관리 앱 서비스워커
 * 전략:
 *  - navigation: network-first -> 캐시 폴백 (최신 HTML 우선, 오프라인엔 캐시된 앱 셸)
 *  - 정적 에셋(_next/static, 공개 파일): stale-while-revalidate
 *  - 외부 API(Supabase)는 캐시하지 않음
 */
const VERSION = "v1";
const APP_SHELL_CACHE = `medicine-app-shell-${VERSION}`;
const STATIC_CACHE = `medicine-app-static-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) =>
        cache.addAll(["/", "/manifest.webmanifest", "/icon.svg"])
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("medicine-app-") && key !== APP_SHELL_CACHE && key !== STATIC_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // 외부(API 등) 요청은 캐시하지 않는다
  if (url.origin !== self.location.origin) return;

  // HTML 내비게이션: network-first
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches
            .open(APP_SHELL_CACHE)
            .then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // 정적 에셋: stale-while-revalidate
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 그 외 같은 도메인 요청은 network-first 후 캐시 폴백
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches
          .open(APP_SHELL_CACHE)
          .then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

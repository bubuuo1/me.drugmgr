/*
 * 온라인 전용 전환용 정리 서비스 워커.
 * 이전 버전의 앱 셸 캐시를 제거한 뒤 스스로 등록 해제한다.
 * fetch 핸들러를 두지 않으므로 어떤 응답도 캐시하지 않는다.
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
      .then(() => self.registration.unregister())
  );
});

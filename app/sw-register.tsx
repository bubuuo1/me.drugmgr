"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // 이 앱은 온라인 전용이다. 이전 MVP에서 등록한 서비스 워커와
    // 앱 셸 캐시가 오프라인 화면을 계속 제공하지 않도록 정리한다.
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister()))
        )
        .catch(() => undefined);
    }

    if ("caches" in window) {
      void caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("medicine-app-"))
              .map((key) => caches.delete(key))
          )
        )
        .catch(() => undefined);
    }
  }, []);

  return null;
}

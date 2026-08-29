"use client";

import { useEffect, useState } from "react";

function isOffline(): boolean {
  return typeof window !== "undefined" && !window.navigator.onLine;
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(isOffline);

  useEffect(() => {
    function onOffline() {
      setOffline(true);
    }
    function onOnline() {
      setOffline(false);
    }
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-warning px-4 py-3 text-center text-sm font-bold text-on-primary"
    >
      인터넷 연결이 필요합니다. 지금은 기록을 불러오거나 저장할 수 없습니다.
    </div>
  );
}

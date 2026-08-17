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
    <div role="status" className="bg-surface-strong px-4 py-2 text-center text-sm font-semibold text-body">
      오프라인 상태입니다. 기록은 표시 불가할 수 있습니다.
    </div>
  );
}

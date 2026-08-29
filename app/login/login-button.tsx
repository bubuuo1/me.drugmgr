"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LoginButtonProps = {
  nextPath: string;
};

export function LoginButton({ nextPath }: LoginButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setPending(true);
    setError(null);

    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", nextPath);
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
        },
      });

      if (signInError) throw signInError;
    } catch {
      setError(
        "Google 로그인을 시작하지 못했습니다. 인터넷 연결과 로그인 설정을 확인한 뒤 다시 시도해 주세요."
      );
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        disabled={pending}
        className="flex min-h-16 w-full items-center justify-center gap-3 rounded-full border-2 border-ink bg-canvas px-6 text-xl font-bold text-ink active:bg-surface-soft disabled:border-hairline disabled:bg-surface-soft disabled:text-muted"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-8 items-center justify-center rounded-full border border-hairline text-base font-bold"
        >
          G
        </span>
        {pending ? "Google로 이동하는 중…" : "Google로 계속하기"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-error bg-canvas px-4 py-3 text-base font-semibold leading-relaxed text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

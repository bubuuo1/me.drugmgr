import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "로그인 오류 | 투약 관리",
};

type AuthCodeErrorPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

function loginHref(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/login";
  }

  try {
    const base = new URL("https://medicine-app.invalid");
    const candidate = new URL(value, base);
    if (
      candidate.origin !== base.origin ||
      candidate.pathname === "/login" ||
      candidate.pathname.startsWith("/auth/")
    ) {
      return "/login";
    }
    const safePath = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    return `/login?next=${encodeURIComponent(safePath)}`;
  } catch {
    return "/login";
  }
}

export default async function AuthCodeErrorPage({
  searchParams,
}: AuthCodeErrorPageProps) {
  const { next } = await searchParams;

  return (
    <main className="flex flex-1 flex-col justify-center py-8">
      <section
        role="alert"
        aria-labelledby="auth-error-title"
        className="rounded-2xl border border-error bg-canvas px-6 py-8"
      >
        <h1 id="auth-error-title" className="text-2xl font-bold text-error">
          로그인하지 못했습니다
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-body">
          Google 로그인 과정이 완료되지 않았습니다. 인터넷 연결을 확인한 뒤 다시
          시도해 주세요.
        </p>
        <Link
          href={loginHref(next)}
          className="mt-7 flex min-h-16 w-full items-center justify-center rounded-full bg-primary-active px-6 text-xl font-bold text-on-primary active:bg-ink"
        >
          로그인 다시 시도
        </Link>
      </section>
    </main>
  );
}

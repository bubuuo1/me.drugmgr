import type { Metadata } from "next";
import { LoginButton } from "./login-button";

export const metadata: Metadata = {
  title: "로그인 | 투약 관리",
};

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

function normalizeNextPath(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  try {
    const base = new URL("https://medicine-app.invalid");
    const candidate = new URL(value, base);
    if (candidate.origin !== base.origin) return "/";
    if (
      candidate.pathname === "/login" ||
      candidate.pathname.startsWith("/auth/")
    ) {
      return "/";
    }
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return "/";
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const nextPath = normalizeNextPath(next);

  return (
    <main className="flex flex-1 flex-col justify-center py-8">
      <section
        aria-labelledby="login-title"
        className="rounded-2xl border border-hairline bg-canvas px-6 py-8"
      >
        <p className="text-base font-bold text-primary-active">투약 관리</p>
        <h1 id="login-title" className="mt-2 text-2xl font-bold leading-snug text-ink">
          내 기록을 안전하게 이어가세요
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-body">
          Google 계정으로 로그인하면 개인 복약 기록은 사용자별로 분리되고,
          초대한 가족과 필요한 기록을 함께 확인할 수 있습니다.
        </p>

        <LoginButton nextPath={nextPath} />

        <p className="mt-5 text-sm leading-relaxed text-muted">
          처음 로그인하는 Google 계정은 회원으로 등록됩니다. 가족 기록은 초대를
          수락한 뒤에만 볼 수 있습니다.
        </p>
      </section>

      <p className="mt-6 text-center text-sm leading-relaxed text-muted">
        이 앱은 복용 사실을 기록하며 복용량이나 처방을 판단하지 않습니다.
      </p>
    </main>
  );
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function normalizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

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

function redirectWithoutCaching(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0"
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = normalizeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return redirectWithoutCaching(new URL(nextPath, requestUrl.origin));
      }
    } catch {
      // The public error page intentionally does not expose provider details.
    }
  }

  const errorUrl = new URL("/auth/auth-code-error", requestUrl.origin);
  if (nextPath !== "/") errorUrl.searchParams.set("next", nextPath);
  return redirectWithoutCaching(errorUrl);
}

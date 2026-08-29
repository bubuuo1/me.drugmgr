import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types";

const LOGIN_PATH = "/login";
const AUTH_CALLBACK_PATH = "/auth/callback";
const AUTH_ERROR_PATH = "/auth/auth-code-error";
const PUSH_DISPATCH_PATH = "/api/push/dispatch";

function jwtRole(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

function normalizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const base = new URL("https://medicine-app.invalid");
    const candidate = new URL(value, base);
    if (candidate.origin !== base.origin) return "/";
    if (
      candidate.pathname === LOGIN_PATH ||
      candidate.pathname.startsWith("/auth/")
    ) {
      return "/";
    }
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return "/";
  }
}

function getPublicSupabaseConfiguration(): {
  url: string;
  key: string;
} | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";

  if (
    !url ||
    !key ||
    key.startsWith("sb_secret_") ||
    jwtRole(key) === "service_role"
  ) {
    return null;
  }
  return { url, key };
}

function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname === AUTH_CALLBACK_PATH ||
    pathname === AUTH_ERROR_PATH
  );
}

function copyAuthCookies(source: NextResponse, target: NextResponse): void {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  for (const headerName of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(headerName);
    if (value) target.headers.set(headerName, value);
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0"
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function loginRedirect(request: NextRequest, authResponse: NextResponse): NextResponse {
  const loginUrl = new URL(LOGIN_PATH, request.url);
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set("next", normalizeNextPath(requestedPath));
  const response = NextResponse.redirect(loginUrl);
  copyAuthCookies(authResponse, response);
  return noStore(response);
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_USE_MOCK_DB === "true") {
    return NextResponse.next({ request });
  }

  const pathname = request.nextUrl.pathname;
  if (
    pathname === PUSH_DISPATCH_PATH ||
    pathname === AUTH_CALLBACK_PATH ||
    pathname === AUTH_ERROR_PATH
  ) {
    return NextResponse.next({ request });
  }

  const configuration = getPublicSupabaseConfiguration();
  if (!configuration) {
    if (isPublicAuthPath(pathname)) return NextResponse.next({ request });
    return loginRedirect(request, NextResponse.next({ request }));
  }

  let authResponse = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    configuration.url,
    configuration.key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          authResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            authResponse.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([name, value]) => {
            authResponse.headers.set(name, value);
          });
        },
      },
    }
  );

  let isAuthenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    isAuthenticated =
      !error &&
      typeof data?.claims?.sub === "string" &&
      data.claims.role === "authenticated" &&
      data.claims.is_anonymous !== true;
  } catch {
    // Fail closed when identity cannot be cryptographically verified.
  }

  if (!isAuthenticated && !isPublicAuthPath(pathname)) {
    return loginRedirect(request, authResponse);
  }

  if (isAuthenticated && pathname === LOGIN_PATH) {
    const nextPath = normalizeNextPath(request.nextUrl.searchParams.get("next"));
    const response = NextResponse.redirect(new URL(nextPath, request.url));
    copyAuthCookies(authResponse, response);
    return noStore(response);
  }

  return noStore(authResponse);
}

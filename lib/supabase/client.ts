import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

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

function getPublicSupabaseConfiguration(): {
  url: string;
  key: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";

  if (!url || !key) {
    throw new Error("Supabase 로그인 설정이 필요합니다.");
  }
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    throw new Error(
      "브라우저에는 Supabase service_role/secret key를 사용할 수 없습니다."
    );
  }

  return { url, key };
}

export function createClient(): SupabaseClient<Database> {
  const { url, key } = getPublicSupabaseConfiguration();
  return createBrowserClient<Database>(url, key);
}

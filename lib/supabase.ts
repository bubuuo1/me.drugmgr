import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

export const isMockDbEnabled =
  process.env.NEXT_PUBLIC_USE_MOCK_DB === "true";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  "";

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

function configurationError(): string | null {
  if (isMockDbEnabled) return null;
  if (!supabaseUrl) {
    return "Supabase 설정 오류: NEXT_PUBLIC_SUPABASE_URL이 필요합니다.";
  }
  if (!supabasePublicKey) {
    return "Supabase 설정 오류: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY가 필요합니다.";
  }

  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      return "Supabase 설정 오류: URL은 HTTPS여야 합니다.";
    }
  } catch {
    return "Supabase 설정 오류: NEXT_PUBLIC_SUPABASE_URL 형식이 올바르지 않습니다.";
  }

  if (
    supabasePublicKey.startsWith("sb_secret_") ||
    jwtRole(supabasePublicKey) === "service_role"
  ) {
    return "Supabase 설정 오류: 브라우저에 service_role/secret key를 사용할 수 없습니다.";
  }

  return null;
}

export const supabaseConfigurationError = configurationError();

export const supabase: SupabaseClient<Database> | null =
  !isMockDbEnabled && !supabaseConfigurationError
    ? createClient<Database>(supabaseUrl, supabasePublicKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

export const isSupabaseEnabled = supabase !== null;

export function requireSupabase(): SupabaseClient<Database> {
  if (supabase) return supabase;
  if (isMockDbEnabled) {
    throw new Error("테스트용 메모리 DB 모드에서는 Supabase를 사용할 수 없습니다.");
  }
  throw new Error(
    supabaseConfigurationError ?? "Supabase 클라이언트를 초기화하지 못했습니다."
  );
}

"use server";

import { createClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  if (process.env.NEXT_PUBLIC_USE_MOCK_DB === "true") {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    throw new Error("로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

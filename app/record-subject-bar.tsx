"use client";

import { usePathname } from "next/navigation";
import { useDb } from "@/lib/store";
import type { CareSpaceRole } from "@/lib/types";

function roleLabel(role: CareSpaceRole): string {
  if (role === "owner") return "소유자";
  if (role === "caregiver") return "보호자";
  return "조회 전용";
}

export function RecordSubjectBar() {
  const pathname = usePathname();
  const { selectedCareSpace } = useDb();

  if (
    !selectedCareSpace ||
    pathname === "/login" ||
    pathname.startsWith("/auth/") ||
    pathname === "/settings" ||
    pathname === "/family"
  ) {
    return null;
  }

  return (
    <aside
      aria-label="현재 기록 대상"
      className="mb-4 flex min-h-12 min-w-0 items-center justify-between gap-3 border-b border-hairline-soft pb-3"
    >
      <span className="shrink-0 text-sm font-semibold text-muted">기록 대상</span>
      <span className="min-w-0 break-words text-right text-base font-bold text-ink">
        {selectedCareSpace.name} · {roleLabel(selectedCareSpace.role)}
      </span>
    </aside>
  );
}

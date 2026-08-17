"use client";

import Link from "next/link";
import { useDb } from "@/lib/store";
import { isToday, toDateKey } from "@/lib/date";

export default function Home() {
  const { db } = useDb();
  const medications = db.medications.filter((m) => m.active);

  const today = toDateKey(new Date());
  const todayLogs = db.medication_logs.filter((l) => {
    const t = new Date(l.taken_at);
    return toDateKey(t) === today;
  });

  const actionLink = (medicationId: string) =>
    `/log?med=${encodeURIComponent(medicationId)}`;

  return (
    <main className="flex flex-1 flex-col gap-8">
      <header className="pt-4">
        <h1 className="text-[24px] font-bold leading-[1.4] text-ink">투약 관리</h1>
        <p className="mt-1 text-[16px] text-muted">
          {isToday(today) ? "오늘의 기록" : "기록 확인"}
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {medications.map((med) => {
          const todayMedCount = todayLogs
            .filter((l) => l.medication_id === med.id)
            .reduce((sum, l) => sum + l.quantity, 0);
          return (
            <Link
              key={med.id}
              href={actionLink(med.id)}
              className="flex min-h-[72px] w-full flex-col items-center justify-center rounded-full bg-primary px-6 text-center text-[20px] font-bold text-on-primary transition-colors hover:bg-primary-active active:bg-primary-active"
            >
              {med.name} 기록
              {todayMedCount > 0 && (
                <span className="mt-0.5 text-sm font-semibold text-on-primary/90">
                  오늘 {todayMedCount}{med.unit} 복용
                </span>
              )}
            </Link>
          );
        })}

        <Link
          href="/status"
          className="flex min-h-[72px] w-full items-center justify-center rounded-full border-2 border-ink bg-canvas px-6 text-center text-[20px] font-bold text-ink transition-colors hover:bg-surface-soft active:bg-surface-soft"
        >
          오늘 상태
        </Link>

        <Link
          href="/records"
          className="flex min-h-[72px] w-full items-center justify-center rounded-full border-2 border-ink bg-canvas px-6 text-center text-[20px] font-bold text-ink transition-colors hover:bg-surface-soft active:bg-surface-soft"
        >
          기록 확인
        </Link>
      </div>
    </main>
  );
}

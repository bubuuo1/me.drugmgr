"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDb } from "@/lib/store";
import { isToday, toDateKey } from "@/lib/date";
import { isBooleanOnly } from "@/lib/types";

export default function Home() {
  const { db } = useDb();
  const medications = db.medications.filter((m) => m.active);

  const medById = useMemo(
    () => new Map(db.medications.map((m) => [m.id, m])),
    [db.medications]
  );

  const today = toDateKey(new Date());
  const todayLogs = useMemo(
    () =>
      db.medication_logs.filter((l) => {
        const t = new Date(l.taken_at);
        return toDateKey(t) === today;
      }),
    [db.medication_logs, today]
  );

  const medsToday = medications.map((med) => {
    const logs = todayLogs.filter((l) => l.medication_id === med.id);
    const count = logs.reduce((sum, l) => sum + l.quantity, 0);
    return {
      med,
      booleanOnly: isBooleanOnly(med),
      logged: logs.length > 0,
      count,
    };
  });

  const todaySchedules = db.medication_schedules
    .filter((s) => {
      if (!s.active) return false;
      const med = medById.get(s.medication_id);
      return !!med && med.active;
    })
    .sort((a, b) => (a.time < b.time ? -1 : 1))
    .map((s) => {
      const med = medById.get(s.medication_id)!;
      const logged = todayLogs.some((l) => l.medication_id === s.medication_id);
      return { schedule: s, med, logged };
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

      <section className="rounded-2xl border border-hairline px-5 py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] font-bold text-ink">오늘 현황</h2>
          <span className="text-sm text-muted">
            {medsToday.filter((m) => m.logged).length}/{medsToday.length} 기록됨
          </span>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {medsToday.map(({ med, booleanOnly, logged, count }) => (
            <li
              key={med.id}
              className="flex items-center justify-between gap-3 text-base"
            >
              <span className="font-medium text-ink">{med.name}</span>
              {!logged ? (
                <span className="font-semibold text-muted">미기록</span>
              ) : booleanOnly ? (
                <span className="font-semibold text-primary">복용함</span>
              ) : (
                <span className="font-semibold text-primary">
                  {count}
                  {med.unit} 복용
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-4">
        {medications.map((med) => {
          const todayMedCount = todayLogs
            .filter((l) => l.medication_id === med.id)
            .reduce((sum, l) => sum + l.quantity, 0);
          const booleanOnly = isBooleanOnly(med);
          return (
            <Link
              key={med.id}
              href={actionLink(med.id)}
              className="flex min-h-[72px] w-full flex-col items-center justify-center rounded-full bg-primary px-6 text-center text-[20px] font-bold text-on-primary transition-colors hover:bg-primary-active active:bg-primary-active"
            >
              {med.name} 기록
              {booleanOnly ? (
                todayMedCount > 0 ? (
                  <span className="mt-0.5 text-sm font-semibold text-on-primary/90">
                    복용함
                  </span>
                ) : (
                  <span className="mt-0.5 text-sm font-semibold text-on-primary/70">
                    미기록
                  </span>
                )
              ) : (
                todayMedCount > 0 && (
                  <span className="mt-0.5 text-sm font-semibold text-on-primary/90">
                    오늘 {todayMedCount}
                    {med.unit} 복용
                  </span>
                )
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

      {todaySchedules.length > 0 && (
        <section className="rounded-2xl border border-hairline px-5 py-4">
          <h2 className="text-[18px] font-bold text-ink">오늘 예정</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {todaySchedules.map(({ schedule, med, logged }) => (
              <li
                key={schedule.id}
                className="flex items-center justify-between gap-3 text-base"
              >
                <span className="font-medium text-ink">{schedule.time}</span>
                <span className="text-body">
                  {med.name}
                  {!isBooleanOnly(med) && schedule.default_quantity > 0
                    ? ` ${schedule.default_quantity}${med.unit}`
                    : ""}
                </span>
                <span
                  className={
                    logged
                      ? "font-semibold text-primary"
                      : "font-semibold text-muted"
                  }
                >
                  {logged ? "복용함" : "미기록"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

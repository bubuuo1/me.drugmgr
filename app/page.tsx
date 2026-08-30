"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorBanner } from "@/app/components/ui";
import { formatDateTime, formatKoreanDate, toDateKey } from "@/lib/date";
import { useDb } from "@/lib/store";
import { isBooleanOnly, type MedicationLog } from "@/lib/types";

export default function Home() {
  const {
    db,
    selectedCareSpace,
    loading,
    error,
    refresh,
    clearError,
    canManageMedicationSettings,
    canWriteRecords,
    initialized,
  } = useDb();
  const [refreshing, setRefreshing] = useState(false);
  const today = toDateKey(new Date());

  const medications = useMemo(
    () => db.medications.filter((medication) => medication.active),
    [db.medications]
  );
  const medById = useMemo(
    () => new Map(db.medications.map((medication) => [medication.id, medication])),
    [db.medications]
  );
  const todayLogs = useMemo(
    () =>
      db.medication_logs
        .filter(
          (log) =>
            log.deleted_at === null && toDateKey(new Date(log.taken_at)) === today
        )
        .sort((a, b) => a.taken_at.localeCompare(b.taken_at)),
    [db.medication_logs, today]
  );
  const todayScheduleOutcomes = useMemo(
    () =>
      db.medication_schedule_outcomes.filter(
        (outcome) => outcome.scheduled_date === today
      ),
    [db.medication_schedule_outcomes, today]
  );
  const latestLogByMedication = useMemo(() => {
    const result = new Map<string, MedicationLog>();
    for (const log of db.medication_logs) {
      if (log.deleted_at !== null) continue;
      const current = result.get(log.medication_id);
      if (!current || current.taken_at < log.taken_at) {
        result.set(log.medication_id, log);
      }
    }
    return result;
  }, [db.medication_logs]);
  const todaySchedules = useMemo(
    () =>
      db.medication_schedules
        .filter((schedule) => {
          const medication = medById.get(schedule.medication_id);
          return schedule.active && medication?.active;
        })
        .sort((a, b) => a.time.localeCompare(b.time)),
    [db.medication_schedules, medById]
  );
  const todayStatus = db.daily_status.find((status) => status.date === today);
  const recordedScheduleIds = useMemo(
    () =>
      new Set(
        [
          ...todayLogs.map((log) => log.schedule_id),
          ...todayScheduleOutcomes.map((outcome) => outcome.schedule_id),
        ]
          .filter((scheduleId): scheduleId is string => scheduleId !== null)
      ),
    [todayLogs, todayScheduleOutcomes]
  );
  const recordedScheduleCount = todaySchedules.filter((schedule) =>
    recordedScheduleIds.has(schedule.id)
  ).length;

  async function retry() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  if (!initialized) {
    return (
      <main className="flex flex-1 flex-col gap-5" aria-busy="true">
        <section aria-labelledby="quick-log-title" className="flex flex-col gap-4">
          <h1 id="quick-log-title" className="sr-only">
            빠른 투약 기록
          </h1>
          <p className="sr-only" role="status">
            오늘 기록을 불러오는 중입니다.
          </p>
          <div aria-hidden="true" className="h-40 rounded-2xl bg-surface-soft" />
          <div
            aria-hidden="true"
            className="h-[4.5rem] rounded-full bg-surface-soft"
          />
        </section>
      </main>
    );
  }

  if (error && !selectedCareSpace) {
    return (
      <main className="flex flex-1 flex-col gap-5">
        <h1 className="sr-only">투약 관리</h1>
        <ErrorBanner
          message={error}
          onRetry={retry}
          onDismiss={clearError}
          retrying={refreshing}
        />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-7">
      <h1 id="quick-log-title" className="sr-only">
        빠른 투약 기록
      </h1>

      <section
        aria-labelledby="schedule-title"
        className="rounded-2xl border border-hairline px-5 py-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="schedule-title" className="text-xl font-bold text-ink">
            오늘 예정
          </h2>
          {todaySchedules.length > 0 && (
            <p className="text-base font-semibold text-body">
              {recordedScheduleCount}/{todaySchedules.length}개 일정 기록
            </p>
          )}
        </div>

        {todaySchedules.length === 0 ? (
          <p className="mt-3 text-base leading-relaxed text-muted">
            등록된 복용 일정이 없습니다.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {todaySchedules.map((schedule) => {
              const medication = medById.get(schedule.medication_id);
              if (!medication) return null;
              const log = todayLogs.find(
                (candidate) => candidate.schedule_id === schedule.id
              );
              const outcome = todayScheduleOutcomes.find(
                (candidate) => candidate.schedule_id === schedule.id
              );
              return (
                <li key={schedule.id}>
                  {log ? (
                    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-soft px-4 py-3">
                      <div>
                        <p className="text-lg font-bold text-ink">
                          {schedule.time} · {medication.name}
                        </p>
                        <p className="text-base text-body">
                          실제 기록 {formatDateTime(log.taken_at)}
                        </p>
                      </div>
                      <span className="font-bold text-success">기록 있음</span>
                    </div>
                  ) : outcome ? (
                    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-soft px-4 py-3">
                      <div>
                        <p className="text-lg font-bold text-ink">
                          {schedule.time} · {medication.name}
                        </p>
                        <p className="text-base text-body">
                          일정 결과{" "}
                          {outcome.outcome === "not_taken"
                            ? "복용하지 않음"
                            : "약 없음"}
                        </p>
                      </div>
                      <span className="font-bold text-body">기록 완료</span>
                    </div>
                  ) : canWriteRecords ? (
                    <Link
                      href={`/log?med=${encodeURIComponent(medication.id)}&schedule=${encodeURIComponent(schedule.id)}&date=${today}`}
                      className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-canvas px-4 py-3 active:bg-surface-soft"
                    >
                      <div>
                        <p className="text-lg font-bold text-ink">
                          {schedule.time} · {medication.name}
                        </p>
                      </div>
                      <span className="font-bold text-primary-active">
                        기록하기
                      </span>
                    </Link>
                  ) : (
                    <div className="flex min-h-14 items-center rounded-xl border border-hairline bg-canvas px-4 py-3">
                      <p className="text-lg font-bold text-ink">
                        {schedule.time} · {medication.name}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="quick-log-title" className="flex flex-col gap-5">
        {loading && (
          <p
            role="status"
            className="sr-only"
          >
            최신 기록을 확인하고 있습니다.
          </p>
        )}

        <ErrorBanner
          message={error}
          onRetry={retry}
          onDismiss={clearError}
          retrying={refreshing}
        />

        {medications.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-hairline px-5 py-5 text-center">
            <p className="text-lg font-semibold text-body">활성화된 약이 없습니다.</p>
            {canManageMedicationSettings && (
              <Link
                href="/settings"
                className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-primary-active px-5 text-base font-bold text-on-primary"
              >
                약 등록하기
              </Link>
            )}
          </div>
        ) : (
          medications.map((medication) => {
            const logs = todayLogs.filter(
              (log) => log.medication_id === medication.id
            );
            const latest = latestLogByMedication.get(medication.id);
            const latestDate = latest
              ? toDateKey(new Date(latest.taken_at))
              : null;
            const total = logs.reduce((sum, log) => sum + log.quantity, 0);
            const schedules = todaySchedules.filter(
              (schedule) => schedule.medication_id === medication.id
            );
            const nextSchedule = schedules.find(
              (schedule) => !recordedScheduleIds.has(schedule.id)
            );
            const href = nextSchedule
              ? `/log?med=${encodeURIComponent(medication.id)}&schedule=${encodeURIComponent(nextSchedule.id)}&date=${today}`
              : `/log?med=${encodeURIComponent(medication.id)}&extra=1`;
            const booleanOnly = isBooleanOnly(medication);

            return (
              <article
                key={medication.id}
                className="rounded-2xl border border-hairline px-5 py-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-ink">{medication.name}</h2>
                    <p className="mt-1 text-base text-body">
                      {latest
                        ? `마지막 복용 ${latestDate === today ? "오늘" : formatKoreanDate(latestDate!)} ${formatDateTime(latest.taken_at)} · ${latest.quantity}${latest.medication_unit || "회"}`
                        : "마지막 복용 기록 없음"}
                    </p>
                  </div>
                  <span className="rounded-full bg-surface-soft px-3 py-1 text-base font-bold text-body">
                    {booleanOnly
                      ? `오늘 ${logs.length}회`
                      : `오늘 합계 ${total}${medication.unit}`}
                  </span>
                </div>
                {canWriteRecords ? (
                  <Link
                    href={href}
                    className="mt-4 flex min-h-[4.5rem] w-full flex-col items-center justify-center rounded-full bg-primary-active px-6 text-center text-xl font-bold text-on-primary active:bg-ink"
                  >
                    {nextSchedule
                      ? `${nextSchedule.time} 예정 기록`
                      : schedules.length > 0
                        ? "추가 복용 기록"
                        : "복용 기록"}
                  </Link>
                ) : (
                  <p className="mt-4 flex min-h-14 w-full items-center justify-center rounded-full bg-surface-soft px-5 text-center text-base font-bold text-body">
                    조회 전용 · 기록 추가 불가
                  </p>
                )}
              </article>
            );
          })
        )}
      </section>

      <nav className="grid gap-4" aria-label="기록 메뉴">
        <Link
          href={`/status?date=${today}`}
          className="flex min-h-[4.5rem] w-full items-center justify-between rounded-full border-2 border-ink bg-canvas px-6 text-xl font-bold text-ink active:bg-surface-soft"
        >
          <span>오늘 상태</span>
          <span className="text-base font-semibold text-body">
            {todayStatus ? "기록됨" : "기록 없음"}
          </span>
        </Link>
        <Link
          href="/records"
          className="flex min-h-[4.5rem] w-full items-center justify-center rounded-full border-2 border-ink bg-canvas px-6 text-xl font-bold text-ink active:bg-surface-soft"
        >
          복용기록 확인
        </Link>
      </nav>

      <Link
        href="/settings"
        className="flex min-h-14 w-full items-center justify-center rounded-full border border-ink bg-canvas px-5 text-lg font-bold text-ink active:bg-surface-soft"
      >
        {canManageMedicationSettings ? "약·일정 관리" : "약·일정 보기"}
      </Link>
    </main>
  );
}

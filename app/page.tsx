"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorBanner, LoadingState } from "@/app/components/ui";
import { formatDateTime, toDateKey } from "@/lib/date";
import { useDb } from "@/lib/store";
import { isBooleanOnly } from "@/lib/types";

export default function Home() {
  const { db, loading, error, refresh, clearError } = useDb();
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
        todayLogs
          .map((log) => log.schedule_id)
          .filter((scheduleId): scheduleId is string => scheduleId !== null)
      ),
    [todayLogs]
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

  if (loading && medications.length === 0) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <section aria-labelledby="quick-log-title" className="flex flex-col gap-5">
          <h1 id="quick-log-title" className="sr-only">
            빠른 투약 기록
          </h1>
          <LoadingState label="오늘 기록을 불러오는 중입니다." />
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-7">
      <section aria-labelledby="quick-log-title" className="flex flex-col gap-5">
        <h1 id="quick-log-title" className="sr-only">
          빠른 투약 기록
        </h1>

        {loading && (
          <p
            role="status"
            className="rounded-xl bg-surface-soft px-4 py-3 text-center text-base font-semibold text-body"
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
          <div className="rounded-2xl border border-hairline px-5 py-5">
            <p className="text-lg font-semibold text-body">활성화된 약이 없습니다.</p>
            <Link
              href="/settings"
              className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-primary-active px-5 text-base font-bold text-on-primary"
            >
              약 등록하기
            </Link>
          </div>
        ) : (
          medications.map((medication) => {
            const logs = todayLogs.filter(
              (log) => log.medication_id === medication.id
            );
            const latest = logs.at(-1);
            const total = logs.reduce((sum, log) => sum + log.quantity, 0);
            const schedules = todaySchedules.filter(
              (schedule) => schedule.medication_id === medication.id
            );
            const nextSchedule = schedules.find(
              (schedule) => !recordedScheduleIds.has(schedule.id)
            );
            const href = nextSchedule
              ? `/log?med=${encodeURIComponent(medication.id)}&schedule=${encodeURIComponent(nextSchedule.id)}`
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
                        ? `마지막 기록 ${formatDateTime(latest.taken_at)}`
                        : "오늘 기록 없음"}
                    </p>
                  </div>
                  <span className="rounded-full bg-surface-soft px-3 py-1 text-base font-bold text-body">
                    {booleanOnly
                      ? `오늘 ${logs.length}회`
                      : `오늘 합계 ${total}${medication.unit}`}
                  </span>
                </div>
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
          기록 확인
        </Link>
      </nav>

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
            등록된 복용 일정이 없습니다. 일정은 약·일정 관리에서 추가할 수
            있습니다.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {todaySchedules.map((schedule) => {
              const medication = medById.get(schedule.medication_id);
              if (!medication) return null;
              const log = todayLogs.find(
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
                      <span className="font-bold text-success">기록됨</span>
                    </div>
                  ) : (
                    <Link
                      href={`/log?med=${encodeURIComponent(medication.id)}&schedule=${encodeURIComponent(schedule.id)}`}
                      className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-canvas px-4 py-3 active:bg-surface-soft"
                    >
                      <div>
                        <p className="text-lg font-bold text-ink">
                          {schedule.time} · {medication.name}
                        </p>
                        {!isBooleanOnly(medication) && (
                          <p className="text-base text-body">
                            예정 수량 {schedule.default_quantity}
                            {medication.unit}
                          </p>
                        )}
                      </div>
                      <span className="font-bold text-muted">기록하기</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav aria-label="설정 메뉴">
        <Link
          href="/settings"
          className="flex min-h-14 w-full items-center justify-center rounded-full border border-hairline bg-canvas px-6 text-lg font-bold text-ink active:bg-surface-soft"
        >
          약·일정 관리
        </Link>
      </nav>

      <p className="pb-2 text-center text-sm leading-relaxed text-muted">
        이 앱은 복용 사실을 기록하며 복용량이나 처방을 판단하지 않습니다.
      </p>
    </main>
  );
}

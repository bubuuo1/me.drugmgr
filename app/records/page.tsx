"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DateTimePicker } from "@/app/components/date-time-picker";
import { DateNavigator } from "@/app/components/date-navigator";
import {
  ConfirmDialog,
  ErrorBanner,
  FieldError,
  LoadingState,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import { useOnlineStatus } from "@/app/components/use-online-status";
import {
  formatDateTime,
  formatKstDateTimeInput,
  isToday,
  parseKstDateTimeInput,
  toDateKey,
} from "@/lib/date";
import { useDb } from "@/lib/store";
import type { MedicationLog } from "@/lib/types";

const PRESERVED_SCHEDULE_SELECTION = "__preserved_schedule__";

type EditDraft = {
  quantity: string;
  takenAt: string;
  note: string;
  scheduleId: string;
  originalScheduleId: string;
};

type UndoState = { id: string; label: string };

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "기록을 처리하지 못했습니다.";
}

function statusLabel(
  key: "fatigue" | "strength" | "breathing" | "eye",
  value: string
) {
  const labels = {
    fatigue: {
      좋음: "거의 없음",
      보통: "조금 피곤함",
      나쁨: "매우 피곤함",
    },
    strength: {
      좋음: "평소와 비슷함",
      보통: "조금 약함",
      나쁨: "많이 약함",
    },
    breathing: { 편안함: "평소와 같음", "평소와 다름": "평소와 다름" },
    eye: { 없음: "증상 없음", 있음: "증상 있음" },
  } as const;
  return (labels[key] as Record<string, string>)[value] ?? value;
}

export default function RecordsPage() {
  const online = useOnlineStatus();
  const {
    db,
    selectedCareSpace,
    loading,
    error,
    refresh,
    clearError,
    updateLog,
    deleteLog,
    restoreLog,
    canWriteRecords,
  } = useDb();
  const [dateKey, setDateKey] = useState(() => toDateKey(new Date()));
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    quantity: "",
    takenAt: "",
    note: "",
    scheduleId: "",
    originalScheduleId: "",
  });
  const [confirmDelete, setConfirmDelete] = useState<MedicationLog | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dayLogs = useMemo(
    () =>
      db.medication_logs
        .filter(
          (log) =>
            log.deleted_at === null &&
            toDateKey(new Date(log.taken_at)) === dateKey
        )
        .sort((a, b) => a.taken_at.localeCompare(b.taken_at)),
    [dateKey, db.medication_logs]
  );
  const status = db.daily_status.find((candidate) => candidate.date === dateKey);
  const totals = useMemo(() => {
    const byMedication = new Map<
      string,
      { id: string; name: string; unit: string; total: number; count: number }
    >();
    for (const log of dayLogs) {
      const current = byMedication.get(log.medication_id) ?? {
        id: log.medication_id,
        name: log.medication_name,
        unit: log.medication_unit,
        total: 0,
        count: 0,
      };
      current.total += log.quantity;
      current.count += 1;
      byMedication.set(log.medication_id, current);
    }
    return Array.from(byMedication.values());
  }, [dayLogs]);

  function changeDate(next: string) {
    setDateKey(next);
    setEditId(null);
    setConfirmDelete(null);
    setUndo(null);
    setFieldError(null);
    setSuccess(null);
  }

  function startEdit(log: MedicationLog) {
    const scheduleId =
      log.schedule_id ??
      (log.is_extra ? "" : PRESERVED_SCHEDULE_SELECTION);
    setEditId(log.id);
    setEditDraft({
      quantity: String(log.quantity),
      takenAt: formatKstDateTimeInput(log.taken_at),
      note: log.note ?? "",
      scheduleId,
      originalScheduleId: scheduleId,
    });
    setFieldError(null);
    setSuccess(null);
  }

  async function saveEdit(log: MedicationLog) {
    if (pendingKey || !online) return;
    const booleanOnly = log.medication_unit === "";
    const quantity = booleanOnly ? log.quantity : Number(editDraft.quantity);
    if (!booleanOnly && (!Number.isFinite(quantity) || quantity <= 0)) {
      setFieldError("0보다 큰 복용 수량을 입력해 주세요.");
      return;
    }
    let takenAtIso: string;
    try {
      takenAtIso = parseKstDateTimeInput(editDraft.takenAt);
    } catch {
      setFieldError("실제 복용 시각을 다시 확인해 주세요.");
      return;
    }

    setPendingKey("edit-" + log.id);
    setFieldError(null);
    setLocalError(null);
    setSuccess(null);
    clearError();
    try {
      const classificationPatch =
        editDraft.scheduleId === editDraft.originalScheduleId ||
        editDraft.scheduleId === PRESERVED_SCHEDULE_SELECTION
          ? {}
          : {
              schedule_id: editDraft.scheduleId || null,
              is_extra: editDraft.scheduleId === "",
            };
      await updateLog(log.id, {
        quantity,
        taken_at: takenAtIso,
        note: editDraft.note.trim() || null,
        ...classificationPatch,
      });
      setEditId(null);
      setSuccess(
        log.medication_name +
          " " +
          formatDateTime(takenAtIso) +
          " 기록을 수정했습니다."
      );
    } catch (caught) {
      setLocalError(messageOf(caught));
    } finally {
      setPendingKey(null);
    }
  }

  async function removeLog(log: MedicationLog) {
    if (pendingKey || !online) return;
    setPendingKey("delete-" + log.id);
    setLocalError(null);
    setSuccess(null);
    clearError();
    try {
      await deleteLog(log.id);
      setUndo({
        id: log.id,
        label: log.medication_name + " · " + formatDateTime(log.taken_at),
      });
      setConfirmDelete(null);
      if (editId === log.id) setEditId(null);
    } catch (caught) {
      setLocalError(messageOf(caught));
      setConfirmDelete(null);
    } finally {
      setPendingKey(null);
    }
  }

  async function undoDelete() {
    if (!undo || pendingKey || !online) return;
    setPendingKey("restore-" + undo.id);
    setLocalError(null);
    clearError();
    try {
      await restoreLog(undo.id);
      setSuccess(undo.label + " 기록을 복원했습니다.");
      setUndo(null);
    } catch (caught) {
      setLocalError(messageOf(caught));
    } finally {
      setPendingKey(null);
    }
  }

  if (loading && !selectedCareSpace) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader title="복용기록 확인" />
        <LoadingState label="투약 기록을 불러오는 중입니다." />
      </main>
    );
  }

  if (error && !selectedCareSpace) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader title="복용기록 확인" />
        <ErrorBanner message={error} onRetry={refresh} />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <PageHeader title="복용기록 확인" />

      <DateNavigator
        value={dateKey}
        onChange={changeDate}
        inputId="record-date"
      />

      {loading && db.medication_logs.length === 0 ? (
        <LoadingState label="투약 기록을 불러오는 중입니다." />
      ) : (
        <>
          {loading && (
            <p
              role="status"
              className="rounded-xl bg-surface-soft px-4 py-3 text-center text-base font-semibold text-body"
            >
              최신 기록을 확인하고 있습니다.
            </p>
          )}

          <ErrorBanner
            message={localError ?? error}
            onRetry={refresh}
            onDismiss={() => {
              setLocalError(null);
              clearError();
            }}
          />

          {!canWriteRecords && (
            <Notice>
              이 가족 공간에서는 기록을 조회만 할 수 있습니다.
            </Notice>
          )}
          {!online && canWriteRecords && (
            <Notice tone="warning">
              인터넷 연결이 없어 기록을 수정·삭제·복원할 수 없습니다.
            </Notice>
          )}
          {success && <Notice tone="success">{success}</Notice>}
          {undo && canWriteRecords && (
            <Notice
              tone="warning"
              action={
                <button
                  type="button"
                  onClick={() => void undoDelete()}
                  disabled={pendingKey !== null || !online}
                  className="flex min-h-12 w-full items-center justify-center rounded-full border border-warning bg-canvas px-5 text-base font-bold text-warning disabled:opacity-60"
                >
                  {pendingKey === "restore-" + undo.id
                    ? "복원 중입니다"
                    : "삭제 실행 취소"}
                </button>
              }
            >
              {undo.label} 기록을 삭제했습니다.
            </Notice>
          )}

          <section aria-labelledby="timeline-title" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="timeline-title" className="text-xl font-bold text-ink">
                투약 타임라인
              </h2>
              <span className="text-base font-semibold text-body">
                {dayLogs.length}건
              </span>
            </div>

            {dayLogs.length === 0 ? (
              <div className="rounded-2xl border border-hairline px-5 py-6 text-center">
                <p className="text-lg font-bold text-ink">
                  이 날짜의 투약 기록이 없습니다.
                </p>
                {isToday(dateKey) && (
                  <Link
                    href="/"
                    className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-primary-active px-5 text-base font-bold text-on-primary"
                  >
                    오늘 복용 기록하기
                  </Link>
                )}
              </div>
            ) : (
              <ol className="flex flex-col gap-4">
                {dayLogs.map((log) => {
                  const editing = editId === log.id;
                  const booleanOnly = log.medication_unit === "";
                  const schedules = db.medication_schedules
                    .filter(
                      (schedule) => schedule.medication_id === log.medication_id
                    )
                    .sort((a, b) => a.time.localeCompare(b.time));
                  const missingCurrentSchedule =
                    log.schedule_id !== null &&
                    !schedules.some((schedule) => schedule.id === log.schedule_id);
                  const preservingDeletedSchedule =
                    log.schedule_id === null && !log.is_extra;

                  return (
                    <li
                      key={log.id}
                      className="rounded-2xl border border-hairline px-5 py-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-2xl font-bold text-ink">
                            {formatDateTime(log.taken_at)}
                          </p>
                          <h3 className="mt-1 text-xl font-bold text-ink">
                            {log.medication_name}
                          </h3>
                          <p className="mt-1 text-lg text-body">
                            {booleanOnly
                              ? "복용"
                              : log.quantity + log.medication_unit}
                          </p>
                        </div>
                        <span className="rounded-full bg-surface-soft px-3 py-1 text-sm font-bold text-body">
                          {log.is_extra
                            ? "추가 기록"
                            : log.schedule_time
                              ? "예정 " + log.schedule_time
                              : "일정 기록"}
                        </span>
                      </div>

                      {log.note && (
                        <p className="mt-4 rounded-xl bg-surface-soft px-4 py-3 text-base leading-relaxed text-body">
                          <span className="font-bold text-ink">메모: </span>
                          {log.note}
                        </p>
                      )}

                      {canWriteRecords && (
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              editing ? setEditId(null) : startEdit(log)
                            }
                            disabled={pendingKey !== null || !online}
                            className="flex min-h-12 items-center justify-center rounded-full border border-hairline bg-canvas px-4 text-base font-bold text-ink"
                          >
                            {editing ? "수정 취소" : "수정"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(log)}
                            disabled={pendingKey !== null || !online}
                            className="flex min-h-12 items-center justify-center rounded-full border border-warning bg-canvas px-4 text-base font-bold text-warning"
                          >
                            삭제
                          </button>
                        </div>
                      )}

                      {editing && (
                        <form
                          className="mt-5 flex flex-col gap-4 border-t border-hairline-soft pt-5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveEdit(log);
                          }}
                        >
                          <h4 className="text-lg font-bold text-ink">
                            {log.medication_name} 기록 수정
                          </h4>
                          {!booleanOnly && (
                            <label className="flex flex-col gap-2 text-base font-bold text-body">
                              복용 수량 ({log.medication_unit})
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                step="any"
                                value={editDraft.quantity}
                                onChange={(event) =>
                                  setEditDraft({
                                    ...editDraft,
                                    quantity: event.target.value,
                                  })
                                }
                                disabled={pendingKey !== null}
                                className="min-h-14 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink disabled:bg-surface-soft"
                              />
                            </label>
                          )}
                          <DateTimePicker
                            id={`edit-taken-at-${log.id}`}
                            value={editDraft.takenAt}
                            label="실제 복용 시각"
                            onChange={(value) =>
                              setEditDraft({
                                ...editDraft,
                                takenAt: value,
                              })
                            }
                            disabled={pendingKey !== null}
                            className="[&_legend]:text-base [&_legend]:text-body"
                          />
                          <label className="flex flex-col gap-2 text-base font-bold text-body">
                            일정 연결
                            <select
                              value={editDraft.scheduleId}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  scheduleId: event.target.value,
                                })
                              }
                              disabled={pendingKey !== null}
                              className="min-h-14 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink disabled:bg-surface-soft"
                            >
                              {preservingDeletedSchedule && (
                                <option value={PRESERVED_SCHEDULE_SELECTION}>
                                  기존 일정 기록 유지
                                  {log.schedule_time
                                    ? ` · 예정 ${log.schedule_time}`
                                    : ""}
                                </option>
                              )}
                              <option value="">추가 복용 기록</option>
                              {missingCurrentSchedule && log.schedule_id && (
                                <option value={log.schedule_id}>
                                  이전 일정 {log.schedule_time ?? ""}
                                </option>
                              )}
                              {schedules.map((schedule) => (
                                <option key={schedule.id} value={schedule.id}>
                                  {schedule.time}
                                  {schedule.active ? "" : " (비활성)"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-2 text-base font-bold text-body">
                            메모 <span className="font-normal text-muted">(선택)</span>
                            <textarea
                              value={editDraft.note}
                              onChange={(event) =>
                                setEditDraft({
                                  ...editDraft,
                                  note: event.target.value,
                                })
                              }
                              disabled={pendingKey !== null}
                              maxLength={2000}
                              rows={3}
                              className="min-h-28 rounded-xl border border-hairline bg-canvas px-4 py-3 text-lg font-normal text-ink focus:border-2 focus:border-ink disabled:bg-surface-soft"
                            />
                          </label>
                          {fieldError && editId === log.id && (
                            <FieldError>{fieldError}</FieldError>
                          )}
                          <button
                            type="submit"
                            disabled={pendingKey !== null || !online}
                            className="flex min-h-14 items-center justify-center rounded-xl bg-primary-active px-5 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
                          >
                            {pendingKey === "edit-" + log.id
                              ? "수정 저장 중"
                              : "수정 내용 저장"}
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {totals.length > 0 && (
            <section className="rounded-2xl border border-hairline px-5 py-5">
              <h2 className="text-xl font-bold text-ink">이 날짜의 총 기록</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {totals.map((total) => (
                  <li
                    key={total.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-lg"
                  >
                    <span className="font-bold text-ink">{total.name}</span>
                    <span className="text-body">
                      {total.unit
                        ? "합계 " + total.total + total.unit
                        : total.count + "회 기록"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-hairline px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-ink">상태 기록</h2>
              <Link
                href={"/status?date=" + dateKey}
                className="flex min-h-12 items-center justify-center rounded-full border border-ink bg-canvas px-4 text-base font-bold text-ink"
              >
                {canWriteRecords
                  ? status
                    ? "상태 수정"
                    : "상태 기록"
                  : "상태 보기"}
              </Link>
            </div>
            {status ? (
              <dl className="mt-4 grid gap-3 text-lg text-body">
                {status.fatigue && (
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="font-bold text-ink">피로</dt>
                    <dd>{statusLabel("fatigue", status.fatigue)}</dd>
                  </div>
                )}
                {status.strength && (
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="font-bold text-ink">근력</dt>
                    <dd>{statusLabel("strength", status.strength)}</dd>
                  </div>
                )}
                {status.breathing && (
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="font-bold text-ink">호흡</dt>
                    <dd>{statusLabel("breathing", status.breathing)}</dd>
                  </div>
                )}
                {status.eye_symptom && (
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="font-bold text-ink">눈 증상</dt>
                    <dd>{statusLabel("eye", status.eye_symptom)}</dd>
                  </div>
                )}
                {status.note && (
                  <div className="border-t border-hairline-soft pt-3">
                    <dt className="font-bold text-ink">메모</dt>
                    <dd className="mt-1 leading-relaxed">{status.note}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-3 text-base leading-relaxed text-muted">
                이 날짜의 상태 기록이 없습니다.
              </p>
            )}
          </section>
        </>
      )}

      {confirmDelete && canWriteRecords && (
        <ConfirmDialog
          title="투약 기록을 삭제할까요?"
          description={
            <div className="space-y-1">
              <p className="font-bold text-ink">
                {confirmDelete.medication_name} ·{" "}
                {formatDateTime(confirmDelete.taken_at)}
              </p>
              <p>
                {confirmDelete.medication_unit
                  ? confirmDelete.quantity + confirmDelete.medication_unit
                  : "복용"}
                기록을 삭제합니다. 삭제 후 실행 취소할 수 있습니다.
              </p>
            </div>
          }
          confirmLabel="기록 삭제"
          destructive
          pending={pendingKey === "delete-" + confirmDelete.id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => removeLog(confirmDelete)}
        />
      )}
    </main>
  );
}

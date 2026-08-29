"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  parseKstDateTimeInput,
  toDateKey,
} from "@/lib/date";
import { useDb } from "@/lib/store";
import { isBooleanOnly, quantityOptionsOf } from "@/lib/types";

const RECENT_DUPLICATE_MINUTES = 15;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "기록을 저장하지 못했습니다.";
}

function MedLogInner() {
  const params = useSearchParams();
  const medId = params.get("med") ?? "";
  const requestedScheduleId = params.get("schedule");
  const requestedExtra = params.get("extra") === "1";
  const online = useOnlineStatus();
  const {
    db,
    loading,
    error,
    refresh,
    clearError,
    addLog,
    canWriteRecords,
  } = useDb();

  const medication = useMemo(
    () => db.medications.find((candidate) => candidate.id === medId),
    [db.medications, medId]
  );
  const schedule = useMemo(
    () =>
      requestedExtra
        ? undefined
        : db.medication_schedules.find(
            (candidate) =>
              candidate.id === requestedScheduleId &&
              candidate.medication_id === medId &&
              candidate.active
          ),
    [db.medication_schedules, medId, requestedExtra, requestedScheduleId]
  );
  const booleanOnly = medication ? isBooleanOnly(medication) : false;
  const quantities = medication ? quantityOptionsOf(medication) : [];
  const defaultQuantity = booleanOnly ? 1 : quantities[0] || 1;

  const [quantity, setQuantity] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState(() =>
    formatKstDateTimeInput(new Date())
  );
  const [clientRequestId, setClientRequestId] = useState(() =>
    crypto.randomUUID()
  );
  const [note, setNote] = useState("");
  const [manualExtra, setManualExtra] = useState(requestedExtra);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);

  const effectiveSchedule = manualExtra ? undefined : schedule;
  const enteredQuantity = quantity ?? String(defaultQuantity);
  const activeLogsForMedication = useMemo(
    () =>
      db.medication_logs
        .filter(
          (log) => log.deleted_at === null && log.medication_id === medId
        )
        .sort((a, b) => b.taken_at.localeCompare(a.taken_at)),
    [db.medication_logs, medId]
  );
  const latestLog = activeLogsForMedication[0];
  const scheduleLog = effectiveSchedule
    ? activeLogsForMedication.find(
        (log) =>
          log.schedule_id === effectiveSchedule.id &&
          toDateKey(new Date(log.taken_at)) === takenAt.slice(0, 10)
      )
    : undefined;

  if (loading && !medication) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader title="투약 기록" />
        <LoadingState label="약 정보를 불러오는 중입니다." />
      </main>
    );
  }

  if (!medication) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader title="투약 기록" />
        <ErrorBanner
          message={error ?? "약 정보를 찾을 수 없습니다."}
          onRetry={refresh}
          onDismiss={clearError}
        />
      </main>
    );
  }

  if (!canWriteRecords) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader title={medication.name} />
        <Notice
          tone="warning"
          action={
            <Link
              href="/records"
              className="flex min-h-12 w-full items-center justify-center rounded-full border border-hairline bg-canvas px-5 text-base font-bold text-ink"
            >
              기록 확인하기
            </Link>
          }
        >
          이 가족 공간에서는 기록을 조회만 할 수 있습니다.
        </Notice>
      </main>
    );
  }

  const currentMedication = medication;
  const unit = currentMedication.unit || "회";

  function validate() {
    const parsedQuantity = booleanOnly ? 1 : Number(enteredQuantity);
    if (!booleanOnly && (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)) {
      setFieldError("0보다 큰 복용 수량을 입력해 주세요.");
      return null;
    }
    if (!takenAt) {
      setFieldError("실제 복용 시각을 입력해 주세요.");
      return null;
    }
    let parsedTakenAt: Date;
    try {
      parsedTakenAt = new Date(parseKstDateTimeInput(takenAt));
    } catch {
      setFieldError("실제 복용 시각을 다시 확인해 주세요.");
      return null;
    }
    setFieldError(null);
    return { parsedQuantity, parsedTakenAt };
  }

  function needsDuplicateConfirmation(parsedTakenAt: Date) {
    if (scheduleLog) return true;
    if (!latestLog) return false;
    const difference =
      Math.abs(parsedTakenAt.getTime() - new Date(latestLog.taken_at).getTime()) /
      60_000;
    return difference <= RECENT_DUPLICATE_MINUTES;
  }

  async function requestSave() {
    if (!online || pending) return;
    const values = validate();
    if (!values) return;
    if (needsDuplicateConfirmation(values.parsedTakenAt)) {
      setConfirmingDuplicate(true);
      return;
    }
    await persist(values.parsedQuantity, values.parsedTakenAt);
  }

  async function persist(
    parsedQuantity?: number,
    parsedTakenAt?: Date,
    forceExtra = false
  ) {
    const values =
      parsedQuantity !== undefined && parsedTakenAt
        ? { parsedQuantity, parsedTakenAt }
        : validate();
    if (!values || !online || pending) return;

    const targetSchedule = forceExtra ? undefined : effectiveSchedule;
    setPending(true);
    setLocalError(null);
    clearError();
    try {
      const saved = await addLog({
        medication_id: currentMedication.id,
        quantity: values.parsedQuantity,
        schedule_id: targetSchedule?.id ?? null,
        is_extra: !targetSchedule,
        note: note.trim() || null,
        taken_at: values.parsedTakenAt.toISOString(),
        client_request_id: clientRequestId,
      });
      const amount = booleanOnly
        ? "복용"
        : `${saved.quantity}${saved.medication_unit}`;
      setSavedMessage(
        `${saved.medication_name} ${amount} · ${formatDateTime(saved.taken_at)} 기록 완료`
      );
      setConfirmingDuplicate(false);
    } catch (caught) {
      setLocalError(errorMessage(caught));
      setConfirmingDuplicate(false);
    } finally {
      setPending(false);
    }
  }

  function recordAnother() {
    setSavedMessage(null);
    setManualExtra(true);
    setQuantity(null);
    setTakenAt(formatKstDateTimeInput(new Date()));
    setClientRequestId(crypto.randomUUID());
    setNote("");
    setFieldError(null);
  }

  const duplicateReference = scheduleLog ?? latestLog;

  return (
    <main className="flex flex-1 flex-col gap-6">
      <PageHeader title={medication.name} />

      <ErrorBanner
        message={localError ?? error}
        onDismiss={() => {
          setLocalError(null);
          clearError();
        }}
      />

      {!online && (
        <Notice tone="warning">
          인터넷 연결이 없어 지금은 저장할 수 없습니다. 연결 후 다시 시도해 주세요.
        </Notice>
      )}

      {savedMessage ? (
        <section className="flex flex-col gap-4" aria-label="저장 완료">
          <Notice
            tone="success"
            action={
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={recordAnother}
                  className="flex min-h-12 w-full items-center justify-center rounded-full border border-hairline bg-canvas px-5 text-base font-bold text-ink"
                >
                  같은 약 추가 기록
                </button>
                <Link
                  href="/"
                  className="flex min-h-14 w-full items-center justify-center rounded-full bg-primary-active px-6 text-lg font-bold text-on-primary"
                >
                  첫 화면으로
                </Link>
              </div>
            }
          >
            {savedMessage}
          </Notice>
        </section>
      ) : (
        <form
          className="flex flex-col gap-7"
          onSubmit={(event) => {
            event.preventDefault();
            void requestSave();
          }}
        >
          <section className="rounded-2xl bg-surface-soft px-5 py-4">
            <h2 className="text-lg font-bold text-ink">
              {effectiveSchedule
                ? `${effectiveSchedule.time} 예정 기록`
                : "추가 복용 기록"}
            </h2>
            <p className="mt-1 text-base leading-relaxed text-body">
              {effectiveSchedule
                ? "이 일정에 실제 복용 내용을 연결합니다."
                : "예정 일정과 별개의 기록으로 저장합니다."}
            </p>
          </section>

          {!booleanOnly && (
            <fieldset className="flex flex-col gap-4" disabled={pending}>
              <legend className="text-xl font-bold text-ink">
                몇 {unit} 드셨나요?
              </legend>
              <div className="grid grid-cols-2 gap-4">
                {quantities.map((option) => {
                  const selected = Number(enteredQuantity) === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setQuantity(String(option));
                        setFieldError(null);
                      }}
                      className={
                        selected
                          ? "flex min-h-16 items-center justify-center rounded-full bg-primary-active px-5 text-xl font-bold text-on-primary"
                          : "flex min-h-16 items-center justify-center rounded-full border-2 border-hairline bg-canvas px-5 text-xl font-bold text-ink active:bg-surface-soft"
                      }
                    >
                      {option}
                      {unit}
                    </button>
                  );
                })}
              </div>
              <label htmlFor="custom-quantity" className="text-base font-bold text-body">
                직접 입력
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="custom-quantity"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="any"
                  value={enteredQuantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setFieldError(null);
                  }}
                  aria-describedby={fieldError ? "log-field-error" : undefined}
                  aria-invalid={fieldError ? true : undefined}
                  className="h-14 min-w-0 flex-1 rounded-xl border border-hairline bg-canvas px-4 text-lg text-ink focus:border-2 focus:border-ink"
                />
                <span className="shrink-0 text-lg font-bold text-body">{unit}</span>
              </div>
            </fieldset>
          )}

          {booleanOnly && (
            <section>
              <h2 className="text-xl font-bold text-ink">복용 사실</h2>
              <p className="mt-2 rounded-2xl border border-success px-5 py-4 text-lg font-bold text-success">
                복용함으로 기록합니다.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <label htmlFor="taken-at" className="text-xl font-bold text-ink">
              실제 복용 시각
            </label>
            <input
              id="taken-at"
              type="datetime-local"
              value={takenAt}
              onChange={(event) => {
                setTakenAt(event.target.value);
                setFieldError(null);
              }}
              disabled={pending}
              aria-describedby={fieldError ? "log-field-error" : "taken-at-help"}
              aria-invalid={fieldError ? true : undefined}
              className="min-h-14 w-full rounded-xl border border-hairline bg-canvas px-4 text-lg text-ink focus:border-2 focus:border-ink disabled:bg-surface-soft"
            />
            <p id="taken-at-help" className="text-base leading-relaxed text-muted">
              현재 시각이 기본으로 입력되어 있습니다. 실제 복용 시각이 다르면 수정해 주세요.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <label htmlFor="log-note" className="text-xl font-bold text-ink">
              메모 <span className="text-base font-normal text-muted">(선택)</span>
            </label>
            <textarea
              id="log-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending}
              maxLength={500}
              rows={3}
              className="min-h-28 w-full rounded-xl border border-hairline bg-canvas px-4 py-3 text-lg text-ink focus:border-2 focus:border-ink disabled:bg-surface-soft"
              placeholder="복용 당시 상황을 남길 수 있습니다."
            />
          </section>

          {fieldError && (
            <FieldError id="log-field-error">{fieldError}</FieldError>
          )}

          <button
            type="submit"
            disabled={pending || !online}
            className="flex min-h-16 w-full items-center justify-center rounded-xl bg-primary-active px-6 text-xl font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
          >
            {pending ? "저장 중입니다" : online ? "기록 저장" : "연결 후 저장 가능"}
          </button>
        </form>
      )}

      {confirmingDuplicate && duplicateReference && (
        <ConfirmDialog
          title={scheduleLog ? "이미 기록된 일정입니다" : "최근 기록이 있습니다"}
          description={
            <p>
              {duplicateReference.medication_name}을{" "}
              <strong className="text-ink">
                {formatDateTime(duplicateReference.taken_at)}
              </strong>
              에 기록했습니다. 별도의 새 기록을 추가할까요?
            </p>
          }
          confirmLabel="새 기록 추가"
          pending={pending}
          onCancel={() => setConfirmingDuplicate(false)}
          onConfirm={async () => {
            if (scheduleLog) setManualExtra(true);
            await persist(undefined, undefined, Boolean(scheduleLog));
          }}
        />
      )}
    </main>
  );
}

export default function MedLogPage() {
  return (
    <Suspense fallback={<LoadingState label="투약 기록 화면을 준비하고 있습니다." />}>
      <MedLogInner />
    </Suspense>
  );
}

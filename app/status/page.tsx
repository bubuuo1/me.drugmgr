"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  formatKoreanFullDate,
  fromDateKey,
  toDateKey,
} from "@/lib/date";
import { useDb } from "@/lib/store";
import type { DailyStatus } from "@/lib/types";

const statusGroups = {
  fatigue: {
    label: "피로",
    options: [
      { label: "거의 없음", value: "좋음" },
      { label: "조금 피곤함", value: "보통" },
      { label: "매우 피곤함", value: "나쁨" },
    ],
  },
  strength: {
    label: "근력",
    options: [
      { label: "평소와 비슷함", value: "좋음" },
      { label: "조금 약함", value: "보통" },
      { label: "많이 약함", value: "나쁨" },
    ],
  },
  breathing: {
    label: "호흡",
    options: [
      { label: "평소와 같음", value: "편안함" },
      { label: "평소와 다름", value: "평소와 다름" },
    ],
  },
  eye: {
    label: "눈 증상",
    options: [
      { label: "증상 없음", value: "없음" },
      { label: "증상 있음", value: "있음" },
    ],
  },
} as const;

type StatusKey = keyof typeof statusGroups;
type Values = Record<StatusKey, string | null>;

function readOnlyLabel(key: StatusKey, value: string | null): string | null {
  if (value === null) return null;
  return (
    statusGroups[key].options.find((option) => option.value === value)?.label ??
    value
  );
}

function ReadOnlyStatus({ existing }: { existing?: DailyStatus }) {
  if (!existing) {
    return (
      <Notice tone="warning">
        이 날짜의 상태 기록이 없습니다. 조회 전용 구성원은 새 기록을 만들 수
        없습니다.
      </Notice>
    );
  }

  const rows = [
    ["피로", readOnlyLabel("fatigue", existing.fatigue)],
    ["근력", readOnlyLabel("strength", existing.strength)],
    ["호흡", readOnlyLabel("breathing", existing.breathing)],
    ["눈 증상", readOnlyLabel("eye", existing.eye_symptom)],
  ].filter((row): row is [string, string] => row[1] !== null);

  return (
    <section className="rounded-2xl border border-hairline bg-canvas px-5 py-5">
      <h2 className="text-xl font-bold text-ink">기록된 상태</h2>
      <p className="mt-2 text-base text-muted">조회 전용으로 보고 있습니다.</p>
      <dl className="mt-4 grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-ink">{label}</dt>
            <dd className="text-body">{value}</dd>
          </div>
        ))}
        {existing.note && (
          <div className="border-t border-hairline-soft pt-3">
            <dt className="font-bold text-ink">메모</dt>
            <dd className="mt-1 leading-relaxed text-body">{existing.note}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function validDateKey(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return toDateKey(new Date());
  }
  try {
    fromDateKey(value);
    return value;
  } catch {
    return toDateKey(new Date());
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "상태 기록을 처리하지 못했습니다.";
}

type StatusEditorProps = {
  dateKey: string;
  existing?: DailyStatus;
  onInteraction: () => void;
};

function StatusEditor({
  dateKey,
  existing,
  onInteraction,
}: StatusEditorProps) {
  const online = useOnlineStatus();
  const {
    error,
    clearError,
    upsertStatus,
    deleteStatus,
  } = useDb();
  const [values, setValues] = useState<Values>({
    fatigue: existing?.fatigue ?? null,
    strength: existing?.strength ?? null,
    breathing: existing?.breathing ?? null,
    eye: existing?.eye_symptom ?? null,
  });
  const [note, setNote] = useState(existing?.note ?? "");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function pick(key: StatusKey, option: string) {
    onInteraction();
    setValues((current) => ({
      ...current,
      [key]: current[key] === option ? null : option,
    }));
    setFieldError(null);
    setSuccess(null);
  }

  async function save() {
    if (pending || !online) return;
    const hasContent = Object.values(values).some(Boolean) || note.trim().length > 0;
    if (!hasContent) {
      setFieldError(
        existing
          ? "모든 내용을 지우려면 아래의 상태 기록 삭제를 이용해 주세요."
          : "상태를 하나 이상 선택하거나 메모를 입력해 주세요."
      );
      return;
    }

    setPending(true);
    setLocalError(null);
    setFieldError(null);
    setSuccess(null);
    clearError();
    try {
      await upsertStatus({
        date: dateKey,
        fatigue: values.fatigue,
        strength: values.strength,
        breathing: values.breathing,
        eye_symptom: values.eye,
        note: note.trim() || null,
      });
      setSuccess(`${formatKoreanFullDate(dateKey)} 상태를 저장했습니다.`);
    } catch (caught) {
      setLocalError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!existing || pending || !online) return;
    setPending(true);
    setLocalError(null);
    setSuccess(null);
    clearError();
    try {
      await deleteStatus(dateKey);
      setValues({
        fatigue: null,
        strength: null,
        breathing: null,
        eye: null,
      });
      setNote("");
      setSuccess(`${formatKoreanFullDate(dateKey)} 상태 기록을 삭제했습니다.`);
      setConfirmDelete(false);
    } catch (caught) {
      setLocalError(messageOf(caught));
      setConfirmDelete(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ErrorBanner
        message={localError ?? error}
        onDismiss={() => {
          setLocalError(null);
          clearError();
        }}
      />

      {!online && (
        <Notice tone="warning">
          인터넷 연결이 없어 지금은 저장하거나 삭제할 수 없습니다.
        </Notice>
      )}

      {success && <Notice tone="success">{success}</Notice>}

      <p className="text-base leading-relaxed text-muted">
        필요한 항목만 선택할 수 있습니다. 선택한 항목을 다시 누르면 선택이 해제됩니다.
      </p>

      <form
        className="flex flex-col gap-7"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {Object.entries(statusGroups).map(([rawKey, group]) => {
          const key = rawKey as StatusKey;
          return (
            <fieldset key={key} className="flex flex-col gap-3" disabled={pending}>
              <legend className="text-xl font-bold text-ink">{group.label}</legend>
              <div className="grid gap-3">
                {group.options.map((option) => {
                  const selected = values[key] === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => pick(key, option.value)}
                      className={
                        selected
                          ? "flex min-h-14 w-full items-center justify-between rounded-full bg-primary-active px-6 text-left text-lg font-bold text-on-primary"
                          : "flex min-h-14 w-full items-center justify-between rounded-full border-2 border-hairline bg-canvas px-6 text-left text-lg font-bold text-ink active:bg-surface-soft"
                      }
                    >
                      <span>{option.label}</span>
                      <span aria-hidden="true">{selected ? "선택됨" : ""}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <section className="flex flex-col gap-3">
          <label htmlFor="status-note" className="text-xl font-bold text-ink">
            기타 메모 <span className="text-base font-normal text-muted">(선택)</span>
          </label>
          <textarea
            id="status-note"
            value={note}
            onChange={(event) => {
              onInteraction();
              setNote(event.target.value);
              setFieldError(null);
              setSuccess(null);
            }}
            disabled={pending}
            rows={4}
            maxLength={1000}
            className="min-h-32 w-full rounded-xl border border-hairline bg-canvas px-4 py-3 text-lg text-ink focus:border-2 focus:border-ink disabled:bg-surface-soft"
            placeholder="예: 오후부터 평소보다 피곤했음"
          />
        </section>

        {fieldError && <FieldError>{fieldError}</FieldError>}

        <button
          type="submit"
          disabled={pending || !online}
          className="flex min-h-16 w-full items-center justify-center rounded-xl bg-primary-active px-6 text-xl font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
        >
          {pending ? "저장 중입니다" : existing ? "상태 기록 수정" : "상태 기록 저장"}
        </button>
      </form>

      {existing && (
        <section className="border-t border-hairline-soft pt-5">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={pending || !online}
            className="flex min-h-14 w-full items-center justify-center rounded-xl border border-warning bg-canvas px-6 text-lg font-bold text-warning disabled:opacity-60"
          >
            이 날짜의 상태 기록 삭제
          </button>
        </section>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="상태 기록을 삭제할까요?"
          description={
            <p>
              <strong className="text-ink">
                {formatKoreanFullDate(dateKey)}
              </strong>
              의
              상태 선택과 메모가 삭제됩니다.
            </p>
          }
          confirmLabel="상태 기록 삭제"
          destructive
          pending={pending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function StatusPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const dateKey = validDateKey(params.get("date"));
  const { db, loading, error, refresh, clearError, canWriteRecords } = useDb();
  const [editingStarted, setEditingStarted] = useState(false);
  const existing = db.daily_status.find((status) => status.date === dateKey);
  const initialLoading =
    loading &&
    !editingStarted &&
    db.medications.length === 0 &&
    db.medication_schedules.length === 0 &&
    db.medication_logs.length === 0 &&
    db.daily_status.length === 0;

  function navigate(nextDate: string) {
    setEditingStarted(false);
    router.replace(`/status?date=${nextDate}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <PageHeader title="상태 기록" />

      <DateNavigator
        value={dateKey}
        onChange={navigate}
        title="상태 기록 날짜"
        inputId="status-date"
      />

      {initialLoading ? (
        <LoadingState label="상태 기록을 불러오는 중입니다." />
      ) : error && db.daily_status.length === 0 ? (
        <ErrorBanner message={error} onRetry={refresh} onDismiss={clearError} />
      ) : !canWriteRecords ? (
        <ReadOnlyStatus existing={existing} />
      ) : (
        <StatusEditor
          key={dateKey}
          dateKey={dateKey}
          existing={existing}
          onInteraction={() => setEditingStarted(true)}
        />
      )}
    </main>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<LoadingState label="상태 기록 화면을 준비하고 있습니다." />}>
      <StatusPageInner />
    </Suspense>
  );
}

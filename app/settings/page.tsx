"use client";

import { useMemo, useState } from "react";
import {
  ConfirmDialog,
  ErrorBanner,
  FieldError,
  LoadingState,
  Notice,
  PageHeader,
} from "@/app/components/ui";
import { useOnlineStatus } from "@/app/components/use-online-status";
import { useDb } from "@/lib/store";
import type { Medication, MedicationSchedule } from "@/lib/types";
import { isBooleanOnly } from "@/lib/types";

type MedicationDraft = {
  name: string;
  unit: string;
  options: string;
  booleanOnly: boolean;
};

type ScheduleDraft = {
  time: string;
  quantity: string;
};

type Confirmation =
  | { kind: "deactivate"; medication: Medication }
  | { kind: "schedule"; schedule: MedicationSchedule; medication: Medication };

const emptyMedication: MedicationDraft = {
  name: "",
  unit: "",
  options: "",
  booleanOnly: false,
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "설정을 저장하지 못했습니다.";
}

function parseOptions(draft: MedicationDraft) {
  if (draft.booleanOnly) return [];
  const numbers = draft.options
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map(Number);
  if (
    numbers.length === 0 ||
    numbers.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error("복용 수량 선택지를 0보다 큰 숫자로 입력해 주세요.");
  }
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

export default function SettingsPage() {
  const online = useOnlineStatus();
  const {
    db,
    loading,
    error,
    refresh,
    clearError,
    addMedication,
    updateMedication,
    addSchedule,
    updateSchedule,
    deleteSchedule,
  } = useDb();

  const [addingMedication, setAddingMedication] = useState(false);
  const [medicationDraft, setMedicationDraft] =
    useState<MedicationDraft>(emptyMedication);
  const [editingMedicationId, setEditingMedicationId] = useState<string | null>(
    null
  );
  const [editingMedicationDraft, setEditingMedicationDraft] =
    useState<MedicationDraft>(emptyMedication);
  const [addingScheduleFor, setAddingScheduleFor] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>({
    time: "",
    quantity: "",
  });
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingScheduleDraft, setEditingScheduleDraft] =
    useState<ScheduleDraft>({ time: "", quantity: "" });
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const medications = useMemo(
    () =>
      [...db.medications].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name, "ko");
      }),
    [db.medications]
  );

  function beginMutation(key: string) {
    setPendingKey(key);
    setLocalError(null);
    setFieldError(null);
    setSuccess(null);
    clearError();
  }

  function finishMutation() {
    setPendingKey(null);
  }

  async function createMedication() {
    if (pendingKey || !online) return;
    try {
      const name = medicationDraft.name.trim();
      const unit = medicationDraft.unit.trim();
      if (!name) throw new Error("약 이름을 입력해 주세요.");
      if (!medicationDraft.booleanOnly && !unit) {
        throw new Error("복용 수량의 단위를 입력해 주세요.");
      }
      const quantityOptions = parseOptions(medicationDraft);
      beginMutation("medication-add");
      await addMedication({
        name,
        unit: medicationDraft.booleanOnly ? "" : unit,
        quantity_options: quantityOptions,
        active: true,
      });
      setMedicationDraft(emptyMedication);
      setAddingMedication(false);
      setSuccess(`${name} 설정을 추가했습니다.`);
    } catch (caught) {
      setFieldError(messageOf(caught));
    } finally {
      finishMutation();
    }
  }

  function startMedicationEdit(medication: Medication) {
    setEditingMedicationId(medication.id);
    setEditingMedicationDraft({
      name: medication.name,
      unit: medication.unit,
      options: (medication.quantity_options ?? []).join(", "),
      booleanOnly: isBooleanOnly(medication),
    });
    setFieldError(null);
    setSuccess(null);
  }

  async function saveMedicationEdit(medication: Medication) {
    if (pendingKey || !online) return;
    try {
      const name = editingMedicationDraft.name.trim();
      const unit = editingMedicationDraft.unit.trim();
      if (!name) throw new Error("약 이름을 입력해 주세요.");
      if (!editingMedicationDraft.booleanOnly && !unit) {
        throw new Error("복용 수량의 단위를 입력해 주세요.");
      }
      const quantityOptions = parseOptions(editingMedicationDraft);
      beginMutation(`medication-${medication.id}`);
      await updateMedication(medication.id, {
        name,
        unit: editingMedicationDraft.booleanOnly ? "" : unit,
        quantity_options: quantityOptions,
      });
      setEditingMedicationId(null);
      setSuccess(`${name} 설정을 수정했습니다.`);
    } catch (caught) {
      setFieldError(messageOf(caught));
    } finally {
      finishMutation();
    }
  }

  async function toggleMedication(medication: Medication) {
    if (pendingKey || !online) return;
    beginMutation(`medication-active-${medication.id}`);
    try {
      await updateMedication(medication.id, { active: !medication.active });
      setSuccess(
        medication.active
          ? `${medication.name}을 비활성화했습니다.`
          : `${medication.name}을 다시 활성화했습니다.`
      );
      setConfirmation(null);
    } catch (caught) {
      setLocalError(messageOf(caught));
      setConfirmation(null);
    } finally {
      finishMutation();
    }
  }

  function startScheduleAdd(medication: Medication) {
    setAddingScheduleFor(medication.id);
    setScheduleDraft({
      time: "",
      quantity: isBooleanOnly(medication) ? "1" : "",
    });
    setFieldError(null);
    setSuccess(null);
  }

  async function createSchedule(medication: Medication) {
    if (pendingKey || !online) return;
    try {
      const quantity = isBooleanOnly(medication)
        ? 1
        : Number(scheduleDraft.quantity);
      if (!scheduleDraft.time) throw new Error("예정 시각을 입력해 주세요.");
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("예정 수량을 0보다 큰 숫자로 입력해 주세요.");
      }
      beginMutation(`schedule-add-${medication.id}`);
      await addSchedule({
        medication_id: medication.id,
        time: scheduleDraft.time,
        default_quantity: quantity,
        active: true,
      });
      setAddingScheduleFor(null);
      setScheduleDraft({ time: "", quantity: "" });
      setSuccess(`${medication.name} ${scheduleDraft.time} 일정을 추가했습니다.`);
    } catch (caught) {
      setFieldError(messageOf(caught));
    } finally {
      finishMutation();
    }
  }

  function startScheduleEdit(schedule: MedicationSchedule) {
    setEditingScheduleId(schedule.id);
    setEditingScheduleDraft({
      time: schedule.time,
      quantity: String(schedule.default_quantity),
    });
    setFieldError(null);
    setSuccess(null);
  }

  async function saveScheduleEdit(
    medication: Medication,
    schedule: MedicationSchedule
  ) {
    if (pendingKey || !online) return;
    try {
      const quantity = isBooleanOnly(medication)
        ? 1
        : Number(editingScheduleDraft.quantity);
      if (!editingScheduleDraft.time) {
        throw new Error("예정 시각을 입력해 주세요.");
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("예정 수량을 0보다 큰 숫자로 입력해 주세요.");
      }
      beginMutation(`schedule-${schedule.id}`);
      await updateSchedule(schedule.id, {
        time: editingScheduleDraft.time,
        default_quantity: quantity,
      });
      setEditingScheduleId(null);
      setSuccess(`${medication.name} 일정을 수정했습니다.`);
    } catch (caught) {
      setFieldError(messageOf(caught));
    } finally {
      finishMutation();
    }
  }

  async function toggleSchedule(
    medication: Medication,
    schedule: MedicationSchedule
  ) {
    if (pendingKey || !online) return;
    beginMutation(`schedule-active-${schedule.id}`);
    try {
      await updateSchedule(schedule.id, { active: !schedule.active });
      setSuccess(
        `${medication.name} ${schedule.time} 일정을 ${
          schedule.active ? "비활성화" : "활성화"
        }했습니다.`
      );
    } catch (caught) {
      setLocalError(messageOf(caught));
    } finally {
      finishMutation();
    }
  }

  async function removeSchedule(schedule: MedicationSchedule) {
    if (pendingKey || !online) return;
    beginMutation(`schedule-delete-${schedule.id}`);
    try {
      await deleteSchedule(schedule.id);
      setSuccess(`${schedule.time} 일정을 삭제했습니다.`);
      setConfirmation(null);
    } catch (caught) {
      setLocalError(messageOf(caught));
      setConfirmation(null);
    } finally {
      finishMutation();
    }
  }

  if (loading && medications.length === 0) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <PageHeader title="약과 일정 설정" />
        <LoadingState label="약 설정을 불러오는 중입니다." />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-7">
      <PageHeader title="약과 일정 설정" />

      <p className="rounded-2xl bg-surface-soft px-5 py-4 text-base leading-relaxed text-body">
        처방받은 약 이름, 수량 선택지와 예정 시각을 그대로 입력해 주세요. 앱은
        복용량이나 일정을 추천하지 않습니다. 설정을 바꿔도 과거 기록은 유지됩니다.
      </p>

      {loading && (
        <p role="status" className="text-center text-base font-semibold text-body">
          최신 설정을 확인하고 있습니다.
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

      {!online && (
        <Notice tone="warning">
          인터넷 연결이 없어 설정을 추가하거나 변경할 수 없습니다.
        </Notice>
      )}
      {success && <Notice tone="success">{success}</Notice>}
      {fieldError && <FieldError>{fieldError}</FieldError>}

      <section aria-labelledby="medication-list-title" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="medication-list-title" className="text-xl font-bold text-ink">
            등록된 약
          </h2>
          <button
            type="button"
            onClick={() => {
              setAddingMedication((current) => !current);
              setFieldError(null);
              setSuccess(null);
            }}
            disabled={pendingKey !== null || !online}
            className="flex min-h-12 items-center justify-center rounded-full bg-primary-active px-5 text-base font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
          >
            {addingMedication ? "추가 취소" : "새 약 추가"}
          </button>
        </div>

        {addingMedication && (
          <MedicationForm
            title="새 약"
            draft={medicationDraft}
            setDraft={setMedicationDraft}
            pending={pendingKey === "medication-add"}
            available={online}
            onSave={createMedication}
          />
        )}

        {medications.length === 0 ? (
          <p className="rounded-2xl border border-hairline px-5 py-5 text-lg text-muted">
            등록된 약이 없습니다.
          </p>
        ) : (
          medications.map((medication) => {
            const schedules = db.medication_schedules
              .filter((schedule) => schedule.medication_id === medication.id)
              .sort((a, b) => a.time.localeCompare(b.time));
            const editing = editingMedicationId === medication.id;

            return (
              <article
                key={medication.id}
                className={`rounded-2xl border px-5 py-5 ${
                  medication.active
                    ? "border-hairline bg-canvas"
                    : "border-hairline-soft bg-surface-soft"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold text-ink">{medication.name}</h3>
                      <span
                        className={`rounded-full px-3 py-1 text-sm font-bold ${
                          medication.active
                            ? "bg-surface-soft text-success"
                            : "bg-hairline-soft text-muted"
                        }`}
                      >
                        {medication.active ? "사용 중" : "비활성"}
                      </span>
                    </div>
                    <p className="mt-1 text-base text-body">
                      {isBooleanOnly(medication)
                        ? "복용 여부만 기록"
                        : `단위 ${medication.unit} · 선택지 ${(medication.quantity_options ?? []).join(", ")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      editing
                        ? setEditingMedicationId(null)
                        : startMedicationEdit(medication)
                    }
                    disabled={pendingKey !== null || !online}
                    className="flex min-h-12 items-center justify-center rounded-full border border-hairline bg-canvas px-4 text-base font-bold text-ink"
                  >
                    {editing ? "수정 취소" : "약 수정"}
                  </button>
                </div>

                {editing && (
                  <div className="mt-5">
                    <MedicationForm
                      title={`${medication.name} 수정`}
                      draft={editingMedicationDraft}
                      setDraft={setEditingMedicationDraft}
                      pending={pendingKey === `medication-${medication.id}`}
                      available={online}
                      onSave={() => saveMedicationEdit(medication)}
                    />
                  </div>
                )}

                <section className="mt-6 border-t border-hairline-soft pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-lg font-bold text-ink">복용 예정 시간</h4>
                    {medication.active && (
                      <button
                        type="button"
                        onClick={() =>
                          addingScheduleFor === medication.id
                            ? setAddingScheduleFor(null)
                            : startScheduleAdd(medication)
                        }
                        disabled={pendingKey !== null || !online}
                        className="flex min-h-12 items-center justify-center rounded-full border border-ink bg-canvas px-4 text-base font-bold text-ink"
                      >
                        {addingScheduleFor === medication.id
                          ? "일정 추가 취소"
                          : "일정 추가"}
                      </button>
                    )}
                  </div>

                  {addingScheduleFor === medication.id && (
                    <div className="mt-4">
                      <ScheduleForm
                        medication={medication}
                        draft={scheduleDraft}
                        setDraft={setScheduleDraft}
                        pending={pendingKey === `schedule-add-${medication.id}`}
                        available={online}
                        saveLabel="일정 저장"
                        onSave={() => createSchedule(medication)}
                      />
                    </div>
                  )}

                  {schedules.length === 0 ? (
                    <p className="mt-4 text-base text-muted">등록된 일정이 없습니다.</p>
                  ) : (
                    <ul className="mt-4 flex flex-col gap-3">
                      {schedules.map((schedule) => {
                        const scheduleEditing = editingScheduleId === schedule.id;
                        return (
                          <li
                            key={schedule.id}
                            className="rounded-xl border border-hairline-soft bg-canvas px-4 py-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-lg font-bold text-ink">
                                  {schedule.time}
                                  {!isBooleanOnly(medication) &&
                                    ` · ${schedule.default_quantity}${medication.unit}`}
                                </p>
                                <p
                                  className={`text-base font-semibold ${
                                    schedule.active ? "text-success" : "text-muted"
                                  }`}
                                >
                                  {schedule.active ? "사용 중" : "비활성"}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  scheduleEditing
                                    ? setEditingScheduleId(null)
                                    : startScheduleEdit(schedule)
                                }
                                disabled={pendingKey !== null || !online}
                                className="flex min-h-12 items-center justify-center rounded-full border border-hairline px-4 text-base font-bold text-ink"
                              >
                                {scheduleEditing ? "수정 취소" : "수정"}
                              </button>
                            </div>

                            {scheduleEditing && (
                              <div className="mt-4">
                                <ScheduleForm
                                  medication={medication}
                                  draft={editingScheduleDraft}
                                  setDraft={setEditingScheduleDraft}
                                  pending={pendingKey === `schedule-${schedule.id}`}
                                  available={online}
                                  saveLabel="일정 수정 저장"
                                  onSave={() =>
                                    saveScheduleEdit(medication, schedule)
                                  }
                                />
                              </div>
                            )}

                            <div className="mt-4 grid grid-cols-2 gap-3">
                              <button
                                type="button"
                                onClick={() => void toggleSchedule(medication, schedule)}
                                disabled={pendingKey !== null || !online}
                                className="flex min-h-12 items-center justify-center rounded-full border border-hairline bg-canvas px-3 text-base font-bold text-body"
                              >
                                {schedule.active ? "일정 끄기" : "일정 켜기"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmation({
                                    kind: "schedule",
                                    schedule,
                                    medication,
                                  })
                                }
                                disabled={pendingKey !== null || !online}
                                className="flex min-h-12 items-center justify-center rounded-full border border-warning bg-canvas px-3 text-base font-bold text-warning"
                              >
                                일정 삭제
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <button
                  type="button"
                  onClick={() =>
                    medication.active
                      ? setConfirmation({ kind: "deactivate", medication })
                      : void toggleMedication(medication)
                  }
                  disabled={pendingKey !== null || !online}
                  className={`mt-6 flex min-h-12 w-full items-center justify-center rounded-full border px-5 text-base font-bold ${
                    medication.active
                      ? "border-warning bg-canvas text-warning"
                      : "border-success bg-canvas text-success"
                  }`}
                >
                  {medication.active ? "약 비활성화" : "약 다시 활성화"}
                </button>
              </article>
            );
          })
        )}
      </section>

      {confirmation?.kind === "deactivate" && (
        <ConfirmDialog
          title="약을 비활성화할까요?"
          description={
            <p>
              <strong className="text-ink">{confirmation.medication.name}</strong>이
              첫 화면에서 숨겨지고 관련 일정도 표시되지 않습니다. 과거 기록은
              유지됩니다.
            </p>
          }
          confirmLabel="약 비활성화"
          destructive
          pending={pendingKey !== null}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => toggleMedication(confirmation.medication)}
        />
      )}

      {confirmation?.kind === "schedule" && (
        <ConfirmDialog
          title="일정을 삭제할까요?"
          description={
            <p>
              <strong className="text-ink">
                {confirmation.medication.name} {confirmation.schedule.time}
              </strong>
              일정을 삭제합니다. 이미 작성한 투약 기록은 유지됩니다.
            </p>
          }
          confirmLabel="일정 삭제"
          destructive
          pending={pendingKey !== null}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => removeSchedule(confirmation.schedule)}
        />
      )}
    </main>
  );
}

type MedicationFormProps = {
  title: string;
  draft: MedicationDraft;
  setDraft: (draft: MedicationDraft) => void;
  pending: boolean;
  available: boolean;
  onSave: () => void | Promise<void>;
};

function MedicationForm({
  title,
  draft,
  setDraft,
  pending,
  available,
  onSave,
}: MedicationFormProps) {
  return (
    <fieldset
      disabled={pending}
      className="flex flex-col gap-4 rounded-2xl bg-surface-soft px-5 py-5"
    >
      <legend className="px-1 text-lg font-bold text-ink">{title}</legend>
      <label className="flex flex-col gap-2 text-base font-bold text-body">
        약 이름
        <input
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className="min-h-14 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
        />
      </label>
      <label className="flex min-h-14 items-center gap-3 rounded-xl border border-hairline bg-canvas px-4 text-base font-bold text-ink">
        <input
          type="checkbox"
          checked={draft.booleanOnly}
          onChange={(event) =>
            setDraft({ ...draft, booleanOnly: event.target.checked })
          }
          className="h-6 w-6 accent-primary-active"
        />
        수량 없이 복용 여부만 기록
      </label>
      {!draft.booleanOnly && (
        <>
          <label className="flex flex-col gap-2 text-base font-bold text-body">
            단위
            <input
              value={draft.unit}
              onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
              className="min-h-14 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
              placeholder="예: 정, mL"
            />
          </label>
          <label className="flex flex-col gap-2 text-base font-bold text-body">
            빠른 수량 선택지
            <input
              value={draft.options}
              onChange={(event) =>
                setDraft({ ...draft, options: event.target.value })
              }
              className="min-h-14 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
              placeholder="숫자를 쉼표로 구분"
            />
            <span className="font-normal leading-relaxed text-muted">
              처방에 맞는 수량만 입력해 주세요.
            </span>
          </label>
        </>
      )}
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={pending || !available}
        className="flex min-h-14 items-center justify-center rounded-xl bg-primary-active px-6 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
      >
        {pending
          ? "저장 중입니다"
          : available
            ? "약 설정 저장"
            : "연결 후 저장 가능"}
      </button>
    </fieldset>
  );
}

type ScheduleFormProps = {
  medication: Medication;
  draft: ScheduleDraft;
  setDraft: (draft: ScheduleDraft) => void;
  pending: boolean;
  available: boolean;
  saveLabel: string;
  onSave: () => void | Promise<void>;
};

function ScheduleForm({
  medication,
  draft,
  setDraft,
  pending,
  available,
  saveLabel,
  onSave,
}: ScheduleFormProps) {
  return (
    <fieldset
      disabled={pending}
      className="grid gap-4 rounded-xl bg-surface-soft px-4 py-4"
    >
      <legend className="sr-only">{medication.name} 일정 입력</legend>
      <label className="flex flex-col gap-2 text-base font-bold text-body">
        예정 시각
        <input
          type="time"
          value={draft.time}
          onChange={(event) => setDraft({ ...draft, time: event.target.value })}
          className="min-h-14 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
        />
      </label>
      {!isBooleanOnly(medication) && (
        <label className="flex flex-col gap-2 text-base font-bold text-body">
          예정 수량 ({medication.unit})
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="any"
            value={draft.quantity}
            onChange={(event) =>
              setDraft({ ...draft, quantity: event.target.value })
            }
            className="min-h-14 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
          />
        </label>
      )}
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={pending || !available}
        className="flex min-h-14 items-center justify-center rounded-xl bg-primary-active px-5 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
      >
        {pending ? "저장 중입니다" : available ? saveLabel : "연결 후 저장 가능"}
      </button>
    </fieldset>
  );
}

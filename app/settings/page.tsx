"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { TimePicker } from "@/app/components/date-time-picker";
import {
  ConfirmDialog,
  ErrorBanner,
  FieldError,
  LoadingState,
  Notice,
} from "@/app/components/ui";
import { useOnlineStatus } from "@/app/components/use-online-status";
import { AccountSettingsCard } from "@/app/settings/account-settings-card";
import { PushNotificationsCard } from "@/app/settings/push-notifications-card";
import { Button } from "@/components/ui/button";
import { dismissScheduleNotifications } from "@/lib/push-client";
import { useDb } from "@/lib/store";
import type { Medication, MedicationSchedule } from "@/lib/types";
import { isBooleanOnly } from "@/lib/types";

type MedicationDraft = {
  name: string;
  unit: string;
  options: string;
  booleanOnly: boolean;
};

const scheduleSchema = z.object({
  time: z
    .string()
    .min(1, "예정 시각을 입력해 주세요.")
    .regex(
      /^(?:[01]\d|2[0-3]):[0-5]\d$/,
      "예정 시각을 00:00부터 23:59 사이로 입력해 주세요."
    ),
});

type ScheduleDraft = z.infer<typeof scheduleSchema>;

type Confirmation =
  | { kind: "deactivate"; medication: Medication }
  | { kind: "delete-medication"; medication: Medication }
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
    selectedCareSpace,
    loading,
    error,
    refresh,
    clearError,
    addMedication,
    updateMedication,
    deleteMedication,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    canManageMedicationSettings,
    initialized,
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
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
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
      if (medication.active) {
        if (addingScheduleFor === medication.id) {
          closeScheduleAdd();
        }
        await dismissScheduleNotifications(
          db.medication_schedules
            .filter((schedule) => schedule.medication_id === medication.id)
            .map((schedule) => schedule.id)
        );
      }
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

  async function removeMedication(medication: Medication) {
    if (pendingKey || !online) return;
    const scheduleIds = db.medication_schedules
      .filter((schedule) => schedule.medication_id === medication.id)
      .map((schedule) => schedule.id);

    beginMutation(`medication-delete-${medication.id}`);
    try {
      await deleteMedication(medication.id);
      await dismissScheduleNotifications(scheduleIds);
      if (editingMedicationId === medication.id) {
        setEditingMedicationId(null);
      }
      if (addingScheduleFor === medication.id) {
        setAddingScheduleFor(null);
      }
      if (
        editingScheduleId !== null &&
        scheduleIds.includes(editingScheduleId)
      ) {
        setEditingScheduleId(null);
      }
      setSuccess(
        `${medication.name}을 등록 목록에서 삭제했습니다. 기존 복용 기록에서 약 이름, 복용 시각, 수량을 계속 확인할 수 있습니다.`
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
    setFieldError(null);
    setSuccess(null);
  }

  function closeScheduleAdd() {
    setAddingScheduleFor(null);
    setFieldError(null);
    setSuccess(null);
  }

  async function createSchedule(
    medication: Medication,
    draft: ScheduleDraft
  ): Promise<boolean> {
    if (pendingKey || !online) return false;
    setFieldError(null);
    setSuccess(null);
    try {
      beginMutation(`schedule-add-${medication.id}`);
      const addedTime = draft.time;
      await addSchedule({
        medication_id: medication.id,
        time: addedTime,
        active: true,
      });
      setSuccess(
        `${medication.name} ${addedTime} 시간을 추가했습니다. 다른 시간도 이어서 추가할 수 있습니다.`
      );
      return true;
    } catch (caught) {
      setFieldError(messageOf(caught));
      return false;
    } finally {
      finishMutation();
    }
  }

  function startScheduleEdit(schedule: MedicationSchedule) {
    setEditingScheduleId(schedule.id);
    setFieldError(null);
    setSuccess(null);
  }

  async function saveScheduleEdit(
    medication: Medication,
    schedule: MedicationSchedule,
    draft: ScheduleDraft
  ): Promise<boolean> {
    if (pendingKey || !online) return false;
    try {
      beginMutation(`schedule-${schedule.id}`);
      await updateSchedule(schedule.id, {
        time: draft.time,
      });
      await dismissScheduleNotifications(schedule.id);
      setEditingScheduleId(null);
      setSuccess(`${medication.name} 일정을 수정했습니다.`);
      return true;
    } catch (caught) {
      setFieldError(messageOf(caught));
      return false;
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
      if (schedule.active) {
        await dismissScheduleNotifications(schedule.id);
      }
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
      await dismissScheduleNotifications(schedule.id);
      setSuccess(`${schedule.time} 알림 시간을 삭제했습니다.`);
      setConfirmation(null);
    } catch (caught) {
      setLocalError(messageOf(caught));
      setConfirmation(null);
    } finally {
      finishMutation();
    }
  }

  const showFullPageLoading =
    !initialized ||
    (loading &&
      medications.length === 0 &&
      !addingMedication &&
      pendingKey === null);

  if (showFullPageLoading) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <h1 className="sr-only">환경설정</h1>
        <AccountSettingsCard />
        <LoadingState label="약 설정을 불러오는 중입니다." />
      </main>
    );
  }

  if (error && !selectedCareSpace) {
    return (
      <main className="flex flex-1 flex-col gap-6">
        <h1 className="sr-only">환경설정</h1>
        <ErrorBanner message={error} onRetry={refresh} />
      </main>
    );
  }

  if (!canManageMedicationSettings) {
    return (
      <main className="flex flex-1 flex-col gap-7">
        <h1 className="sr-only">환경설정</h1>
        <AccountSettingsCard />
        <PushNotificationsCard online={online} />
        <ErrorBanner
          message={error}
          onRetry={refresh}
          onDismiss={clearError}
        />
        <Notice>
          약과 일정은 이 가족 공간의 소유자와 보호자만 변경할 수 있습니다. 현재는
          등록된 설정을 조회하고 이 기기의 알림 수신 여부를 관리할 수 있습니다.
        </Notice>
        <section aria-labelledby="medication-list-title" className="flex flex-col gap-4">
          <h2 id="medication-list-title" className="text-xl font-bold text-ink">
            등록된 약과 일정
          </h2>
          {medications.length === 0 ? (
            <p className="rounded-2xl border border-hairline px-5 py-5 text-lg text-muted">
              등록된 약이 없습니다.
            </p>
          ) : (
            medications.map((medication) => {
              const schedules = db.medication_schedules
                .filter((schedule) => schedule.medication_id === medication.id)
                .sort((a, b) => a.time.localeCompare(b.time));
              return (
                <article
                  key={medication.id}
                  className="rounded-2xl border border-hairline bg-canvas px-5 py-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xl font-bold text-ink">{medication.name}</h3>
                    <span className="rounded-full bg-surface-soft px-3 py-1 text-sm font-bold text-body">
                      {medication.active ? "사용 중" : "비활성"}
                    </span>
                  </div>
                  <p className="mt-1 text-base text-body">
                    {isBooleanOnly(medication)
                      ? "복용 여부만 기록"
                      : `단위 ${medication.unit} · 선택지 ${medication.quantity_options.join(", ")}`}
                  </p>
                  <h4 className="mt-5 border-t border-hairline-soft pt-4 text-lg font-bold text-ink">
                    복용·알림 시간
                  </h4>
                  {schedules.length === 0 ? (
                    <p className="mt-2 text-base text-muted">등록된 일정이 없습니다.</p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-2">
                      {schedules.map((schedule) => (
                        <li
                          key={schedule.id}
                          className="flex items-center justify-between gap-3 rounded-xl bg-surface-soft px-4 py-3"
                        >
                          <span className="text-lg font-bold text-ink">
                            {schedule.time}
                          </span>
                          <span className="text-base font-semibold text-body">
                            {schedule.active ? "사용 중" : "비활성"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-7">
      <h1 className="sr-only">환경설정</h1>

      <AccountSettingsCard />
      <PushNotificationsCard online={online} />

      {loading && (
        <p role="status" className="sr-only">
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
                    <div>
                      <h4 className="text-lg font-bold text-ink">
                        복용·알림 시간 ({schedules.length}개)
                      </h4>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        필요한 시간만큼 추가할 수 있습니다.
                      </p>
                    </div>
                    {medication.active && (
                      <button
                        type="button"
                        onClick={() =>
                          addingScheduleFor === medication.id
                            ? closeScheduleAdd()
                            : startScheduleAdd(medication)
                        }
                        aria-label={`${medication.name} ${
                          addingScheduleFor === medication.id
                            ? "시간 추가 닫기"
                            : "알림 시간 추가"
                        }`}
                        disabled={pendingKey !== null || !online}
                        className="flex min-h-12 items-center justify-center rounded-full border border-ink bg-canvas px-4 text-base font-bold text-ink"
                      >
                        {addingScheduleFor === medication.id
                          ? "시간 추가 닫기"
                          : "알림 시간 추가"}
                      </button>
                    )}
                  </div>

                  {medication.active && addingScheduleFor === medication.id && (
                    <div className="mt-4">
                      <ScheduleForm
                        legend={`${medication.name} 새 복용·알림 시간 입력`}
                        pending={pendingKey === `schedule-add-${medication.id}`}
                        available={online}
                        saveLabel="이 시간 추가"
                        resetAfterSave
                        onSave={(draft) => createSchedule(medication, draft)}
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
                                aria-label={`${medication.name} ${schedule.time} ${
                                  scheduleEditing ? "수정 취소" : "수정"
                                }`}
                                disabled={pendingKey !== null || !online}
                                className="flex min-h-12 items-center justify-center rounded-full border border-hairline px-4 text-base font-bold text-ink"
                              >
                                {scheduleEditing ? "수정 취소" : "수정"}
                              </button>
                            </div>

                            {scheduleEditing && (
                              <div className="mt-4">
                                <ScheduleForm
                                  legend={`${medication.name} ${schedule.time} 복용·알림 시간 수정`}
                                  initialTime={schedule.time}
                                  pending={pendingKey === `schedule-${schedule.id}`}
                                  available={online}
                                  saveLabel="일정 수정 저장"
                                  onSave={(draft) =>
                                    saveScheduleEdit(medication, schedule, draft)
                                  }
                                />
                              </div>
                            )}

                            <div className="mt-4 grid grid-cols-2 gap-3">
                              <button
                                type="button"
                                onClick={() => void toggleSchedule(medication, schedule)}
                                aria-label={`${medication.name} ${schedule.time} ${
                                  schedule.active ? "시간 끄기" : "시간 켜기"
                                }`}
                                disabled={pendingKey !== null || !online}
                                className="flex min-h-12 items-center justify-center rounded-full border border-hairline bg-canvas px-3 text-base font-bold text-body"
                              >
                                {schedule.active ? "시간 끄기" : "시간 켜기"}
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
                                aria-label={`${medication.name} ${schedule.time} 알림 시간 삭제`}
                                disabled={pendingKey !== null || !online}
                                className="flex min-h-12 items-center justify-center rounded-full border border-warning bg-canvas px-3 text-base font-bold text-warning"
                              >
                                알림 시간 삭제
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <div className="mt-6 grid gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      medication.active
                        ? setConfirmation({ kind: "deactivate", medication })
                        : void toggleMedication(medication)
                    }
                    disabled={pendingKey !== null || !online}
                    className={`flex min-h-12 w-full items-center justify-center rounded-full border px-5 text-base font-bold ${
                      medication.active
                        ? "border-warning bg-canvas text-warning"
                        : "border-success bg-canvas text-success"
                    }`}
                  >
                    {medication.active ? "약 비활성화" : "약 다시 활성화"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmation({ kind: "delete-medication", medication })
                    }
                    aria-label={`${medication.name} 등록된 약 삭제`}
                    disabled={pendingKey !== null || !online}
                    className="flex min-h-12 w-full items-center justify-center rounded-full border border-error bg-canvas px-5 text-base font-bold text-error"
                  >
                    등록된 약 삭제
                  </button>
                </div>
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
              유지되며 관련 반복 알림은 중단됩니다.
            </p>
          }
          confirmLabel="약 비활성화"
          destructive
          pending={pendingKey !== null}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => toggleMedication(confirmation.medication)}
        />
      )}

      {confirmation?.kind === "delete-medication" && (
        <ConfirmDialog
          title="등록된 약을 삭제할까요?"
          description={
            <div className="flex flex-col gap-3">
              <p>
                <strong className="text-ink">
                  {confirmation.medication.name}
                </strong>
                은 등록 목록과 첫 화면에서 사라지고, 관련 복용·알림 시간과
                앞으로의 알림도 중단됩니다.
              </p>
              <p className="font-bold text-ink">
                기존 복용 기록은 삭제되지 않습니다. 약 이름, 복용 시각, 복용
                수량을 계속 확인할 수 있습니다.
              </p>
            </div>
          }
          confirmLabel="등록된 약 삭제"
          destructive
          pending={pendingKey !== null}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => removeMedication(confirmation.medication)}
        />
      )}

      {confirmation?.kind === "schedule" && (
        <ConfirmDialog
          title="알림 시간을 삭제할까요?"
          description={
            <p>
              <strong className="text-ink">
                {confirmation.medication.name} {confirmation.schedule.time}
              </strong>
              시간을 삭제합니다. 첫 화면의 해당 예정 시간과 반복 알림은
              제거되고, 이미 작성한 투약 기록은 유지됩니다.
            </p>
          }
          confirmLabel="알림 시간 삭제"
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
      className="flex w-full min-w-0 flex-col gap-4 rounded-2xl bg-surface-soft px-5 py-5"
    >
      <legend className="sr-only">{title}</legend>
      <p aria-hidden="true" className="text-lg font-bold text-ink">
        {title}
      </p>
      <label className="flex min-w-0 flex-col gap-2 text-base font-bold text-body">
        약 이름
        <input
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className="min-h-14 w-full min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
        />
      </label>
      <label className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-hairline bg-canvas px-4 text-base font-bold text-ink">
        <input
          type="checkbox"
          checked={draft.booleanOnly}
          onChange={(event) =>
            setDraft({ ...draft, booleanOnly: event.target.checked })
          }
          className="h-6 w-6 shrink-0 accent-primary-active"
        />
        수량 없이 복용 여부만 기록
      </label>
      {!draft.booleanOnly && (
        <>
          <label className="flex min-w-0 flex-col gap-2 text-base font-bold text-body">
            단위
            <input
              value={draft.unit}
              onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
              className="min-h-14 w-full min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
              placeholder="예: 정, mL"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-2 text-base font-bold text-body">
            빠른 수량 선택지
            <input
              value={draft.options}
              onChange={(event) =>
                setDraft({ ...draft, options: event.target.value })
              }
              className="min-h-14 w-full min-w-0 rounded-xl border border-hairline bg-canvas px-4 text-lg font-normal text-ink focus:border-2 focus:border-ink"
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
  legend: string;
  initialTime?: string;
  pending: boolean;
  available: boolean;
  saveLabel: string;
  resetAfterSave?: boolean;
  onSave: (draft: ScheduleDraft) => Promise<boolean>;
};

function ScheduleForm({
  legend,
  initialTime = "",
  pending,
  available,
  saveLabel,
  resetAfterSave = false,
  onSave,
}: ScheduleFormProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleDraft>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { time: initialTime },
  });
  const submitting = pending || isSubmitting;

  async function submit(draft: ScheduleDraft) {
    const saved = await onSave(draft);
    if (saved && resetAfterSave) {
      reset({ time: "" });
    }
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(submit)}
      className="rounded-xl bg-surface-soft px-4 py-4"
    >
      <fieldset disabled={submitting} className="grid gap-4">
        <legend className="sr-only">{legend}</legend>
        <div className="grid gap-2">
          <Controller
            name="time"
            control={control}
            render={({ field }) => (
              <TimePicker
                id={inputId}
                value={field.value}
                label="예정 시각"
                onChange={field.onChange}
                onBlur={field.onBlur}
                triggerRef={field.ref}
                disabled={submitting}
                invalid={Boolean(errors.time)}
                describedBy={errors.time ? errorId : undefined}
              />
            )}
          />
          {errors.time?.message && (
            <p
              id={errorId}
              role="alert"
              className="text-base font-semibold leading-relaxed text-error"
            >
              {errors.time.message}
            </p>
          )}
        </div>
        <Button
          type="submit"
          disabled={submitting || !available}
          className="h-14 min-h-14 w-full rounded-xl bg-primary-active px-5 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
        >
          {submitting
            ? "저장 중입니다"
            : available
              ? saveLabel
              : "연결 후 저장 가능"}
        </Button>
      </fieldset>
    </form>
  );
}

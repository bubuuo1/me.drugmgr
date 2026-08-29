"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { DbRepository } from "@/lib/db-repository";
import { fromDateKey } from "@/lib/date";
import { MockDbRepository } from "@/lib/mock-db";
import { isMockDbEnabled } from "@/lib/supabase";
import { SupabaseDbRepository } from "@/lib/supabase-db";
import type {
  AddMedicationInput,
  AddMedicationLogInput,
  AddScheduleInput,
  DB,
  DailyStatus,
  DailyStatusInput,
  Medication,
  MedicationLog,
  MedicationSchedule,
  UpdateMedicationInput,
  UpdateMedicationLogInput,
  UpdateScheduleInput,
} from "@/lib/types";

const EMPTY_DB: DB = {
  medications: [],
  medication_schedules: [],
  medication_logs: [],
  daily_status: [],
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repository: DbRepository = isMockDbEnabled
  ? new MockDbRepository()
  : new SupabaseDbRepository();

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("알 수 없는 데이터 오류가 발생했습니다.");
}

function assertNonEmpty(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}을(를) 입력해 주세요.`);
  if (trimmed.length > maxLength) {
    throw new Error(`${label}은(는) ${maxLength}자 이하여야 합니다.`);
  }
  return trimmed;
}

function normalizedUnit(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 20) throw new Error("약 단위는 20자 이하여야 합니다.");
  return trimmed;
}

function assertQuantity(value: number, label = "복용량"): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1000) {
    throw new Error(`${label}은(는) 0보다 크고 1000 이하여야 합니다.`);
  }
  return value;
}

function normalizedQuantityOptions(values: number[]): number[] {
  if (!Array.isArray(values) || values.length > 50) {
    throw new Error("복용량 선택지는 50개 이하여야 합니다.");
  }
  const normalized = values.map((value) => assertQuantity(value, "복용량 선택지"));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("복용량 선택지에 중복 값이 있습니다.");
  }
  return normalized;
}

function normalizedTime(value: string): string {
  const trimmed = value.trim();
  if (!TIME_PATTERN.test(trimmed)) {
    throw new Error("복용 시각은 HH:mm 형식이어야 합니다.");
  }
  return trimmed.slice(0, 5);
}

function normalizedNote(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length > 2000) throw new Error("메모는 2000자 이하여야 합니다.");
  return trimmed || null;
}

function assertIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("유효한 복용 시각이 아닙니다.");
  return date.toISOString();
}

function requestId(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function replaceRow<T extends { id: string }>(rows: T[], row: T): T[] {
  const exists = rows.some((candidate) => candidate.id === row.id);
  return exists
    ? rows.map((candidate) => (candidate.id === row.id ? row : candidate))
    : [...rows, row];
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertPatch(patch: object): void {
  if (!Object.values(patch).some((value) => value !== undefined)) {
    throw new Error("변경할 값을 입력해 주세요.");
  }
}

function validateStatus(input: DailyStatusInput): DailyStatusInput {
  fromDateKey(input.date);
  const allowedThree = new Set(["좋음", "보통", "나쁨"]);
  if (input.fatigue !== null && !allowedThree.has(input.fatigue)) {
    throw new Error("유효하지 않은 피로 상태입니다.");
  }
  if (input.strength !== null && !allowedThree.has(input.strength)) {
    throw new Error("유효하지 않은 근력 상태입니다.");
  }
  if (
    input.breathing !== null &&
    input.breathing !== "편안함" &&
    input.breathing !== "평소와 다름"
  ) {
    throw new Error("유효하지 않은 호흡 상태입니다.");
  }
  if (
    input.eye_symptom !== null &&
    input.eye_symptom !== "없음" &&
    input.eye_symptom !== "있음"
  ) {
    throw new Error("유효하지 않은 눈 증상 상태입니다.");
  }
  return { ...input, note: normalizedNote(input.note) };
}

export type DbContextValue = {
  db: DB;
  loading: boolean;
  error: string | null;
  isSupabase: boolean;
  refresh(): Promise<void>;
  clearError(): void;
  addMedication(input: AddMedicationInput): Promise<Medication>;
  updateMedication(id: string, patch: UpdateMedicationInput): Promise<Medication>;
  deactivateMedication(id: string): Promise<Medication>;
  addSchedule(input: AddScheduleInput): Promise<MedicationSchedule>;
  updateSchedule(id: string, patch: UpdateScheduleInput): Promise<MedicationSchedule>;
  deleteSchedule(id: string): Promise<MedicationSchedule>;
  addLog(input: AddMedicationLogInput): Promise<MedicationLog>;
  updateLog(id: string, patch: UpdateMedicationLogInput): Promise<MedicationLog>;
  deleteLog(id: string): Promise<MedicationLog>;
  softDeleteLog(id: string): Promise<MedicationLog>;
  restoreLog(id: string): Promise<MedicationLog>;
  upsertStatus(input: DailyStatusInput): Promise<DailyStatus>;
  deleteStatus(date: string): Promise<DailyStatus>;
};

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({ children }: PropsWithChildren) {
  const [db, setDb] = useState<DB>(EMPTY_DB);
  const [pendingCount, setPendingCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const loading = pendingCount > 0;

  const begin = useCallback(() => {
    setPendingCount((count) => count + 1);
    setError(null);
  }, []);

  const finish = useCallback(() => {
    setPendingCount((count) => Math.max(0, count - 1));
  }, []);

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      begin();
      try {
        return await operation();
      } catch (reason) {
        const caught = asError(reason);
        setError(caught.message);
        throw caught;
      } finally {
        finish();
      }
    },
    [begin, finish]
  );

  const refresh = useCallback(async () => {
    const next = await run(() => repository.fetchAll());
    setDb(next);
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    void repository
      .fetchAll()
      .then((next) => {
        if (!cancelled) setDb(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(asError(reason).message);
      })
      .finally(() => {
        if (!cancelled) setPendingCount((count) => Math.max(0, count - 1));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const addMedication = useCallback(
    async (input: AddMedicationInput) => {
      const prepared: AddMedicationInput = {
        name: assertNonEmpty(input.name, "약 이름", 100),
        unit: normalizedUnit(input.unit),
        quantity_options: normalizedQuantityOptions(input.quantity_options),
        active: input.active ?? true,
      };
      const row = await run(() => repository.addMedication(prepared));
      setDb((current) => ({
        ...current,
        medications: replaceRow(current.medications, row),
      }));
      return row;
    },
    [run]
  );

  const updateMedication = useCallback(
    async (id: string, patch: UpdateMedicationInput) => {
      assertPatch(patch);
      const prepared: UpdateMedicationInput = {
        ...patch,
        name:
          patch.name === undefined
            ? undefined
            : assertNonEmpty(patch.name, "약 이름", 100),
        unit: patch.unit === undefined ? undefined : normalizedUnit(patch.unit),
        quantity_options:
          patch.quantity_options === undefined
            ? undefined
            : normalizedQuantityOptions(patch.quantity_options),
      };
      const row = await run(() => repository.updateMedication(id, prepared));
      setDb((current) => ({
        ...current,
        medications: replaceRow(current.medications, row),
      }));
      return row;
    },
    [run]
  );

  const deactivateMedication = useCallback(
    async (id: string) => {
      const row = await run(() => repository.deactivateMedication(id));
      setDb((current) => ({
        ...current,
        medications: replaceRow(current.medications, row),
      }));
      return row;
    },
    [run]
  );

  const addSchedule = useCallback(
    async (input: AddScheduleInput) => {
      const prepared: AddScheduleInput = {
        medication_id: input.medication_id,
        time: normalizedTime(input.time),
        default_quantity: assertQuantity(input.default_quantity, "기본 복용량"),
        active: input.active ?? true,
      };
      const row = await run(() => repository.addSchedule(prepared));
      setDb((current) => ({
        ...current,
        medication_schedules: replaceRow(current.medication_schedules, row),
      }));
      return row;
    },
    [run]
  );

  const updateSchedule = useCallback(
    async (id: string, patch: UpdateScheduleInput) => {
      assertPatch(patch);
      const prepared: UpdateScheduleInput = {
        ...patch,
        time: patch.time === undefined ? undefined : normalizedTime(patch.time),
        default_quantity:
          patch.default_quantity === undefined
            ? undefined
            : assertQuantity(patch.default_quantity, "기본 복용량"),
      };
      const row = await run(() => repository.updateSchedule(id, prepared));
      setDb((current) => ({
        ...current,
        medication_schedules: replaceRow(current.medication_schedules, row),
      }));
      return row;
    },
    [run]
  );

  const deleteSchedule = useCallback(
    async (id: string) => {
      const { row, next } = await run(async () => {
        const deleted = await repository.deleteSchedule(id);
        const refreshed = await repository.fetchAll();
        return { row: deleted, next: refreshed };
      });
      setDb(next);
      return row;
    },
    [run]
  );

  const addLog = useCallback(
    async (input: AddMedicationLogInput) => {
      const scheduleId = input.schedule_id ?? null;
      const expectedExtra = scheduleId === null;
      const isExtra = input.is_extra ?? expectedExtra;
      if (isExtra !== expectedExtra) {
        throw new Error(
          scheduleId
            ? "일정에 연결된 기록은 추가 복용으로 표시할 수 없습니다."
            : "일정 없는 기록은 추가 복용으로 표시해야 합니다."
        );
      }
      const clientRequestId = input.client_request_id ?? requestId();
      if (!UUID_PATTERN.test(clientRequestId)) {
        throw new Error("client_request_id는 UUID 형식이어야 합니다.");
      }
      const prepared = {
        medication_id: input.medication_id,
        schedule_id: scheduleId,
        quantity: assertQuantity(input.quantity),
        note: normalizedNote(input.note),
        taken_at: assertIsoDate(input.taken_at ?? new Date().toISOString()),
        is_extra: isExtra,
        client_request_id: clientRequestId,
      };
      const row = await run(() => repository.addLog(prepared));
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [run]
  );

  const updateLog = useCallback(
    async (id: string, patch: UpdateMedicationLogInput) => {
      assertPatch(patch);
      const currentLog = db.medication_logs.find((log) => log.id === id);
      const finalScheduleId = hasOwn(patch, "schedule_id")
        ? patch.schedule_id ?? null
        : currentLog?.schedule_id;
      const expectedExtra = finalScheduleId === null;
      if (patch.is_extra !== undefined && patch.is_extra !== expectedExtra) {
        throw new Error("schedule_id와 is_extra 값이 일치하지 않습니다.");
      }
      const prepared: UpdateMedicationLogInput = {
        ...patch,
        schedule_id: hasOwn(patch, "schedule_id") ? patch.schedule_id ?? null : undefined,
        is_extra:
          hasOwn(patch, "schedule_id") && patch.is_extra === undefined
            ? expectedExtra
            : patch.is_extra,
        quantity:
          patch.quantity === undefined ? undefined : assertQuantity(patch.quantity),
        note: hasOwn(patch, "note") ? normalizedNote(patch.note) : undefined,
        taken_at:
          patch.taken_at === undefined ? undefined : assertIsoDate(patch.taken_at),
      };
      const row = await run(() => repository.updateLog(id, prepared));
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [db.medication_logs, run]
  );

  const softDeleteLog = useCallback(
    async (id: string) => {
      const row = await run(() => repository.softDeleteLog(id));
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [run]
  );

  const restoreLog = useCallback(
    async (id: string) => {
      const row = await run(() => repository.restoreLog(id));
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [run]
  );

  const upsertStatus = useCallback(
    async (input: DailyStatusInput) => {
      const row = await run(() => repository.upsertStatus(validateStatus(input)));
      setDb((current) => ({
        ...current,
        daily_status: replaceRow(current.daily_status, row),
      }));
      return row;
    },
    [run]
  );

  const deleteStatus = useCallback(
    async (date: string) => {
      fromDateKey(date);
      const row = await run(() => repository.deleteStatus(date));
      setDb((current) => ({
        ...current,
        daily_status: current.daily_status.filter((status) => status.id !== row.id),
      }));
      return row;
    },
    [run]
  );

  const value = useMemo<DbContextValue>(
    () => ({
      db,
      loading,
      error,
      isSupabase: !isMockDbEnabled,
      refresh,
      clearError,
      addMedication,
      updateMedication,
      deactivateMedication,
      addSchedule,
      updateSchedule,
      deleteSchedule,
      addLog,
      updateLog,
      deleteLog: softDeleteLog,
      softDeleteLog,
      restoreLog,
      upsertStatus,
      deleteStatus,
    }),
    [
      db,
      loading,
      error,
      refresh,
      clearError,
      addMedication,
      updateMedication,
      deactivateMedication,
      addSchedule,
      updateSchedule,
      deleteSchedule,
      addLog,
      updateLog,
      softDeleteLog,
      restoreLog,
      upsertStatus,
      deleteStatus,
    ]
  );

  return createElement(DbContext.Provider, { value }, children);
}

export function useDb(): DbContextValue {
  const context = useContext(DbContext);
  if (!context) throw new Error("useDb는 DbProvider 안에서 사용해야 합니다.");
  return context;
}

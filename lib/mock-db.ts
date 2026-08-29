import type { DbRepository, RequiredAddMedicationLogInput } from "@/lib/db-repository";
import type {
  AddMedicationInput,
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

const SEED_TIME = "2026-01-01T00:00:00.000Z";

const memoryDb: DB = {
  medications: [
    {
      id: "med-mestinon",
      name: "메스티논",
      unit: "정",
      active: true,
      quantity_options: [0.5, 1, 1.5, 2],
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    },
    {
      id: "med-solon",
      name: "소론도",
      unit: "정",
      active: true,
      quantity_options: [1, 2, 3, 4, 5, 6, 7, 8],
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    },
    {
      id: "med-ceftrin",
      name: "셉트린정",
      unit: "",
      active: true,
      quantity_options: [],
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    },
  ],
  medication_schedules: [],
  medication_logs: [],
  daily_status: [],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(): string {
  return globalThis.crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function definedPatch<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function missing(label: string): never {
  throw new Error(`${label}을(를) 찾을 수 없습니다.`);
}

function medicationById(medicationId: string): Medication {
  return (
    memoryDb.medications.find((medication) => medication.id === medicationId) ??
    missing("약")
  );
}

function scheduleById(scheduleId: string): MedicationSchedule {
  return (
    memoryDb.medication_schedules.find((schedule) => schedule.id === scheduleId) ??
    missing("복용 일정")
  );
}

function logById(logId: string): MedicationLog {
  return memoryDb.medication_logs.find((log) => log.id === logId) ?? missing("투약 기록");
}

function replaceById<T extends { id: string }>(rows: T[], row: T): void {
  const index = rows.findIndex((candidate) => candidate.id === row.id);
  if (index < 0) missing("행");
  rows[index] = row;
}

export class MockDbRepository implements DbRepository {
  async fetchAll(): Promise<DB> {
    return clone({
      medications: [...memoryDb.medications].sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      ),
      medication_schedules: [...memoryDb.medication_schedules].sort((a, b) =>
        a.time.localeCompare(b.time)
      ),
      medication_logs: [...memoryDb.medication_logs].sort((a, b) =>
        a.taken_at.localeCompare(b.taken_at)
      ),
      daily_status: [...memoryDb.daily_status].sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
    });
  }

  async addMedication(input: AddMedicationInput): Promise<Medication> {
    if (
      memoryDb.medications.some(
        (medication) => medication.name.toLocaleLowerCase() === input.name.toLocaleLowerCase()
      )
    ) {
      throw new Error("같은 이름의 약이 이미 있습니다.");
    }
    const timestamp = now();
    const medication: Medication = {
      id: id(),
      name: input.name,
      unit: input.unit,
      quantity_options: [...input.quantity_options],
      active: input.active ?? true,
      created_at: timestamp,
      updated_at: timestamp,
    };
    memoryDb.medications.push(medication);
    return clone(medication);
  }

  async updateMedication(
    medicationId: string,
    patch: UpdateMedicationInput
  ): Promise<Medication> {
    const current = medicationById(medicationId);
    const clean = definedPatch(patch);
    if (
      patch.name &&
      memoryDb.medications.some(
        (medication) =>
          medication.id !== medicationId &&
          medication.name.toLocaleLowerCase() === patch.name!.toLocaleLowerCase()
      )
    ) {
      throw new Error("같은 이름의 약이 이미 있습니다.");
    }
    const updated: Medication = {
      ...current,
      ...clean,
      quantity_options: patch.quantity_options
        ? [...patch.quantity_options]
        : current.quantity_options,
      updated_at: now(),
    };
    replaceById(memoryDb.medications, updated);
    return clone(updated);
  }

  async deactivateMedication(medicationId: string): Promise<Medication> {
    return this.updateMedication(medicationId, { active: false });
  }

  async addSchedule(input: AddScheduleInput): Promise<MedicationSchedule> {
    medicationById(input.medication_id);
    if (
      memoryDb.medication_schedules.some(
        (schedule) =>
          schedule.medication_id === input.medication_id && schedule.time === input.time
      )
    ) {
      throw new Error("같은 약과 시각의 일정이 이미 있습니다.");
    }
    const timestamp = now();
    const schedule: MedicationSchedule = {
      id: id(),
      medication_id: input.medication_id,
      time: input.time,
      active: input.active ?? true,
      created_at: timestamp,
      updated_at: timestamp,
    };
    memoryDb.medication_schedules.push(schedule);
    return clone(schedule);
  }

  async updateSchedule(
    scheduleId: string,
    patch: UpdateScheduleInput
  ): Promise<MedicationSchedule> {
    const current = scheduleById(scheduleId);
    const clean = definedPatch(patch);
    const medicationId = current.medication_id;
    const time = patch.time ?? current.time;
    medicationById(medicationId);
    if (
      memoryDb.medication_schedules.some(
        (schedule) =>
          schedule.id !== scheduleId &&
          schedule.medication_id === medicationId &&
          schedule.time === time
      )
    ) {
      throw new Error("같은 약과 시각의 일정이 이미 있습니다.");
    }
    const updated: MedicationSchedule = {
      ...current,
      ...clean,
      updated_at: now(),
    };
    replaceById(memoryDb.medication_schedules, updated);
    return clone(updated);
  }

  async deleteSchedule(scheduleId: string): Promise<MedicationSchedule> {
    const current = scheduleById(scheduleId);
    memoryDb.medication_schedules = memoryDb.medication_schedules.filter(
      (schedule) => schedule.id !== scheduleId
    );
    memoryDb.medication_logs = memoryDb.medication_logs.map((log) =>
      log.schedule_id === scheduleId
        ? { ...log, schedule_id: null, updated_at: now() }
        : log
    );
    return clone(current);
  }

  async addLog(input: RequiredAddMedicationLogInput): Promise<MedicationLog> {
    const duplicate = memoryDb.medication_logs.find(
      (log) => log.client_request_id === input.client_request_id
    );
    if (duplicate) return clone(duplicate);

    const medication = medicationById(input.medication_id);
    const schedule = input.schedule_id ? scheduleById(input.schedule_id) : null;
    if (schedule && schedule.medication_id !== medication.id) {
      throw new Error("선택한 일정과 약이 일치하지 않습니다.");
    }
    const timestamp = now();
    const log: MedicationLog = {
      id: id(),
      client_request_id: input.client_request_id,
      medication_id: medication.id,
      schedule_id: schedule?.id ?? null,
      medication_name: medication.name,
      medication_unit: medication.unit,
      schedule_time: schedule?.time ?? null,
      taken_at: input.taken_at,
      quantity: input.quantity,
      note: input.note,
      is_extra: input.is_extra,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    memoryDb.medication_logs.push(log);
    return clone(log);
  }

  async updateLog(
    logId: string,
    patch: UpdateMedicationLogInput
  ): Promise<MedicationLog> {
    const current = logById(logId);
    const clean = definedPatch(patch);
    const medicationId = patch.medication_id ?? current.medication_id;
    const medication = medicationById(medicationId);
    const scheduleId = hasOwn(patch, "schedule_id")
      ? patch.schedule_id ?? null
      : current.schedule_id;
    const schedule = scheduleId ? scheduleById(scheduleId) : null;
    if (schedule && schedule.medication_id !== medication.id) {
      throw new Error("선택한 일정과 약이 일치하지 않습니다.");
    }

    const medicationChanged = medication.id !== current.medication_id;
    const scheduleChanged = scheduleId !== current.schedule_id;
    const updated: MedicationLog = {
      ...current,
      ...clean,
      medication_id: medication.id,
      schedule_id: scheduleId,
      medication_name: medicationChanged ? medication.name : current.medication_name,
      medication_unit: medicationChanged ? medication.unit : current.medication_unit,
      schedule_time: scheduleChanged
        ? schedule?.time ?? (patch.is_extra ? null : current.schedule_time)
        : current.schedule_time,
      updated_at: now(),
    };
    replaceById(memoryDb.medication_logs, updated);
    return clone(updated);
  }

  async softDeleteLog(logId: string): Promise<MedicationLog> {
    const current = logById(logId);
    if (current.deleted_at) throw new Error("이미 삭제된 투약 기록입니다.");
    const updated = { ...current, deleted_at: now(), updated_at: now() };
    replaceById(memoryDb.medication_logs, updated);
    return clone(updated);
  }

  async restoreLog(logId: string): Promise<MedicationLog> {
    const current = logById(logId);
    const updated = { ...current, deleted_at: null, updated_at: now() };
    replaceById(memoryDb.medication_logs, updated);
    return clone(updated);
  }

  async upsertStatus(input: DailyStatusInput): Promise<DailyStatus> {
    const current = memoryDb.daily_status.find((status) => status.date === input.date);
    const timestamp = now();
    const status: DailyStatus = current
      ? { ...current, ...input, updated_at: timestamp }
      : {
          id: id(),
          ...input,
          created_at: timestamp,
          updated_at: timestamp,
        };
    if (current) replaceById(memoryDb.daily_status, status);
    else memoryDb.daily_status.push(status);
    return clone(status);
  }

  async deleteStatus(date: string): Promise<DailyStatus> {
    const current =
      memoryDb.daily_status.find((status) => status.date === date) ??
      missing("상태 기록");
    memoryDb.daily_status = memoryDb.daily_status.filter(
      (status) => status.date !== date
    );
    return clone(current);
  }
}

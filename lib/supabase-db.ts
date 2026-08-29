import type { DbRepository, RequiredAddMedicationLogInput } from "@/lib/db-repository";
import { requireSupabase } from "@/lib/supabase";
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

type QueryError = {
  message: string;
  code?: string;
};

function failure(operation: string, error: QueryError): Error {
  return new Error(`${operation} 실패: ${error.message}`);
}

function definedPatch<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function withoutSeconds(time: string): string {
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(time) ? time.slice(0, 5) : time;
}

function normalizeSchedule(row: MedicationSchedule): MedicationSchedule {
  return { ...row, time: withoutSeconds(row.time) };
}

function normalizeLog(row: MedicationLog): MedicationLog {
  return {
    ...row,
    schedule_time: row.schedule_time
      ? withoutSeconds(row.schedule_time)
      : null,
  };
}

export class SupabaseDbRepository implements DbRepository {
  async fetchAll(): Promise<DB> {
    const client = requireSupabase();
    const [medications, schedules, logs, statuses] = await Promise.all([
      client.from("medications").select("*").order("created_at", { ascending: true }),
      client
        .from("medication_schedules")
        .select("*")
        .order("time", { ascending: true }),
      client
        .from("medication_logs")
        .select("*")
        .order("taken_at", { ascending: true }),
      client.from("daily_status").select("*").order("date", { ascending: true }),
    ]);

    if (medications.error) throw failure("약 목록 조회", medications.error);
    if (schedules.error) throw failure("복용 일정 조회", schedules.error);
    if (logs.error) throw failure("투약 기록 조회", logs.error);
    if (statuses.error) throw failure("상태 기록 조회", statuses.error);

    return {
      medications: medications.data,
      medication_schedules: schedules.data.map(normalizeSchedule),
      medication_logs: logs.data.map(normalizeLog),
      daily_status: statuses.data,
    };
  }

  async addMedication(input: AddMedicationInput): Promise<Medication> {
    const { data, error } = await requireSupabase()
      .from("medications")
      .insert({
        name: input.name,
        unit: input.unit,
        quantity_options: input.quantity_options,
        active: input.active ?? true,
      })
      .select()
      .single();
    if (error) throw failure("약 추가", error);
    return data;
  }

  async updateMedication(
    id: string,
    patch: UpdateMedicationInput
  ): Promise<Medication> {
    const { data, error } = await requireSupabase()
      .from("medications")
      .update(definedPatch(patch))
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("약 수정", error);
    return data;
  }

  async deactivateMedication(id: string): Promise<Medication> {
    return this.updateMedication(id, { active: false });
  }

  async addSchedule(input: AddScheduleInput): Promise<MedicationSchedule> {
    const { data, error } = await requireSupabase()
      .from("medication_schedules")
      .insert({
        medication_id: input.medication_id,
        time: input.time,
        default_quantity: input.default_quantity,
        active: input.active ?? true,
      })
      .select()
      .single();
    if (error) throw failure("복용 일정 추가", error);
    return normalizeSchedule(data);
  }

  async updateSchedule(
    id: string,
    patch: UpdateScheduleInput
  ): Promise<MedicationSchedule> {
    const { data, error } = await requireSupabase()
      .from("medication_schedules")
      .update(definedPatch(patch))
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("복용 일정 수정", error);
    return normalizeSchedule(data);
  }

  async deleteSchedule(id: string): Promise<MedicationSchedule> {
    const { data, error } = await requireSupabase()
      .from("medication_schedules")
      .delete()
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("복용 일정 삭제", error);
    return normalizeSchedule(data);
  }

  async addLog(input: RequiredAddMedicationLogInput): Promise<MedicationLog> {
    const client = requireSupabase();
    const inserted = await client
      .from("medication_logs")
      .insert(input)
      .select()
      .single();

    if (!inserted.error) return normalizeLog(inserted.data);

    if (inserted.error.code === "23505") {
      const existing = await client
        .from("medication_logs")
        .select("*")
        .eq("client_request_id", input.client_request_id)
        .maybeSingle();
      if (!existing.error && existing.data) return normalizeLog(existing.data);
    }

    throw failure("투약 기록 저장", inserted.error);
  }

  async updateLog(
    id: string,
    patch: UpdateMedicationLogInput
  ): Promise<MedicationLog> {
    const { data, error } = await requireSupabase()
      .from("medication_logs")
      .update(definedPatch(patch))
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("투약 기록 수정", error);
    return normalizeLog(data);
  }

  async softDeleteLog(id: string): Promise<MedicationLog> {
    const { data, error } = await requireSupabase()
      .from("medication_logs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw failure("투약 기록 삭제", error);
    return normalizeLog(data);
  }

  async restoreLog(id: string): Promise<MedicationLog> {
    const { data, error } = await requireSupabase()
      .from("medication_logs")
      .update({ deleted_at: null })
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("투약 기록 복원", error);
    return normalizeLog(data);
  }

  async upsertStatus(input: DailyStatusInput): Promise<DailyStatus> {
    const { data, error } = await requireSupabase()
      .from("daily_status")
      .upsert(input, { onConflict: "date" })
      .select()
      .single();
    if (error) throw failure("상태 기록 저장", error);
    return data;
  }

  async deleteStatus(date: string): Promise<DailyStatus> {
    const { data, error } = await requireSupabase()
      .from("daily_status")
      .delete()
      .eq("date", date)
      .select()
      .single();
    if (error) throw failure("상태 기록 삭제", error);
    return data;
  }
}

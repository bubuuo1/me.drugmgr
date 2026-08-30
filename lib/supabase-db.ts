import type { DbRepository, RequiredAddMedicationLogInput } from "@/lib/db-repository";
import { requireSupabase } from "@/lib/supabase";
import type {
  AddMedicationInput,
  AddScheduleInput,
  CareSpace,
  CareSpaceAccess,
  CareSpaceInvite,
  CareSpaceMember,
  CareSpaceMemberWithProfile,
  CreateCareSpaceInviteInput,
  DB,
  DailyStatus,
  DailyStatusInput,
  Medication,
  MedicationLog,
  MedicationSchedule,
  PendingCareSpaceInvite,
  UpdateMedicationInput,
  UpdateMedicationLogInput,
  UpdateScheduleInput,
} from "@/lib/types";

type QueryError = {
  message: string;
  code?: string;
  status?: number;
};

function failure(operation: string, error: QueryError): Error {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message.toLowerCase();

  if (
    error.status === 401 ||
    (error.status === 403 && operation === "현재 사용자 확인") ||
    code === "bad_jwt" ||
    code === "invalid_token" ||
    code === "session_not_found" ||
    code === "user_not_found" ||
    code === "refresh_token_not_found" ||
    code === "pgrst301" ||
    message.includes("jwt expired") ||
    message.includes("invalid jwt")
  ) {
    return new Error(
      `${operation} 작업에 필요한 로그인 정보를 확인할 수 없습니다. 다시 로그인한 뒤 재시도해 주세요.`
    );
  }

  if (
    error.status === 403 ||
    code === "42501" ||
    message.includes("permission denied") ||
    message.includes("insufficient privilege") ||
    message.includes("row-level security")
  ) {
    return new Error(
      `${operation} 작업을 수행할 권한이 없습니다. 현재 복약 공간과 역할을 확인한 뒤 재시도해 주세요.`
    );
  }

  if (
    code === "fetch_error" ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("network request failed")
  ) {
    return new Error(
      `${operation} 작업 중 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 재시도해 주세요.`
    );
  }

  if (
    code.startsWith("22") ||
    code.startsWith("23") ||
    code === "pgrst116"
  ) {
    return new Error(
      `${operation} 작업을 완료할 수 없습니다. 입력값이나 이미 저장된 내용을 확인한 뒤 재시도해 주세요.`
    );
  }

  return new Error(
    `${operation} 작업에 실패했습니다. 잠시 후 다시 시도해 주세요.`
  );
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

function normalizedNullableText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function isSameLogRequest(
  row: MedicationLog,
  input: RequiredAddMedicationLogInput
): boolean {
  return (
    row.medication_id === input.medication_id &&
    row.schedule_id === input.schedule_id &&
    new Date(row.taken_at).getTime() === new Date(input.taken_at).getTime() &&
    Number(row.quantity) === Number(input.quantity) &&
    normalizedNullableText(row.note) === normalizedNullableText(input.note) &&
    row.is_extra === input.is_extra
  );
}

function existingLogForRequest(
  row: MedicationLog,
  input: RequiredAddMedicationLogInput
): MedicationLog {
  if (isSameLogRequest(row, input)) return normalizeLog(row);
  throw new Error(
    "같은 요청 ID로 이미 다른 내용의 투약 기록이 저장되어 있습니다. 기록을 새로고침한 뒤 다시 시도해 주세요."
  );
}

export class SupabaseDbRepository implements DbRepository {
  async fetchCareSpaces(): Promise<CareSpaceAccess[]> {
    const client = requireSupabase();
    const currentUser = await client.auth.getUser();
    if (currentUser.error) {
      throw failure("현재 사용자 확인", currentUser.error);
    }
    if (!currentUser.data.user) {
      throw new Error("로그인이 필요합니다.");
    }

    const { data, error } = await client
      .from("care_space_members")
      .select("role, care_space:care_spaces(*)")
      .eq("user_id", currentUser.data.user.id)
      .order("created_at", { ascending: true });
    if (error) throw failure("복약 공간 목록 조회", error);

    return data.flatMap((membership) =>
      membership.care_space
        ? [{ ...membership.care_space, role: membership.role }]
        : []
    );
  }

  async updateCareSpace(careSpaceId: string, name: string): Promise<CareSpace> {
    const { data, error } = await requireSupabase()
      .from("care_spaces")
      .update({ name })
      .eq("id", careSpaceId)
      .select()
      .single();
    if (error) throw failure("복약 공간 이름 변경", error);
    return data;
  }

  async fetchPendingCareSpaceInvites(): Promise<PendingCareSpaceInvite[]> {
    const { data, error } = await requireSupabase().rpc(
      "get_pending_care_space_invites",
      {}
    );
    if (error) throw failure("받은 가족 초대 조회", error);
    return data;
  }

  async fetchCareSpaceMembers(
    careSpaceId: string
  ): Promise<CareSpaceMemberWithProfile[]> {
    const { data, error } = await requireSupabase()
      .from("care_space_members")
      .select("*, profile:profiles(*)")
      .eq("care_space_id", careSpaceId)
      .order("created_at", { ascending: true });
    if (error) throw failure("가족 구성원 조회", error);
    return data;
  }

  async fetchCareSpaceInvites(
    careSpaceId: string
  ): Promise<CareSpaceInvite[]> {
    const { data, error } = await requireSupabase()
      .from("care_space_invites")
      .select("*")
      .eq("care_space_id", careSpaceId)
      .order("created_at", { ascending: false });
    if (error) throw failure("가족 초대 내역 조회", error);
    return data;
  }

  async createCareSpaceInvite(
    careSpaceId: string,
    input: CreateCareSpaceInviteInput
  ): Promise<CareSpaceInvite> {
    const { data, error } = await requireSupabase().rpc(
      "create_care_space_invite",
      {
        p_care_space_id: careSpaceId,
        p_email: input.email,
        p_role: input.role,
        ...(input.expires_at === undefined
          ? {}
          : { p_expires_at: input.expires_at }),
      }
    );
    if (error) throw failure("가족 초대 생성", error);
    return data;
  }

  async acceptCareSpaceInvite(inviteId: string): Promise<CareSpaceMember> {
    const { data, error } = await requireSupabase().rpc(
      "accept_care_space_invite",
      { p_invite_id: inviteId }
    );
    if (error) throw failure("가족 초대 수락", error);
    return data;
  }

  async declineCareSpaceInvite(inviteId: string): Promise<CareSpaceInvite> {
    const { data, error } = await requireSupabase().rpc(
      "decline_care_space_invite",
      { p_invite_id: inviteId }
    );
    if (error) throw failure("가족 초대 거절", error);
    return data;
  }

  async revokeCareSpaceInvite(inviteId: string): Promise<CareSpaceInvite> {
    const { data, error } = await requireSupabase().rpc(
      "revoke_care_space_invite",
      { p_invite_id: inviteId }
    );
    if (error) throw failure("가족 초대 취소", error);
    return data;
  }

  async removeCareSpaceMember(
    careSpaceId: string,
    userId: string
  ): Promise<CareSpaceMember> {
    const { data, error } = await requireSupabase().rpc(
      "remove_care_space_member",
      { p_care_space_id: careSpaceId, p_user_id: userId }
    );
    if (error) throw failure("가족 구성원 제거", error);
    return data;
  }

  async fetchAll(careSpaceId: string): Promise<DB> {
    const client = requireSupabase();
    const [medications, schedules, logs, statuses] = await Promise.all([
      client
        .from("medications")
        .select("*")
        .eq("care_space_id", careSpaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      client
        .from("medication_schedules")
        .select("*")
        .eq("care_space_id", careSpaceId)
        .order("time", { ascending: true }),
      client
        .from("medication_logs")
        .select("*")
        .eq("care_space_id", careSpaceId)
        .is("deleted_at", null)
        .order("taken_at", { ascending: true }),
      client
        .from("daily_status")
        .select("*")
        .eq("care_space_id", careSpaceId)
        .order("date", { ascending: true }),
    ]);

    if (medications.error) throw failure("약 목록 조회", medications.error);
    if (schedules.error) throw failure("복용 일정 조회", schedules.error);
    if (logs.error) throw failure("투약 기록 조회", logs.error);
    if (statuses.error) throw failure("상태 기록 조회", statuses.error);

    const visibleMedicationIds = new Set(
      medications.data.map((medication) => medication.id)
    );

    return {
      medications: medications.data,
      medication_schedules: schedules.data
        .filter((schedule) => visibleMedicationIds.has(schedule.medication_id))
        .map(normalizeSchedule),
      medication_logs: logs.data.map(normalizeLog),
      daily_status: statuses.data,
    };
  }

  async addMedication(
    careSpaceId: string,
    input: AddMedicationInput
  ): Promise<Medication> {
    const { data, error } = await requireSupabase()
      .from("medications")
      .insert({
        care_space_id: careSpaceId,
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
    careSpaceId: string,
    id: string,
    patch: UpdateMedicationInput
  ): Promise<Medication> {
    const { data, error } = await requireSupabase()
      .from("medications")
      .update(definedPatch(patch))
      .eq("care_space_id", careSpaceId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("약 수정", error);
    return data;
  }

  async deactivateMedication(
    careSpaceId: string,
    id: string
  ): Promise<Medication> {
    return this.updateMedication(careSpaceId, id, { active: false });
  }

  async deleteMedication(
    careSpaceId: string,
    id: string
  ): Promise<Medication> {
    const { data, error } = await requireSupabase().rpc(
      "soft_delete_medication",
      { p_care_space_id: careSpaceId, p_medication_id: id }
    );
    if (error) throw failure("약 삭제", error);
    return data;
  }

  async addSchedule(
    careSpaceId: string,
    input: AddScheduleInput
  ): Promise<MedicationSchedule> {
    const { data, error } = await requireSupabase()
      .from("medication_schedules")
      .insert({
        care_space_id: careSpaceId,
        medication_id: input.medication_id,
        time: input.time,
        active: input.active ?? true,
      })
      .select()
      .single();
    if (error) throw failure("복용 일정 추가", error);
    return normalizeSchedule(data);
  }

  async updateSchedule(
    careSpaceId: string,
    id: string,
    patch: UpdateScheduleInput
  ): Promise<MedicationSchedule> {
    const { data, error } = await requireSupabase()
      .from("medication_schedules")
      .update(definedPatch(patch))
      .eq("care_space_id", careSpaceId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("복용 일정 수정", error);
    return normalizeSchedule(data);
  }

  async deleteSchedule(
    careSpaceId: string,
    id: string
  ): Promise<MedicationSchedule> {
    const { data, error } = await requireSupabase()
      .from("medication_schedules")
      .delete()
      .eq("care_space_id", careSpaceId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("복용 일정 삭제", error);
    return normalizeSchedule(data);
  }

  async addLog(
    careSpaceId: string,
    input: RequiredAddMedicationLogInput
  ): Promise<MedicationLog> {
    const client = requireSupabase();
    const existingBeforeInsert = await client
      .from("medication_logs")
      .select("*")
      .eq("care_space_id", careSpaceId)
      .eq("client_request_id", input.client_request_id)
      .maybeSingle();
    if (existingBeforeInsert.error) {
      throw failure("투약 기록 중복 확인", existingBeforeInsert.error);
    }
    if (existingBeforeInsert.data) {
      return existingLogForRequest(existingBeforeInsert.data, input);
    }

    const inserted = await client
      .from("medication_logs")
      .insert({ ...input, care_space_id: careSpaceId })
      .select()
      .single();

    if (!inserted.error) return normalizeLog(inserted.data);

    if (inserted.error.code === "23505") {
      const existing = await client
        .from("medication_logs")
        .select("*")
        .eq("care_space_id", careSpaceId)
        .eq("client_request_id", input.client_request_id)
        .maybeSingle();
      if (existing.error) {
        throw failure("투약 기록 중복 확인", existing.error);
      }
      if (existing.data) {
        return existingLogForRequest(existing.data, input);
      }
    }

    throw failure("투약 기록 저장", inserted.error);
  }

  async updateLog(
    careSpaceId: string,
    id: string,
    patch: UpdateMedicationLogInput
  ): Promise<MedicationLog> {
    const { data, error } = await requireSupabase()
      .from("medication_logs")
      .update(definedPatch(patch))
      .eq("care_space_id", careSpaceId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("투약 기록 수정", error);
    return normalizeLog(data);
  }

  async softDeleteLog(
    careSpaceId: string,
    id: string
  ): Promise<MedicationLog> {
    const { data, error } = await requireSupabase()
      .from("medication_logs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("care_space_id", careSpaceId)
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();
    if (error) throw failure("투약 기록 삭제", error);
    return normalizeLog(data);
  }

  async restoreLog(
    careSpaceId: string,
    id: string
  ): Promise<MedicationLog> {
    const { data, error } = await requireSupabase()
      .from("medication_logs")
      .update({ deleted_at: null })
      .eq("care_space_id", careSpaceId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw failure("투약 기록 복원", error);
    return normalizeLog(data);
  }

  async upsertStatus(
    careSpaceId: string,
    input: DailyStatusInput
  ): Promise<DailyStatus> {
    const { data, error } = await requireSupabase().rpc(
      "upsert_daily_status",
      {
        p_breathing: input.breathing,
        p_care_space_id: careSpaceId,
        p_date: input.date,
        p_eye_symptom: input.eye_symptom,
        p_fatigue: input.fatigue,
        p_note: input.note,
        p_strength: input.strength,
      }
    );
    if (error) throw failure("상태 기록 저장", error);
    return data;
  }

  async deleteStatus(
    careSpaceId: string,
    date: string
  ): Promise<DailyStatus> {
    const { data, error } = await requireSupabase()
      .from("daily_status")
      .delete()
      .eq("care_space_id", careSpaceId)
      .eq("date", date)
      .select()
      .single();
    if (error) throw failure("상태 기록 삭제", error);
    return data;
  }
}

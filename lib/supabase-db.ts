import type { DbRepository, RequiredAddMedicationLogInput } from "@/lib/db-repository";
import { requireSupabase } from "@/lib/supabase";
import type {
  AddMedicationInput,
  AddScheduleInput,
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
      if (!existing.error && existing.data) return normalizeLog(existing.data);
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
    const { data, error } = await requireSupabase()
      .from("daily_status")
      .upsert(
        { ...input, care_space_id: careSpaceId },
        { onConflict: "care_space_id,date" }
      )
      .select()
      .single();
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

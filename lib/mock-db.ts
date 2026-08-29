import type { DbRepository, RequiredAddMedicationLogInput } from "@/lib/db-repository";
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
  Profile,
  UpdateMedicationInput,
  UpdateMedicationLogInput,
  UpdateScheduleInput,
} from "@/lib/types";

const SEED_TIME = "2026-01-01T00:00:00.000Z";
export const MOCK_USER_ID = "mock-user";
export const MOCK_USER_EMAIL = "mock@example.com";
export const MOCK_CARE_SPACE_ID = "mock-care-space";
export const MOCK_SECOND_CARE_SPACE_ID = "mock-second-care-space";
const MOCK_FAMILY_USER_ID = "mock-family-user";

const profiles: Profile[] = [
  {
    user_id: MOCK_USER_ID,
    display_name: "테스트 사용자",
    avatar_url: null,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
  {
    user_id: MOCK_FAMILY_USER_ID,
    display_name: "테스트 보호자",
    avatar_url: null,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
];

const careSpaces: CareSpace[] = [
  {
    id: MOCK_CARE_SPACE_ID,
    name: "나의 복약 공간",
    created_by: MOCK_USER_ID,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
  {
    id: MOCK_SECOND_CARE_SPACE_ID,
    name: "두 번째 복약 공간",
    created_by: MOCK_USER_ID,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
];

const careSpaceMembers: CareSpaceMember[] = [
  {
    care_space_id: MOCK_CARE_SPACE_ID,
    user_id: MOCK_USER_ID,
    role: "owner",
    invited_by: null,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
  {
    care_space_id: MOCK_SECOND_CARE_SPACE_ID,
    user_id: MOCK_USER_ID,
    role: "owner",
    invited_by: null,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
  {
    care_space_id: MOCK_CARE_SPACE_ID,
    user_id: MOCK_FAMILY_USER_ID,
    role: "caregiver",
    invited_by: MOCK_USER_ID,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
];

const careSpaceInvites: CareSpaceInvite[] = [];

const memoryDb: DB = {
  medications: [
    {
      id: "med-mestinon",
      care_space_id: MOCK_CARE_SPACE_ID,
      created_by: MOCK_USER_ID,
      updated_by: MOCK_USER_ID,
      name: "메스티논",
      unit: "정",
      active: true,
      quantity_options: [0.5, 1, 1.5, 2],
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    },
    {
      id: "med-solon",
      care_space_id: MOCK_CARE_SPACE_ID,
      created_by: MOCK_USER_ID,
      updated_by: MOCK_USER_ID,
      name: "소론도",
      unit: "정",
      active: true,
      quantity_options: [1, 2, 3, 4, 5, 6, 7, 8],
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    },
    {
      id: "med-ceftrin",
      care_space_id: MOCK_CARE_SPACE_ID,
      created_by: MOCK_USER_ID,
      updated_by: MOCK_USER_ID,
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

function careSpaceById(careSpaceId: string): CareSpace {
  return careSpaces.find((space) => space.id === careSpaceId) ?? missing("복약 공간");
}

function profileById(userId: string): Profile | null {
  return profiles.find((profile) => profile.user_id === userId) ?? null;
}

function medicationById(
  careSpaceId: string,
  medicationId: string
): Medication {
  return (
    memoryDb.medications.find(
      (medication) =>
        medication.care_space_id === careSpaceId && medication.id === medicationId
    ) ??
    missing("약")
  );
}

function scheduleById(
  careSpaceId: string,
  scheduleId: string
): MedicationSchedule {
  return (
    memoryDb.medication_schedules.find(
      (schedule) =>
        schedule.care_space_id === careSpaceId && schedule.id === scheduleId
    ) ??
    missing("복용 일정")
  );
}

function logById(careSpaceId: string, logId: string): MedicationLog {
  return (
    memoryDb.medication_logs.find(
      (log) => log.care_space_id === careSpaceId && log.id === logId
    ) ?? missing("투약 기록")
  );
}

function inviteById(inviteId: string): CareSpaceInvite {
  return careSpaceInvites.find((invite) => invite.id === inviteId) ?? missing("가족 초대");
}

function replaceById<T extends { id: string }>(rows: T[], row: T): void {
  const index = rows.findIndex((candidate) => candidate.id === row.id);
  if (index < 0) missing("행");
  rows[index] = row;
}

export class MockDbRepository implements DbRepository {
  async fetchCareSpaces(): Promise<CareSpaceAccess[]> {
    const spaces = careSpaceMembers
      .filter((member) => member.user_id === MOCK_USER_ID)
      .map((member) => ({
        ...careSpaceById(member.care_space_id),
        role: member.role,
      }));
    return clone(spaces);
  }

  async fetchPendingCareSpaceInvites(): Promise<PendingCareSpaceInvite[]> {
    return clone(
      careSpaceInvites
        .filter(
          (invite) =>
            invite.status === "pending" &&
            invite.email.toLocaleLowerCase() === MOCK_USER_EMAIL
        )
        .map((invite) => ({
          ...invite,
          care_space_name: careSpaceById(invite.care_space_id).name,
          inviter_display_name:
            profileById(invite.invited_by)?.display_name ?? null,
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    );
  }

  async fetchCareSpaceMembers(
    careSpaceId: string
  ): Promise<CareSpaceMemberWithProfile[]> {
    careSpaceById(careSpaceId);
    return clone(
      careSpaceMembers
        .filter((member) => member.care_space_id === careSpaceId)
        .map((member) => ({ ...member, profile: profileById(member.user_id) }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    );
  }

  async fetchCareSpaceInvites(
    careSpaceId: string
  ): Promise<CareSpaceInvite[]> {
    careSpaceById(careSpaceId);
    return clone(
      careSpaceInvites
        .filter((invite) => invite.care_space_id === careSpaceId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    );
  }

  async createCareSpaceInvite(
    careSpaceId: string,
    input: CreateCareSpaceInviteInput
  ): Promise<CareSpaceInvite> {
    careSpaceById(careSpaceId);
    const email = input.email.trim().toLocaleLowerCase();
    if (
      careSpaceInvites.some(
        (invite) =>
          invite.care_space_id === careSpaceId &&
          invite.email.toLocaleLowerCase() === email &&
          invite.status === "pending"
      )
    ) {
      throw new Error("이미 대기 중인 가족 초대가 있습니다.");
    }

    const timestamp = now();
    const invite: CareSpaceInvite = {
      id: id(),
      care_space_id: careSpaceId,
      email,
      role: input.role,
      status: "pending",
      invited_by: MOCK_USER_ID,
      accepted_by: null,
      expires_at:
        input.expires_at ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      responded_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    careSpaceInvites.push(invite);
    return clone(invite);
  }

  async acceptCareSpaceInvite(inviteId: string): Promise<CareSpaceMember> {
    const current = inviteById(inviteId);
    if (current.status !== "pending") {
      throw new Error("대기 중인 가족 초대가 아닙니다.");
    }
    if (new Date(current.expires_at).getTime() <= Date.now()) {
      const timestamp = now();
      replaceById(careSpaceInvites, {
        ...current,
        status: "expired",
        responded_at: timestamp,
        updated_at: timestamp,
      });
      throw new Error("가족 초대가 만료되었습니다.");
    }

    const timestamp = now();
    replaceById(careSpaceInvites, {
      ...current,
      status: "accepted",
      accepted_by: MOCK_USER_ID,
      responded_at: timestamp,
      updated_at: timestamp,
    });
    const existing = careSpaceMembers.find(
      (member) =>
        member.care_space_id === current.care_space_id &&
        member.user_id === MOCK_USER_ID
    );
    if (existing) return clone(existing);

    const member: CareSpaceMember = {
      care_space_id: current.care_space_id,
      user_id: MOCK_USER_ID,
      role: current.role,
      invited_by: current.invited_by,
      created_at: timestamp,
      updated_at: timestamp,
    };
    careSpaceMembers.push(member);
    return clone(member);
  }

  async declineCareSpaceInvite(inviteId: string): Promise<CareSpaceInvite> {
    const current = inviteById(inviteId);
    if (current.status !== "pending") {
      throw new Error("대기 중인 가족 초대가 아닙니다.");
    }
    const timestamp = now();
    const updated: CareSpaceInvite = {
      ...current,
      status: "declined",
      responded_at: timestamp,
      updated_at: timestamp,
    };
    replaceById(careSpaceInvites, updated);
    return clone(updated);
  }

  async revokeCareSpaceInvite(inviteId: string): Promise<CareSpaceInvite> {
    const current = inviteById(inviteId);
    if (current.status !== "pending") {
      throw new Error("대기 중인 가족 초대가 아닙니다.");
    }
    const timestamp = now();
    const updated: CareSpaceInvite = {
      ...current,
      status: "revoked",
      responded_at: timestamp,
      updated_at: timestamp,
    };
    replaceById(careSpaceInvites, updated);
    return clone(updated);
  }

  async removeCareSpaceMember(
    careSpaceId: string,
    userId: string
  ): Promise<CareSpaceMember> {
    careSpaceById(careSpaceId);
    const index = careSpaceMembers.findIndex(
      (member) =>
        member.care_space_id === careSpaceId && member.user_id === userId
    );
    if (index < 0) return missing("가족 구성원");
    const member = careSpaceMembers[index];
    if (member.role === "owner") {
      throw new Error("공간 소유자는 제거할 수 없습니다.");
    }
    careSpaceMembers.splice(index, 1);
    return clone(member);
  }

  async fetchAll(careSpaceId: string): Promise<DB> {
    careSpaceById(careSpaceId);
    return clone({
      medications: memoryDb.medications
        .filter((row) => row.care_space_id === careSpaceId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      medication_schedules: memoryDb.medication_schedules
        .filter((row) => row.care_space_id === careSpaceId)
        .sort((a, b) => a.time.localeCompare(b.time)),
      medication_logs: memoryDb.medication_logs
        .filter((row) => row.care_space_id === careSpaceId)
        .sort((a, b) => a.taken_at.localeCompare(b.taken_at)),
      daily_status: memoryDb.daily_status
        .filter((row) => row.care_space_id === careSpaceId)
        .sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  async addMedication(
    careSpaceId: string,
    input: AddMedicationInput
  ): Promise<Medication> {
    careSpaceById(careSpaceId);
    if (
      memoryDb.medications.some(
        (medication) =>
          medication.care_space_id === careSpaceId &&
          medication.name.toLocaleLowerCase() === input.name.toLocaleLowerCase()
      )
    ) {
      throw new Error("같은 이름의 약이 이미 있습니다.");
    }
    const timestamp = now();
    const medication: Medication = {
      id: id(),
      care_space_id: careSpaceId,
      created_by: MOCK_USER_ID,
      updated_by: MOCK_USER_ID,
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
    careSpaceId: string,
    medicationId: string,
    patch: UpdateMedicationInput
  ): Promise<Medication> {
    const current = medicationById(careSpaceId, medicationId);
    const clean = definedPatch(patch);
    if (
      patch.name &&
      memoryDb.medications.some(
        (medication) =>
          medication.care_space_id === careSpaceId &&
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
      updated_by: MOCK_USER_ID,
      updated_at: now(),
    };
    replaceById(memoryDb.medications, updated);
    return clone(updated);
  }

  async deactivateMedication(
    careSpaceId: string,
    medicationId: string
  ): Promise<Medication> {
    return this.updateMedication(careSpaceId, medicationId, { active: false });
  }

  async addSchedule(
    careSpaceId: string,
    input: AddScheduleInput
  ): Promise<MedicationSchedule> {
    medicationById(careSpaceId, input.medication_id);
    if (
      memoryDb.medication_schedules.some(
        (schedule) =>
          schedule.care_space_id === careSpaceId &&
          schedule.medication_id === input.medication_id && schedule.time === input.time
      )
    ) {
      throw new Error("같은 약과 시각의 일정이 이미 있습니다.");
    }
    const timestamp = now();
    const schedule: MedicationSchedule = {
      id: id(),
      care_space_id: careSpaceId,
      created_by: MOCK_USER_ID,
      updated_by: MOCK_USER_ID,
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
    careSpaceId: string,
    scheduleId: string,
    patch: UpdateScheduleInput
  ): Promise<MedicationSchedule> {
    const current = scheduleById(careSpaceId, scheduleId);
    const clean = definedPatch(patch);
    const medicationId = current.medication_id;
    const time = patch.time ?? current.time;
    medicationById(careSpaceId, medicationId);
    if (
      memoryDb.medication_schedules.some(
        (schedule) =>
          schedule.care_space_id === careSpaceId &&
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
      updated_by: MOCK_USER_ID,
      updated_at: now(),
    };
    replaceById(memoryDb.medication_schedules, updated);
    return clone(updated);
  }

  async deleteSchedule(
    careSpaceId: string,
    scheduleId: string
  ): Promise<MedicationSchedule> {
    const current = scheduleById(careSpaceId, scheduleId);
    memoryDb.medication_schedules = memoryDb.medication_schedules.filter(
      (schedule) =>
        schedule.care_space_id !== careSpaceId || schedule.id !== scheduleId
    );
    memoryDb.medication_logs = memoryDb.medication_logs.map((log) =>
      log.care_space_id === careSpaceId && log.schedule_id === scheduleId
        ? {
            ...log,
            schedule_id: null,
            updated_by: MOCK_USER_ID,
            updated_at: now(),
          }
        : log
    );
    return clone(current);
  }

  async addLog(
    careSpaceId: string,
    input: RequiredAddMedicationLogInput
  ): Promise<MedicationLog> {
    const duplicate = memoryDb.medication_logs.find(
      (log) =>
        log.care_space_id === careSpaceId &&
        log.client_request_id === input.client_request_id
    );
    if (duplicate) return clone(duplicate);

    const medication = medicationById(careSpaceId, input.medication_id);
    const schedule = input.schedule_id
      ? scheduleById(careSpaceId, input.schedule_id)
      : null;
    if (schedule && schedule.medication_id !== medication.id) {
      throw new Error("선택한 일정과 약이 일치하지 않습니다.");
    }
    const timestamp = now();
    const log: MedicationLog = {
      id: id(),
      care_space_id: careSpaceId,
      created_by: MOCK_USER_ID,
      updated_by: MOCK_USER_ID,
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
    careSpaceId: string,
    logId: string,
    patch: UpdateMedicationLogInput
  ): Promise<MedicationLog> {
    const current = logById(careSpaceId, logId);
    const clean = definedPatch(patch);
    const medicationId = patch.medication_id ?? current.medication_id;
    const medication = medicationById(careSpaceId, medicationId);
    const scheduleId = hasOwn(patch, "schedule_id")
      ? patch.schedule_id ?? null
      : current.schedule_id;
    const schedule = scheduleId ? scheduleById(careSpaceId, scheduleId) : null;
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
      updated_by: MOCK_USER_ID,
      updated_at: now(),
    };
    replaceById(memoryDb.medication_logs, updated);
    return clone(updated);
  }

  async softDeleteLog(
    careSpaceId: string,
    logId: string
  ): Promise<MedicationLog> {
    const current = logById(careSpaceId, logId);
    if (current.deleted_at) throw new Error("이미 삭제된 투약 기록입니다.");
    const updated = {
      ...current,
      deleted_at: now(),
      updated_by: MOCK_USER_ID,
      updated_at: now(),
    };
    replaceById(memoryDb.medication_logs, updated);
    return clone(updated);
  }

  async restoreLog(
    careSpaceId: string,
    logId: string
  ): Promise<MedicationLog> {
    const current = logById(careSpaceId, logId);
    const updated = {
      ...current,
      deleted_at: null,
      updated_by: MOCK_USER_ID,
      updated_at: now(),
    };
    replaceById(memoryDb.medication_logs, updated);
    return clone(updated);
  }

  async upsertStatus(
    careSpaceId: string,
    input: DailyStatusInput
  ): Promise<DailyStatus> {
    careSpaceById(careSpaceId);
    const current = memoryDb.daily_status.find(
      (status) =>
        status.care_space_id === careSpaceId && status.date === input.date
    );
    const timestamp = now();
    const status: DailyStatus = current
      ? {
          ...current,
          ...input,
          updated_by: MOCK_USER_ID,
          updated_at: timestamp,
        }
      : {
          id: id(),
          care_space_id: careSpaceId,
          created_by: MOCK_USER_ID,
          updated_by: MOCK_USER_ID,
          ...input,
          created_at: timestamp,
          updated_at: timestamp,
        };
    if (current) replaceById(memoryDb.daily_status, status);
    else memoryDb.daily_status.push(status);
    return clone(status);
  }

  async deleteStatus(
    careSpaceId: string,
    date: string
  ): Promise<DailyStatus> {
    const current =
      memoryDb.daily_status.find(
        (status) =>
          status.care_space_id === careSpaceId && status.date === date
      ) ??
      missing("상태 기록");
    memoryDb.daily_status = memoryDb.daily_status.filter(
      (status) => status.care_space_id !== careSpaceId || status.date !== date
    );
    return clone(current);
  }
}

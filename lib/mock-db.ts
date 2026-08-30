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
const MOCK_INVITE_SOURCE_CARE_SPACE_ID = "mock-invite-source-care-space";
const MOCK_FAMILY_USER_ID = "mock-family-user";
const MOCK_SECOND_OWNER_ID = "mock-second-owner";

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
  {
    user_id: MOCK_SECOND_OWNER_ID,
    display_name: "초대한 가족",
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
    created_by: MOCK_SECOND_OWNER_ID,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
  {
    id: MOCK_INVITE_SOURCE_CARE_SPACE_ID,
    name: "요청자 비공개 공간",
    created_by: MOCK_SECOND_OWNER_ID,
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
    role: "caregiver",
    invited_by: null,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
  {
    care_space_id: MOCK_SECOND_CARE_SPACE_ID,
    user_id: MOCK_SECOND_OWNER_ID,
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
  {
    care_space_id: MOCK_INVITE_SOURCE_CARE_SPACE_ID,
    user_id: MOCK_SECOND_OWNER_ID,
    role: "owner",
    invited_by: null,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
];

const careSpaceInvites: CareSpaceInvite[] = [
  {
    id: "mock-incoming-management-request",
    care_space_id: MOCK_INVITE_SOURCE_CARE_SPACE_ID,
    email: MOCK_USER_EMAIL,
    role: "caregiver",
    inviter_caregiver_care_space_id: null,
    status: "pending",
    invited_by: MOCK_SECOND_OWNER_ID,
    accepted_by: null,
    expires_at: "2099-12-31T23:59:59.000Z",
    responded_at: null,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  },
];

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
      deleted_at: null,
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
      deleted_at: null,
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
      deleted_at: null,
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
  medicationId: string,
  includeDeleted = false
): Medication {
  return (
    memoryDb.medications.find(
      (medication) =>
        medication.care_space_id === careSpaceId &&
        medication.id === medicationId &&
        (includeDeleted || medication.deleted_at === null)
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
  return careSpaceInvites.find((invite) => invite.id === inviteId) ?? missing("가족 기록 관리 요청");
}

function replaceById<T extends { id: string }>(rows: T[], row: T): void {
  const index = rows.findIndex((candidate) => candidate.id === row.id);
  if (index < 0) missing("행");
  rows[index] = row;
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

function hasStatusContent(input: DailyStatusInput): boolean {
  return (
    input.fatigue !== null ||
    input.strength !== null ||
    input.breathing !== null ||
    input.eye_symptom !== null ||
    normalizedNullableText(input.note) !== null
  );
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

  async updateCareSpace(careSpaceId: string, name: string): Promise<CareSpace> {
    const current = careSpaceById(careSpaceId);
    const membership = careSpaceMembers.find(
      (member) =>
        member.care_space_id === careSpaceId && member.user_id === MOCK_USER_ID
    );
    if (membership?.role !== "owner") {
      throw new Error("복약 공간 이름은 소유자만 변경할 수 있습니다.");
    }
    const updated = { ...current, name, updated_at: now() };
    replaceById(careSpaces, updated);
    return clone(updated);
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
          id: invite.id,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          expires_at: invite.expires_at,
          created_at: invite.created_at,
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
    if (input.role !== "caregiver") {
      throw new Error("가족 기록 관리 요청은 보호자 권한으로만 보낼 수 있습니다.");
    }
    const email = input.email.trim().toLocaleLowerCase();
    if (email === MOCK_USER_EMAIL) {
      throw new Error("자기 자신에게 가족 기록 관리 요청을 보낼 수 없습니다.");
    }
    const ownerMembership = careSpaceMembers.find(
      (member) =>
        member.care_space_id === careSpaceId &&
        member.user_id === MOCK_USER_ID &&
        member.role === "owner"
    );
    if (!ownerMembership) {
      throw new Error("복약 공간 소유자만 관리 요청을 보낼 수 있습니다.");
    }
    if (
      careSpaceInvites.some(
        (invite) =>
          invite.care_space_id === careSpaceId &&
          invite.email.toLocaleLowerCase() === email &&
          invite.status === "pending"
      )
    ) {
      throw new Error("이미 대기 중인 가족 기록 관리 요청이 있습니다.");
    }

    const timestamp = now();
    const invite: CareSpaceInvite = {
      id: id(),
      care_space_id: careSpaceId,
      email,
      role: input.role,
      inviter_caregiver_care_space_id: null,
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

  async acceptCareSpaceInvite(
    inviteId: string,
    inviterCaregiverCareSpaceId: string | null
  ): Promise<CareSpaceMember> {
    const current = inviteById(inviteId);
    if (
      current.status === "accepted" &&
      current.accepted_by === MOCK_USER_ID
    ) {
      if (
        current.inviter_caregiver_care_space_id !==
        inviterCaregiverCareSpaceId
      ) {
        throw new Error("이미 수락한 관리 대상 공간은 바꿀 수 없습니다.");
      }
      const acceptedMember = careSpaceMembers.find(
        (candidate) =>
          candidate.care_space_id === inviterCaregiverCareSpaceId &&
          candidate.user_id === current.invited_by
      );
      if (!acceptedMember) {
        throw new Error("수락된 보호자 권한을 확인하지 못했습니다.");
      }
      return clone(acceptedMember);
    }
    if (current.status !== "pending") {
      throw new Error("대기 중인 가족 기록 관리 요청이 아닙니다.");
    }
    if (new Date(current.expires_at).getTime() <= Date.now()) {
      const timestamp = now();
      replaceById(careSpaceInvites, {
        ...current,
        status: "expired",
        responded_at: timestamp,
        updated_at: timestamp,
      });
      throw new Error("가족 기록 관리 요청이 만료되었습니다.");
    }
    if (inviterCaregiverCareSpaceId === null) {
      throw new Error("관리 대상으로 공유할 내 복약 공간을 선택해 주세요.");
    }
    if (current.role !== "caregiver") {
      throw new Error("보호자 권한 관리 요청만 수락할 수 있습니다.");
    }
    if (current.email.toLocaleLowerCase() !== MOCK_USER_EMAIL) {
      throw new Error("이 계정으로 받은 관리 요청이 아닙니다.");
    }
    if (current.invited_by === MOCK_USER_ID) {
      throw new Error("자기 자신의 관리 요청은 수락할 수 없습니다.");
    }
    const requesterIsSourceOwner = careSpaceMembers.some(
      (member) =>
        member.care_space_id === current.care_space_id &&
        member.user_id === current.invited_by &&
        member.role === "owner"
    );
    if (!requesterIsSourceOwner) {
      throw new Error("관리 요청을 보낸 소유자 권한을 확인할 수 없습니다.");
    }
    const ownerMembership = careSpaceMembers.find(
      (member) =>
        member.care_space_id === inviterCaregiverCareSpaceId &&
        member.user_id === MOCK_USER_ID &&
        member.role === "owner"
    );
    if (!ownerMembership) {
      throw new Error("본인이 소유한 복약 공간만 공유할 수 있습니다.");
    }
    const requesterOwnsTarget = careSpaceMembers.some(
      (member) =>
        member.care_space_id === inviterCaregiverCareSpaceId &&
        member.user_id === current.invited_by &&
        member.role === "owner"
    );
    if (requesterOwnsTarget) {
      throw new Error("이미 대상 공간을 소유한 사람에게 관리 권한을 줄 수 없습니다.");
    }

    const timestamp = now();
    replaceById(careSpaceInvites, {
      ...current,
      status: "accepted",
      accepted_by: MOCK_USER_ID,
      inviter_caregiver_care_space_id: inviterCaregiverCareSpaceId,
      responded_at: timestamp,
      updated_at: timestamp,
    });
    const existing = careSpaceMembers.find(
      (candidate) =>
        candidate.care_space_id === inviterCaregiverCareSpaceId &&
        candidate.user_id === current.invited_by
    );
    if (existing && existing.role !== "owner") {
      existing.role = "caregiver";
      existing.invited_by = MOCK_USER_ID;
      existing.updated_at = timestamp;
    } else if (!existing) {
      careSpaceMembers.push({
        care_space_id: inviterCaregiverCareSpaceId,
        user_id: current.invited_by,
        role: "caregiver",
        invited_by: MOCK_USER_ID,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
    const member = careSpaceMembers.find(
      (candidate) =>
        candidate.care_space_id === inviterCaregiverCareSpaceId &&
        candidate.user_id === current.invited_by
    );
    if (!member) throw new Error("보호자 권한을 추가하지 못했습니다.");
    return clone(member);
  }

  async declineCareSpaceInvite(inviteId: string): Promise<CareSpaceInvite> {
    const current = inviteById(inviteId);
    if (current.status !== "pending") {
      throw new Error("대기 중인 가족 기록 관리 요청이 아닙니다.");
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
      throw new Error("대기 중인 가족 기록 관리 요청이 아닙니다.");
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
    const visibleMedicationIds = new Set(
      memoryDb.medications
        .filter(
          (medication) =>
            medication.care_space_id === careSpaceId &&
            medication.deleted_at === null
        )
        .map((medication) => medication.id)
    );
    return clone({
      medications: memoryDb.medications
        .filter(
          (row) =>
            row.care_space_id === careSpaceId && row.deleted_at === null
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      medication_schedules: memoryDb.medication_schedules
        .filter(
          (row) =>
            row.care_space_id === careSpaceId &&
            visibleMedicationIds.has(row.medication_id)
        )
        .sort((a, b) => a.time.localeCompare(b.time)),
      medication_logs: memoryDb.medication_logs
        .filter(
          (row) => row.care_space_id === careSpaceId && row.deleted_at === null
        )
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
          medication.deleted_at === null &&
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
      deleted_at: null,
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
          medication.deleted_at === null &&
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

  async deleteMedication(
    careSpaceId: string,
    medicationId: string
  ): Promise<Medication> {
    const current = medicationById(careSpaceId, medicationId);
    const timestamp = now();
    const deleted: Medication = {
      ...current,
      active: false,
      deleted_at: timestamp,
      updated_by: MOCK_USER_ID,
      updated_at: timestamp,
    };
    replaceById(memoryDb.medications, deleted);
    memoryDb.medication_schedules = memoryDb.medication_schedules.map(
      (schedule) =>
        schedule.care_space_id === careSpaceId &&
        schedule.medication_id === medicationId
          ? {
              ...schedule,
              active: false,
              updated_by: MOCK_USER_ID,
              updated_at: timestamp,
            }
          : schedule
    );
    return clone(deleted);
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
    if (duplicate) {
      if (isSameLogRequest(duplicate, input)) return clone(duplicate);
      throw new Error(
        "같은 요청 ID로 이미 다른 내용의 투약 기록이 저장되어 있습니다. 기록을 새로고침한 뒤 다시 시도해 주세요."
      );
    }

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
    const updatesClassification =
      patch.schedule_id !== undefined || patch.is_extra !== undefined;
    if (
      updatesClassification &&
      (patch.schedule_id === undefined || patch.is_extra === undefined)
    ) {
      throw new Error(
        "투약 기록의 일정 연결과 추가 복용 분류는 함께 변경해야 합니다."
      );
    }
    const scheduleId = patch.schedule_id !== undefined
      ? patch.schedule_id ?? null
      : current.schedule_id;
    const schedule = scheduleId ? scheduleById(careSpaceId, scheduleId) : null;
    const isExtra = patch.is_extra ?? current.is_extra;
    if (updatesClassification && scheduleId === null && !isExtra) {
      throw new Error(
        "삭제된 일정의 과거 분류는 직접 만들 수 없습니다."
      );
    }
    if (schedule && isExtra) {
      throw new Error("일정에 연결된 기록은 추가 복용으로 표시할 수 없습니다.");
    }
    if (schedule && schedule.medication_id !== current.medication_id) {
      throw new Error("선택한 일정과 약이 일치하지 않습니다.");
    }

    const scheduleChanged = scheduleId !== current.schedule_id;
    const updated: MedicationLog = {
      ...current,
      ...clean,
      schedule_id: scheduleId,
      is_extra: isExtra,
      schedule_time: schedule
        ? scheduleChanged
          ? schedule.time
          : current.schedule_time
        : isExtra
          ? null
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
    if (!hasStatusContent(input)) {
      throw new Error(
        "상태를 하나 이상 선택하거나 비어 있지 않은 메모를 입력해 주세요."
      );
    }
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

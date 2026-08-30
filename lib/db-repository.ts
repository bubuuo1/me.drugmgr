import type {
  AddMedicationInput,
  AddMedicationLogInput,
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

export interface DbRepository {
  fetchCareSpaces(): Promise<CareSpaceAccess[]>;
  updateCareSpace(careSpaceId: string, name: string): Promise<CareSpace>;
  fetchPendingCareSpaceInvites(): Promise<PendingCareSpaceInvite[]>;
  fetchCareSpaceMembers(
    careSpaceId: string
  ): Promise<CareSpaceMemberWithProfile[]>;
  fetchCareSpaceInvites(careSpaceId: string): Promise<CareSpaceInvite[]>;
  createCareSpaceInvite(
    careSpaceId: string,
    input: CreateCareSpaceInviteInput
  ): Promise<CareSpaceInvite>;
  acceptCareSpaceInvite(
    inviteId: string,
    inviterCaregiverCareSpaceId: string | null
  ): Promise<CareSpaceMember>;
  declineCareSpaceInvite(inviteId: string): Promise<CareSpaceInvite>;
  revokeCareSpaceInvite(inviteId: string): Promise<CareSpaceInvite>;
  removeCareSpaceMember(
    careSpaceId: string,
    userId: string
  ): Promise<CareSpaceMember>;
  fetchAll(careSpaceId: string): Promise<DB>;
  addMedication(
    careSpaceId: string,
    input: AddMedicationInput
  ): Promise<Medication>;
  updateMedication(
    careSpaceId: string,
    id: string,
    patch: UpdateMedicationInput
  ): Promise<Medication>;
  deactivateMedication(careSpaceId: string, id: string): Promise<Medication>;
  deleteMedication(careSpaceId: string, id: string): Promise<Medication>;
  addSchedule(
    careSpaceId: string,
    input: AddScheduleInput
  ): Promise<MedicationSchedule>;
  updateSchedule(
    careSpaceId: string,
    id: string,
    patch: UpdateScheduleInput
  ): Promise<MedicationSchedule>;
  deleteSchedule(careSpaceId: string, id: string): Promise<MedicationSchedule>;
  addLog(
    careSpaceId: string,
    input: RequiredAddMedicationLogInput
  ): Promise<MedicationLog>;
  updateLog(
    careSpaceId: string,
    id: string,
    patch: UpdateMedicationLogInput
  ): Promise<MedicationLog>;
  softDeleteLog(careSpaceId: string, id: string): Promise<MedicationLog>;
  restoreLog(careSpaceId: string, id: string): Promise<MedicationLog>;
  upsertStatus(
    careSpaceId: string,
    input: DailyStatusInput
  ): Promise<DailyStatus>;
  deleteStatus(careSpaceId: string, date: string): Promise<DailyStatus>;
}

export type RequiredAddMedicationLogInput = Omit<
  AddMedicationLogInput,
  "client_request_id" | "schedule_id" | "note" | "taken_at" | "is_extra"
> & {
  client_request_id: string;
  schedule_id: string | null;
  note: string | null;
  taken_at: string;
  is_extra: boolean;
};

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

export interface DbRepository {
  fetchAll(): Promise<DB>;
  addMedication(input: AddMedicationInput): Promise<Medication>;
  updateMedication(
    id: string,
    patch: UpdateMedicationInput
  ): Promise<Medication>;
  deactivateMedication(id: string): Promise<Medication>;
  addSchedule(input: AddScheduleInput): Promise<MedicationSchedule>;
  updateSchedule(
    id: string,
    patch: UpdateScheduleInput
  ): Promise<MedicationSchedule>;
  deleteSchedule(id: string): Promise<MedicationSchedule>;
  addLog(input: RequiredAddMedicationLogInput): Promise<MedicationLog>;
  updateLog(
    id: string,
    patch: UpdateMedicationLogInput
  ): Promise<MedicationLog>;
  softDeleteLog(id: string): Promise<MedicationLog>;
  restoreLog(id: string): Promise<MedicationLog>;
  upsertStatus(input: DailyStatusInput): Promise<DailyStatus>;
  deleteStatus(date: string): Promise<DailyStatus>;
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

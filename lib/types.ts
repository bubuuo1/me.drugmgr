export type Medication = {
  id: string;
  name: string;
  unit: string;
  active: boolean;
  quantity_options?: number[];
  created_at: string;
  updated_at: string;
};

export type MedicationSchedule = {
  id: string;
  medication_id: string;
  time: string;
  default_quantity: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type MedicationLog = {
  id: string;
  medication_id: string;
  schedule_id: string | null;
  taken_at: string;
  quantity: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyStatus = {
  id: string;
  date: string;
  fatigue: string | null;
  strength: string | null;
  breathing: string | null;
  eye_symptom: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_QUANTITY_OPTIONS = [1, 2, 3, 4];

export function quantityOptionsOf(med: Medication): number[] {
  if (Array.isArray(med.quantity_options) && med.quantity_options.length > 0) {
    return med.quantity_options;
  }
  return DEFAULT_QUANTITY_OPTIONS;
}

export function isBooleanOnly(med: Medication): boolean {
  return Array.isArray(med.quantity_options) && med.quantity_options.length === 0;
}

export type DB = {
  medications: Medication[];
  medication_schedules: MedicationSchedule[];
  medication_logs: MedicationLog[];
  daily_status: DailyStatus[];
};

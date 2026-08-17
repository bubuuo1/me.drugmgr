export type Medication = {
  id: string;
  name: string;
  unit: string;
  active: boolean;
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

export type DB = {
  medications: Medication[];
  medication_schedules: MedicationSchedule[];
  medication_logs: MedicationLog[];
  daily_status: DailyStatus[];
};

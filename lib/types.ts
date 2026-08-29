export type Medication = {
  id: string;
  name: string;
  unit: string;
  active: boolean;
  quantity_options: number[];
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
  client_request_id: string;
  medication_id: string;
  schedule_id: string | null;
  medication_name: string;
  medication_unit: string;
  schedule_time: string | null;
  taken_at: string;
  quantity: number;
  note: string | null;
  is_extra: boolean;
  deleted_at: string | null;
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

export type AddMedicationInput = {
  name: string;
  unit: string;
  quantity_options: number[];
  active?: boolean;
};

export type UpdateMedicationInput = Partial<
  Pick<Medication, "name" | "unit" | "quantity_options" | "active">
>;

export type AddScheduleInput = {
  medication_id: string;
  time: string;
  default_quantity: number;
  active?: boolean;
};

export type UpdateScheduleInput = Partial<
  Pick<MedicationSchedule, "time" | "default_quantity" | "active">
>;

export type AddMedicationLogInput = {
  medication_id: string;
  quantity: number;
  schedule_id?: string | null;
  note?: string | null;
  taken_at?: string;
  is_extra?: boolean;
  /**
   * Generate this once per user submission and reuse it when retrying.
   * The database unique constraint makes a repeated request idempotent.
   */
  client_request_id?: string;
};

export type UpdateMedicationLogInput = Partial<
  Pick<
    MedicationLog,
    | "medication_id"
    | "schedule_id"
    | "taken_at"
    | "quantity"
    | "note"
    | "is_extra"
  >
>;

export type DailyStatusInput = Pick<
  DailyStatus,
  "date" | "fatigue" | "strength" | "breathing" | "eye_symptom" | "note"
>;

export const DEFAULT_QUANTITY_OPTIONS = [1, 2, 3, 4] as const;

export function quantityOptionsOf(medication: Medication): number[] {
  return medication.quantity_options.length > 0
    ? medication.quantity_options
    : [...DEFAULT_QUANTITY_OPTIONS];
}

export function isBooleanOnly(medication: Medication): boolean {
  return medication.quantity_options.length === 0;
}

type MedicationInsert = Omit<Medication, "id" | "created_at" | "updated_at"> & {
  id?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
};

type MedicationUpdate = Partial<
  Omit<Medication, "id" | "created_at" | "updated_at">
>;

type MedicationScheduleInsert = Omit<
  MedicationSchedule,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
};

type MedicationScheduleUpdate = Partial<
  Omit<MedicationSchedule, "id" | "created_at" | "updated_at">
>;

type MedicationLogInsert = Pick<
  MedicationLog,
  "client_request_id" | "medication_id" | "quantity" | "is_extra"
> &
  Partial<
    Pick<
      MedicationLog,
      | "id"
      | "schedule_id"
      | "medication_name"
      | "medication_unit"
      | "schedule_time"
      | "taken_at"
      | "note"
      | "deleted_at"
      | "created_at"
      | "updated_at"
    >
  >;

type MedicationLogUpdate = Partial<
  Pick<
    MedicationLog,
    | "medication_id"
    | "schedule_id"
    | "taken_at"
    | "quantity"
    | "note"
    | "is_extra"
    | "deleted_at"
  >
>;

type DailyStatusInsert = Pick<DailyStatus, "date"> &
  Partial<Omit<DailyStatus, "date">>;

type DailyStatusUpdate = Partial<
  Omit<DailyStatus, "id" | "created_at" | "updated_at">
>;

/** Minimal generated-style type used by supabase-js for end-to-end query typing. */
export type Database = {
  public: {
    Tables: {
      medications: {
        Row: Medication;
        Insert: MedicationInsert;
        Update: MedicationUpdate;
        Relationships: [];
      };
      medication_schedules: {
        Row: MedicationSchedule;
        Insert: MedicationScheduleInsert;
        Update: MedicationScheduleUpdate;
        Relationships: [
          {
            foreignKeyName: "medication_schedules_medication_id_fkey";
            columns: ["medication_id"];
            isOneToOne: false;
            referencedRelation: "medications";
            referencedColumns: ["id"];
          },
        ];
      };
      medication_logs: {
        Row: MedicationLog;
        Insert: MedicationLogInsert;
        Update: MedicationLogUpdate;
        Relationships: [
          {
            foreignKeyName: "medication_logs_medication_id_fkey";
            columns: ["medication_id"];
            isOneToOne: false;
            referencedRelation: "medications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_logs_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "medication_schedules";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_status: {
        Row: DailyStatus;
        Insert: DailyStatusInsert;
        Update: DailyStatusUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      register_push_subscription: {
        Args: {
          p_auth: string;
          p_dispatch_secret: string;
          p_endpoint: string;
          p_expiration_time?: string | null;
          p_p256dh: string;
        };
        Returns: boolean;
      };
      unregister_push_subscription: {
        Args: { p_auth: string; p_dispatch_secret: string; p_endpoint: string };
        Returns: boolean;
      };
      get_push_subscription_for_test: {
        Args: {
          p_auth: string;
          p_dispatch_secret: string;
          p_endpoint: string;
        };
        Returns: Array<{ auth: string; endpoint: string; p256dh: string }>;
      };
      claim_due_push_notifications: {
        Args: { p_dispatch_secret: string; p_now: string };
        Returns: Array<{
          attempt_count: number;
          auth: string;
          body: string;
          delivery_id: string;
          endpoint: string;
          p256dh: string;
          tag: string;
          title: string;
          url: string;
        }>;
      };
      prepare_push_delivery_for_send: {
        Args: {
          p_attempt_count: number;
          p_delivery_id: string;
          p_dispatch_secret: string;
          p_now: string;
        };
        Returns: Array<{
          attempt_count: number;
          auth: string;
          body: string;
          delivery_id: string;
          endpoint: string;
          p256dh: string;
          tag: string;
          title: string;
          url: string;
        }>;
      };
      complete_push_delivery: {
        Args: {
          p_attempt_count: number;
          p_delivery_id: string;
          p_disable_subscription?: boolean;
          p_dispatch_secret: string;
          p_error_code?: string | null;
          p_response_status?: number | null;
          p_success: boolean;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

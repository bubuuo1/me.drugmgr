export type Profile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type CareSpaceRole = "owner" | "caregiver" | "viewer";
export type CareSpaceInviteRole = Exclude<CareSpaceRole, "owner">;
export type CareSpaceInviteStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";

export type CareSpace = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CareSpaceAccess = CareSpace & {
  role: CareSpaceRole;
};

export type CareSpaceMember = {
  care_space_id: string;
  user_id: string;
  role: CareSpaceRole;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CareSpaceMemberWithProfile = CareSpaceMember & {
  profile: Profile | null;
};

export type CareSpaceInvite = {
  id: string;
  care_space_id: string;
  email: string;
  role: CareSpaceInviteRole;
  reciprocal_management: boolean;
  inviter_caregiver_care_space_id: string | null;
  status: CareSpaceInviteStatus;
  invited_by: string;
  accepted_by: string | null;
  expires_at: string;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FamilyRelationship = {
  id: string;
  other_user_id: string;
  other_display_name: string;
  caller_can_manage_other_records: boolean;
  other_can_manage_caller_records: boolean;
  manageable_care_space_id: string | null;
  manageable_care_space_name: string | null;
  caller_shared_care_space_id: string | null;
  caller_shared_care_space_name: string | null;
  can_upgrade_to_reciprocal: boolean;
  started_at: string;
};

export type PendingCareSpaceInvite = Pick<
  CareSpaceInvite,
  "id" | "email" | "role" | "status" | "expires_at" | "created_at"
> & {
  inviter_display_name: string | null;
};

type CareSpaceScopedAudit = {
  care_space_id: string;
  created_by: string | null;
  updated_by: string | null;
};

export type Medication = CareSpaceScopedAudit & {
  id: string;
  name: string;
  unit: string;
  active: boolean;
  deleted_at: string | null;
  quantity_options: number[];
  created_at: string;
  updated_at: string;
};

export type MedicationSchedule = CareSpaceScopedAudit & {
  id: string;
  medication_id: string;
  time: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type MedicationScheduleOutcomeValue =
  | "not_taken"
  | "medication_unavailable";

export type MedicationScheduleOutcome = CareSpaceScopedAudit & {
  id: string;
  client_request_id: string;
  medication_id: string;
  schedule_id: string | null;
  medication_name: string;
  medication_unit: string;
  schedule_time: string;
  scheduled_date: string;
  outcome: MedicationScheduleOutcomeValue;
  note: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MedicationLog = CareSpaceScopedAudit & {
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

export type DailyStatus = CareSpaceScopedAudit & {
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
  medication_schedule_outcomes: MedicationScheduleOutcome[];
  medication_logs: MedicationLog[];
  daily_status: DailyStatus[];
};

export type AddMedicationInput = {
  name: string;
  unit: string;
  quantity_options: number[];
  active?: boolean;
};

export type CreateCareSpaceInviteInput = {
  email: string;
  role: "caregiver";
  expires_at?: string;
};

export type UpdateMedicationInput = Partial<
  Pick<Medication, "name" | "unit" | "quantity_options" | "active">
>;

export type AddScheduleInput = {
  medication_id: string;
  time: string;
  active?: boolean;
};

export type UpdateScheduleInput = Partial<
  Pick<MedicationSchedule, "time" | "active">
>;

export type AddMedicationScheduleOutcomeInput = {
  schedule_id: string;
  scheduled_date: string;
  outcome: MedicationScheduleOutcomeValue;
  note?: string | null;
  /**
   * Generate this once per user submission and reuse it when retrying.
   * The database unique constraint makes a repeated request idempotent.
   */
  client_request_id?: string;
};

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

type ProfileInsert = Pick<Profile, "user_id" | "display_name"> & {
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ProfileUpdate = Partial<
  Omit<Profile, "user_id" | "created_at" | "updated_at">
>;

type CareSpaceInsert = Pick<CareSpace, "name"> & {
  id?: string;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type CareSpaceUpdate = Partial<Pick<CareSpace, "name">>;

type CareSpaceMemberInsert = Omit<
  CareSpaceMember,
  "created_at" | "updated_at" | "invited_by"
> & {
  invited_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type CareSpaceMemberUpdate = Partial<Pick<CareSpaceMember, "role">>;

type CareSpaceInviteInsert = Pick<
  CareSpaceInvite,
  "care_space_id" | "email" | "role" | "invited_by"
> & {
  id?: string;
  reciprocal_management?: boolean;
  inviter_caregiver_care_space_id?: string | null;
  accepted_by?: string | null;
  expires_at?: string;
  status?: CareSpaceInviteStatus;
  responded_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type CareSpaceInviteUpdate = Partial<
  Pick<
    CareSpaceInvite,
    | "status"
    | "accepted_by"
    | "expires_at"
    | "responded_at"
    | "inviter_caregiver_care_space_id"
  >
>;

type MedicationInsert = Omit<
  Medication,
  | "id"
  | "deleted_at"
  | "created_at"
  | "updated_at"
  | "created_by"
  | "updated_by"
> & {
  id?: string;
  active?: boolean;
  deleted_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type MedicationUpdate = Partial<
  Omit<Medication, "id" | "care_space_id" | "created_at" | "updated_at">
>;

type MedicationScheduleInsert = Omit<
  MedicationSchedule,
  "id" | "created_at" | "updated_at" | "created_by" | "updated_by"
> & {
  id?: string;
  active?: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type MedicationScheduleUpdate = Partial<
  Omit<
    MedicationSchedule,
    "id" | "care_space_id" | "medication_id" | "created_at" | "updated_at"
  >
>;

type MedicationScheduleOutcomeInsert = Pick<
  MedicationScheduleOutcome,
  | "care_space_id"
  | "client_request_id"
  | "schedule_id"
  | "scheduled_date"
  | "outcome"
> &
  Partial<
    Pick<
      MedicationScheduleOutcome,
      | "id"
      | "medication_id"
      | "medication_name"
      | "medication_unit"
      | "schedule_time"
      | "note"
      | "deleted_at"
      | "created_by"
      | "updated_by"
      | "created_at"
      | "updated_at"
    >
  >;

type MedicationScheduleOutcomeUpdate = Partial<
  Pick<MedicationScheduleOutcome, "outcome" | "note" | "deleted_at">
>;

type MedicationLogInsert = Pick<
  MedicationLog,
  | "care_space_id"
  | "client_request_id"
  | "medication_id"
  | "quantity"
  | "is_extra"
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
      | "created_by"
      | "updated_by"
      | "created_at"
      | "updated_at"
    >
  >;

type MedicationLogUpdate = Partial<
  Pick<
    MedicationLog,
    | "schedule_id"
    | "taken_at"
    | "quantity"
    | "note"
    | "is_extra"
    | "deleted_at"
    | "updated_by"
  >
>;

type DailyStatusInsert = Pick<DailyStatus, "care_space_id" | "date"> &
  Partial<Omit<DailyStatus, "care_space_id" | "date">>;

type DailyStatusUpdate = Partial<
  Omit<
    DailyStatus,
    "id" | "care_space_id" | "created_by" | "created_at" | "updated_at"
  >
>;

/** Minimal generated-style type used by supabase-js for end-to-end query typing. */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      care_spaces: {
        Row: CareSpace;
        Insert: CareSpaceInsert;
        Update: CareSpaceUpdate;
        Relationships: [];
      };
      care_space_members: {
        Row: CareSpaceMember;
        Insert: CareSpaceMemberInsert;
        Update: CareSpaceMemberUpdate;
        Relationships: [
          {
            foreignKeyName: "care_space_members_care_space_id_fkey";
            columns: ["care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "care_space_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      care_space_invites: {
        Row: CareSpaceInvite;
        Insert: CareSpaceInviteInsert;
        Update: CareSpaceInviteUpdate;
        Relationships: [
          {
            foreignKeyName: "care_space_invites_care_space_id_fkey";
            columns: ["care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "care_space_invites_inviter_caregiver_care_space_id_fkey";
            columns: ["inviter_caregiver_care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
        ];
      };
      medications: {
        Row: Medication;
        Insert: MedicationInsert;
        Update: MedicationUpdate;
        Relationships: [
          {
            foreignKeyName: "medications_care_space_id_fkey";
            columns: ["care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
        ];
      };
      medication_schedules: {
        Row: MedicationSchedule;
        Insert: MedicationScheduleInsert;
        Update: MedicationScheduleUpdate;
        Relationships: [
          {
            foreignKeyName: "medication_schedules_care_space_id_fkey";
            columns: ["care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_schedules_medication_id_fkey";
            columns: ["medication_id"];
            isOneToOne: false;
            referencedRelation: "medications";
            referencedColumns: ["id"];
          },
        ];
      };
      medication_schedule_outcomes: {
        Row: MedicationScheduleOutcome;
        Insert: MedicationScheduleOutcomeInsert;
        Update: MedicationScheduleOutcomeUpdate;
        Relationships: [
          {
            foreignKeyName: "medication_schedule_outcomes_care_space_id_fkey";
            columns: ["care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_schedule_outcomes_medication_id_fkey";
            columns: ["medication_id"];
            isOneToOne: false;
            referencedRelation: "medications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_schedule_outcomes_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "medication_schedules";
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
            foreignKeyName: "medication_logs_care_space_id_fkey";
            columns: ["care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
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
        Relationships: [
          {
            foreignKeyName: "daily_status_care_space_id_fkey";
            columns: ["care_space_id"];
            isOneToOne: false;
            referencedRelation: "care_spaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_care_space_invite: {
        Args: {
          p_care_space_id: string;
          p_email: string;
          p_reciprocal_management: true;
          p_expires_at?: string;
          p_role: "caregiver";
        };
        Returns: CareSpaceInvite;
      };
      claim_care_space_invite_email_send: {
        Args: { p_dispatch_secret: string; p_invite_id: string };
        Returns: string;
      };
      accept_care_space_invite: {
        Args: {
          p_invite_id: string;
          p_inviter_caregiver_care_space_id: string | null;
          p_reciprocal_management: true;
        };
        Returns: CareSpaceMember;
      };
      get_family_relationships: {
        Args: Record<string, never>;
        Returns: FamilyRelationship[];
      };
      upgrade_family_relationship_to_reciprocal: {
        Args: {
          p_relationship_id: string;
          p_caller_care_space_id: string;
        };
        Returns: string;
      };
      end_family_relationship: {
        Args: { p_relationship_id: string };
        Returns: string;
      };
      decline_care_space_invite: {
        Args: { p_invite_id: string };
        Returns: CareSpaceInvite;
      };
      revoke_care_space_invite: {
        Args: { p_invite_id: string };
        Returns: CareSpaceInvite;
      };
      remove_care_space_member: {
        Args: { p_care_space_id: string; p_user_id: string };
        Returns: CareSpaceMember;
      };
      soft_delete_medication: {
        Args: { p_care_space_id: string; p_medication_id: string };
        Returns: Medication;
      };
      reclassify_medication_log: {
        Args: {
          p_care_space_id: string;
          p_is_extra: boolean;
          p_log_id: string;
          p_note: string | null;
          p_quantity: number | null;
          p_schedule_id: string | null;
          p_taken_at: string | null;
          p_update_note: boolean;
          p_update_quantity: boolean;
          p_update_taken_at: boolean;
        };
        Returns: MedicationLog;
      };
      upsert_daily_status: {
        Args: {
          p_breathing: string | null;
          p_care_space_id: string;
          p_date: string;
          p_eye_symptom: string | null;
          p_fatigue: string | null;
          p_note: string | null;
          p_strength: string | null;
        };
        Returns: DailyStatus;
      };
      get_pending_care_space_invites: {
        Args: Record<string, never>;
        Returns: PendingCareSpaceInvite[];
      };
      register_push_subscription: {
        Args: {
          p_auth: string;
          p_care_space_id: string;
          p_dispatch_secret: string;
          p_endpoint: string;
          p_expiration_time?: string | null;
          p_p256dh: string;
        };
        Returns: boolean;
      };
      unregister_push_subscription: {
        Args: {
          p_auth: string;
          p_care_space_id: string;
          p_dispatch_secret: string;
          p_endpoint: string;
        };
        Returns: boolean;
      };
      unregister_all_push_subscriptions_for_endpoint: {
        Args: {
          p_auth: string;
          p_dispatch_secret: string;
          p_endpoint: string;
        };
        Returns: boolean;
      };
      get_push_subscription_for_test: {
        Args: {
          p_auth: string;
          p_care_space_id: string;
          p_dispatch_secret: string;
          p_endpoint: string;
        };
        Returns: Array<{
          auth: string;
          care_space_id: string;
          endpoint: string;
          p256dh: string;
        }>;
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

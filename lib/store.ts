"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  DB,
  DailyStatus,
  Medication,
  MedicationLog,
} from "@/lib/types";
import { supabase } from "@/lib/supabase";

const STORAGE_KEY = "medicine-app-db-v1";

const SEED_MEDICATIONS: Medication[] = [
  {
    id: "med-mestinon",
    name: "메스티논",
    unit: "정",
    active: true,
    quantity_options: [0.5, 1, 1.5, 2],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "med-solon",
    name: "소론도",
    unit: "정",
    active: true,
    quantity_options: [1, 2, 3, 4, 5, 6, 7, 8],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyDb(): DB {
  return {
    medications: SEED_MEDICATIONS,
    medication_schedules: [],
    medication_logs: [],
    daily_status: [],
  };
}

export function loadDb(): DB {
  if (typeof window === "undefined") return emptyDb();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw) as Partial<DB>;
    return {
      medications: parsed.medications ?? SEED_MEDICATIONS,
      medication_schedules: parsed.medication_schedules ?? [],
      medication_logs: parsed.medication_logs ?? [],
      daily_status: parsed.daily_status ?? [],
    };
  } catch {
    return emptyDb();
  }
}

export function saveDb(db: DB) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // 저장 실패 무시
  }
}

/**
 * Supabase 연동 여부. supabase 클라이언트가 있으면 서버 데이터를 우선 사용하고,
 * 없으면(localStorage만) 기존처럼 동작한다.
 */
export function isSupabaseMode(): boolean {
  return supabase !== null;
}

const TABLES = {
  medications: "medications",
  medication_schedules: "medication_schedules",
  medication_logs: "medication_logs",
  daily_status: "daily_status",
} as const;

export function useDb() {
  const [db, setDb] = useState<DB>(() => loadDb());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncFromServer = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const meds = await supabase.from(TABLES.medications).select("*");
      const schedules = await supabase.from(TABLES.medication_schedules).select("*");
      const logs = await supabase.from(TABLES.medication_logs).select("*");
      const statuses = await supabase.from(TABLES.daily_status).select("*");

      if (meds.error) throw new Error(meds.error.message);
      if (schedules.error) throw new Error(schedules.error.message);
      if (logs.error) throw new Error(logs.error.message);
      if (statuses.error) throw new Error(statuses.error.message);

      const next: DB = {
        medications: (meds.data ?? []) as Medication[],
        medication_schedules: (schedules.data ?? []) as DB["medication_schedules"],
        medication_logs: (logs.data ?? []) as MedicationLog[],
        daily_status: (statuses.data ?? []) as DailyStatus[],
      };
      if (next.medications.length === 0) {
        // 시드는 SQL로 이미 있어야 하지만, 없으면 로컬 시드를 서버로 올린다.
        const inserted = await supabase.from(TABLES.medications).insert(SEED_MEDICATIONS).select();
        if (inserted.error) throw new Error(inserted.error.message);
        next.medications = inserted.data as Medication[];
      }
      setDb(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 캐시 저장 실패 무시
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "동기화 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (supabase) {
      void (async () => {
        await syncFromServer();
      })();
    }
  }, [syncFromServer]);

  function addLog(input: {
    medication_id: string;
    quantity: number;
    schedule_id?: string | null;
    note?: string | null;
    taken_at?: string;
  }): MedicationLog {
    const now = new Date().toISOString();
    const log: MedicationLog = {
      id: uid("log"),
      medication_id: input.medication_id,
      schedule_id: input.schedule_id ?? null,
      taken_at: input.taken_at ?? now,
      quantity: input.quantity,
      note: input.note ?? null,
      created_at: now,
      updated_at: now,
    };
    setDb((prev) => ({
      ...prev,
      medication_logs: [...prev.medication_logs, log],
    }));
    if (supabase) {
      void (async () => {
        const { error } = await supabase.from(TABLES.medication_logs).insert({
          medication_id: log.medication_id,
          schedule_id: log.schedule_id,
          taken_at: log.taken_at,
          quantity: log.quantity,
          note: log.note,
        });
        if (error) {
          setError(`기록 저장 실패: ${error.message}`);
        }
      })();
    }
    return log;
  }

  function updateLog(id: string, patch: Partial<MedicationLog>) {
    setDb((prev) => ({
      ...prev,
      medication_logs: prev.medication_logs.map((l) =>
        l.id === id ? { ...l, ...patch, updated_at: new Date().toISOString() } : l
      ),
    }));
    if (supabase) {
      void (async () => {
        const clean = { ...patch };
        delete clean.id;
        delete clean.created_at;
        const { error } = await supabase
          .from(TABLES.medication_logs)
          .update(clean)
          .eq("id", id);
        if (error) {
          setError(`기록 수정 실패: ${error.message}`);
        }
      })();
    }
  }

  function deleteLog(id: string) {
    setDb((prev) => ({
      ...prev,
      medication_logs: prev.medication_logs.filter((l) => l.id !== id),
    }));
    if (supabase) {
      void (async () => {
        const { error } = await supabase.from(TABLES.medication_logs).delete().eq("id", id);
        if (error) {
          setError(`기록 삭제 실패: ${error.message}`);
        }
      })();
    }
  }

  function upsertStatus(input: {
    date: string;
    fatigue?: string | null;
    strength?: string | null;
    breathing?: string | null;
    eye_symptom?: string | null;
    note?: string | null;
  }): DailyStatus {
    const now = new Date().toISOString();
    const existing = db.daily_status.find((s) => s.date === input.date);
    if (existing) {
      const next: DailyStatus = {
        ...existing,
        fatigue: input.fatigue ?? existing.fatigue,
        strength: input.strength ?? existing.strength,
        breathing: input.breathing ?? existing.breathing,
        eye_symptom: input.eye_symptom ?? existing.eye_symptom,
        note: input.note ?? existing.note,
        updated_at: now,
      };
      setDb((prev) => ({
        ...prev,
        daily_status: prev.daily_status.map((s) => (s.date === input.date ? next : s)),
      }));
      if (supabase) {
        void (async () => {
          const { error } = await supabase
            .from(TABLES.daily_status)
            .update({
              fatigue: next.fatigue,
              strength: next.strength,
              breathing: next.breathing,
              eye_symptom: next.eye_symptom,
              note: next.note,
            })
            .eq("id", existing.id);
          if (error) {
            setError(`상태 저장 실패: ${error.message}`);
          }
        })();
      }
      return next;
    }
    const status: DailyStatus = {
      id: uid("status"),
      date: input.date,
      fatigue: input.fatigue ?? null,
      strength: input.strength ?? null,
      breathing: input.breathing ?? null,
      eye_symptom: input.eye_symptom ?? null,
      note: input.note ?? null,
      created_at: now,
      updated_at: now,
    };
    setDb((prev) => ({
      ...prev,
      daily_status: [...prev.daily_status, status],
    }));
    if (supabase) {
      void (async () => {
        const { error } = await supabase.from(TABLES.daily_status).insert({
          date: status.date,
          fatigue: status.fatigue,
          strength: status.strength,
          breathing: status.breathing,
          eye_symptom: status.eye_symptom,
          note: status.note,
        });
        if (error) {
          setError(`상태 저장 실패: ${error.message}`);
        }
      })();
    }
    return status;
  }

  return {
    db,
    loading,
    error,
    isSupabase: isSupabaseMode(),
    addLog,
    updateLog,
    deleteLog,
    upsertStatus,
  };
}
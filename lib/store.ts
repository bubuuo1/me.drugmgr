"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { DbRepository } from "@/lib/db-repository";
import { fromDateKey, toDateKey } from "@/lib/date";
import { MockDbRepository } from "@/lib/mock-db";
import { dismissScheduleNotifications } from "@/lib/push-client";
import { isMockDbEnabled, supabase } from "@/lib/supabase";
import { SupabaseDbRepository } from "@/lib/supabase-db";
import type {
  AddMedicationInput,
  AddMedicationLogInput,
  AddScheduleInput,
  CareSpaceAccess,
  CareSpaceInvite,
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

const EMPTY_DB: DB = {
  medications: [],
  medication_schedules: [],
  medication_logs: [],
  daily_status: [],
};

const SELECTED_CARE_SPACE_STORAGE_KEY = "medicine:selected-care-space";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repository: DbRepository = isMockDbEnabled
  ? new MockDbRepository()
  : new SupabaseDbRepository();
let repositoryGeneration = 0;

class StaleRepositoryOperationError extends Error {
  constructor() {
    super("로그아웃되어 진행 중인 데이터 요청을 취소했습니다.");
  }
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("알 수 없는 데이터 오류가 발생했습니다.");
}

function assertNonEmpty(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}을(를) 입력해 주세요.`);
  if (trimmed.length > maxLength) {
    throw new Error(`${label}은(는) ${maxLength}자 이하여야 합니다.`);
  }
  return trimmed;
}

function normalizedUnit(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 20) throw new Error("약 단위는 20자 이하여야 합니다.");
  return trimmed;
}

function assertQuantity(value: number, label = "복용량"): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1000) {
    throw new Error(`${label}은(는) 0보다 크고 1000 이하여야 합니다.`);
  }
  return value;
}

function normalizedQuantityOptions(values: number[]): number[] {
  if (!Array.isArray(values) || values.length > 50) {
    throw new Error("복용량 선택지는 50개 이하여야 합니다.");
  }
  const normalized = values.map((value) => assertQuantity(value, "복용량 선택지"));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("복용량 선택지에 중복 값이 있습니다.");
  }
  return normalized;
}

function normalizedTime(value: string): string {
  const trimmed = value.trim();
  if (!TIME_PATTERN.test(trimmed)) {
    throw new Error("복용 시각은 HH:mm 형식이어야 합니다.");
  }
  return trimmed.slice(0, 5);
}

function normalizedNote(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length > 2000) throw new Error("메모는 2000자 이하여야 합니다.");
  return trimmed || null;
}

function normalizedInviteInput(
  input: CreateCareSpaceInviteInput
): CreateCareSpaceInviteInput {
  const email = input.email.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("초대할 Google 계정 이메일을 확인해 주세요.");
  }
  if (input.role !== "caregiver" && input.role !== "viewer") {
    throw new Error("유효한 가족 역할을 선택해 주세요.");
  }
  if (input.expires_at !== undefined) assertIsoDate(input.expires_at);
  return { ...input, email };
}

function assertIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("유효한 복용 시각이 아닙니다.");
  return date.toISOString();
}

function requestId(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function replaceRow<T extends { id: string }>(rows: T[], row: T): T[] {
  const exists = rows.some((candidate) => candidate.id === row.id);
  return exists
    ? rows.map((candidate) => (candidate.id === row.id ? row : candidate))
    : [...rows, row];
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertPatch(patch: object): void {
  if (!Object.values(patch).some((value) => value !== undefined)) {
    throw new Error("변경할 값을 입력해 주세요.");
  }
}

function validateStatus(input: DailyStatusInput): DailyStatusInput {
  fromDateKey(input.date);
  const allowedThree = new Set(["좋음", "보통", "나쁨"]);
  if (input.fatigue !== null && !allowedThree.has(input.fatigue)) {
    throw new Error("유효하지 않은 피로 상태입니다.");
  }
  if (input.strength !== null && !allowedThree.has(input.strength)) {
    throw new Error("유효하지 않은 근력 상태입니다.");
  }
  if (
    input.breathing !== null &&
    input.breathing !== "편안함" &&
    input.breathing !== "평소와 다름"
  ) {
    throw new Error("유효하지 않은 호흡 상태입니다.");
  }
  if (
    input.eye_symptom !== null &&
    input.eye_symptom !== "없음" &&
    input.eye_symptom !== "있음"
  ) {
    throw new Error("유효하지 않은 눈 증상 상태입니다.");
  }
  return { ...input, note: normalizedNote(input.note) };
}

export type DbContextValue = {
  db: DB;
  careSpaces: CareSpaceAccess[];
  selectedCareSpace: CareSpaceAccess | null;
  careSpaceMembers: CareSpaceMemberWithProfile[];
  careSpaceInvites: CareSpaceInvite[];
  pendingCareSpaceInvites: PendingCareSpaceInvite[];
  canManageSettings: boolean;
  canWriteRecords: boolean;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  isSupabase: boolean;
  refresh(): Promise<void>;
  selectCareSpace(id: string): Promise<void>;
  refreshCareSpaces(): Promise<void>;
  refreshFamily(): Promise<void>;
  purgeSensitiveState(): void;
  createCareSpaceInvite(input: CreateCareSpaceInviteInput): Promise<CareSpaceInvite>;
  acceptCareSpaceInvite(inviteId: string): Promise<void>;
  declineCareSpaceInvite(inviteId: string): Promise<void>;
  revokeCareSpaceInvite(inviteId: string): Promise<void>;
  removeCareSpaceMember(userId: string): Promise<void>;
  clearError(): void;
  addMedication(input: AddMedicationInput): Promise<Medication>;
  updateMedication(id: string, patch: UpdateMedicationInput): Promise<Medication>;
  deactivateMedication(id: string): Promise<Medication>;
  addSchedule(input: AddScheduleInput): Promise<MedicationSchedule>;
  updateSchedule(id: string, patch: UpdateScheduleInput): Promise<MedicationSchedule>;
  deleteSchedule(id: string): Promise<MedicationSchedule>;
  addLog(input: AddMedicationLogInput): Promise<MedicationLog>;
  updateLog(id: string, patch: UpdateMedicationLogInput): Promise<MedicationLog>;
  deleteLog(id: string): Promise<MedicationLog>;
  softDeleteLog(id: string): Promise<MedicationLog>;
  restoreLog(id: string): Promise<MedicationLog>;
  upsertStatus(input: DailyStatusInput): Promise<DailyStatus>;
  deleteStatus(date: string): Promise<DailyStatus>;
};

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({ children }: PropsWithChildren) {
  const [db, setDb] = useState<DB>(EMPTY_DB);
  const [careSpaces, setCareSpaces] = useState<CareSpaceAccess[]>([]);
  const [selectedCareSpaceId, setSelectedCareSpaceId] = useState<string | null>(
    null
  );
  const [careSpaceMembersBySpace, setCareSpaceMembersBySpace] = useState<
    Record<string, CareSpaceMemberWithProfile[]>
  >({});
  const [careSpaceInvitesBySpace, setCareSpaceInvitesBySpace] = useState<
    Record<string, CareSpaceInvite[]>
  >({});
  const [pendingCareSpaceInvites, setPendingCareSpaceInvites] = useState<
    PendingCareSpaceInvite[]
  >([]);
  const [pendingCount, setPendingCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [privacyLocked, setPrivacyLocked] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const loading = pendingCount > 0;
  const selectedCareSpace = useMemo(
    () =>
      careSpaces.find((space) => space.id === selectedCareSpaceId) ?? null,
    [careSpaces, selectedCareSpaceId]
  );
  const careSpaceMembers = useMemo(
    () =>
      selectedCareSpaceId
        ? (careSpaceMembersBySpace[selectedCareSpaceId] ?? [])
        : [],
    [careSpaceMembersBySpace, selectedCareSpaceId]
  );
  const careSpaceInvites = useMemo(
    () =>
      selectedCareSpaceId
        ? (careSpaceInvitesBySpace[selectedCareSpaceId] ?? [])
        : [],
    [careSpaceInvitesBySpace, selectedCareSpaceId]
  );
  const canManageSettings = selectedCareSpace?.role === "owner";
  const canWriteRecords =
    selectedCareSpace?.role === "owner" ||
    selectedCareSpace?.role === "caregiver";

  const begin = useCallback(() => {
    setPendingCount((count) => count + 1);
    setError(null);
  }, []);

  const finish = useCallback(() => {
    setPendingCount((count) => Math.max(0, count - 1));
  }, []);

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      const generation = repositoryGeneration;
      begin();
      try {
        const result = await operation();
        if (generation !== repositoryGeneration) {
          throw new StaleRepositoryOperationError();
        }
        return result;
      } catch (reason) {
        if (
          generation !== repositoryGeneration ||
          reason instanceof StaleRepositoryOperationError
        ) {
          throw reason;
        }
        const caught = asError(reason);
        setError(caught.message);
        throw caught;
      } finally {
        finish();
      }
    },
    [begin, finish]
  );

  const requireSelectedCareSpace = useCallback((): CareSpaceAccess => {
    if (!selectedCareSpace) {
      throw new Error("사용할 가족 공간을 먼저 선택해 주세요.");
    }
    return selectedCareSpace;
  }, [selectedCareSpace]);

  const requireOwnerSpace = useCallback((): CareSpaceAccess => {
    const space = requireSelectedCareSpace();
    if (space.role !== "owner") {
      throw new Error("이 공간의 약과 일정은 소유자만 관리할 수 있습니다.");
    }
    return space;
  }, [requireSelectedCareSpace]);

  const requireWritableSpace = useCallback((): CareSpaceAccess => {
    const space = requireSelectedCareSpace();
    if (space.role === "viewer") {
      throw new Error("조회 전용 구성원은 기록을 변경할 수 없습니다.");
    }
    return space;
  }, [requireSelectedCareSpace]);

  const selectCareSpace = useCallback(
    async (id: string) => {
      const space = careSpaces.find((candidate) => candidate.id === id);
      if (!space) throw new Error("접근할 수 없는 가족 공간입니다.");

      setSelectedCareSpaceId(space.id);
      setDb(EMPTY_DB);
      try {
        globalThis.localStorage.setItem(
          SELECTED_CARE_SPACE_STORAGE_KEY,
          space.id
        );
      } catch {
        // The preference is optional; the selected space remains in memory.
      }

      const next = await run(() => repository.fetchAll(space.id));
      setDb(next);
    },
    [careSpaces, run]
  );

  const refreshCareSpaces = useCallback(async () => {
    const preferredId = selectedCareSpaceId;
    const result = await run(async () => {
      const [spaces, pendingInvites] = await Promise.all([
        repository.fetchCareSpaces(),
        repository.fetchPendingCareSpaceInvites(),
      ]);
      const selected =
        spaces.find((space) => space.id === preferredId) ?? spaces[0] ?? null;
      const next = selected ? await repository.fetchAll(selected.id) : EMPTY_DB;
      return { spaces, pendingInvites, selected, next };
    });

    setCareSpaces(result.spaces);
    setPendingCareSpaceInvites(result.pendingInvites);
    setSelectedCareSpaceId(result.selected?.id ?? null);
    setCareSpaceMembersBySpace({});
    setCareSpaceInvitesBySpace({});
    setDb(result.next);
  }, [run, selectedCareSpaceId]);

  const revalidateAccessibleSpaces = useCallback(async () => {
    const preferredId = selectedCareSpaceId;
    const result = await run(async () => {
      const spaces = await repository.fetchCareSpaces();
      const selected =
        spaces.find((space) => space.id === preferredId) ?? spaces[0] ?? null;
      const next = selected ? await repository.fetchAll(selected.id) : EMPTY_DB;
      return { spaces, selected, next };
    });
    setCareSpaces(result.spaces);
    setSelectedCareSpaceId(result.selected?.id ?? null);
    setDb(result.next);
  }, [run, selectedCareSpaceId]);

  const refresh = useCallback(async () => {
    const space = requireSelectedCareSpace();
    const next = await run(() => repository.fetchAll(space.id));
    setDb(next);
  }, [requireSelectedCareSpace, run]);

  useEffect(() => {
    const pathname = globalThis.location.pathname;
    if (
      !isMockDbEnabled &&
      (pathname === "/login" || pathname.startsWith("/auth/"))
    ) {
      let cancelled = false;
      globalThis.queueMicrotask(() => {
        if (cancelled) return;
        setInitialized(true);
        setPendingCount((count) => Math.max(0, count - 1));
      });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    const generation = repositoryGeneration;
    let preferredId: string | null = null;
    try {
      const linkedSpaceId = new URL(globalThis.location.href).searchParams.get(
        "space"
      );
      preferredId =
        linkedSpaceId ??
        globalThis.localStorage.getItem(SELECTED_CARE_SPACE_STORAGE_KEY);
    } catch {
      // Falling back to the first accessible space is safe.
    }

    void Promise.all([
      repository.fetchCareSpaces(),
      repository.fetchPendingCareSpaceInvites(),
    ])
      .then(async ([spaces, pendingInvites]) => {
        const selected =
          spaces.find((space) => space.id === preferredId) ?? spaces[0] ?? null;
        const next = selected ? await repository.fetchAll(selected.id) : EMPTY_DB;
        if (cancelled || generation !== repositoryGeneration) return;
        setCareSpaces(spaces);
        setPendingCareSpaceInvites(pendingInvites);
        setSelectedCareSpaceId(selected?.id ?? null);
        setDb(next);
        if (selected) {
          try {
            globalThis.localStorage.setItem(
              SELECTED_CARE_SPACE_STORAGE_KEY,
              selected.id
            );
          } catch {
            // The preference is optional.
          }
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled && generation === repositoryGeneration) {
          setError(asError(reason).message);
        }
      })
      .finally(() => {
        if (!cancelled && generation === repositoryGeneration) {
          setInitialized(true);
          setPendingCount((count) => Math.max(0, count - 1));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshFamily = useCallback(async () => {
    const space = requireSelectedCareSpace();
    const result = await run(async () => {
      const members = await repository.fetchCareSpaceMembers(space.id);
      const invites =
        space.role === "owner"
          ? await repository.fetchCareSpaceInvites(space.id)
          : [];
      return { members, invites };
    });
    setCareSpaceMembersBySpace((current) => ({
      ...current,
      [space.id]: result.members,
    }));
    setCareSpaceInvitesBySpace((current) => ({
      ...current,
      [space.id]: result.invites,
    }));
  }, [requireSelectedCareSpace, run]);

  const createCareSpaceInvite = useCallback(
    async (input: CreateCareSpaceInviteInput) => {
      const space = requireOwnerSpace();
      const row = await run(() =>
        repository.createCareSpaceInvite(
          space.id,
          normalizedInviteInput(input)
        )
      );
      setCareSpaceInvitesBySpace((current) => ({
        ...current,
        [space.id]: replaceRow(current[space.id] ?? [], row),
      }));
      return row;
    },
    [requireOwnerSpace, run]
  );

  const acceptCareSpaceInvite = useCallback(
    async (inviteId: string) => {
      await run(() => repository.acceptCareSpaceInvite(inviteId));
      setPendingCareSpaceInvites((current) =>
        current.filter((invite) => invite.id !== inviteId)
      );
      await refreshCareSpaces();
    },
    [refreshCareSpaces, run]
  );

  const declineCareSpaceInvite = useCallback(
    async (inviteId: string) => {
      await run(() => repository.declineCareSpaceInvite(inviteId));
      setPendingCareSpaceInvites((current) =>
        current.filter((invite) => invite.id !== inviteId)
      );
    },
    [run]
  );

  const revokeCareSpaceInvite = useCallback(
    async (inviteId: string) => {
      const space = requireOwnerSpace();
      const row = await run(() => repository.revokeCareSpaceInvite(inviteId));
      setCareSpaceInvitesBySpace((current) => ({
        ...current,
        [space.id]: replaceRow(current[space.id] ?? [], row),
      }));
    },
    [requireOwnerSpace, run]
  );

  const removeCareSpaceMember = useCallback(
    async (userId: string) => {
      const space = requireOwnerSpace();
      const removed = await run(() =>
        repository.removeCareSpaceMember(space.id, userId)
      );
      setCareSpaceMembersBySpace((current) => ({
        ...current,
        [space.id]: (current[space.id] ?? []).filter(
          (member) => member.user_id !== removed.user_id
        ),
      }));
    },
    [requireOwnerSpace, run]
  );

  const purgeSensitiveState = useCallback(() => {
    repositoryGeneration += 1;
    setPrivacyLocked(true);
    setDb(EMPTY_DB);
    setCareSpaces([]);
    setSelectedCareSpaceId(null);
    setCareSpaceMembersBySpace({});
    setCareSpaceInvitesBySpace({});
    setPendingCareSpaceInvites([]);
    setPendingCount(0);
    setInitialized(false);
    setError(null);
    try {
      globalThis.localStorage.removeItem(SELECTED_CARE_SPACE_STORAGE_KEY);
    } catch {
      // The preference may be unavailable or already cleared.
    }
  }, []);

  useEffect(() => {
    if (isMockDbEnabled || !supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === "SIGNED_OUT" ||
        (event !== "INITIAL_SESSION" && session === null)
      ) {
        purgeSensitiveState();
        globalThis.location.replace("/login");
      }
    });
    return () => data.subscription.unsubscribe();
  }, [purgeSensitiveState]);

  useEffect(() => {
    if (isMockDbEnabled || privacyLocked || !initialized) return;

    function validateCurrentAccess() {
      if (
        globalThis.document.visibilityState !== "visible" ||
        globalThis.location.pathname === "/login" ||
        globalThis.location.pathname.startsWith("/auth/")
      ) {
        return;
      }
      void revalidateAccessibleSpaces().catch(() => undefined);
    }

    const intervalId = globalThis.setInterval(validateCurrentAccess, 30_000);
    globalThis.addEventListener("focus", validateCurrentAccess);
    globalThis.document.addEventListener("visibilitychange", validateCurrentAccess);
    return () => {
      globalThis.clearInterval(intervalId);
      globalThis.removeEventListener("focus", validateCurrentAccess);
      globalThis.document.removeEventListener(
        "visibilitychange",
        validateCurrentAccess
      );
    };
  }, [initialized, privacyLocked, revalidateAccessibleSpaces]);

  const clearError = useCallback(() => setError(null), []);

  const addMedication = useCallback(
    async (input: AddMedicationInput) => {
      const space = requireOwnerSpace();
      const prepared: AddMedicationInput = {
        name: assertNonEmpty(input.name, "약 이름", 100),
        unit: normalizedUnit(input.unit),
        quantity_options: normalizedQuantityOptions(input.quantity_options),
        active: input.active ?? true,
      };
      const row = await run(() => repository.addMedication(space.id, prepared));
      setDb((current) => ({
        ...current,
        medications: replaceRow(current.medications, row),
      }));
      return row;
    },
    [requireOwnerSpace, run]
  );

  const updateMedication = useCallback(
    async (id: string, patch: UpdateMedicationInput) => {
      const space = requireOwnerSpace();
      assertPatch(patch);
      const prepared: UpdateMedicationInput = {
        ...patch,
        name:
          patch.name === undefined
            ? undefined
            : assertNonEmpty(patch.name, "약 이름", 100),
        unit: patch.unit === undefined ? undefined : normalizedUnit(patch.unit),
        quantity_options:
          patch.quantity_options === undefined
            ? undefined
            : normalizedQuantityOptions(patch.quantity_options),
      };
      const row = await run(() =>
        repository.updateMedication(space.id, id, prepared)
      );
      setDb((current) => ({
        ...current,
        medications: replaceRow(current.medications, row),
      }));
      return row;
    },
    [requireOwnerSpace, run]
  );

  const deactivateMedication = useCallback(
    async (id: string) => {
      const space = requireOwnerSpace();
      const row = await run(() =>
        repository.deactivateMedication(space.id, id)
      );
      setDb((current) => ({
        ...current,
        medications: replaceRow(current.medications, row),
      }));
      return row;
    },
    [requireOwnerSpace, run]
  );

  const addSchedule = useCallback(
    async (input: AddScheduleInput) => {
      const space = requireOwnerSpace();
      const prepared: AddScheduleInput = {
        medication_id: input.medication_id,
        time: normalizedTime(input.time),
        active: input.active ?? true,
      };
      const row = await run(() => repository.addSchedule(space.id, prepared));
      setDb((current) => ({
        ...current,
        medication_schedules: replaceRow(current.medication_schedules, row),
      }));
      return row;
    },
    [requireOwnerSpace, run]
  );

  const updateSchedule = useCallback(
    async (id: string, patch: UpdateScheduleInput) => {
      const space = requireOwnerSpace();
      assertPatch(patch);
      const prepared: UpdateScheduleInput = {
        ...patch,
        time: patch.time === undefined ? undefined : normalizedTime(patch.time),
      };
      const row = await run(() =>
        repository.updateSchedule(space.id, id, prepared)
      );
      setDb((current) => ({
        ...current,
        medication_schedules: replaceRow(current.medication_schedules, row),
      }));
      return row;
    },
    [requireOwnerSpace, run]
  );

  const deleteSchedule = useCallback(
    async (id: string) => {
      const space = requireOwnerSpace();
      const { row, next } = await run(async () => {
        const deleted = await repository.deleteSchedule(space.id, id);
        const refreshed = await repository.fetchAll(space.id);
        return { row: deleted, next: refreshed };
      });
      setDb(next);
      return row;
    },
    [requireOwnerSpace, run]
  );

  const addLog = useCallback(
    async (input: AddMedicationLogInput) => {
      const space = requireWritableSpace();
      const scheduleId = input.schedule_id ?? null;
      const expectedExtra = scheduleId === null;
      const isExtra = input.is_extra ?? expectedExtra;
      if (isExtra !== expectedExtra) {
        throw new Error(
          scheduleId
            ? "일정에 연결된 기록은 추가 복용으로 표시할 수 없습니다."
            : "일정 없는 기록은 추가 복용으로 표시해야 합니다."
        );
      }
      const clientRequestId = input.client_request_id ?? requestId();
      if (!UUID_PATTERN.test(clientRequestId)) {
        throw new Error("client_request_id는 UUID 형식이어야 합니다.");
      }
      const prepared = {
        medication_id: input.medication_id,
        schedule_id: scheduleId,
        quantity: assertQuantity(input.quantity),
        note: normalizedNote(input.note),
        taken_at: assertIsoDate(input.taken_at ?? new Date().toISOString()),
        is_extra: isExtra,
        client_request_id: clientRequestId,
      };
      const row = await run(() => repository.addLog(space.id, prepared));
      if (row.schedule_id) {
        await dismissScheduleNotifications(
          row.schedule_id,
          toDateKey(new Date(row.taken_at))
        );
      }
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [requireWritableSpace, run]
  );

  const updateLog = useCallback(
    async (id: string, patch: UpdateMedicationLogInput) => {
      const space = requireWritableSpace();
      assertPatch(patch);
      const currentLog = db.medication_logs.find((log) => log.id === id);
      const finalScheduleId = hasOwn(patch, "schedule_id")
        ? patch.schedule_id ?? null
        : currentLog?.schedule_id;
      const expectedExtra = finalScheduleId === null;
      if (patch.is_extra !== undefined && patch.is_extra !== expectedExtra) {
        throw new Error("schedule_id와 is_extra 값이 일치하지 않습니다.");
      }
      const prepared: UpdateMedicationLogInput = {
        ...patch,
        schedule_id: hasOwn(patch, "schedule_id") ? patch.schedule_id ?? null : undefined,
        is_extra:
          hasOwn(patch, "schedule_id") && patch.is_extra === undefined
            ? expectedExtra
            : patch.is_extra,
        quantity:
          patch.quantity === undefined ? undefined : assertQuantity(patch.quantity),
        note: hasOwn(patch, "note") ? normalizedNote(patch.note) : undefined,
        taken_at:
          patch.taken_at === undefined ? undefined : assertIsoDate(patch.taken_at),
      };
      const row = await run(() => repository.updateLog(space.id, id, prepared));
      if (row.schedule_id && row.deleted_at === null) {
        await dismissScheduleNotifications(
          row.schedule_id,
          toDateKey(new Date(row.taken_at))
        );
      }
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [db.medication_logs, requireWritableSpace, run]
  );

  const softDeleteLog = useCallback(
    async (id: string) => {
      const space = requireWritableSpace();
      const row = await run(() => repository.softDeleteLog(space.id, id));
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [requireWritableSpace, run]
  );

  const restoreLog = useCallback(
    async (id: string) => {
      const space = requireWritableSpace();
      const row = await run(() => repository.restoreLog(space.id, id));
      if (row.schedule_id) {
        await dismissScheduleNotifications(
          row.schedule_id,
          toDateKey(new Date(row.taken_at))
        );
      }
      setDb((current) => ({
        ...current,
        medication_logs: replaceRow(current.medication_logs, row),
      }));
      return row;
    },
    [requireWritableSpace, run]
  );

  const upsertStatus = useCallback(
    async (input: DailyStatusInput) => {
      const space = requireWritableSpace();
      const row = await run(() =>
        repository.upsertStatus(space.id, validateStatus(input))
      );
      setDb((current) => ({
        ...current,
        daily_status: replaceRow(current.daily_status, row),
      }));
      return row;
    },
    [requireWritableSpace, run]
  );

  const deleteStatus = useCallback(
    async (date: string) => {
      const space = requireWritableSpace();
      fromDateKey(date);
      const row = await run(() => repository.deleteStatus(space.id, date));
      setDb((current) => ({
        ...current,
        daily_status: current.daily_status.filter((status) => status.id !== row.id),
      }));
      return row;
    },
    [requireWritableSpace, run]
  );

  const value = useMemo<DbContextValue>(
    () => ({
      db,
      careSpaces,
      selectedCareSpace,
      careSpaceMembers,
      careSpaceInvites,
      pendingCareSpaceInvites,
      canManageSettings,
      canWriteRecords,
      initialized,
      loading,
      error,
      isSupabase: !isMockDbEnabled,
      refresh,
      selectCareSpace,
      refreshCareSpaces,
      refreshFamily,
      purgeSensitiveState,
      createCareSpaceInvite,
      acceptCareSpaceInvite,
      declineCareSpaceInvite,
      revokeCareSpaceInvite,
      removeCareSpaceMember,
      clearError,
      addMedication,
      updateMedication,
      deactivateMedication,
      addSchedule,
      updateSchedule,
      deleteSchedule,
      addLog,
      updateLog,
      deleteLog: softDeleteLog,
      softDeleteLog,
      restoreLog,
      upsertStatus,
      deleteStatus,
    }),
    [
      db,
      careSpaces,
      selectedCareSpace,
      careSpaceMembers,
      careSpaceInvites,
      pendingCareSpaceInvites,
      canManageSettings,
      canWriteRecords,
      initialized,
      loading,
      error,
      refresh,
      selectCareSpace,
      refreshCareSpaces,
      refreshFamily,
      purgeSensitiveState,
      createCareSpaceInvite,
      acceptCareSpaceInvite,
      declineCareSpaceInvite,
      revokeCareSpaceInvite,
      removeCareSpaceMember,
      clearError,
      addMedication,
      updateMedication,
      deactivateMedication,
      addSchedule,
      updateSchedule,
      deleteSchedule,
      addLog,
      updateLog,
      softDeleteLog,
      restoreLog,
      upsertStatus,
      deleteStatus,
    ]
  );

  return createElement(
    DbContext.Provider,
    { value },
    privacyLocked
      ? createElement(
          "div",
          {
            className:
              "mx-auto mt-8 w-full max-w-md rounded-2xl bg-surface-soft px-5 py-6 text-center text-lg font-semibold text-body",
            role: "status",
          },
          "개인 기록을 지우고 안전하게 로그아웃하고 있습니다."
        )
      : children
  );
}

export function useDb(): DbContextValue {
  const context = useContext(DbContext);
  if (!context) throw new Error("useDb는 DbProvider 안에서 사용해야 합니다.");
  return context;
}

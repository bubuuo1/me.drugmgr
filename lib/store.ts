"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  FamilyRelationship,
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

class DataRequestCoordinator {
  private selectedCareSpaceId: string | null = null;
  private generation = 0;
  private selectionGeneration = 0;
  private activeForegroundOperations = 0;
  private foregroundOperationVersion = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  snapshot(): number {
    return this.generation;
  }

  beginForegroundOperation(): number {
    this.activeForegroundOperations += 1;
    this.foregroundOperationVersion += 1;
    return this.foregroundOperationVersion;
  }

  finishForegroundOperation(): void {
    this.activeForegroundOperations = Math.max(
      0,
      this.activeForegroundOperations - 1
    );
  }

  hasActiveForegroundOperation(): boolean {
    return this.activeForegroundOperations > 0;
  }

  foregroundOperationSnapshot(): number {
    return this.foregroundOperationVersion;
  }

  selectedId(): string | null {
    return this.selectedCareSpaceId;
  }

  select(id: string | null): void {
    if (id !== this.selectedCareSpaceId) {
      this.selectionGeneration += 1;
    }
    this.selectedCareSpaceId = id;
  }

  selectionSnapshot(): number {
    return this.selectionGeneration;
  }

  isSelected(id: string, selectionGeneration: number): boolean {
    return (
      this.selectedCareSpaceId === id &&
      this.selectionGeneration === selectionGeneration
    );
  }

  clear(): void {
    this.generation += 1;
    this.select(null);
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
  if (input.role !== "caregiver") {
    throw new Error("가족 기록 관리 요청은 보호자 권한으로만 보낼 수 있습니다.");
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

function isStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isStructurallyEqual(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        isStructurallyEqual(leftRecord[key], rightRecord[key])
    )
  );
}

function preferredCareSpace(
  spaces: CareSpaceAccess[],
  preferredId: string | null
): CareSpaceAccess | null {
  return (
    spaces.find((space) => space.id === preferredId) ??
    spaces.find((space) => space.role === "owner") ??
    spaces[0] ??
    null
  );
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
  const note = normalizedNote(input.note);
  if (
    input.fatigue === null &&
    input.strength === null &&
    input.breathing === null &&
    input.eye_symptom === null &&
    note === null
  ) {
    throw new Error(
      "상태를 하나 이상 선택하거나 비어 있지 않은 메모를 입력해 주세요."
    );
  }
  return { ...input, note };
}

export type DbContextValue = {
  db: DB;
  careSpaces: CareSpaceAccess[];
  selectedCareSpace: CareSpaceAccess | null;
  careSpaceMembers: CareSpaceMemberWithProfile[];
  careSpaceInvites: CareSpaceInvite[];
  pendingCareSpaceInvites: PendingCareSpaceInvite[];
  familyRelationships: FamilyRelationship[];
  canManageMedicationSettings: boolean;
  canManageFamily: boolean;
  canWriteRecords: boolean;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  isSupabase: boolean;
  refresh(): Promise<void>;
  selectCareSpace(id: string): Promise<void>;
  refreshCareSpaces(preferredId?: string): Promise<void>;
  refreshFamily(): Promise<void>;
  purgeSensitiveState(): void;
  updateCareSpaceName(name: string): Promise<CareSpaceAccess>;
  createCareSpaceInvite(input: CreateCareSpaceInviteInput): Promise<CareSpaceInvite>;
  acceptCareSpaceInvite(
    inviteId: string,
    inviterCaregiverCareSpaceId?: string | null
  ): Promise<void>;
  declineCareSpaceInvite(inviteId: string): Promise<void>;
  revokeCareSpaceInvite(inviteId: string): Promise<void>;
  upgradeFamilyRelationshipToReciprocal(
    relationshipId: string,
    callerCareSpaceId: string
  ): Promise<void>;
  endFamilyRelationship(relationshipId: string): Promise<void>;
  removeCareSpaceMember(userId: string): Promise<void>;
  clearError(): void;
  addMedication(input: AddMedicationInput): Promise<Medication>;
  updateMedication(id: string, patch: UpdateMedicationInput): Promise<Medication>;
  deactivateMedication(id: string): Promise<Medication>;
  deleteMedication(id: string): Promise<Medication>;
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
  const [dataRequests] = useState(() => new DataRequestCoordinator());
  const backgroundRevalidation = useRef<Promise<void> | null>(null);
  const [careSpaceMembersBySpace, setCareSpaceMembersBySpace] = useState<
    Record<string, CareSpaceMemberWithProfile[]>
  >({});
  const [careSpaceInvitesBySpace, setCareSpaceInvitesBySpace] = useState<
    Record<string, CareSpaceInvite[]>
  >({});
  const [pendingCareSpaceInvites, setPendingCareSpaceInvites] = useState<
    PendingCareSpaceInvite[]
  >([]);
  const [familyRelationships, setFamilyRelationships] = useState<
    FamilyRelationship[]
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
  const canManageMedicationSettings =
    selectedCareSpace?.role === "owner" ||
    selectedCareSpace?.role === "caregiver";
  const canManageFamily = selectedCareSpace?.role === "owner";
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
      dataRequests.beginForegroundOperation();
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
        dataRequests.finishForegroundOperation();
        finish();
      }
    },
    [begin, dataRequests, finish]
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
      throw new Error("이 공간의 가족과 초대는 소유자만 관리할 수 있습니다.");
    }
    return space;
  }, [requireSelectedCareSpace]);

  const requireMedicationManagerSpace = useCallback((): CareSpaceAccess => {
    const space = requireSelectedCareSpace();
    if (space.role === "viewer") {
      throw new Error("조회 전용 구성원은 약과 일정을 변경할 수 없습니다.");
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

      const requestGeneration = dataRequests.begin();
      dataRequests.select(space.id);
      setSelectedCareSpaceId(space.id);
      setDb(EMPTY_DB);

      const next = await run(() => repository.fetchAll(space.id));
      if (!dataRequests.isCurrent(requestGeneration)) return;
      setDb(next);
    },
    [careSpaces, dataRequests, run]
  );

  const refreshCareSpaces = useCallback(async (preferredId?: string) => {
    const nextPreferredId = preferredId ?? dataRequests.selectedId();
    const requestGeneration = dataRequests.begin();
    const result = await run(async () => {
      const [spaces, pendingInvites] = await Promise.all([
        repository.fetchCareSpaces(),
        repository.fetchPendingCareSpaceInvites(),
      ]);
      const selected = preferredCareSpace(spaces, nextPreferredId);
      const next = selected ? await repository.fetchAll(selected.id) : EMPTY_DB;
      return { spaces, pendingInvites, selected, next };
    });

    if (!dataRequests.isCurrent(requestGeneration)) return;
    dataRequests.select(result.selected?.id ?? null);
    setCareSpaces(result.spaces);
    setPendingCareSpaceInvites(result.pendingInvites);
    setSelectedCareSpaceId(result.selected?.id ?? null);
    setCareSpaceMembersBySpace({});
    setCareSpaceInvitesBySpace({});
    setDb(result.next);
  }, [dataRequests, run]);

  const revalidateAccessibleSpaces = useCallback(async () => {
    const preferredId = dataRequests.selectedId();
    const requestGeneration = dataRequests.begin();
    const result = await run(async () => {
      const [spaces, pendingInvites] = await Promise.all([
        repository.fetchCareSpaces(),
        repository.fetchPendingCareSpaceInvites(),
      ]);
      const selected = preferredCareSpace(spaces, preferredId);
      const next = selected ? await repository.fetchAll(selected.id) : EMPTY_DB;
      return { spaces, pendingInvites, selected, next };
    });
    if (!dataRequests.isCurrent(requestGeneration)) return;
    dataRequests.select(result.selected?.id ?? null);
    setCareSpaces(result.spaces);
    setPendingCareSpaceInvites(result.pendingInvites);
    setSelectedCareSpaceId(result.selected?.id ?? null);
    setDb(result.next);
  }, [dataRequests, run]);

  const revalidateAccessibleSpacesSilently = useCallback((): Promise<void> => {
    if (backgroundRevalidation.current) {
      return backgroundRevalidation.current;
    }
    if (dataRequests.hasActiveForegroundOperation()) {
      return Promise.resolve();
    }

    const repositoryGenerationAtStart = repositoryGeneration;
    const requestGeneration = dataRequests.snapshot();
    const runVersionAtStart = dataRequests.foregroundOperationSnapshot();
    const preferredId = dataRequests.selectedId();
    const operation = (async () => {
      const canApply = () =>
        repositoryGenerationAtStart === repositoryGeneration &&
        dataRequests.isCurrent(requestGeneration) &&
        dataRequests.foregroundOperationSnapshot() === runVersionAtStart &&
        !dataRequests.hasActiveForegroundOperation();

      const spaces = await repository.fetchCareSpaces();
      const selected = preferredCareSpace(spaces, preferredId);
      const selectedAccessWasRevoked =
        preferredId !== null &&
        !spaces.some((space) => space.id === preferredId);
      if (!canApply()) return;

      dataRequests.select(selected?.id ?? null);
      setCareSpaces((current) =>
        isStructurallyEqual(current, spaces) ? current : spaces
      );
      setSelectedCareSpaceId(selected?.id ?? null);
      if (selectedAccessWasRevoked) {
        setDb(EMPTY_DB);
      }

      const [pendingInvitesResult, nextResult] = await Promise.allSettled([
        repository.fetchPendingCareSpaceInvites(),
        selected ? repository.fetchAll(selected.id) : Promise.resolve(EMPTY_DB),
      ]);
      if (!canApply()) return;

      if (pendingInvitesResult.status === "fulfilled") {
        setPendingCareSpaceInvites((current) =>
          isStructurallyEqual(current, pendingInvitesResult.value)
            ? current
            : pendingInvitesResult.value
        );
      }
      if (nextResult.status === "fulfilled") {
        setDb((current) =>
          isStructurallyEqual(current, nextResult.value)
            ? current
            : nextResult.value
        );
      }
    })();
    const trackedOperation = operation.finally(() => {
      if (backgroundRevalidation.current === trackedOperation) {
        backgroundRevalidation.current = null;
      }
    });
    backgroundRevalidation.current = trackedOperation;
    return trackedOperation;
  }, [dataRequests]);

  const refresh = useCallback(async () => {
    if (!selectedCareSpace) {
      await revalidateAccessibleSpaces();
      return;
    }
    const space = requireSelectedCareSpace();
    const requestGeneration = dataRequests.begin();
    const next = await run(() => repository.fetchAll(space.id));
    if (!dataRequests.isCurrent(requestGeneration)) return;
    setDb(next);
  }, [
    dataRequests,
    revalidateAccessibleSpaces,
    requireSelectedCareSpace,
    run,
    selectedCareSpace,
  ]);

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
    const dataRequestGeneration = dataRequests.begin();
    let preferredId: string | null = null;
    try {
      preferredId = new URL(globalThis.location.href).searchParams.get("space");
    } catch {
      // Falling back to the owner's space is safe.
    }

    void Promise.all([
      repository.fetchCareSpaces(),
      repository.fetchPendingCareSpaceInvites(),
    ])
      .then(async ([spaces, pendingInvites]) => {
        const selected = preferredCareSpace(spaces, preferredId);
        const next = selected ? await repository.fetchAll(selected.id) : EMPTY_DB;
        if (
          cancelled ||
          generation !== repositoryGeneration ||
          !dataRequests.isCurrent(dataRequestGeneration)
        ) {
          return;
        }
        dataRequests.select(selected?.id ?? null);
        setCareSpaces(spaces);
        setPendingCareSpaceInvites(pendingInvites);
        setSelectedCareSpaceId(selected?.id ?? null);
        setDb(next);
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
  }, [dataRequests]);

  const refreshFamily = useCallback(async () => {
    const space = requireSelectedCareSpace();
    const selectionGeneration = dataRequests.selectionSnapshot();
    const result = await run(async () => {
      const [members, invites, pendingInvites, relationships] = await Promise.all([
        repository.fetchCareSpaceMembers(space.id),
        space.role === "owner"
          ? repository.fetchCareSpaceInvites(space.id)
          : Promise.resolve([]),
        repository.fetchPendingCareSpaceInvites(),
        repository.fetchFamilyRelationships(),
      ]);
      return { members, invites, pendingInvites, relationships };
    });
    if (!dataRequests.isSelected(space.id, selectionGeneration)) return;
    setPendingCareSpaceInvites(result.pendingInvites);
    setFamilyRelationships(result.relationships);
    setCareSpaceMembersBySpace((current) => ({
      ...current,
      [space.id]: result.members,
    }));
    setCareSpaceInvitesBySpace((current) => ({
      ...current,
      [space.id]: result.invites,
    }));
  }, [dataRequests, requireSelectedCareSpace, run]);

  const updateCareSpaceName = useCallback(
    async (name: string) => {
      const space = requireOwnerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const row = await run(() =>
        repository.updateCareSpace(
          space.id,
          assertNonEmpty(name, "복약 공간 이름", 100)
        )
      );
      const updatedAccess: CareSpaceAccess = { ...row, role: space.role };
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setCareSpaces((current) =>
          current.map((candidate) =>
            candidate.id === row.id
              ? updatedAccess
              : candidate
          )
        );
      }
      return updatedAccess;
    },
    [dataRequests, requireOwnerSpace, run]
  );

  const createCareSpaceInvite = useCallback(
    async (input: CreateCareSpaceInviteInput) => {
      const space = requireOwnerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const row = await run(() =>
        repository.createCareSpaceInvite(
          space.id,
          normalizedInviteInput(input)
        )
      );
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setCareSpaceInvitesBySpace((current) => ({
          ...current,
          [space.id]: replaceRow(current[space.id] ?? [], row),
        }));
      }
      return row;
    },
    [dataRequests, requireOwnerSpace, run]
  );

  const acceptCareSpaceInvite = useCallback(
    async (
      inviteId: string,
      inviterCaregiverCareSpaceId: string | null = null
    ) => {
      const member = await run(() =>
        repository.acceptCareSpaceInvite(
          inviteId,
          inviterCaregiverCareSpaceId
        )
      );
      setPendingCareSpaceInvites((current) =>
        current.filter((invite) => invite.id !== inviteId)
      );
      await refreshCareSpaces(member.care_space_id);
      setFamilyRelationships(
        await run(() => repository.fetchFamilyRelationships())
      );
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
      const selectionGeneration = dataRequests.selectionSnapshot();
      const row = await run(() => repository.revokeCareSpaceInvite(inviteId));
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setCareSpaceInvitesBySpace((current) => ({
          ...current,
          [space.id]: replaceRow(current[space.id] ?? [], row),
        }));
      }
    },
    [dataRequests, requireOwnerSpace, run]
  );

  const upgradeFamilyRelationshipToReciprocal = useCallback(
    async (relationshipId: string, callerCareSpaceId: string) => {
      const callerSpace = careSpaces.find(
        (space) => space.id === callerCareSpaceId && space.role === "owner"
      );
      if (!callerSpace) {
        throw new Error("본인이 소유한 복약 공간을 선택해 주세요.");
      }
      await run(() =>
        repository.upgradeFamilyRelationshipToReciprocal(
          relationshipId,
          callerSpace.id
        )
      );
      await refreshCareSpaces();
      setFamilyRelationships(
        await run(() => repository.fetchFamilyRelationships())
      );
    },
    [careSpaces, refreshCareSpaces, run]
  );

  const endFamilyRelationship = useCallback(
    async (relationshipId: string) => {
      await run(() => repository.endFamilyRelationship(relationshipId));
      setFamilyRelationships((current) =>
        current.filter((relationship) => relationship.id !== relationshipId)
      );
      await refreshCareSpaces();
    },
    [refreshCareSpaces, run]
  );

  const removeCareSpaceMember = useCallback(
    async (userId: string) => {
      const space = requireOwnerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const removed = await run(() =>
        repository.removeCareSpaceMember(space.id, userId)
      );
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setCareSpaceMembersBySpace((current) => ({
          ...current,
          [space.id]: (current[space.id] ?? []).filter(
            (member) => member.user_id !== removed.user_id
          ),
        }));
      }
    },
    [dataRequests, requireOwnerSpace, run]
  );

  const purgeSensitiveState = useCallback(() => {
    repositoryGeneration += 1;
    dataRequests.clear();
    setPrivacyLocked(true);
    setDb(EMPTY_DB);
    setCareSpaces([]);
    setSelectedCareSpaceId(null);
    setCareSpaceMembersBySpace({});
    setCareSpaceInvitesBySpace({});
    setPendingCareSpaceInvites([]);
    setFamilyRelationships([]);
    setPendingCount(0);
    setInitialized(false);
    setError(null);
  }, [dataRequests]);

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
      void revalidateAccessibleSpacesSilently().catch(() => undefined);
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
  }, [initialized, privacyLocked, revalidateAccessibleSpacesSilently]);

  const clearError = useCallback(() => setError(null), []);

  const addMedication = useCallback(
    async (input: AddMedicationInput) => {
      const space = requireMedicationManagerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const prepared: AddMedicationInput = {
        name: assertNonEmpty(input.name, "약 이름", 100),
        unit: normalizedUnit(input.unit),
        quantity_options: normalizedQuantityOptions(input.quantity_options),
        active: input.active ?? true,
      };
      const row = await run(() => repository.addMedication(space.id, prepared));
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medications: replaceRow(current.medications, row),
        }));
      }
      return row;
    },
    [dataRequests, requireMedicationManagerSpace, run]
  );

  const updateMedication = useCallback(
    async (id: string, patch: UpdateMedicationInput) => {
      const space = requireMedicationManagerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
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
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medications: replaceRow(current.medications, row),
        }));
      }
      return row;
    },
    [dataRequests, requireMedicationManagerSpace, run]
  );

  const deactivateMedication = useCallback(
    async (id: string) => {
      const space = requireMedicationManagerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const row = await run(() =>
        repository.deactivateMedication(space.id, id)
      );
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medications: replaceRow(current.medications, row),
        }));
      }
      return row;
    },
    [dataRequests, requireMedicationManagerSpace, run]
  );

  const deleteMedication = useCallback(
    async (id: string) => {
      const space = requireMedicationManagerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const scheduleIds = db.medication_schedules
        .filter((schedule) => schedule.medication_id === id)
        .map((schedule) => schedule.id);
      const row = await run(() => repository.deleteMedication(space.id, id));
      if (scheduleIds.length > 0) {
        await dismissScheduleNotifications(scheduleIds);
      }
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medications: current.medications.filter(
            (medication) => medication.id !== id
          ),
          medication_schedules: current.medication_schedules.filter(
            (schedule) => schedule.medication_id !== id
          ),
        }));
      }
      return row;
    },
    [dataRequests, db.medication_schedules, requireMedicationManagerSpace, run]
  );

  const addSchedule = useCallback(
    async (input: AddScheduleInput) => {
      const space = requireMedicationManagerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const prepared: AddScheduleInput = {
        medication_id: input.medication_id,
        time: normalizedTime(input.time),
        active: input.active ?? true,
      };
      const row = await run(() => repository.addSchedule(space.id, prepared));
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medication_schedules: replaceRow(current.medication_schedules, row),
        }));
      }
      return row;
    },
    [dataRequests, requireMedicationManagerSpace, run]
  );

  const updateSchedule = useCallback(
    async (id: string, patch: UpdateScheduleInput) => {
      const space = requireMedicationManagerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      assertPatch(patch);
      const prepared: UpdateScheduleInput = {
        ...patch,
        time: patch.time === undefined ? undefined : normalizedTime(patch.time),
      };
      const row = await run(() =>
        repository.updateSchedule(space.id, id, prepared)
      );
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medication_schedules: replaceRow(current.medication_schedules, row),
        }));
      }
      return row;
    },
    [dataRequests, requireMedicationManagerSpace, run]
  );

  const deleteSchedule = useCallback(
    async (id: string) => {
      const space = requireMedicationManagerSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const { row, next } = await run(async () => {
        const deleted = await repository.deleteSchedule(space.id, id);
        const refreshed = await repository.fetchAll(space.id);
        return { row: deleted, next: refreshed };
      });
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb(next);
      }
      return row;
    },
    [dataRequests, requireMedicationManagerSpace, run]
  );

  const addLog = useCallback(
    async (input: AddMedicationLogInput) => {
      const space = requireWritableSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
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
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medication_logs: replaceRow(current.medication_logs, row),
        }));
      }
      return row;
    },
    [dataRequests, requireWritableSpace, run]
  );

  const updateLog = useCallback(
    async (id: string, patch: UpdateMedicationLogInput) => {
      const space = requireWritableSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      assertPatch(patch);
      const currentLog = db.medication_logs.find((log) => log.id === id);
      const updatesSchedule = patch.schedule_id !== undefined;
      if (!updatesSchedule && patch.is_extra !== undefined) {
        throw new Error(
          "투약 기록의 일정 연결과 추가 복용 분류는 함께 변경해야 합니다."
        );
      }
      const finalScheduleId = updatesSchedule
        ? patch.schedule_id ?? null
        : currentLog?.schedule_id;
      const expectedExtra = finalScheduleId === null;
      if (patch.is_extra !== undefined && patch.is_extra !== expectedExtra) {
        throw new Error("schedule_id와 is_extra 값이 일치하지 않습니다.");
      }
      const prepared = Object.fromEntries(
        Object.entries({
          ...patch,
          schedule_id: updatesSchedule ? patch.schedule_id ?? null : undefined,
          is_extra: updatesSchedule
            ? patch.is_extra ?? expectedExtra
            : undefined,
          quantity:
            patch.quantity === undefined
              ? undefined
              : assertQuantity(patch.quantity),
          note: patch.note === undefined ? undefined : normalizedNote(patch.note),
          taken_at:
            patch.taken_at === undefined
              ? undefined
              : assertIsoDate(patch.taken_at),
        }).filter(([, value]) => value !== undefined)
      ) as UpdateMedicationLogInput;
      const row = await run(() => repository.updateLog(space.id, id, prepared));
      if (row.schedule_id && row.deleted_at === null) {
        await dismissScheduleNotifications(
          row.schedule_id,
          toDateKey(new Date(row.taken_at))
        );
      }
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medication_logs: replaceRow(current.medication_logs, row),
        }));
      }
      return row;
    },
    [dataRequests, db.medication_logs, requireWritableSpace, run]
  );

  const softDeleteLog = useCallback(
    async (id: string) => {
      const space = requireWritableSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const row = await run(() => repository.softDeleteLog(space.id, id));
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medication_logs: replaceRow(current.medication_logs, row),
        }));
      }
      return row;
    },
    [dataRequests, requireWritableSpace, run]
  );

  const restoreLog = useCallback(
    async (id: string) => {
      const space = requireWritableSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const row = await run(() => repository.restoreLog(space.id, id));
      if (row.schedule_id) {
        await dismissScheduleNotifications(
          row.schedule_id,
          toDateKey(new Date(row.taken_at))
        );
      }
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          medication_logs: replaceRow(current.medication_logs, row),
        }));
      }
      return row;
    },
    [dataRequests, requireWritableSpace, run]
  );

  const upsertStatus = useCallback(
    async (input: DailyStatusInput) => {
      const space = requireWritableSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      const row = await run(() =>
        repository.upsertStatus(space.id, validateStatus(input))
      );
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          daily_status: replaceRow(current.daily_status, row),
        }));
      }
      return row;
    },
    [dataRequests, requireWritableSpace, run]
  );

  const deleteStatus = useCallback(
    async (date: string) => {
      const space = requireWritableSpace();
      const selectionGeneration = dataRequests.selectionSnapshot();
      fromDateKey(date);
      const row = await run(() => repository.deleteStatus(space.id, date));
      if (dataRequests.isSelected(space.id, selectionGeneration)) {
        setDb((current) => ({
          ...current,
          daily_status: current.daily_status.filter(
            (status) => status.id !== row.id
          ),
        }));
      }
      return row;
    },
    [dataRequests, requireWritableSpace, run]
  );

  const value = useMemo<DbContextValue>(
    () => ({
      db,
      careSpaces,
      selectedCareSpace,
      careSpaceMembers,
      careSpaceInvites,
      pendingCareSpaceInvites,
      familyRelationships,
      canManageMedicationSettings,
      canManageFamily,
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
      updateCareSpaceName,
      createCareSpaceInvite,
      acceptCareSpaceInvite,
      declineCareSpaceInvite,
      revokeCareSpaceInvite,
      upgradeFamilyRelationshipToReciprocal,
      endFamilyRelationship,
      removeCareSpaceMember,
      clearError,
      addMedication,
      updateMedication,
      deactivateMedication,
      deleteMedication,
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
      familyRelationships,
      canManageMedicationSettings,
      canManageFamily,
      canWriteRecords,
      initialized,
      loading,
      error,
      refresh,
      selectCareSpace,
      refreshCareSpaces,
      refreshFamily,
      purgeSensitiveState,
      updateCareSpaceName,
      createCareSpaceInvite,
      acceptCareSpaceInvite,
      declineCareSpaceInvite,
      revokeCareSpaceInvite,
      upgradeFamilyRelationshipToReciprocal,
      endFamilyRelationship,
      removeCareSpaceMember,
      clearError,
      addMedication,
      updateMedication,
      deactivateMedication,
      deleteMedication,
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

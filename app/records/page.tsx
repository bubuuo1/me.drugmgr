"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "@/lib/store";
import {
  addDays,
  formatDateTime,
  formatKoreanDate,
  isToday,
  toDateKey,
} from "@/lib/date";
import { isBooleanOnly } from "@/lib/types";

export default function RecordsPage() {
  const router = useRouter();
  const { db, updateLog, deleteLog } = useDb();
  const [dateKey, setDateKey] = useState<string>(() => toDateKey(new Date()));
  const [editId, setEditId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState<string>("");
  const [editTime, setEditTime] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const medById = useMemo(
    () => new Map(db.medications.map((m) => [m.id, m])),
    [db.medications]
  );

  const dayLogs = db.medication_logs
    .filter((l) => {
      const t = new Date(l.taken_at);
      return toDateKey(t) === dateKey;
    })
    .sort((a, b) => a.taken_at.localeCompare(b.taken_at));

  const grouped = useMemo(() => {
    const map = new Map<string, typeof dayLogs>();
    for (const log of dayLogs) {
      const med = medById.get(log.medication_id);
      const name = med?.name ?? "알 수 없는 약";
      const arr = map.get(name) ?? [];
      arr.push(log);
      map.set(name, arr);
    }
    return Array.from(map.entries());
  }, [dayLogs, medById]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of dayLogs) {
      const med = medById.get(log.medication_id);
      const name = med?.name ?? `${log.medication_id}`;
      map.set(name, (map.get(name) ?? 0) + log.quantity);
    }
    return Array.from(map.entries());
  }, [dayLogs, medById]);

  const status = db.daily_status.find((s) => s.date === dateKey);

  function startEdit(logId: string, quantity: number, takenAt: string) {
    setEditId(logId);
    setEditQuantity(String(quantity));
    const d = new Date(takenAt);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    setEditTime(`${h}:${m}`);
  }

  function saveEdit() {
    if (!editId) return;
    const editLog = db.medication_logs.find((l) => l.id === editId);
    const editMed = editLog ? medById.get(editLog.medication_id) : undefined;
    const booleanOnly = !!editMed && isBooleanOnly(editMed);
    const quantity = booleanOnly ? editLog!.quantity : parseFloat(editQuantity);
    if (!booleanOnly && (!Number.isFinite(quantity) || quantity <= 0)) return;
    const [h, m] = editTime.split(":").map(Number);
    const date = new Date(dateKey);
    date.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    updateLog(editId, {
      quantity,
      taken_at: date.toISOString(),
    });
    setEditId(null);
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <header className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-strong text-ink active:bg-surface-soft"
          aria-label="뒤로 가기"
        >
          ‹
        </button>
        <h1 className="text-[24px] font-bold text-ink">기록 확인</h1>
        <button type="button" className="w-12" aria-hidden="true" tabIndex={-1} />
      </header>

      <nav className="flex items-center justify-between gap-3" aria-label="날짜 이동">
        <button
          type="button"
          onClick={() => setDateKey((k) => addDays(k, -1))}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-canvas text-ink active:bg-surface-strong"
          aria-label="이전 날짜"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-[20px] font-bold text-ink">
            {formatKoreanDate(dateKey)}
            {isToday(dateKey) && (
              <span className="ml-2 text-sm font-semibold text-primary">오늘</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setDateKey(toDateKey(new Date()))}
            className="mt-1 text-sm font-semibold text-muted underline"
          >
            오늘로
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDateKey((k) => addDays(k, 1))}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-canvas text-ink active:bg-surface-strong"
          aria-label="다음 날짜"
        >
          ›
        </button>
      </nav>

      {grouped.length === 0 ? (
        <p className="text-center text-base text-muted">기록이 없습니다.</p>
      ) : (
        <>
          {grouped.map(([name, logs]) => (
            <section key={name} className="flex flex-col gap-2">
              <h2 className="border-b border-hairline pb-2 text-[20px] font-bold text-ink">
                {name}
              </h2>
              <ul className="flex flex-col gap-2">
                {logs.map((log) => {
                  const med = medById.get(log.medication_id);
                  const isEditing = editId === log.id;
                  const editingBoolean = !!med && isBooleanOnly(med);
                  return (
                    <li
                      key={log.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-hairline-soft px-4 py-3"
                    >
                      {isEditing ? (
                        editingBoolean ? (
                          <div className="flex flex-1 flex-wrap items-center gap-2">
                            <span className="text-base font-medium text-ink">복용</span>
                            <input
                              type="time"
                              value={editTime}
                              onChange={(e) => setEditTime(e.target.value)}
                              className="h-11 rounded-lg border border-hairline bg-canvas px-3 text-base text-ink outline-none focus:border-2 focus:border-ink"
                              aria-label="복용 시각"
                            />
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditId(null)}
                              className="rounded-full px-3 py-2 text-sm font-medium text-muted underline"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-1 flex-wrap items-center gap-2">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0.5}
                              step={0.5}
                              value={editQuantity}
                              onChange={(e) => setEditQuantity(e.target.value)}
                              className="h-11 w-20 rounded-lg border border-hairline bg-canvas px-3 text-base text-ink outline-none focus:border-2 focus:border-ink"
                              aria-label="복용 개수"
                            />
                            <span>{med?.unit ?? ""}</span>
                            <input
                              type="time"
                              value={editTime}
                              onChange={(e) => setEditTime(e.target.value)}
                              className="h-11 rounded-lg border border-hairline bg-canvas px-3 text-base text-ink outline-none focus:border-2 focus:border-ink"
                              aria-label="복용 시각"
                            />
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditId(null)}
                              className="rounded-full px-3 py-2 text-sm font-medium text-muted underline"
                            >
                              취소
                            </button>
                          </div>
                        )
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <span className="text-base font-medium text-ink">
                              {formatDateTime(log.taken_at)}
                            </span>
                            <span className="text-base font-medium text-body">
                              {med && isBooleanOnly(med)
                                ? "복용"
                                : `${log.quantity}${med?.unit ?? ""}`}
                            </span>                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                startEdit(log.id, log.quantity, log.taken_at)
                              }
                              className="rounded-full px-3 py-2 text-sm font-medium text-muted underline"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(log.id)}
                              className="rounded-full px-3 py-2 text-sm font-medium text-warning underline"
                            >
                              삭제
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section className="rounded-2xl border border-hairline px-5 py-4">
            <h2 className="text-[20px] font-bold text-ink">{formatKoreanDate(dateKey)} 총 복용량</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {totals.map(([name, total]) => {
                const med = medById.get(name);
                const booleanOnly = !!med && isBooleanOnly(med);
                return (
                  <li key={name} className="text-base text-body">
                    {name} {booleanOnly ? "복용함" : `${total}${med?.unit ?? "정"}`}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {status && (
        <section className="rounded-2xl border border-hairline px-5 py-4">
          <h2 className="text-[20px] font-bold text-ink">상태 기록</h2>
          <dl className="mt-2 flex flex-col gap-1 text-base text-body">
            {status.fatigue && (
              <div className="flex justify-between">
                <dt>피로</dt>
                <dd>{status.fatigue}</dd>
              </div>
            )}
            {status.strength && (
              <div className="flex justify-between">
                <dt>근력</dt>
                <dd>{status.strength}</dd>
              </div>
            )}
            {status.breathing && (
              <div className="flex justify-between">
                <dt>호흡</dt>
                <dd>{status.breathing}</dd>
              </div>
            )}
            {status.eye_symptom && (
              <div className="flex justify-between">
                <dt>눈 증상</dt>
                <dd>{status.eye_symptom}</dd>
              </div>
            )}
            {status.note && (
              <p className="mt-2 border-t border-hairline-soft pt-2 text-body">
                {status.note}
              </p>
            )}
          </dl>
        </section>
      )}

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="삭제 확인"
        >
          <div className="w-full max-w-md rounded-2xl bg-canvas p-6">
            <h2 className="text-[20px] font-bold text-ink">기록을 삭제할까요?</h2>
            <p className="mt-2 text-base text-body">
              삭제한 기록은 되돌릴 수 없습니다.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  if (confirmDeleteId) deleteLog(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="flex min-h-[56px] items-center justify-center rounded-lg bg-warning px-6 text-lg font-bold text-on-primary"
              >
                삭제
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex min-h-[56px] items-center justify-center rounded-lg border border-hairline bg-canvas px-6 text-lg font-bold text-ink"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

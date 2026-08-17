"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Medication } from "@/lib/types";
import { isBooleanOnly, quantityOptionsOf } from "@/lib/types";
import { useDb } from "@/lib/store";
import { formatDateTime } from "@/lib/date";

function MedLogInner() {
  const router = useRouter();
  const params = useSearchParams();
  const medId = params.get("med") ?? "";
  const { db, loading, addLog } = useDb();

  const med: Medication | undefined = useMemo(
    () => db.medications.find((m) => m.id === medId),
    [db.medications, medId]
  );

  const unit = med?.unit ?? "정";

  const [custom, setCustom] = useState<string>("");
  const [customMode, setCustomMode] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  if (!med) {
    if (loading) {
      return (
        <p className="text-muted" role="status">
          불러오는 중...
        </p>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-muted">약을 찾을 수 없습니다.</p>
        <Link
          href="/"
          className="rounded-full border-2 border-ink bg-canvas px-6 py-3 text-base font-semibold text-ink"
        >
          첫 화면으로
        </Link>
      </div>
    );
  }

  const currentMed: Medication = med;
  const booleanOnly = isBooleanOnly(currentMed);
  const quantities = quantityOptionsOf(currentMed);

  function save(quantity: number) {
    const log = addLog({
      medication_id: currentMed.id,
      quantity,
    });
    const suffix = booleanOnly ? "" : ` ${quantity}${unit}`;
    setSaved(
      `${currentMed.name}${suffix} / ${formatDateTime(log.taken_at)} 기록 완료`
    );
    setTimeout(() => {
      router.push("/");
    }, 1200);
  }

  function submitCustom() {
    const n = parseFloat(custom);
    if (!Number.isFinite(n) || n <= 0) return;
    save(n);
  }

  return (
    <main className="flex flex-1 flex-col gap-6">
      <header className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-strong text-ink active:bg-surface-soft"
          aria-label="뒤로 가기"
        >
          ‹
        </button>
        <h1 className="text-[24px] font-bold text-ink">{med.name}</h1>
      </header>

      <p className="text-[20px] font-bold text-ink">
        {booleanOnly ? "오늘 드셨나요?" : `몇 ${unit} 드셨나요?`}
      </p>

      {saved ? (
        <div
          role="status"
          className="rounded-2xl bg-surface-soft px-6 py-5 text-center text-lg font-semibold text-body"
        >
          {saved}
        </div>
      ) : booleanOnly ? (
        <button
          type="button"
          onClick={() => save(1)}
          className="flex min-h-[64px] items-center justify-center rounded-full bg-primary px-6 text-[20px] font-bold text-on-primary active:bg-primary-active"
        >
          복용함
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            {quantities.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => save(q)}
                className="flex min-h-[64px] items-center justify-center rounded-full border border-hairline bg-canvas text-[20px] font-semibold text-ink transition-colors hover:bg-surface-soft active:bg-primary active:text-on-primary"
              >
                {q}{unit}
              </button>
            ))}
          </div>

          {customMode ? (
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-muted" htmlFor="custom-qty">
                복용 개수 직접 입력
              </label>
              <div className="flex gap-3">
                <input
                  id="custom-qty"
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  step={0.5}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="h-14 min-w-0 flex-1 rounded-lg border border-hairline bg-canvas px-4 text-lg text-ink outline-none focus:border-2 focus:border-ink"
                  placeholder={`개수 (${unit})`}
                />
                <button
                  type="button"
                  onClick={submitCustom}
                  className="rounded-full bg-primary px-6 text-lg font-bold text-on-primary active:bg-primary-active"
                >
                  저장
                </button>
              </div>
              <button
                type="button"
                onClick={() => setCustomMode(false)}
                className="self-start rounded-full px-4 py-2 text-base font-medium text-muted underline"
              >
                취소
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className="flex min-h-[64px] items-center justify-center rounded-full border border-hairline bg-canvas text-[20px] font-semibold text-ink transition-colors hover:bg-surface-soft active:bg-surface-strong"
            >
              직접 입력
            </button>
          )}
        </>
      )}
    </main>
  );
}

export default function MedLogPage() {
  return (
    <Suspense fallback={<p className="text-muted">불러오는 중...</p>}>
      <MedLogInner />
    </Suspense>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "@/lib/store";
import { toDateKey } from "@/lib/date";

const statuses = {
  fatigue: { label: "피로", options: ["좋음", "보통", "나쁨"] },
  strength: { label: "근력", options: ["좋음", "보통", "나쁨"] },
  breathing: { label: "호흡", options: ["편안함", "평소와 다름"] },
  eye: { label: "눈 증상", options: ["없음", "있음"] },
} as const;

type StatusKey = keyof typeof statuses;

export default function StatusPage() {
  const router = useRouter();
  const { db, upsertStatus } = useDb();
  const today = toDateKey(new Date());
  const existing = db.daily_status.find((s) => s.date === today);

  const [values, setValues] = useState<Record<StatusKey, string | null>>({
    fatigue: existing?.fatigue ?? null,
    strength: existing?.strength ?? null,
    breathing: existing?.breathing ?? null,
    eye: existing?.eye_symptom ?? null,
  });
  const [note, setNote] = useState<string>(existing?.note ?? "");
  const [saved, setSaved] = useState(false);

  function pick(key: StatusKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    upsertStatus({
      date: today,
      fatigue: values.fatigue,
      strength: values.strength,
      breathing: values.breathing,
      eye_symptom: values.eye,
      note: note.trim() || null,
    });
    setSaved(true);
    setTimeout(() => {
      router.push("/");
    }, 700);
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
        <h1 className="text-[24px] font-bold text-ink">오늘 상태</h1>
      </header>

      {saved ? (
        <div
          role="status"
          className="rounded-2xl bg-surface-soft px-6 py-5 text-center text-lg font-semibold text-body"
        >
          오늘 상태를 기록했습니다.
        </div>
      ) : (
        <>
          {Object.entries(statuses).map(([key, group]) => (
            <section key={key} className="flex flex-col gap-3">
              <h2 className="text-[20px] font-bold text-ink">{group.label}</h2>
              <div className="flex flex-wrap gap-3">
                {group.options.map((opt) => {
                  const selected = values[key as StatusKey] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => pick(key as StatusKey, opt)}
                      aria-pressed={selected}
                      className={
                        selected
                          ? "flex min-h-[56px] items-center justify-center rounded-full bg-primary px-6 text-lg font-semibold text-on-primary"
                          : "flex min-h-[56px] items-center justify-center rounded-full border border-hairline bg-canvas px-6 text-lg font-semibold text-ink"
                      }
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          <section className="flex flex-col gap-2">
            <label
              htmlFor="status-note"
              className="text-[20px] font-bold text-ink"
            >
              기타 메모
            </label>
            <textarea
              id="status-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-hairline bg-canvas px-4 py-3 text-base text-ink outline-none focus:border-2 focus:border-ink"
              placeholder="예: 오후부터 피곤함"
            />
          </section>

          <button
            type="button"
            onClick={save}
            className="mt-2 flex min-h-[56px] w-full items-center justify-center rounded-lg bg-primary px-6 text-lg font-bold text-on-primary active:bg-primary-active"
          >
            저장
          </button>
        </>
      )}
    </main>
  );
}

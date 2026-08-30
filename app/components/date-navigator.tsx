"use client";

import { DatePicker } from "@/app/components/date-time-picker";
import { Button } from "@/components/ui/button";
import {
  addDays,
  formatKoreanFullDate,
  toDateKey,
} from "@/lib/date";

type DateNavigatorProps = {
  value: string;
  onChange: (nextDate: string) => void;
  title?: string;
  inputId: string;
};

export function DateNavigator({
  value,
  onChange,
  title = "기록 날짜",
  inputId,
}: DateNavigatorProps) {
  const todayKey = toDateKey(new Date());
  const previousDateKey = addDays(value, -1);
  const nextDateKey = addDays(value, 1);

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="rounded-2xl border border-hairline px-4 py-4"
    >
      <h2 id={`${inputId}-title`} className="text-sm font-bold text-body">
        {title}
      </h2>
      <div className="mt-2" aria-live="polite" aria-atomic="true">
        <DatePicker
          id={inputId}
          value={value}
          label="날짜 직접 선택"
          onChange={onChange}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(previousDateKey)}
          className="min-h-12 rounded-xl border-hairline bg-canvas px-2 text-base font-bold text-ink hover:bg-surface-soft"
          aria-label={`이전 날짜, ${formatKoreanFullDate(previousDateKey)}`}
        >
          이전 날
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(todayKey)}
          disabled={value === todayKey}
          className="min-h-12 rounded-xl border-ink bg-canvas px-2 text-base font-bold text-ink hover:bg-surface-soft disabled:border-hairline disabled:bg-surface-soft disabled:text-muted"
          aria-label={
            value === todayKey ? "현재 날짜는 오늘" : "오늘 날짜로 이동"
          }
        >
          오늘
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(nextDateKey)}
          className="min-h-12 rounded-xl border-hairline bg-canvas px-2 text-base font-bold text-ink hover:bg-surface-soft"
          aria-label={`다음 날짜, ${formatKoreanFullDate(nextDateKey)}`}
        >
          다음 날
        </Button>
      </div>
    </section>
  );
}

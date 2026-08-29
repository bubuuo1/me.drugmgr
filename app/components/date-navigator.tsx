"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addDays,
  formatKoreanFullDate,
  fromDateKey,
  isToday,
  toDateKey,
} from "@/lib/date";

const dateFormSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택해 주세요.")
    .refine((value) => {
      try {
        fromDateKey(value);
        return true;
      } catch {
        return false;
      }
    }, "올바른 날짜를 선택해 주세요."),
});

type DateFormValues = z.infer<typeof dateFormSchema>;

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
  const errorId = `${inputId}-error`;
  const {
    formState: { errors },
    getValues,
    handleSubmit,
    register,
    reset,
    trigger,
  } = useForm<DateFormValues>({
    resolver: zodResolver(dateFormSchema),
    defaultValues: { date: value },
    mode: "onChange",
  });

  useEffect(() => {
    reset({ date: value });
  }, [reset, value]);

  const dateField = register("date");

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="rounded-2xl border border-hairline px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`${inputId}-title`}
            className="text-sm font-bold text-body"
          >
            {title}
          </h2>
          <time
            dateTime={value}
            aria-live="polite"
            aria-atomic="true"
            className="mt-1 block text-xl font-bold leading-snug text-ink"
          >
            {formatKoreanFullDate(value)}
          </time>
        </div>
        {isToday(value) && (
          <span className="rounded-full bg-surface-soft px-3 py-1 text-sm font-bold text-success">
            오늘
          </span>
        )}
      </div>

      <form
        className="mt-4"
        noValidate
        onSubmit={handleSubmit(({ date }) => onChange(date))}
      >
        <Label htmlFor={inputId} className="text-sm font-bold text-body">
          날짜 직접 선택
        </Label>
        <Input
          {...dateField}
          id={inputId}
          type="date"
          aria-invalid={errors.date ? "true" : "false"}
          aria-describedby={errors.date ? errorId : undefined}
          onChange={(event) => {
            const nextDate = event.target.value;
            dateField.onChange(event);
            void trigger("date").then((valid) => {
              if (valid && getValues("date") === nextDate) {
                onChange(nextDate);
              }
            });
          }}
          className="mt-2 min-h-14 rounded-xl border-hairline bg-canvas px-4 text-lg text-ink md:text-lg"
        />
        {errors.date && (
          <p id={errorId} role="alert" className="mt-2 text-sm font-bold text-error">
            {errors.date.message}
          </p>
        )}

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
      </form>
    </section>
  );
}

"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Minus,
  Plus,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import {
  formatDateTime,
  formatKoreanFullDate,
  fromDateKey,
  toDateKey,
} from "@/lib/date";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const QUICK_MINUTES = ["00", "15", "30", "45"] as const;

type Month = {
  year: number;
  month: number;
};

type SharedPickerProps = {
  id: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
};

type DatePickerProps = SharedPickerProps & {
  value: string;
  label: string;
  onChange: (value: string) => void;
};

type TimePickerProps = SharedPickerProps & {
  value: string;
  label: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  triggerRef?: (element: HTMLButtonElement | null) => void;
};

type DateTimePickerProps = Omit<SharedPickerProps, "describedBy"> & {
  value: string;
  label: string;
  describedBy?: string;
  onChange: (value: string) => void;
};

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`유효하지 않은 날짜입니다: ${value}`);
  fromDateKey(value);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function monthOf(value: string): Month {
  const { year, month } = dateParts(value);
  return { year, month };
}

function dateKeyFromUtc(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function shiftMonth(value: Month, amount: number): Month {
  const shifted = new Date(Date.UTC(value.year, value.month - 1 + amount, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

function calendarDays(value: Month) {
  const firstDay = new Date(Date.UTC(value.year, value.month - 1, 1));
  const start = firstDay.getTime() - firstDay.getUTCDay() * DAY_MS;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start + index * DAY_MS);
    const key = dateKeyFromUtc(date);
    return {
      key,
      day: date.getUTCDate(),
      weekday: date.getUTCDay(),
      inMonth:
        date.getUTCFullYear() === value.year &&
        date.getUTCMonth() + 1 === value.month,
    };
  });
}

function addCalendarDays(value: string, amount: number) {
  const { year, month, day } = dateParts(value);
  return dateKeyFromUtc(
    new Date(Date.UTC(year, month - 1, day) + amount * DAY_MS)
  );
}

function timeParts(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function timeLabel(value: string) {
  const parts = timeParts(value);
  if (!parts) return "시간을 선택하세요";
  const period = parts.hour < 12 ? "오전" : "오후";
  const displayHour = parts.hour % 12 || 12;
  return `${period} ${displayHour}:${String(parts.minute).padStart(2, "0")}`;
}

function currentKoreanTime() {
  return formatDateTime(new Date().toISOString());
}

function PickerPopup({
  title,
  description,
  children,
  initialFocus,
  finalFocus,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/50 opacity-100 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-center sm:p-4">
        <Dialog.Popup
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          className="max-h-[calc(100dvh-0.5rem)] w-full max-w-md overflow-y-auto rounded-t-3xl border border-hairline bg-canvas px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-ink shadow-xl transition-all duration-200 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl sm:px-6 sm:pb-6 sm:pt-5 sm:data-[ending-style]:translate-y-4 sm:data-[ending-style]:opacity-0 sm:data-[starting-style]:translate-y-4 sm:data-[starting-style]:opacity-0"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-bold leading-snug text-ink">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-base leading-relaxed text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              type="button"
              aria-label="선택 창 닫기"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-strong text-ink active:bg-hairline-soft"
            >
              <X className="size-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  );
}

export function DatePicker({
  id,
  value,
  label,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(value));
  const visibleMonthRef = useRef(visibleMonth);
  const [focusedDate, setFocusedDate] = useState(value);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusedButtonRef = useRef<HTMLButtonElement>(null);
  const today = toDateKey(new Date());
  const days = calendarDays(visibleMonth);

  function updateVisibleMonth(nextMonth: Month) {
    visibleMonthRef.current = nextMonth;
    setVisibleMonth(nextMonth);
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      updateVisibleMonth(monthOf(value));
      setFocusedDate(value);
    }
    setOpen(nextOpen);
  }

  function focusDate(nextDate: string) {
    setFocusedDate(nextDate);
    const nextMonth = monthOf(nextDate);
    if (
      nextMonth.year !== visibleMonthRef.current.year ||
      nextMonth.month !== visibleMonthRef.current.month
    ) {
      updateVisibleMonth(nextMonth);
    }
    requestAnimationFrame(() => {
      document.getElementById(`${id}-day-${nextDate}`)?.focus();
    });
  }

  function changeVisibleMonth(amount: number) {
    const nextMonth = shiftMonth(visibleMonthRef.current, amount);
    const nextDate = `${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}-01`;
    updateVisibleMonth(nextMonth);
    setFocusedDate(nextDate);
    requestAnimationFrame(() => {
      document.getElementById(`${id}-day-${nextDate}`)?.focus();
    });
  }

  function handleDayKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    dateKey: string,
    index: number
  ) {
    let nextDate: string | null = null;
    if (event.key === "ArrowLeft") nextDate = addCalendarDays(dateKey, -1);
    if (event.key === "ArrowRight") nextDate = addCalendarDays(dateKey, 1);
    if (event.key === "ArrowUp") nextDate = addCalendarDays(dateKey, -7);
    if (event.key === "ArrowDown") nextDate = addCalendarDays(dateKey, 7);
    if (event.key === "Home") nextDate = addCalendarDays(dateKey, -(index % 7));
    if (event.key === "End") nextDate = addCalendarDays(dateKey, 6 - (index % 7));
    if (!nextDate) return;
    event.preventDefault();
    focusDate(nextDate);
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={`${label}, 현재 ${formatKoreanFullDate(value)}`}
        data-value={value}
        className={cn(
          "flex min-h-16 w-full items-center gap-3 rounded-xl border bg-canvas px-4 py-3 text-left transition-colors active:bg-surface-soft disabled:bg-surface-soft disabled:text-muted",
          invalid ? "border-error" : "border-hairline",
          className
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-soft text-primary-active">
          <CalendarDays className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-muted">{label}</span>
          <time
            dateTime={value}
            className="mt-0.5 block break-words text-lg font-bold leading-snug text-ink"
          >
            {formatKoreanFullDate(value)}
          </time>
        </span>
        <ChevronDown className="size-5 shrink-0 text-muted" aria-hidden="true" />
      </Dialog.Trigger>

      <PickerPopup
        title={`${label} 달력`}
        finalFocus={triggerRef}
        initialFocus={focusedButtonRef}
      >
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => changeVisibleMonth(-1)}
              aria-label="이전 달"
              className="flex size-12 items-center justify-center rounded-full border border-hairline bg-canvas text-ink active:bg-surface-soft"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <p
              aria-live="polite"
              className="text-center text-xl font-bold text-ink"
            >
              {visibleMonth.year}년 {visibleMonth.month}월
            </p>
            <button
              type="button"
              onClick={() => changeVisibleMonth(1)}
              aria-label="다음 달"
              className="flex size-12 items-center justify-center rounded-full border border-hairline bg-canvas text-ink active:bg-surface-soft"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div
            role="grid"
            aria-label={`${visibleMonth.year}년 ${visibleMonth.month}월 달력`}
            className="mt-4"
          >
            <div role="row" className="grid grid-cols-7">
              {WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  role="columnheader"
                  className="flex h-9 items-center justify-center text-sm font-bold text-muted"
                >
                  {weekday}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, rowIndex) => (
              <div key={rowIndex} role="row" className="grid grid-cols-7">
                {days
                  .slice(rowIndex * 7, rowIndex * 7 + 7)
                  .map((date, dayIndex) => {
                    const selected = date.key === value;
                    const current = date.key === today;
                    const focused = date.key === focusedDate;
                    const stateLabel = selected
                      ? current
                        ? ", 오늘, 선택됨"
                        : ", 선택됨"
                      : current
                        ? ", 오늘"
                        : "";
                    return (
                      <div
                        key={date.key}
                        role="gridcell"
                        aria-selected={selected}
                        className="min-w-0"
                      >
                        <button
                          ref={focused ? focusedButtonRef : undefined}
                          id={`${id}-day-${date.key}`}
                          type="button"
                          tabIndex={focused ? 0 : -1}
                          aria-label={`${dateParts(date.key).month}월 ${date.day}일 ${WEEKDAYS[date.weekday]}요일${stateLabel}`}
                          aria-current={current ? "date" : undefined}
                          data-date={date.key}
                          onFocus={() => setFocusedDate(date.key)}
                          onKeyDown={(event) =>
                            handleDayKeyDown(
                              event,
                              date.key,
                              rowIndex * 7 + dayIndex
                            )
                          }
                          onClick={() => {
                            onChange(date.key);
                            setOpen(false);
                          }}
                          className={cn(
                            "relative flex min-h-14 w-full min-w-0 flex-col items-center justify-center rounded-full text-base font-bold outline-none transition-colors",
                            selected
                              ? current
                                ? "bg-primary-active text-on-primary ring-2 ring-inset ring-on-primary"
                                : "bg-primary-active text-on-primary"
                              : current
                                ? "border-2 border-primary-active bg-canvas text-primary-active"
                                : date.inMonth
                                  ? "text-ink hover:bg-surface-soft"
                                  : "text-muted hover:bg-surface-soft"
                          )}
                        >
                          <span>{date.day}</span>
                          {selected ? (
                            <span className="flex items-center gap-0.5 text-xs leading-none">
                              <Check className="size-3" aria-hidden="true" />
                              {current ? "오늘·선택" : "선택"}
                            </span>
                          ) : current ? (
                            <span className="text-xs leading-none">오늘</span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </PickerPopup>
    </Dialog.Root>
  );
}

function TimeNumberField({
  label,
  value,
  max,
  onChange,
  inputRef,
  errorId,
}: {
  label: "시" | "분";
  value: string;
  max: number;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  errorId: string;
}) {
  const numeric = Number(value);
  const valid = /^\d{1,2}$/.test(value) && numeric >= 0 && numeric <= max;

  function adjust(amount: number) {
    const base = valid ? numeric : 0;
    const next = (base + amount + max + 1) % (max + 1);
    onChange(String(next).padStart(2, "0"));
  }

  return (
    <div className="rounded-2xl bg-surface-soft p-2">
      <p className="text-center text-sm font-bold text-muted">{label}</p>
      <div className="mt-2 grid grid-cols-2 items-center gap-1 min-[430px]:grid-cols-[3rem_minmax(3rem,1fr)_3rem] min-[430px]:gap-0.5">
        <button
          type="button"
          onClick={() => adjust(-1)}
          aria-label={`${label} 1 내리기`}
          className="col-start-1 row-start-2 flex size-12 w-full items-center justify-center rounded-full border border-hairline bg-canvas text-primary-active active:bg-surface-strong min-[430px]:row-start-1 min-[430px]:w-12"
        >
          <Minus className="size-5" aria-hidden="true" />
        </button>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, "").slice(0, 2))
          }
          onBlur={() => {
            if (valid) onChange(String(numeric).padStart(2, "0"));
          }}
          aria-label={label}
          aria-invalid={!valid}
          aria-describedby={!valid ? errorId : undefined}
          className="col-span-2 col-start-1 row-start-1 h-14 min-w-0 w-full rounded-xl border border-hairline bg-canvas px-1 text-center text-2xl font-bold text-ink outline-none focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-ink/20 aria-invalid:border-error aria-invalid:ring-error/20 min-[430px]:col-span-1 min-[430px]:col-start-2 min-[430px]:h-16"
        />
        <button
          type="button"
          onClick={() => adjust(1)}
          aria-label={`${label} 1 올리기`}
          className="col-start-2 row-start-2 flex size-12 w-full items-center justify-center rounded-full border border-hairline bg-canvas text-primary-active active:bg-surface-strong min-[430px]:col-start-3 min-[430px]:row-start-1 min-[430px]:w-12"
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function TimePicker({
  id,
  value,
  label,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  className,
  onBlur,
  triggerRef: externalTriggerRef,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const fallback = timeParts(currentKoreanTime()) ?? { hour: 0, minute: 0 };
  const initial = timeParts(value) ?? fallback;
  const [hour, setHour] = useState(String(initial.hour).padStart(2, "0"));
  const [minute, setMinute] = useState(String(initial.minute).padStart(2, "0"));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hourInputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const validHour = /^\d{1,2}$/.test(hour) && hourNumber <= 23;
  const validMinute = /^\d{1,2}$/.test(minute) && minuteNumber <= 59;
  const validDraft = validHour && validMinute;
  const setTriggerRef = useCallback(
    (element: HTMLButtonElement | null) => {
      triggerRef.current = element;
      externalTriggerRef?.(element);
    },
    [externalTriggerRef]
  );

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      const next = timeParts(value) ?? timeParts(currentKoreanTime()) ?? fallback;
      setHour(String(next.hour).padStart(2, "0"));
      setMinute(String(next.minute).padStart(2, "0"));
    }
    setOpen(nextOpen);
  }

  function applyTime() {
    if (!validDraft) return;
    onChange(
      `${String(hourNumber).padStart(2, "0")}:${String(minuteNumber).padStart(2, "0")}`
    );
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger
        ref={setTriggerRef}
        id={id}
        type="button"
        onBlur={onBlur}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={`${label}, 현재 ${timeLabel(value)}`}
        data-value={value}
        className={cn(
          "flex min-h-16 w-full items-center gap-3 rounded-xl border bg-canvas px-4 py-3 text-left transition-colors active:bg-surface-soft disabled:bg-surface-soft disabled:text-muted",
          invalid ? "border-error" : "border-hairline",
          className
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-soft text-primary-active">
          <Clock3 className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-muted">{label}</span>
          <span
            className={cn(
              "mt-0.5 block text-lg font-bold leading-snug",
              value ? "text-ink" : "text-muted"
            )}
          >
            {timeLabel(value)}
          </span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-muted" aria-hidden="true" />
      </Dialog.Trigger>

      <PickerPopup
        title={`${label} 선택`}
        description="시와 분을 선택하세요. 1분 단위로 입력할 수 있습니다."
        initialFocus={hourInputRef}
        finalFocus={triggerRef}
      >
        <div className="mt-5 grid grid-cols-2 items-start gap-2 min-[430px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[430px]:items-center">
          <TimeNumberField
            label="시"
            value={hour}
            max={23}
            onChange={setHour}
            inputRef={hourInputRef}
            errorId={errorId}
          />
          <span
            className="hidden text-3xl font-bold text-muted min-[430px]:block"
            aria-hidden="true"
          >
            :
          </span>
          <TimeNumberField
            label="분"
            value={minute}
            max={59}
            onChange={setMinute}
            errorId={errorId}
          />
        </div>

        <div className="mt-5">
          <p className="text-sm font-bold text-body">빠른 분 선택</p>
          <div className="mt-2 grid grid-cols-4 gap-2" role="group" aria-label="빠른 분 선택">
            {QUICK_MINUTES.map((option) => {
              const selected = minute === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMinute(option)}
                  className={cn(
                    "min-h-12 rounded-full border px-2 text-base font-bold",
                    selected
                      ? "border-primary-active bg-primary-active text-on-primary"
                      : "border-hairline bg-canvas text-ink active:bg-surface-soft"
                  )}
                >
                  {option}분
                  {selected && <span className="sr-only"> 선택됨</span>}
                </button>
              );
            })}
          </div>
        </div>

        {!validDraft && (
          <p id={errorId} role="alert" className="mt-4 text-base font-bold text-error">
            시는 00~23, 분은 00~59 사이로 입력해 주세요.
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Dialog.Close
            type="button"
            className="min-h-14 rounded-xl border-2 border-ink bg-canvas px-4 text-lg font-bold text-ink active:bg-surface-soft"
          >
            취소
          </Dialog.Close>
          <button
            type="button"
            onClick={applyTime}
            disabled={!validDraft}
            aria-describedby={!validDraft ? errorId : undefined}
            className="min-h-14 rounded-xl bg-primary-active px-4 text-lg font-bold text-on-primary disabled:bg-primary-disabled disabled:text-body"
          >
            선택 완료
          </button>
        </div>
      </PickerPopup>
    </Dialog.Root>
  );
}

export function DateTimePicker({
  id,
  value,
  label,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  className,
}: DateTimePickerProps) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  const date = match?.[1] ?? toDateKey(new Date());
  const time = match?.[2] ?? currentKoreanTime();
  const dateLabel = label.endsWith("시각")
    ? `${label.slice(0, -2)}날짜`
    : `${label} 날짜`;
  const timePickerLabel = label.endsWith("시각")
    ? `${label.slice(0, -2)}시간`
    : `${label} 시간`;

  return (
    <fieldset
      disabled={disabled}
      aria-describedby={describedBy}
      className={cn("min-w-0", className)}
    >
      <legend className="text-xl font-bold text-ink">{label}</legend>
      <div className="mt-3 grid gap-3 min-[380px]:grid-cols-2">
        <DatePicker
          id={`${id}-date`}
          value={date}
          label={dateLabel}
          onChange={(nextDate) => onChange(`${nextDate}T${time}`)}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
        />
        <TimePicker
          id={`${id}-time`}
          value={time}
          label={timePickerLabel}
          onChange={(nextTime) => onChange(`${date}T${nextTime}`)}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
        />
      </div>
    </fieldset>
  );
}

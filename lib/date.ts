export const KOREA_TIME_ZONE = "Asia/Seoul";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const kstDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: KOREA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const kstTimeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: KOREA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const kstFullDate = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KOREA_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("유효하지 않은 날짜입니다.");
  }
}

function parseDateKey(key: string): { year: number; month: number; day: number } {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) {
    throw new RangeError(`유효하지 않은 날짜 키입니다: ${key}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new RangeError(`존재하지 않는 날짜입니다: ${key}`);
  }

  return { year, month, day };
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) throw new Error(`날짜 형식에서 ${type} 값을 찾지 못했습니다.`);
  return value;
}

/** Returns a calendar date in Asia/Seoul regardless of the runtime timezone. */
export function toDateKey(date: Date): string {
  assertValidDate(date);
  const parts = kstDateParts.formatToParts(date);
  const year = partValue(parts, "year");
  const month = partValue(parts, "month");
  const day = partValue(parts, "day");
  return `${year}-${month}-${day}`;
}

/** Returns the instant corresponding to 00:00:00 in Asia/Seoul for the date key. */
export function fromDateKey(key: string): Date {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

export function addDays(key: string, delta: number): string {
  if (!Number.isInteger(delta)) {
    throw new RangeError("날짜 이동 값은 정수여야 합니다.");
  }
  const { year, month, day } = parseDateKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day) + delta * DAY_MS);
  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function formatKoreanDate(key: string): string {
  const { month, day } = parseDateKey(key);
  return `${month}월 ${day}일`;
}

export function formatKoreanFullDate(key: string): string {
  return kstFullDate.format(fromDateKey(key));
}

/** Formats an ISO instant as HH:mm in Asia/Seoul. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  assertValidDate(date);
  const parts = kstTimeParts.formatToParts(date);
  return `${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

/** Converts a Korean calendar date and time into a UTC ISO timestamp. */
export function toKstDateTimeIso(dateKey: string, time: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new RangeError(`유효하지 않은 시각입니다: ${time}`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    throw new RangeError(`유효하지 않은 시각입니다: ${time}`);
  }

  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - KST_OFFSET_MS
  ).toISOString();
}

/** Formats an instant for a datetime-local field using the Korean timezone. */
export function formatKstDateTimeInput(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  assertValidDate(date);
  return `${toDateKey(date)}T${formatDateTime(date.toISOString())}`;
}

/** Parses a timezone-less datetime-local value as a Korean calendar time. */
export function parseKstDateTimeInput(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(
    value
  );
  if (!match) throw new RangeError(`유효하지 않은 한국 시각입니다: ${value}`);
  return toKstDateTimeIso(
    match[1],
    match[3] ? `${match[2]}:${match[3]}` : match[2]
  );
}

export function isToday(key: string): boolean {
  parseDateKey(key);
  return key === toDateKey(new Date());
}

/**
 * Day-granularity date handling. Everything is a `YYYY-MM-DD` string; the only
 * Date objects that exist are transient and pinned to UTC noon so DST can never
 * shift a day boundary under us.
 */

export type ISODate = string;

const DAY_MS = 86_400_000;

export function toDate(d: ISODate): Date {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) throw new Error(`bad date: ${d}`);
  return new Date(Date.UTC(y, m - 1, day, 12));
}

export function fromDate(dt: Date): ISODate {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local calendar today, as an ISODate. */
export function today(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDate(new Date(toDate(d).getTime() + n * DAY_MS));
}

/** b - a, in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekday(d: ISODate): number {
  return toDate(d).getUTCDay();
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function dayName(d: ISODate): string {
  return DAY_NAMES[weekday(d)]!;
}

/**
 * "daily" | "weekdays" | "weekends" | "mon-fri" | "mon,wed,fri" -> weekday numbers.
 */
export function parseDays(spec: string): number[] {
  const s = spec.trim().toLowerCase();
  if (!s || s === "daily" || s === "everyday") return [0, 1, 2, 3, 4, 5, 6];
  if (s === "weekdays") return [1, 2, 3, 4, 5];
  if (s === "weekends") return [0, 6];

  const out = new Set<number>();
  for (const part of s.split(",")) {
    const range = part.trim().split("-");
    if (range.length === 2) {
      const a = DAY_NAMES.indexOf(range[0]!.trim().slice(0, 3));
      const b = DAY_NAMES.indexOf(range[1]!.trim().slice(0, 3));
      if (a < 0 || b < 0) throw new Error(`bad day range: ${part}`);
      for (let i = a; ; i = (i + 1) % 7) {
        out.add(i);
        if (i === b) break;
      }
    } else {
      const i = DAY_NAMES.indexOf(part.trim().slice(0, 3));
      if (i < 0) throw new Error(`bad day: ${part}`);
      out.add(i);
    }
  }
  if (out.size === 0) throw new Error(`no days in: ${spec}`);
  return [...out].sort((a, b) => a - b);
}

export function formatDays(days: number[]): string {
  if (days.length === 7) return "daily";
  return days.map((d) => DAY_NAMES[d]).join(",");
}

/** First session day on or after `d`. */
export function nextSessionOnOrAfter(d: ISODate, days: number[]): ISODate {
  for (let i = 0; i < 7; i++) {
    const c = addDays(d, i);
    if (days.includes(weekday(c))) return c;
  }
  throw new Error("no session days configured");
}

export function nextSessionAfter(d: ISODate, days: number[]): ISODate {
  return nextSessionOnOrAfter(addDays(d, 1), days);
}

/** Session days in [start, end] inclusive. */
export function countSessions(start: ISODate, end: ISODate, days: number[]): number {
  if (end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (days.includes(weekday(d))) n++;
  }
  return n;
}

/** The `count`th session day on or after `start` (1-indexed). */
export function nthSessionFrom(start: ISODate, days: number[], count: number): ISODate {
  if (count < 1) throw new Error("count must be >= 1");
  let d = nextSessionOnOrAfter(start, days);
  for (let i = 1; i < count; i++) d = nextSessionAfter(d, days);
  return d;
}

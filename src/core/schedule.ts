import { snapTarget, snapTolerance } from "./chunks.js";
import {
  addDays,
  countSessions,
  maxDate,
  nextSessionOnOrAfter,
  type ISODate,
} from "./time.js";
import type { Commitment, Item, PointCommitment, SeriesCommitment, State } from "./types.js";

export interface Todo {
  id: string;
  commitmentId: string;
  itemId: string;
  title: string;
  date: ISODate;
  kind: "point" | "series";
  /** What the user actually reads on the card. */
  label: string;
  /** Series only: cumulative unit count this session lands on. */
  targetCumulative?: number;
  fromCumulative?: number;
  unit?: string;
  /** True when this todo is the one owed right now (rather than a projection). */
  due: boolean;
}

const MAX_SESSIONS = 5000;

/**
 * Effective rate. Held constant as you fall behind — that is the whole
 * product. Only a commitment explicitly flagged `hardDeadline` gets its rate
 * recalculated upward to protect the end date.
 */
export function effectiveRate(c: SeriesCommitment, from: ISODate): number {
  if (!c.hardDeadline) return c.rate;
  const start = maxDate(from, c.nextDueDate);
  const sessions = countSessions(start, c.endDate, c.sessionDays);
  const remaining = c.total - c.progress;
  if (remaining <= 0) return c.rate;
  if (sessions <= 0) return remaining; // deadline is here: it's all owed now
  return Math.max(c.rate, Math.ceil(remaining / sessions));
}

function seriesLabel(c: SeriesCommitment, to: number, snapped: { label?: string; inside?: string }): string {
  const verb = c.unit === "page" || c.unit === "chapter" ? "Read" : "Watch";
  if (snapped.label) {
    if (c.unit === "page") return `${verb} to the end of ${snapped.label} (p. ${to})`;
    return `${verb} through ${snapped.label}`;
  }
  const mid = snapped.inside ? ` (into ${snapped.inside})` : "";
  if (c.unit === "page") return `${verb} to p. ${to}${mid}`;
  if (c.unit === "minute") return `${verb} to ${to} min`;
  return `${verb} through ${c.unit} ${to}${mid}`;
}

/**
 * Generate the forward sessions for a series, starting from wherever the user
 * actually is. Sessions are never dated in the past: a missed day means the
 * same chunk shows up today and the projected finish recedes. Nothing is late.
 */
export function seriesSessions(
  c: SeriesCommitment,
  from: ISODate,
  opts: { until?: ISODate; limit?: number } = {},
): Todo[] {
  const out: Todo[] = [];
  if (c.progress >= c.total) return out;

  const rate = effectiveRate(c, from);
  let cum = c.progress;
  let d = nextSessionOnOrAfter(maxDate(c.nextDueDate, from), c.sessionDays);
  let i = 0;

  const tolerance = snapTolerance(rate);

  while (cum < c.total && i < (opts.limit ?? MAX_SESSIONS)) {
    if (opts.until && d > opts.until) break;
    const snapped = snapTarget(cum, cum + rate, c.total, c.chunks, tolerance);
    out.push({
      id: `${c.id}:${d}`,
      commitmentId: c.id,
      itemId: c.itemId,
      title: "",
      date: d,
      kind: "series",
      label: seriesLabel(c, snapped.end, snapped),
      fromCumulative: cum,
      targetCumulative: snapped.end,
      unit: c.unit,
      due: i === 0,
    });
    cum = snapped.end;
    i++;
    d = nextSessionOnOrAfter(addDays(d, 1), c.sessionDays);
  }
  return out;
}

/** Where this series actually lands if the current rate holds from today. */
export function projectedFinish(c: SeriesCommitment, from: ISODate): ISODate | undefined {
  const sessions = seriesSessions(c, from);
  return sessions.at(-1)?.date;
}

export function pointTodo(c: PointCommitment, from: ISODate): Todo {
  // A missed point commitment slides to today rather than going overdue.
  const date = maxDate(c.plannedFor, from);
  return {
    id: `${c.id}:${date}`,
    commitmentId: c.id,
    itemId: c.itemId,
    title: "",
    date,
    kind: "point",
    label: "",
    due: date === from,
  };
}

function pointLabel(item: Item): string {
  const verb =
    item.format === "film" || item.format === "tv"
      ? "Watch"
      : item.format === "album"
        ? "Listen to"
        : "Read";
  const len = item.minutes ? ` (${item.minutes} min)` : "";
  return `${verb} ${item.title}${len}`;
}

/** Todos for every active commitment across a rolling window. */
export function planWindow(state: State, from: ISODate, days: number): Todo[] {
  const until = addDays(from, days - 1);
  const items = new Map(state.items.map((i) => [i.id, i]));
  const out: Todo[] = [];

  for (const c of state.commitments) {
    if (c.state !== "active") continue;
    const item = items.get(c.itemId);
    if (!item) continue;

    if (c.kind === "series") {
      for (const t of seriesSessions(c, from, { until })) {
        out.push({ ...t, title: item.title, label: `${t.label} — ${item.title}` });
      }
    } else {
      const t = pointTodo(c, from);
      if (t.date <= until) out.push({ ...t, title: item.title, label: pointLabel(item) });
    }
  }

  out.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? -1 : 1));
  return out;
}

export function groupByDate(todos: Todo[]): Map<ISODate, Todo[]> {
  const m = new Map<ISODate, Todo[]>();
  for (const t of todos) {
    const list = m.get(t.date) ?? [];
    list.push(t);
    m.set(t.date, list);
  }
  return m;
}

/** The lightest day in the window — where an unplaced point commitment goes. */
export function lightestDay(state: State, from: ISODate, days: number): ISODate {
  const counts = new Map<ISODate, number>();
  for (let i = 0; i < days; i++) counts.set(addDays(from, i), 0);
  for (const t of planWindow(state, from, days)) {
    counts.set(t.date, (counts.get(t.date) ?? 0) + 1);
  }
  let best = from;
  let bestN = Infinity;
  for (const [d, n] of counts) {
    if (n < bestN) {
      bestN = n;
      best = d;
    }
  }
  return best;
}

export function commitmentFor(state: State, itemId: string): Commitment | undefined {
  return state.commitments.find((c) => c.itemId === itemId);
}

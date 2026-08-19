import { snapTarget, snapTolerance } from "./chunks.js";
import { deriveSeries } from "./derive.js";
import { effectiveRate, lightestDay, seriesSessions } from "./schedule.js";
import {
  addDays,
  diffDays,
  maxDate,
  nextSessionOnOrAfter,
  parseDays,
  today,
  type ISODate,
} from "./time.js";
import {
  POINT_FORMATS,
  UNIT_FOR_FORMAT,
  type Chunk,
  type Commitment,
  type EventType,
  type Format,
  type Item,
  type SeriesCommitment,
  type State,
  type Unit,
} from "./types.js";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function log(
  state: State,
  type: EventType,
  c: Commitment,
  date: ISODate,
  reason?: string,
  meta?: Record<string, unknown>,
) {
  state.events.push({
    at: new Date().toISOString(),
    date,
    type,
    commitmentId: c.id,
    itemId: c.itemId,
    ...(reason ? { reason } : {}),
    ...(meta ? { meta } : {}),
  });
}

// --- shelf -------------------------------------------------------------

export function addItem(
  state: State,
  input: Omit<Item, "id" | "addedAt"> & { addedAt?: ISODate },
): Item {
  const item: Item = { ...input, id: newId("itm"), addedAt: input.addedAt ?? today() };
  state.items.push(item);
  return item;
}

export function findItem(state: State, ref: string): Item | undefined {
  const lower = ref.toLowerCase();
  return (
    state.items.find((i) => i.id === ref) ??
    state.items.find((i) => i.title.toLowerCase() === lower) ??
    state.items.find((i) => i.title.toLowerCase().includes(lower))
  );
}

export function findCommitment(state: State, ref: string): Commitment | undefined {
  const byId = state.commitments.find((c) => c.id === ref);
  if (byId) return byId;
  const item = findItem(state, ref);
  if (!item) return undefined;
  const active = state.commitments.filter((c) => c.itemId === item.id);
  return active.find((c) => c.state === "active") ?? active.at(-1);
}

export function itemOf(state: State, c: Commitment): Item | undefined {
  return state.items.find((i) => i.id === c.itemId);
}

// --- pacing ------------------------------------------------------------

export interface PaceInput {
  total?: number;
  rate?: number;
  endDate?: ISODate;
  startDate?: ISODate;
  days?: string;
  unit?: Unit;
  chunks?: Chunk[];
  hardDeadline?: boolean;
  progress?: number;
}

/** Turn a shelved item into a paced series commitment. */
export function paceSeries(state: State, item: Item, input: PaceInput): SeriesCommitment {
  const startDate = input.startDate ?? today();
  const sessionDays = parseDays(input.days ?? "daily");
  const d = deriveSeries({
    total: input.total,
    rate: input.rate,
    endDate: input.endDate,
    startDate,
    sessionDays,
  });

  const c: SeriesCommitment = {
    id: newId("cmt"),
    itemId: item.id,
    kind: "series",
    state: "active",
    createdAt: today(),
    lastTouchedAt: today(),
    unit: input.unit ?? UNIT_FOR_FORMAT[item.format],
    total: d.total,
    rate: d.rate,
    sessionDays,
    startDate,
    endDate: d.endDate,
    intent: d.intent,
    hardDeadline: input.hardDeadline ?? false,
    progress: input.progress ?? 0,
    chunks: input.chunks ?? [],
    nextDueDate: nextSessionOnOrAfter(startDate, sessionDays),
  };
  state.commitments.push(c);
  log(state, "activated", c, today(), undefined, { intent: d.intent, rate: d.rate });
  return c;
}

/** Turn a shelved item into a single todo on a date. */
export function pacePoint(state: State, item: Item, on?: ISODate): Commitment {
  const date = on ?? lightestDay(state, today(), state.settings.horizonDays);
  const c: Commitment = {
    id: newId("cmt"),
    itemId: item.id,
    kind: "point",
    state: "active",
    createdAt: today(),
    lastTouchedAt: today(),
    plannedFor: date,
  };
  state.commitments.push(c);
  log(state, "activated", c, date);
  return c;
}

export function defaultKindFor(format: Format): "point" | "series" {
  return POINT_FORMATS.includes(format) ? "point" : "series";
}

// --- progress ----------------------------------------------------------

/**
 * Record where the user actually is and advance the schedule by however many
 * whole sessions that covers.
 *
 * This is where "credit rolls forward" lives: read 90 pages on Sunday at 40/night
 * and two sessions are banked, so Monday is free and Tuesday is the next due day.
 * It is also why nothing is ever late: if the progress covers no sessions,
 * `nextDueDate` does not move, and the same chunk simply reappears.
 */
export function recordProgress(
  state: State,
  c: SeriesCommitment,
  newProgress: number,
  on: ISODate = today(),
  type: EventType = "resync",
  reason?: string,
): void {
  const clamped = Math.max(0, Math.min(newProgress, c.total));
  const rate = effectiveRate(c, on);

  let cum = c.progress;
  let due = nextSessionOnOrAfter(maxDate(c.nextDueDate, on), c.sessionDays);
  let banked = 0;
  const tolerance = snapTolerance(rate);

  while (cum < c.total) {
    const snapped = snapTarget(cum, cum + rate, c.total, c.chunks, tolerance);
    if (clamped < snapped.end) break;
    cum = snapped.end;
    banked++;
    due = nextSessionOnOrAfter(addDays(due, 1), c.sessionDays);
  }

  c.progress = clamped;
  c.nextDueDate = due;
  c.lastTouchedAt = on;

  if (c.progress >= c.total) {
    c.state = "done";
    log(state, "complete", c, on, reason);
    return;
  }
  log(state, type, c, on, reason, { progress: clamped, banked });
}

/** Check off the session that is due. */
export function completeDue(state: State, c: Commitment, on: ISODate = today(), reason?: string): void {
  if (c.kind === "point") {
    c.state = "done";
    c.lastTouchedAt = on;
    log(state, "complete", c, on, reason);
    return;
  }
  const next = seriesSessions(c, on, { limit: 1 })[0];
  if (!next) {
    c.state = "done";
    c.lastTouchedAt = on;
    log(state, "complete", c, on, reason);
    return;
  }
  recordProgress(state, c, next.targetCumulative!, on, "done", reason);
}

/**
 * Free, one-tap, consequence-free. A deferral moves the next session forward and
 * records why — the deferral log is the only thing here that compounds.
 */
export function defer(
  state: State,
  c: Commitment,
  days = 1,
  on: ISODate = today(),
  reason?: string,
): void {
  if (c.kind === "point") {
    c.plannedFor = addDays(maxDate(c.plannedFor, on), days);
  } else {
    c.nextDueDate = nextSessionOnOrAfter(addDays(maxDate(c.nextDueDate, on), days), c.sessionDays);
  }
  c.lastTouchedAt = on;
  log(state, "defer", c, on, reason, { days });
}

export function drop(state: State, c: Commitment, on: ISODate = today(), reason?: string): void {
  c.state = "dropped";
  c.lastTouchedAt = on;
  log(state, "drop", c, on, reason);
}

/** Back to the shelf, keeping progress. Not a failure state. */
export function shelve(state: State, c: Commitment, on: ISODate = today()): void {
  c.state = "pooled";
  c.lastTouchedAt = on;
  log(state, "expire", c, on, "shelved by hand");
}

/**
 * Untouched for ~3 weeks -> quietly back to the shelf. No overdue badge, no red
 * count, no cascade. Progress is kept so picking it up again is cheap.
 */
export function sweepExpired(state: State, on: ISODate = today()): Commitment[] {
  const expired: Commitment[] = [];
  for (const c of state.commitments) {
    if (c.state !== "active") continue;
    if (diffDays(c.lastTouchedAt, on) >= state.settings.expireAfterDays) {
      c.state = "expired";
      expired.push(c);
      log(state, "expire", c, on, "untouched");
    }
  }
  return expired;
}

/** Bring an expired/pooled commitment back without resetting anything. */
export function resume(state: State, c: Commitment, on: ISODate = today()): void {
  c.state = "active";
  c.lastTouchedAt = on;
  if (c.kind === "series") {
    c.nextDueDate = nextSessionOnOrAfter(on, c.sessionDays);
  } else {
    c.plannedFor = maxDate(c.plannedFor, on);
  }
  log(state, "activated", c, on, "resumed");
}

/** Deferral signal: what this person keeps pushing. Thin now, compounds later. */
export function deferralCounts(state: State): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of state.events) {
    if (e.type !== "defer") continue;
    m.set(e.itemId, (m.get(e.itemId) ?? 0) + 1);
  }
  return m;
}

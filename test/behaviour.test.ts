import { beforeEach, describe, expect, it } from "vitest";
import {
  addItem,
  completeDue,
  defer,
  pacePoint,
  paceSeries,
  recordProgress,
  resume,
  sweepExpired,
} from "../src/core/actions.js";
import { parseChapters } from "../src/core/chunks.js";
import { planWindow, projectedFinish, seriesSessions } from "../src/core/schedule.js";
import { emptyState } from "../src/core/store.js";
import type { SeriesCommitment, State } from "../src/core/types.js";

const START = "2026-07-25";

function book(state: State, extra: Parameters<typeof paceSeries>[2] = {}): SeriesCommitment {
  const item = addItem(state, {
    title: "The Magic Mountain",
    format: "book",
    source: "manual",
    addedAt: START,
  });
  return paceSeries(state, item, { total: 706, rate: 40, days: "daily", startDate: START, ...extra });
}

let state: State;
beforeEach(() => {
  state = emptyState();
});

/** Craft behaviour 1: what happens when you miss. */
describe("falling behind pushes the date and holds the rate", () => {
  it("re-presents the same chunk today rather than going overdue", () => {
    const c = book(state);
    const sessions = seriesSessions(c, "2026-07-30"); // five days of silence
    expect(sessions[0]!.date).toBe("2026-07-30");
    expect(sessions[0]!.targetCumulative).toBe(40); // still 40, not 240
    expect(sessions[0]!.due).toBe(true);
  });

  it("lets the projected finish recede by exactly the days missed", () => {
    const c = book(state);
    expect(projectedFinish(c, START)).toBe("2026-08-11");
    expect(projectedFinish(c, "2026-07-30")).toBe("2026-08-16");
  });

  it("never dates a session in the past, so nothing is ever late", () => {
    const c = book(state);
    const from = "2026-08-05";
    for (const t of seriesSessions(c, from, { limit: 5 })) expect(t.date >= from).toBe(true);
  });

  it("recalculates the rate only when the user flagged a real deadline", () => {
    const soft = book(state);
    const hard = book(state, { hardDeadline: true });
    // Two weeks gone, nothing read.
    expect(seriesSessions(soft, "2026-08-08")[0]!.targetCumulative).toBe(40);
    expect(seriesSessions(hard, "2026-08-08")[0]!.targetCumulative).toBeGreaterThan(40);
  });
});

/** Craft behaviour 2: what happens when you're ahead. */
describe("credit rolls forward", () => {
  it("banks whole sessions and gives the next day off", () => {
    const c = book(state);
    recordProgress(state, c, 90, START); // 90 pages at 40/night = two sessions banked
    expect(c.nextDueDate).toBe("2026-07-27");

    const todos = planWindow(state, "2026-07-26", 3);
    expect(todos.filter((t) => t.date === "2026-07-26")).toHaveLength(0);
    expect(todos.filter((t) => t.date === "2026-07-27")).toHaveLength(1);
  });

  it("carries the surplus into the next target rather than resetting it", () => {
    const c = book(state);
    recordProgress(state, c, 90, START);
    expect(seriesSessions(c, "2026-07-27")[0]!.targetCumulative).toBe(130);
  });

  it("spends a small surplus on a rest day, not on an earlier finish", () => {
    const c = book(state);
    const before = projectedFinish(c, START);
    recordProgress(state, c, 90, START); // two sessions banked, 10 pages spare
    expect(projectedFinish(c, "2026-07-27")).toBe(before);
  });

  it("pulls the finish in once the surplus is worth a whole session", () => {
    const c = book(state);
    const before = projectedFinish(c, START);
    recordProgress(state, c, 150, START); // three banked, 30 pages spare
    expect(projectedFinish(c, "2026-07-28")! < before!).toBe(true);
  });

  it("does not advance on partial progress, and does not punish it either", () => {
    const c = book(state);
    recordProgress(state, c, 25, START);
    expect(c.nextDueDate).toBe(START);
    expect(c.rate).toBe(40);
    expect(seriesSessions(c, START)[0]!.targetCumulative).toBe(65); // 25 already banked
  });
});

/** Craft behaviour 3: the slate on a bad day. */
describe("a bad day costs nothing", () => {
  it("deferring moves the next session and changes no numbers", () => {
    const c = book(state);
    defer(state, c, 1, START, "too heavy tonight");
    expect(c.nextDueDate).toBe("2026-07-26");
    expect(c.rate).toBe(40);
    expect(seriesSessions(c, START)[0]!.date).toBe("2026-07-26");
    expect(state.events.at(-1)!.reason).toBe("too heavy tonight");
  });

  it("slides a missed one-sitting commitment forward instead of flagging it", () => {
    const item = addItem(state, { title: "Chungking Express", format: "film", source: "manual" });
    const c = pacePoint(state, item, START);
    const todos = planWindow(state, "2026-08-02", 3);
    expect(todos).toHaveLength(1);
    expect(todos[0]!.date).toBe("2026-08-02");
    expect(c.state).toBe("active");
  });

  it("checking off advances exactly one session", () => {
    const c = book(state);
    completeDue(state, c, START);
    expect(c.progress).toBe(40);
    expect(c.nextDueDate).toBe("2026-07-26");
  });
});

/** Craft behaviour 4: dying quietly. */
describe("quiet expiry", () => {
  it("drops back to the shelf after three untouched weeks, keeping progress", () => {
    const c = book(state);
    recordProgress(state, c, 120, START);
    const expired = sweepExpired(state, "2026-08-15");
    expect(expired).toHaveLength(1);
    expect(c.state).toBe("expired");
    expect(c.progress).toBe(120);
    expect(planWindow(state, "2026-08-15", 7)).toHaveLength(0);
  });

  it("leaves it alone while it is still being touched", () => {
    const c = book(state);
    recordProgress(state, c, 120, "2026-08-10");
    expect(sweepExpired(state, "2026-08-15")).toHaveLength(0);
    expect(c.state).toBe("active");
  });

  it("resumes without resetting anything", () => {
    const c = book(state);
    recordProgress(state, c, 120, START);
    sweepExpired(state, "2026-08-15");
    resume(state, c, "2026-08-15");
    expect(c.state).toBe("active");
    expect(c.progress).toBe(120);
    expect(seriesSessions(c, "2026-08-15")[0]!.date).toBe("2026-08-15");
  });
});

describe("chunked series", () => {
  it("schedules to a chapter end when one is within reach", () => {
    const c = book(state, { chunks: parseChapters("48,110,180,244,318,392,470,552,640,706") });
    expect(seriesSessions(c, START)[0]!.targetCumulative).toBe(48);
    expect(seriesSessions(c, START)[0]!.label).toContain("ch. 1");
  });

  it("does not inflate the session when the next chapter is far off", () => {
    // 65-page chapters against a 40-page rate: snapping every night would mean
    // reading 60% more than the user asked for.
    const c = book(state, { chunks: parseChapters("48,110,180,244,318,392,470,552,640,706") });
    const second = seriesSessions(c, START)[1]!;
    expect(second.targetCumulative).toBe(88);
    expect(second.label).toContain("into ch. 2");
  });

  it("banks whole sessions the same way when chunked", () => {
    const c = book(state, { chunks: parseChapters("48,110,180,244,318,392,470,552,640,706") });
    recordProgress(state, c, 90, START); // covers 48 and 88
    expect(c.nextDueDate).toBe("2026-07-27");
    expect(seriesSessions(c, "2026-07-27")[0]!.targetCumulative).toBe(130);
  });

  it("completes when the last chunk is reached", () => {
    const c = book(state, { total: 100, rate: 60, chunks: parseChapters("60,100") });
    completeDue(state, c, START);
    completeDue(state, c, "2026-07-26");
    expect(c.state).toBe("done");
    expect(c.progress).toBe(100);
  });
});

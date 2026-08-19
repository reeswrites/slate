// The glance cache. A tiny, denormalised projection of the next `horizonDays` of
// slate — written next to slate.json every time state is saved (see store.save).
// External surfaces (Life Terminal's on-deck) read this file directly instead of
// re-running the scheduler: zero process spawn, zero network, always the same shape.
//
// It carries the WHOLE window with per-day session labels, not just tonight, so a
// reader can select "today or the next day with items" on its own and stay correct
// for up to a week without slate being run again.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { groupByDate, planWindow } from "./schedule.js";
import { addDays, dayName, today, type ISODate } from "./time.js";
import type { State } from "./types.js";

export interface GlanceSession {
  title: string;
  label: string;
  kind: "point" | "series";
  due: boolean;
  format?: string;
  creator?: string;
}

export interface GlanceDay {
  date: ISODate;
  day: string;
  isToday: boolean;
  items: GlanceSession[];
}

export interface Glance {
  generatedAt: ISODate;
  week: GlanceDay[];
  counts: { paced: number; shelf: number };
}

export function buildGlance(state: State, from: ISODate = today()): Glance {
  const days = state.settings.horizonDays;
  const byDate = groupByDate(planWindow(state, from, days));

  const week: GlanceDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const items = (byDate.get(d) ?? []).map((t): GlanceSession => {
      const item = state.items.find((x) => x.id === t.itemId);
      return {
        title: t.title,
        label: t.label,
        kind: t.kind,
        due: t.due,
        format: item?.format,
        creator: item?.creator,
      };
    });
    week.push({ date: d, day: dayName(d), isToday: d === from, items });
  }

  const active = state.commitments.filter((c) => c.state === "active");
  const pacedItems = new Set(active.map((c) => c.itemId));
  const shelf = state.items.filter((i) => !pacedItems.has(i.id)).length;

  return { generatedAt: from, week, counts: { paced: active.length, shelf } };
}

export function glancePath(dataPath: string): string {
  return resolve(dirname(dataPath), "glance.json");
}

export function writeGlance(state: State, dataPath: string): void {
  const p = glancePath(dataPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(buildGlance(state), null, 2) + "\n", "utf8");
}

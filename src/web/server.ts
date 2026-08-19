import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addItem,
  completeDue,
  defaultKindFor,
  defer,
  deferralCounts,
  drop,
  findCommitment,
  findItem,
  itemOf,
  pacePoint,
  paceSeries,
  recordProgress,
  resume,
  shelve,
  sweepExpired,
} from "../core/actions.js";
import { parseChapters } from "../core/chunks.js";
import { groupByDate, planWindow, projectedFinish } from "../core/schedule.js";
import { load, save } from "../core/store.js";
import { addDays, dayName, formatDays, today } from "../core/time.js";
import type { Format, State } from "../core/types.js";
import { detectAndImport } from "../importers/index.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function view(state: State) {
  const from = today();
  const days = state.settings.horizonDays;
  const todos = planWindow(state, from, days);
  const byDate = groupByDate(todos);
  const defers = deferralCounts(state);

  const window = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    window.push({
      date: d,
      day: dayName(d),
      isToday: d === from,
      todos: (byDate.get(d) ?? []).map((t) => ({
        id: t.id,
        commitmentId: t.commitmentId,
        title: t.title,
        label: t.label,
        kind: t.kind,
        due: t.due,
      })),
    });
  }

  const paced = state.commitments
    .filter((c) => c.state === "active")
    .map((c) => {
      const item = itemOf(state, c);
      const base = {
        id: c.id,
        itemId: c.itemId,
        title: item?.title ?? "",
        creator: item?.creator,
        format: item?.format,
        kind: c.kind,
      };
      if (c.kind === "series") {
        return {
          ...base,
          fraction: c.progress / c.total,
          progress: c.progress,
          total: c.total,
          unit: c.unit,
          rate: c.rate,
          days: formatDays(c.sessionDays),
          intent: c.intent,
          hardDeadline: c.hardDeadline,
          plannedEnd: c.endDate,
          projectedEnd: projectedFinish(c, from) ?? null,
          nextDue: c.nextDueDate,
        };
      }
      return { ...base, plannedFor: c.plannedFor };
    });

  const pacedItems = new Set(paced.map((p) => p.itemId));
  const shelf = state.items
    .filter((i) => !pacedItems.has(i.id))
    .map((i) => {
      const prior = [...state.commitments].reverse().find((x) => x.itemId === i.id);
      return {
        id: i.id,
        title: i.title,
        creator: i.creator,
        format: i.format,
        minutes: i.minutes,
        year: i.year,
        deferred: defers.get(i.id) ?? 0,
        prior: prior?.state ?? null,
      };
    });

  return { today: from, window, paced, shelf, settings: state.settings };
}

function handleAction(state: State, body: any): string {
  const ref = String(body.ref ?? "");
  switch (body.action) {
    case "add": {
      const item = addItem(state, {
        title: String(body.title).trim(),
        format: (body.format as Format) ?? "other",
        creator: body.creator || undefined,
        minutes: body.minutes ? Number(body.minutes) : undefined,
        source: "manual",
      });
      return `added ${item.title}`;
    }
    case "import": {
      const parsed = detectAndImport(String(body.text ?? ""));
      let added = 0;
      for (const p of parsed) {
        if (state.items.some((i) => i.title.toLowerCase() === p.title.toLowerCase())) continue;
        addItem(state, {
          title: p.title,
          format: p.format,
          creator: p.creator,
          year: p.year,
          minutes: p.minutes,
          source: p.source,
          notes: p.total ? `length: ${p.total}` : undefined,
        });
        added++;
      }
      return `${added} to the shelf`;
    }
    case "pace": {
      const item = findItem(state, ref);
      if (!item) throw new Error("no such item");
      const kind = body.kind ?? defaultKindFor(item.format);
      if (kind === "point") {
        pacePoint(state, item, body.on || undefined);
        return `${item.title} scheduled`;
      }
      paceSeries(state, item, {
        total: body.total ? Number(body.total) : undefined,
        rate: body.rate ? Number(body.rate) : undefined,
        endDate: body.endDate || undefined,
        days: body.days || undefined,
        chunks: body.chapters ? parseChapters(String(body.chapters)) : undefined,
        hardDeadline: Boolean(body.hardDeadline),
        progress: body.at ? Number(body.at) : undefined,
      });
      return `${item.title} paced`;
    }
    case "done": {
      const c = findCommitment(state, ref);
      if (!c) throw new Error("no such commitment");
      completeDue(state, c);
      return "done";
    }
    case "defer": {
      const c = findCommitment(state, ref);
      if (!c) throw new Error("no such commitment");
      defer(state, c, Number(body.days ?? 1), today(), body.reason || undefined);
      return "pushed";
    }
    case "resync": {
      const c = findCommitment(state, ref);
      if (!c || c.kind !== "series") throw new Error("no such series");
      recordProgress(state, c, Number(body.progress), today(), "resync", body.reason || undefined);
      return "resynced";
    }
    case "shelve": {
      const c = findCommitment(state, ref);
      if (!c) throw new Error("no such commitment");
      shelve(state, c);
      return "back on the shelf";
    }
    case "drop": {
      const c = findCommitment(state, ref);
      if (!c) throw new Error("no such commitment");
      drop(state, c, today(), body.reason || undefined);
      return "dropped";
    }
    case "resume": {
      const c = findCommitment(state, ref);
      if (!c) throw new Error("no such commitment");
      resume(state, c);
      return "back on the slate";
    }
    default:
      throw new Error(`unknown action: ${body.action}`);
  }
}

function json(res: any, code: number, payload: unknown): void {
  const s = JSON.stringify(payload);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(s);
}

const port = Number(process.env.PORT ?? process.argv.find((a) => /^\d+$/.test(a)) ?? 4173);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/state") {
    const state = load();
    sweepExpired(state);
    save(state);
    return json(res, 200, view(state));
  }

  if (url.pathname === "/api/action" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const state = load();
        sweepExpired(state);
        const message = handleAction(state, JSON.parse(raw || "{}"));
        save(state);
        json(res, 200, { message, ...view(state) });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    });
    return;
  }

  if (url.pathname === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }

  const rel = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) throw new Error("nope");
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(port, () => {
  console.log(`slate — the shelf at http://localhost:${port}`);
});

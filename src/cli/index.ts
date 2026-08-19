#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
  sweepExpired,
} from "../core/actions.js";
import { parseChapters } from "../core/chunks.js";
import { groupByDate, planWindow, projectedFinish, seriesSessions } from "../core/schedule.js";
import { load, save, dataPath } from "../core/store.js";
import { addDays, dayName, formatDays, today, type ISODate } from "../core/time.js";
import type { Format, State, Unit } from "../core/types.js";
import { detectAndImport } from "../importers/index.js";

// --- tiny arg parser ---------------------------------------------------

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) out.flags[k!] = inline;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) out.flags[k!] = argv[++i]!;
      else out.flags[k!] = true;
    } else out._.push(a);
  }
  return out;
}

const str = (a: Args, k: string): string | undefined =>
  typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined;
const num = (a: Args, k: string): number | undefined => {
  const v = str(a, k);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${k} must be a number`);
  return n;
};
const bool = (a: Args, k: string): boolean => a.flags[k] === true || a.flags[k] === "true";

// --- output ------------------------------------------------------------

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// --- commands ----------------------------------------------------------

function cmdAdd(state: State, a: Args): void {
  const title = a._.join(" ").trim();
  if (!title) throw new Error(`usage: slate add "<title>" [--format book] [--creator X]`);
  const item = addItem(state, {
    title,
    format: (str(a, "format") as Format) ?? "other",
    creator: str(a, "creator"),
    year: num(a, "year"),
    minutes: num(a, "minutes"),
    source: "manual",
    notes: str(a, "notes"),
  });
  console.log(`${c.green("+")} ${item.title} ${c.dim(`(${item.format}) ${item.id}`)}`);
}

function cmdImport(state: State, a: Args): void {
  const file = a._[0];
  if (!file) throw new Error("usage: slate import <file> [--as letterboxd|goodreads|paste] [--dry]");
  const text = readFileSync(file, "utf8");
  const parsed = detectAndImport(text, str(a, "as"));
  const limit = num(a, "limit");
  const rows = limit ? parsed.slice(0, limit) : parsed;

  if (bool(a, "dry")) {
    for (const p of rows) {
      console.log(
        `  ${p.title} ${c.dim(`${p.format}${p.creator ? ` · ${p.creator}` : ""}${p.total ? ` · ${p.total}pp` : ""}`)}`,
      );
    }
    console.log(c.dim(`\n${rows.length} parsed, nothing written (--dry)`));
    return;
  }

  let added = 0;
  let skipped = 0;
  for (const p of rows) {
    const dupe = state.items.find(
      (i) => i.title.toLowerCase() === p.title.toLowerCase() && i.format === p.format,
    );
    if (dupe) {
      skipped++;
      continue;
    }
    addItem(state, {
      title: p.title,
      format: p.format,
      creator: p.creator,
      year: p.year,
      minutes: p.minutes,
      source: p.source,
      notes: p.total ? `length: ${p.total}` : p.notes,
    });
    added++;
  }
  console.log(`${c.green("+")} ${added} to the shelf${skipped ? c.dim(` · ${skipped} already there`) : ""}`);
}

function cmdPace(state: State, a: Args): void {
  const ref = a._.join(" ").trim();
  const item = findItem(state, ref);
  if (!item) throw new Error(`no item matching "${ref}"`);

  const total = num(a, "total");
  const rate = num(a, "rate");
  const by = str(a, "by");
  const kind = str(a, "kind") ?? (total || rate || by ? "series" : defaultKindFor(item.format));

  if (kind === "point") {
    const cm = pacePoint(state, item, str(a, "on") as ISODate | undefined);
    if (cm.kind === "point") console.log(`${c.green("→")} ${item.title} ${c.dim(`on ${cm.plannedFor}`)}`);
    return;
  }

  const chapters = str(a, "chapters");
  const cm = paceSeries(state, item, {
    total,
    rate,
    endDate: by as ISODate | undefined,
    days: str(a, "days"),
    unit: str(a, "unit") as Unit | undefined,
    chunks: chapters ? parseChapters(chapters) : undefined,
    hardDeadline: bool(a, "deadline"),
    progress: num(a, "at"),
  });

  const finish = projectedFinish(cm, today());
  console.log(
    `${c.green("→")} ${item.title}: ${c.bold(`${cm.rate} ${cm.unit}/session`)} ` +
      `${c.dim(`· ${formatDays(cm.sessionDays)} · ${cm.total} total · finishes ~${finish ?? cm.endDate}`)}`,
  );
  console.log(
    c.dim(
      `  intent: ${cm.intent}${cm.hardDeadline ? " · hard deadline (rate may recalculate)" : " · rate held if you fall behind"}`,
    ),
  );
}

function cmdSlate(state: State, a: Args, days: number): void {
  const from = str(a, "from") ?? today();
  const todos = planWindow(state, from, days);
  if (todos.length === 0) {
    console.log(c.dim("nothing paced. `slate shelf` to see what's waiting."));
    return;
  }
  const byDate = groupByDate(todos);
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const list = byDate.get(d);
    if (!list && days > 1) continue;
    const head = d === today() ? `${dayName(d)} ${d} ${c.cyan("· today")}` : `${dayName(d)} ${d}`;
    console.log(`\n${c.bold(head)}`);
    for (const t of list ?? []) console.log(`  ${t.due ? c.cyan("•") : c.dim("◦")} ${t.label}`);
    if (!list?.length) console.log(c.dim("  —"));
  }
  console.log();
}

function cmdShelf(state: State, _a: Args): void {
  const defers = deferralCounts(state);
  const active = state.commitments.filter((x) => x.state === "active");
  const activeItems = new Set(active.map((x) => x.itemId));

  console.log(c.bold(`\nPaced (${active.length})`));
  for (const cm of active) {
    const item = itemOf(state, cm);
    if (!item) continue;
    if (cm.kind === "series") {
      const finish = projectedFinish(cm, today());
      console.log(
        `  ${item.title} ${c.dim(`${pct(cm.progress / cm.total)} · ${cm.rate} ${cm.unit}/session · ~${finish}`)}`,
      );
    } else {
      console.log(`  ${item.title} ${c.dim(`on ${cm.plannedFor}`)}`);
    }
  }
  if (!active.length) console.log(c.dim("  —"));

  const shelf = state.items.filter((i) => !activeItems.has(i.id));
  console.log(c.bold(`\nShelf (${shelf.length})`));
  for (const i of shelf.slice(0, Number(process.env.SLATE_SHELF_LIMIT ?? 40))) {
    const prior = state.commitments.find((x) => x.itemId === i.id);
    const tag =
      prior?.state === "done"
        ? c.green("done")
        : prior?.state === "expired"
          ? c.yellow("drifted")
          : prior?.state === "dropped"
            ? c.dim("dropped")
            : "";
    const d = defers.get(i.id);
    console.log(
      `  ${i.title} ${c.dim(`${i.format}${i.creator ? ` · ${i.creator}` : ""}`)} ${tag}` +
        (d ? c.dim(` · pushed ${d}×`) : ""),
    );
  }
  if (shelf.length > 40) console.log(c.dim(`  …and ${shelf.length - 40} more`));
  console.log();
}

function cmdDone(state: State, a: Args): void {
  const ref = a._.join(" ").trim();
  const cm = findCommitment(state, ref);
  if (!cm) throw new Error(`no commitment matching "${ref}"`);
  const before = cm.kind === "series" ? cm.progress : 0;
  completeDue(state, cm, today(), str(a, "reason"));
  const item = itemOf(state, cm);
  if (cm.kind === "series" && cm.state !== "done") {
    console.log(
      `${c.green("✓")} ${item?.title} ${c.dim(`${before} → ${cm.progress} ${cm.unit} · next ${cm.nextDueDate}`)}`,
    );
  } else {
    console.log(`${c.green("✓")} ${item?.title} ${c.dim("finished")}`);
  }
}

function cmdDefer(state: State, a: Args): void {
  const ref = a._.join(" ").trim();
  const cm = findCommitment(state, ref);
  if (!cm) throw new Error(`no commitment matching "${ref}"`);
  defer(state, cm, num(a, "days") ?? 1, today(), str(a, "reason"));
  console.log(c.dim(`pushed ${itemOf(state, cm)?.title}. nothing is late.`));
}

function cmdAt(state: State, a: Args): void {
  const n = Number(a._.at(-1));
  const ref = a._.slice(0, -1).join(" ").trim();
  if (!Number.isFinite(n)) throw new Error(`usage: slate at "<title>" <progress>`);
  const cm = findCommitment(state, ref);
  if (!cm || cm.kind !== "series") throw new Error(`no series matching "${ref}"`);
  recordProgress(state, cm, n, today(), "resync", str(a, "reason"));
  const finish = projectedFinish(cm, today());
  console.log(
    `${c.green("✓")} ${itemOf(state, cm)?.title} at ${n} ${cm.unit} ` +
      `${c.dim(`(${pct(cm.progress / cm.total)}) · next ${cm.nextDueDate} · ~${finish ?? "done"}`)}`,
  );
}

function cmdStatus(state: State, a: Args): void {
  const ref = a._.join(" ").trim();
  const cm = findCommitment(state, ref);
  if (!cm) throw new Error(`no commitment matching "${ref}"`);
  const item = itemOf(state, cm);
  console.log(`\n${c.bold(item?.title ?? cm.itemId)} ${c.dim(cm.id)}`);
  console.log(`  state      ${cm.state}`);
  if (cm.kind === "series") {
    console.log(`  progress   ${cm.progress}/${cm.total} ${cm.unit} (${pct(cm.progress / cm.total)})`);
    console.log(`  rate       ${cm.rate} ${cm.unit} · ${formatDays(cm.sessionDays)} · ${cm.intent}`);
    console.log(`  planned    ${cm.endDate}${cm.hardDeadline ? " (hard)" : ""}`);
    console.log(`  projected  ${projectedFinish(cm, today()) ?? "done"}`);
    console.log(`  next due   ${cm.nextDueDate}`);
    const next = seriesSessions(cm, today(), { limit: 3 });
    for (const t of next) console.log(c.dim(`    ${t.date}  ${t.label}`));
  } else {
    console.log(`  planned    ${cm.plannedFor}`);
  }
  const evs = state.events.filter((e) => e.commitmentId === cm.id).slice(-8);
  console.log(c.bold("  history"));
  for (const e of evs) console.log(c.dim(`    ${e.date} ${e.type}${e.reason ? ` — ${e.reason}` : ""}`));
  console.log();
}

function cmdSeed(state: State, _a: Args): void {
  const seedItems: [string, Format, string, number | undefined][] = [
    ["The Magic Mountain", "book", "Thomas Mann", undefined],
    ["Chungking Express", "film", "Wong Kar-wai", 102],
    ["Jeanne Dielman", "film", "Chantal Akerman", 201],
    ["The Leopard", "film", "Luchino Visconti", 186],
    ["Against Interpretation", "essay", "Susan Sontag", undefined],
    ["The Sopranos S1", "tv", "David Chase", undefined],
  ];
  for (const [title, format, creator, minutes] of seedItems) {
    if (findItem(state, title)) continue;
    addItem(state, { title, format, creator, minutes, source: "manual" });
  }
  const mm = findItem(state, "The Magic Mountain")!;
  if (!state.commitments.some((x) => x.itemId === mm.id)) {
    paceSeries(state, mm, {
      total: 706,
      rate: 40,
      days: "daily",
      chunks: parseChapters("48,110,180,244,318,392,470,552,640,706"),
    });
  }
  const cq = findItem(state, "Chungking Express")!;
  if (!state.commitments.some((x) => x.itemId === cq.id)) pacePoint(state, cq);
  console.log(c.dim("seeded."));
}

const HELP = `
slate — paced media planner

  shelf                            what you have, and what's paced
  today                            today's slate
  week [--days 7] [--from DATE]    the shape of the next few days

  add "<title>" [--format book|film|tv|essay|lecture|course|album]
                [--creator X] [--year N] [--minutes N]
  import <file> [--as letterboxd|goodreads|paste] [--dry] [--limit N]

  pace "<title>" --total 706 --rate 40 [--days daily|weekdays|mon,wed,fri]
                 [--chapters 48,110,180] [--unit page] [--at 90]
  pace "<title>" --total 706 --by 2026-08-30 [--deadline]
  pace "<title>" --kind point [--on DATE]

  done "<title>"                   check off what's due
  at "<title>" 212                 resync: where you actually are
  defer "<title>" [--days 1] [--reason "too heavy tonight"]
  drop|resume "<title>"
  status "<title>"

  seed                             demo data
  serve [--port 4173]              the shelf, in a browser

data: ${dataPath()}
`;

// --- main --------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));

  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(HELP);
    return;
  }

  const state = load();
  const expired = sweepExpired(state);

  switch (cmd) {
    case "add":
      cmdAdd(state, a);
      break;
    case "import":
      cmdImport(state, a);
      break;
    case "pace":
      cmdPace(state, a);
      break;
    case "today":
      cmdSlate(state, a, 1);
      break;
    case "week":
      cmdSlate(state, a, num(a, "days") ?? 7);
      break;
    case "shelf":
    case "pool":
      cmdShelf(state, a);
      break;
    case "done":
      cmdDone(state, a);
      break;
    case "at":
      cmdAt(state, a);
      break;
    case "defer":
    case "skip":
      cmdDefer(state, a);
      break;
    case "drop": {
      const cm = findCommitment(state, a._.join(" "));
      if (!cm) throw new Error("no match");
      drop(state, cm, today(), str(a, "reason"));
      console.log(c.dim("dropped."));
      break;
    }
    case "resume": {
      const cm = findCommitment(state, a._.join(" "));
      if (!cm) throw new Error("no match");
      resume(state, cm);
      console.log(c.dim("back on the slate."));
      break;
    }
    case "status":
      cmdStatus(state, a);
      break;
    case "seed":
      cmdSeed(state, a);
      break;
    case "serve":
      save(state);
      void import("../web/server.js");
      return;
    default:
      console.log(HELP);
      return;
  }

  if (expired.length) {
    console.log(c.dim(`\n(${expired.length} drifted quietly back to the shelf)`));
  }
  save(state);
}

try {
  main();
} catch (err) {
  console.error(`\x1b[31m${(err as Error).message}\x1b[0m`);
  process.exit(1);
}

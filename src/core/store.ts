import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeGlance } from "./glance.js";
import { DEFAULT_SETTINGS, type State } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../..");

export function dataPath(): string {
  return process.env.SLATE_DATA ?? resolve(ROOT, "data/slate.json");
}

export function emptyState(): State {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, items: [], commitments: [], events: [] };
}

export function load(path = dataPath()): State {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as State;
    return { ...emptyState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw err;
  }
}

export function save(state: State, path = dataPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
  // Refresh the glance cache alongside the real data file only. Tests and other
  // callers that write to an explicit path get no side effects, and a glance
  // failure must never break a save.
  if (path === dataPath()) {
    try {
      writeGlance(state, path);
    } catch {
      // best-effort cache; ignore
    }
  }
}

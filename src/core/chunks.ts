import type { Chunk } from "./types.js";

/**
 * Snap a session target to a chunk boundary. "Read to the end of ch. 8" beats
 * "read to p. 212" even when that means 46 pages instead of 40.
 *
 * Nearest boundary in either direction, but never at or below where you already
 * are, and never past the end.
 *
 * `tolerance` is the catch: when chapters are much longer than the nightly rate,
 * blind snapping quietly inflates every session (65 pages a night when you asked
 * for 40), which is exactly the kind of drift that makes a plan feel like a
 * demand. Past the tolerance we leave the raw target alone and let the label say
 * you're mid-chapter.
 */
export interface Snapped {
  end: number;
  /** Set only when the target actually lands on a boundary. */
  label?: string;
  /** The chunk the target falls inside, snapped or not. */
  inside?: string;
}

export function snapTarget(
  from: number,
  raw: number,
  total: number,
  chunks: Chunk[],
  tolerance = Infinity,
): Snapped {
  const capped = Math.min(raw, total);
  if (chunks.length === 0) return { end: capped };

  const inside = chunks.find((c) => c.end >= capped)?.label;

  let best: Chunk | undefined;
  let bestDist = Infinity;
  for (const c of chunks) {
    if (c.end <= from) continue;
    if (c.end > total) continue;
    const dist = Math.abs(c.end - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  if (!best || bestDist > tolerance) return { end: capped, inside };
  return { end: best.end, label: best.label, inside: best.label };
}

/** How far a session may stretch or shrink to reach a boundary. */
export function snapTolerance(rate: number): number {
  return Math.max(1, Math.round(rate * 0.35));
}

/** Evenly spaced chunks, e.g. 10 episodes of a season. */
export function evenChunks(count: number, total: number, labelFor: (i: number) => string): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 1; i <= count; i++) {
    out.push({ label: labelFor(i), end: Math.round((total * i) / count) });
  }
  return out;
}

/** "12,28,44" -> cumulative chapter ends, auto-labelled. */
export function parseChapters(spec: string, label = "ch."): Chunk[] {
  const ends = spec
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  ends.sort((a, b) => a - b);
  return ends.map((end, i) => ({ label: `${label} ${i + 1}`, end }));
}

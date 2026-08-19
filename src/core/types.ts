import type { ISODate } from "./time.js";

export type Format = "film" | "tv" | "book" | "essay" | "lecture" | "course" | "album" | "other";

/** The unit we *display*. Internally everything compares as fraction complete. */
export type Unit = "page" | "chapter" | "episode" | "lecture" | "minute" | "section" | "track";

export interface Item {
  id: string;
  title: string;
  format: Format;
  creator?: string;
  year?: number;
  /** Runtime / length signal. Free input to the post-MVP effort axis. */
  minutes?: number;
  source: "manual" | "letterboxd" | "goodreads" | "paste";
  addedAt: ISODate;
  notes?: string;
}

/**
 * pooled  - on the shelf, not paced
 * active  - paced, generating todos
 * done    - finished
 * expired - untouched too long; fell quietly back to the shelf (progress kept)
 * dropped - explicitly abandoned
 */
export type CommitmentState = "pooled" | "active" | "done" | "expired" | "dropped";

/** Cumulative unit boundary. `end` is the cumulative unit count at chunk end. */
export interface Chunk {
  label: string;
  end: number;
}

interface CommitmentBase {
  id: string;
  itemId: string;
  state: CommitmentState;
  createdAt: ISODate;
  /** Last time the user did anything to this. Drives quiet expiry. */
  lastTouchedAt: ISODate;
}

export interface PointCommitment extends CommitmentBase {
  kind: "point";
  /** Never moves into the past on its own; the planner clamps it forward. */
  plannedFor: ISODate;
}

export interface SeriesCommitment extends CommitmentBase {
  kind: "series";
  unit: Unit;
  /** Total units. Internal comparisons use progress/total. */
  total: number;
  /** Units per session. Held constant when you fall behind. */
  rate: number;
  /** Weekday numbers, 0 = Sunday. */
  sessionDays: number[];
  startDate: ISODate;
  /**
   * Derived finish date at creation time. Advisory only: it recedes as you
   * fall behind unless `hardDeadline` is set.
   */
  endDate: ISODate;
  /** Which of the two entry points created this. Affects nothing but copy. */
  intent: "habit" | "deadline";
  /**
   * Explicit user flag. Only when true may the rate be recalculated upward to
   * protect `endDate`. Default false, on purpose. See README.
   */
  hardDeadline: boolean;
  /** Cumulative units complete. */
  progress: number;
  /** Chapter/episode boundaries to snap sessions to. */
  chunks: Chunk[];
  /**
   * Next session date owed. Advances only when work is actually banked, so
   * nothing is ever "late" — the date just slides.
   */
  nextDueDate: ISODate;
}

export type Commitment = PointCommitment | SeriesCommitment;

export type EventType =
  | "added"
  | "activated"
  | "done"
  | "defer"
  | "resync"
  | "expire"
  | "drop"
  | "complete";

export interface Event {
  at: string; // ISO timestamp
  date: ISODate;
  type: EventType;
  commitmentId: string;
  itemId: string;
  /** Free text, and the whole point of Phase 0's secondary signal. */
  reason?: string;
  meta?: Record<string, unknown>;
}

export interface Settings {
  /** Untouched this many days -> quietly back to the shelf. */
  expireAfterDays: number;
  /** Soft cap used when auto-placing point commitments. */
  dailyCap: number;
  horizonDays: number;
}

export interface State {
  version: 1;
  settings: Settings;
  items: Item[];
  commitments: Commitment[];
  events: Event[];
}

export const DEFAULT_SETTINGS: Settings = {
  expireAfterDays: 21,
  dailyCap: 2,
  horizonDays: 7,
};

export const UNIT_FOR_FORMAT: Record<Format, Unit> = {
  film: "minute",
  tv: "episode",
  book: "page",
  essay: "page",
  lecture: "minute",
  course: "lecture",
  album: "track",
  other: "section",
};

/** Formats that default to a single todo rather than a generated series. */
export const POINT_FORMATS: Format[] = ["film", "essay", "lecture", "album"];

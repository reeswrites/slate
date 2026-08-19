import { describe, expect, it } from "vitest";
import { parseChapters, snapTarget, snapTolerance } from "../src/core/chunks.js";

const chapters = parseChapters("48,110,180,244,318");
const tol = snapTolerance(40); // 14 pages either way

describe("snapping to chunks", () => {
  it("prefers a chapter boundary over a round page count", () => {
    // 0 + 40 -> ch.1 ends at 48. Eight pages more, and a real stopping point.
    expect(snapTarget(0, 40, 706, chapters, tol)).toMatchObject({ end: 48, label: "ch. 1" });
  });

  it("snaps backwards when the boundary is closer behind", () => {
    // from 110, raw 150; ch.4 ends at 180 (30 away), but ch.3 at 180... use a
    // tighter case: raw 172 is 8 short of ch.4's boundary.
    expect(snapTarget(110, 172, 706, chapters, tol).end).toBe(180);
  });

  it("leaves the target alone when the nearest boundary is too far", () => {
    // from 48, raw 88: ch.2 ends at 110, 22 pages away — more than half a session.
    const s = snapTarget(48, 88, 706, chapters, tol);
    expect(s.end).toBe(88);
    expect(s.label).toBeUndefined();
    expect(s.inside).toBe("ch. 2"); // still tells you where you are
  });

  it("never lands on or before where you already are", () => {
    expect(snapTarget(110, 115, 706, chapters, snapTolerance(200)).end).toBe(180);
  });

  it("passes through unchanged with no chunks", () => {
    expect(snapTarget(0, 40, 706, [])).toEqual({ end: 40 });
  });

  it("never overshoots the whole work", () => {
    expect(snapTarget(300, 340, 318, chapters, tol).end).toBe(318);
  });
});

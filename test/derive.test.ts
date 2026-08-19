import { describe, expect, it } from "vitest";
import { deriveSeries } from "../src/core/derive.js";
import { parseDays } from "../src/core/time.js";

const daily = parseDays("daily");
const weekdays = parseDays("weekdays");

describe("any two of three", () => {
  it("total + rate derives the finish date (habit intent)", () => {
    const d = deriveSeries({ total: 706, rate: 40, startDate: "2026-07-25", sessionDays: daily });
    expect(d.intent).toBe("habit");
    // ceil(706/40) = 18 sessions, starting on the 25th
    expect(d.endDate).toBe("2026-08-11");
  });

  it("total + end date derives the rate (deadline intent)", () => {
    const d = deriveSeries({
      total: 706,
      endDate: "2026-08-31",
      startDate: "2026-07-25",
      sessionDays: daily,
    });
    expect(d.intent).toBe("deadline");
    expect(d.rate).toBe(19); // 38 session days inclusive, rounded up
  });

  it("rate + end date derives the total", () => {
    const d = deriveSeries({
      rate: 40,
      endDate: "2026-08-11",
      startDate: "2026-07-25",
      sessionDays: daily,
    });
    expect(d.total).toBe(720);
  });

  it("honours a weekday-only schedule", () => {
    const d = deriveSeries({ total: 100, rate: 25, startDate: "2026-07-25", sessionDays: weekdays });
    // Sat 25th -> first session Mon 27th, 4 sessions -> Thu 30th
    expect(d.endDate).toBe("2026-07-30");
  });

  it("refuses one or three of three", () => {
    expect(() => deriveSeries({ total: 100, startDate: "2026-07-25", sessionDays: daily })).toThrow();
    expect(() =>
      deriveSeries({ total: 100, rate: 10, endDate: "2026-08-01", startDate: "2026-07-25", sessionDays: daily }),
    ).toThrow();
  });
});

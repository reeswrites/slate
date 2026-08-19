import { countSessions, nthSessionFrom, type ISODate } from "./time.js";

/**
 * Any two of {total, rate, endDate} derive the third.
 *
 *   total + rate    -> endDate   ("40 pages a night")      habit intent
 *   total + endDate -> rate      ("done by the 30th")      deadline intent
 *   rate  + endDate -> total     (rare, but free)          habit intent
 *
 * The two entry points are genuinely different intentions, so we record which
 * one was used even though the resulting object is identical.
 */
export interface DeriveInput {
  total?: number;
  rate?: number;
  endDate?: ISODate;
  startDate: ISODate;
  sessionDays: number[];
}

export interface Derived {
  total: number;
  rate: number;
  endDate: ISODate;
  intent: "habit" | "deadline";
}

export function deriveSeries(input: DeriveInput): Derived {
  const { startDate, sessionDays } = input;
  const given = [input.total, input.rate, input.endDate].filter((v) => v !== undefined).length;
  if (given !== 2) {
    throw new Error(
      `need exactly two of {total, rate, endDate}, got ${given}. ` +
        `e.g. --total 700 --rate 40, or --total 700 --by 2026-08-30`,
    );
  }
  if (sessionDays.length === 0) throw new Error("need at least one session day");

  if (input.total !== undefined && input.rate !== undefined) {
    if (input.total <= 0 || input.rate <= 0) throw new Error("total and rate must be > 0");
    const sessions = Math.ceil(input.total / input.rate);
    return {
      total: input.total,
      rate: input.rate,
      endDate: nthSessionFrom(startDate, sessionDays, sessions),
      intent: "habit",
    };
  }

  if (input.total !== undefined && input.endDate !== undefined) {
    if (input.endDate < startDate) throw new Error("end date is before start date");
    const sessions = countSessions(startDate, input.endDate, sessionDays);
    if (sessions === 0) throw new Error("no session days between start and end date");
    return {
      total: input.total,
      rate: Math.ceil(input.total / sessions),
      endDate: input.endDate,
      intent: "deadline",
    };
  }

  const rate = input.rate!;
  const endDate = input.endDate!;
  const sessions = countSessions(startDate, endDate, sessionDays);
  if (sessions === 0) throw new Error("no session days between start and end date");
  return { total: rate * sessions, rate, endDate, intent: "habit" };
}

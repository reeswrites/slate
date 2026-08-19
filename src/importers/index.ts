import { parseCsv } from "./csv.js";
import type { Format, Item } from "../core/types.js";

export interface ParsedItem {
  title: string;
  format: Format;
  creator?: string;
  year?: number;
  minutes?: number;
  /** Length in the format's natural unit, when the source gives us one. */
  total?: number;
  source: Item["source"];
  notes?: string;
}

// --- Letterboxd --------------------------------------------------------
// watchlist.csv: Date,Name,Year,Letterboxd URI

export function importLetterboxd(text: string): ParsedItem[] {
  return parseCsv(text)
    .map((r): ParsedItem | undefined => {
      const title = r["Name"] ?? r["Title"] ?? "";
      if (!title) return undefined;
      const year = Number(r["Year"]);
      return {
        title,
        format: "film" as const,
        year: Number.isFinite(year) && year > 0 ? year : undefined,
        source: "letterboxd" as const,
        notes: r["Letterboxd URI"] || undefined,
      };
    })
    .filter((x): x is ParsedItem => x !== undefined);
}

// --- Goodreads ---------------------------------------------------------
// goodreads_library_export.csv, filtered to the to-read shelf.

export function importGoodreads(text: string, shelf = "to-read"): ParsedItem[] {
  return parseCsv(text)
    .filter((r) => !shelf || (r["Exclusive Shelf"] ?? "").toLowerCase() === shelf)
    .map((r): ParsedItem | undefined => {
      const title = r["Title"] ?? "";
      if (!title) return undefined;
      const pages = Number(r["Number of Pages"]);
      const year = Number(r["Original Publication Year"] || r["Year Published"]);
      return {
        title: title.replace(/\s*\([^)]*\)\s*$/, "").trim(),
        format: "book" as const,
        creator: r["Author"] || undefined,
        year: Number.isFinite(year) && year > 0 ? year : undefined,
        total: Number.isFinite(pages) && pages > 0 ? pages : undefined,
        source: "goodreads" as const,
      };
    })
    .filter((x): x is ParsedItem => x !== undefined);
}

// --- Free text ---------------------------------------------------------

const FORMAT_WORDS: [RegExp, Format][] = [
  [/\b(film|movie|feature)\b/i, "film"],
  [/\b(tv|series|season|show)\b/i, "tv"],
  [/\b(book|novel|memoir)\b/i, "book"],
  [/\b(essay|article|piece)\b/i, "essay"],
  [/\b(lecture|talk|course|mooc)\b/i, "lecture"],
  [/\b(album|record|lp)\b/i, "album"],
];

/**
 * The paste box. Deliberately forgiving: people paste bullet lists, numbered
 * lists, "Title — Author", "Title (1994)", newsletter fragments. Anything it
 * can't classify lands as `other` rather than being dropped.
 */
export function importFreeText(text: string): ParsedItem[] {
  const out: ParsedItem[] = [];

  for (const rawLine of text.split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;
    // bullets, numbered lists, markdown links
    line = line.replace(/^[-*•·–—]\s+/, "").replace(/^\d+[.)]\s+/, "");
    line = line.replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1");
    if (!line || /^#{1,6}\s/.test(line)) continue;

    let format: Format | undefined;
    let minutes: number | undefined;
    let total: number | undefined;
    let year: number | undefined;
    let creator: string | undefined;

    // trailing parenthetical hints: (book, 706pp) / (1994) / (129 min)
    line = line.replace(/\(([^)]*)\)\s*$/g, (_m, inner: string) => {
      let consumed = false;
      const y = inner.match(/\b(1[6-9]\d{2}|20\d{2})\b/);
      if (y) {
        year = Number(y[1]);
        consumed = true;
      }
      const p = inner.match(/(\d+)\s*(?:pp|pages?)\b/i);
      if (p) {
        total = Number(p[1]);
        format ??= "book";
        consumed = true;
      }
      const m = inner.match(/(\d+)\s*(?:min|mins|minutes)\b/i);
      if (m) {
        minutes = Number(m[1]);
        format ??= "film";
        consumed = true;
      }
      for (const [re, f] of FORMAT_WORDS) {
        if (re.test(inner)) {
          format ??= f;
          consumed = true;
        }
      }
      return consumed ? "" : `(${inner})`;
    });

    // bare trailing length outside parens: "706pp", "129 min"
    line = line.replace(/[,;]?\s*(\d+)\s*(pp|pages?)\s*$/i, (_m, n: string) => {
      total = Number(n);
      format ??= "book";
      return "";
    });
    line = line.replace(/[,;]?\s*(\d+)\s*(min|mins|minutes)\s*$/i, (_m, n: string) => {
      minutes = Number(n);
      format ??= "film";
      return "";
    });

    if (!format) {
      for (const [re, f] of FORMAT_WORDS) {
        if (re.test(line)) {
          format = f;
          line = line.replace(re, "").trim();
          break;
        }
      }
    }

    // "Title — Author" / "Title by Author"
    const dash = line.split(/\s+[—–]\s+|\s+--\s+/);
    if (dash.length === 2 && dash[1]!.length < 60) {
      line = dash[0]!;
      creator = dash[1]!.trim();
    } else {
      const by = line.match(/^(.*?)\s+by\s+([A-Z][^,;]{2,50})$/);
      if (by) {
        line = by[1]!;
        creator = by[2]!.trim();
      }
    }

    const title = line.replace(/[,;:\s]+$/, "").replace(/^["'“]|["'”]$/g, "").trim();
    if (!title) continue;

    out.push({
      title,
      format: format ?? (total ? "book" : minutes ? "film" : "other"),
      creator,
      year,
      minutes,
      total,
      source: "paste",
    });
  }

  return out;
}

export function detectAndImport(text: string, hint?: string): ParsedItem[] {
  const head = text.slice(0, 400);
  if (hint === "letterboxd" || /(^|,)Letterboxd URI/.test(head)) return importLetterboxd(text);
  if (hint === "goodreads" || /Exclusive Shelf/.test(head)) return importGoodreads(text);
  if (hint === "csv" || (/^[^\n]*,[^\n]*,/.test(head) && /\n/.test(head))) {
    const rows = parseCsv(text);
    if (rows.length && ("Title" in rows[0]! || "Name" in rows[0]!)) {
      return rows
        .map((r) => ({
          title: (r["Title"] ?? r["Name"] ?? "").trim(),
          format: "other" as const,
          creator: r["Author"] || r["Creator"] || undefined,
          source: "paste" as const,
        }))
        .filter((r) => r.title);
    }
  }
  return importFreeText(text);
}

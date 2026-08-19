import { describe, expect, it } from "vitest";
import { detectAndImport, importFreeText, importGoodreads, importLetterboxd } from "../src/importers/index.js";

describe("letterboxd watchlist", () => {
  const csv = `Date,Name,Year,Letterboxd URI
2025-01-04,Chungking Express,1994,https://boxd.it/1
2025-02-11,"Jeanne Dielman, 23 quai du Commerce, 1080 Bruxelles",1975,https://boxd.it/2
`;
  it("parses names, years and quoted commas", () => {
    const rows = importLetterboxd(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Chungking Express", year: 1994, format: "film" });
    expect(rows[1]!.title).toContain("1080 Bruxelles");
  });
});

describe("goodreads export", () => {
  const csv = `Book Id,Title,Author,Number of Pages,Exclusive Shelf
1,"Magic Mountain, The (Everyman's Library)",Thomas Mann,706,to-read
2,Dune,Frank Herbert,412,read
`;
  it("keeps only the to-read shelf and strips edition parentheticals", () => {
    const rows = importGoodreads(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Magic Mountain, The", creator: "Thomas Mann", total: 706 });
  });
});

describe("the paste box", () => {
  it("handles bullets, dashes, years and lengths", () => {
    const rows = importFreeText(`
- The Magic Mountain — Thomas Mann (book, 706pp)
* Chungking Express (1994, film, 102 min)
1. Against Interpretation by Susan Sontag (essay)
Jeanne Dielman
`);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ title: "The Magic Mountain", creator: "Thomas Mann", format: "book", total: 706 });
    expect(rows[1]).toMatchObject({ title: "Chungking Express", year: 1994, format: "film", minutes: 102 });
    expect(rows[2]).toMatchObject({ title: "Against Interpretation", creator: "Susan Sontag", format: "essay" });
    expect(rows[3]).toMatchObject({ title: "Jeanne Dielman", format: "other" });
  });

  it("keeps parentheticals it does not understand", () => {
    const rows = importFreeText("The Leopard (Visconti's cut)");
    expect(rows[0]!.title).toBe("The Leopard (Visconti's cut)");
  });

  it("skips headings and blank lines", () => {
    expect(importFreeText("## Films\n\n\nSolaris")).toHaveLength(1);
  });
});

describe("format detection", () => {
  it("routes each source without a hint", () => {
    expect(detectAndImport("Date,Name,Year,Letterboxd URI\n2025-01-04,Solaris,1972,x")[0]!.source).toBe("letterboxd");
    expect(detectAndImport("Title,Author,Number of Pages,Exclusive Shelf\nDune,Herbert,412,to-read")[0]!.source).toBe("goodreads");
    expect(detectAndImport("Solaris")[0]!.source).toBe("paste");
  });
});

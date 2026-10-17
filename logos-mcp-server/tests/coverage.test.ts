import { describe, it, expect } from "vitest";
import { parseReferenceSupersets, rangeContains, parseLogosBibleRef } from "../src/services/logos-books.js";
import { parseTraits } from "../src/services/catalog-reader.js";

// Values copied from the Logos 54 test install's catalog.db (design doc F11).

const range = (raw: string) => {
  const parsed = parseLogosBibleRef(raw);
  if (!parsed) throw new Error(`bad fixture ${raw}`);
  return parsed;
};

describe("parseReferenceSupersets", () => {
  it("splits tab-separated ranges", () => {
    expect(parseReferenceSupersets("bible.72.1.1-72.4.18\tbible.78.1.1-78.1.25")).toEqual([
      { start: { book: 72, chapter: 1, verse: 1 }, end: { book: 72, chapter: 4, verse: 18 } },
      { start: { book: 78, chapter: 1, verse: 1 }, end: { book: 78, chapter: 1, verse: 25 } },
    ]);
  });

  it("also accepts spaces and keeps edition-prefixed ranges", () => {
    expect(parseReferenceSupersets("bible+leb2.1.1.1-87.22.21 bible+kjv.61-87")).toHaveLength(2);
  });

  it("ignores non-Bible entries and empty values", () => {
    expect(parseReferenceSupersets("af.1-2\tpseud.3\tbible.64")).toEqual([{ start: { book: 64 }, end: null }]);
    expect(parseReferenceSupersets("")).toEqual([]);
  });
});

describe("rangeContains", () => {
  it("matches a verse inside a verse range", () => {
    const john = range("bible.64.1.1-64.21.25");
    expect(rangeContains(john, { book: 64, chapter: 5, verse: 14 })).toBe(true);
    expect(rangeContains(john, { book: 64, chapter: 21, verse: 25 })).toBe(true);
    expect(rangeContains(john, { book: 65, chapter: 1, verse: 1 })).toBe(false);
  });

  it("treats a book-only range as the whole book", () => {
    const john = range("bible.64");
    expect(rangeContains(john, { book: 64, chapter: 21, verse: 25 })).toBe(true);
    expect(rangeContains(john, { book: 63, chapter: 24, verse: 53 })).toBe(false);
  });

  it("treats chapter-only ends as whole chapters", () => {
    const chapters = range("bible.64.5-64.6");
    expect(rangeContains(chapters, { book: 64, chapter: 5, verse: 1 })).toBe(true);
    expect(rangeContains(chapters, { book: 64, chapter: 6, verse: 71 })).toBe(true);
    expect(rangeContains(chapters, { book: 64, chapter: 7, verse: 1 })).toBe(false);
    const toChapterEnd = range("bible.64.3.16-64.4");
    expect(rangeContains(toChapterEnd, { book: 64, chapter: 4, verse: 54 })).toBe(true);
    expect(rangeContains(toChapterEnd, { book: 64, chapter: 3, verse: 15 })).toBe(false);
  });

  it("matches a single-verse range exactly", () => {
    const verse = range("bible.64.3.16");
    expect(rangeContains(verse, { book: 64, chapter: 3, verse: 16 })).toBe(true);
    expect(rangeContains(verse, { book: 64, chapter: 3, verse: 17 })).toBe(false);
  });

  it("treats a chapter-only passage as starting at verse 1", () => {
    expect(rangeContains(range("bible.64.5.1-64.5.47"), { book: 64, chapter: 5 })).toBe(true);
  });

  it("matches cross-book ranges", () => {
    const peter = range("bible.81.1.1-82.3.18");
    expect(rangeContains(peter, { book: 82, chapter: 1, verse: 5 })).toBe(true);
    expect(rangeContains(peter, { book: 83, chapter: 1, verse: 1 })).toBe(false);
  });
});

describe("parseTraits", () => {
  it("reads tab-separated key:value traits, keeping the first value per key", () => {
    const traits = parseTraits(
      "author-denomination-group:bk.%Anglicanism_Belief\tauthor-denomination-group:bk.%Presbyterianism\tcommentary-purpose:concise\tera:reformation\tsupports-bible"
    );
    expect(traits.get("commentary-purpose")).toBe("concise");
    expect(traits.get("era")).toBe("reformation");
    expect(traits.get("author-denomination-group")).toBe("bk.%Anglicanism_Belief");
    expect(traits.has("supports-bible")).toBe(false);
  });

  it("returns an empty map for an empty value", () => {
    expect(parseTraits("").size).toBe(0);
  });
});

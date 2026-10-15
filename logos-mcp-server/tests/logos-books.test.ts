import { describe, it, expect } from "vitest";
import {
  logosBookName,
  logosBookNumber,
  parseLogosBibleRef,
  logosRawToHuman,
} from "../src/services/logos-books.js";
import { resolveBookName } from "../src/services/reference-parser.js";

// Book numbers verified on Logos 54 by opening logosres:LLS:LEB;ref=bible.N.1.1
// (design doc F1): 1 Genesis, 19 Psalms, 39 Malachi, 61 Matthew, 87 Revelation;
// 40–60 opened nothing in the LEB.

describe("logosBookName", () => {
  it("maps Old Testament numbers 1–39", () => {
    expect(logosBookName(1)).toBe("Genesis");
    expect(logosBookName(19)).toBe("Psalms");
    expect(logosBookName(22)).toBe("Song of Solomon");
    expect(logosBookName(39)).toBe("Malachi");
  });

  it("maps New Testament numbers 61–87", () => {
    expect(logosBookName(61)).toBe("Matthew");
    expect(logosBookName(64)).toBe("John");
    expect(logosBookName(65)).toBe("Acts");
    expect(logosBookName(66)).toBe("Romans");
    expect(logosBookName(83)).toBe("1 John");
    expect(logosBookName(87)).toBe("Revelation");
  });

  it("leaves the deuterocanon range and out-of-range numbers unmapped", () => {
    expect(logosBookName(40)).toBeNull();
    expect(logosBookName(44)).toBeNull();
    expect(logosBookName(60)).toBeNull();
    expect(logosBookName(0)).toBeNull();
    expect(logosBookName(88)).toBeNull();
  });
});

describe("logosBookNumber", () => {
  it("returns the Logos number for a canonical book name", () => {
    expect(logosBookNumber("Genesis")).toBe(1);
    expect(logosBookNumber("John")).toBe(64);
    expect(logosBookNumber("Romans")).toBe(66);
    expect(logosBookNumber("Revelation")).toBe(87);
  });

  it("returns null for names it does not map", () => {
    expect(logosBookNumber("Tobit")).toBeNull();
    expect(logosBookNumber("john")).toBeNull();
  });
});

describe("parseLogosBibleRef", () => {
  it("parses a single verse", () => {
    expect(parseLogosBibleRef("bible.64.5.1")).toEqual({
      start: { book: 64, chapter: 5, verse: 1 },
      end: null,
    });
  });

  it("parses a verse range and ignores the edition qualifier", () => {
    expect(parseLogosBibleRef("bible+leb2.66.1.8-66.1.15")).toEqual({
      start: { book: 66, chapter: 1, verse: 8 },
      end: { book: 66, chapter: 1, verse: 15 },
    });
  });

  it("parses book-only and chapter-only shapes", () => {
    expect(parseLogosBibleRef("bible.64")).toEqual({ start: { book: 64 }, end: null });
    expect(parseLogosBibleRef("bible+csb2.61-87")).toEqual({
      start: { book: 61 },
      end: { book: 87 },
    });
    expect(parseLogosBibleRef("bible+csb2.61.1")).toEqual({
      start: { book: 61, chapter: 1 },
      end: null,
    });
    expect(parseLogosBibleRef("bible.64.1-64.2.5")).toEqual({
      start: { book: 64, chapter: 1 },
      end: { book: 64, chapter: 2, verse: 5 },
    });
  });

  it("returns null for non-Bible references", () => {
    expect(parseLogosBibleRef("page.9-13")).toBeNull();
    expect(parseLogosBibleRef("bk.%Sabbath")).toBeNull();
    expect(parseLogosBibleRef("af.1-2")).toBeNull();
    expect(parseLogosBibleRef("")).toBeNull();
  });
});

describe("logosRawToHuman", () => {
  it("formats verses, ranges and chapters with Logos book numbers", () => {
    expect(logosRawToHuman("bible.64.5.1")).toBe("John 5:1");
    expect(logosRawToHuman("bible.66.1.8-66.1.15")).toBe("Romans 1:8-15");
    expect(logosRawToHuman("bible.65.3.21-65.4.5")).toBe("Acts 3:21-4:5");
    expect(logosRawToHuman("bible.19.23")).toBe("Psalms 23");
    expect(logosRawToHuman("bible+csb2.61.1")).toBe("Matthew 1");
  });

  it("formats the observed passage-list references", () => {
    expect(logosRawToHuman("bible.18.10.21-18.10.22")).toBe("Job 10:21-22");
    expect(logosRawToHuman("bible.21.9.10")).toBe("Ecclesiastes 9:10");
    expect(logosRawToHuman("bible.23.5.14")).toBe("Isaiah 5:14");
  });

  it("formats cross-book, book-only and chapter-span ranges", () => {
    expect(logosRawToHuman("bible.65.3.21-66.4.5")).toBe("Acts 3:21-Romans 4:5");
    expect(logosRawToHuman("bible+csb2.61-87")).toBe("Matthew-Revelation");
    expect(logosRawToHuman("bible.64")).toBe("John");
    expect(logosRawToHuman("bible.64.1-64.2.5")).toBe("John 1-2:5");
    expect(logosRawToHuman("bible.64.5-64.6")).toBe("John 5-6");
    expect(logosRawToHuman("bible.64.5-64.5")).toBe("John 5");
  });

  it("formats a range whose start has no verse but whose end does (documented as-is)", () => {
    // Documented-as-is: the start is chapter-only, so the end keeps its full
    // chapter:verse form, giving the slightly odd "John 1-1:5".
    expect(logosRawToHuman("bible.64.1-64.1.5")).toBe("John 1-1:5");
  });

  it("returns null when any book is unmapped or the input is not a Bible reference", () => {
    expect(logosRawToHuman("bible.44.3.21")).toBeNull();
    expect(logosRawToHuman("bible.64.1.1-44.1.1")).toBeNull();
    expect(logosRawToHuman("page.9-13")).toBeNull();
  });
});

describe("Logos book names and reference-parser names", () => {
  it("round-trips every mapped Logos book through resolveBookName and logosBookNumber", () => {
    const numbers = [
      ...Array.from({ length: 39 }, (_, i) => i + 1),
      ...Array.from({ length: 27 }, (_, i) => i + 61),
    ];
    expect(numbers).toHaveLength(66);
    for (const n of numbers) {
      const name = logosBookName(n);
      expect(name, `book ${n}`).not.toBeNull();
      expect(resolveBookName(name as string), name as string).toBe(name);
      expect(logosBookNumber(name as string), name as string).toBe(n);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  parseReference,
  toLogosUrlRef,
  toBibliaRef,
  toHumanReadable,
  expandRange,
} from "../src/services/reference-parser.js";

describe("parseReference", () => {
  it("parses full book names", () => {
    const ref = parseReference("Genesis 1:1");
    expect(ref).toEqual({ book: "Genesis", chapter: 1, verse: 1 });
  });

  it("parses Psalms", () => {
    const ref = parseReference("Psalms 23:1");
    expect(ref).toEqual({ book: "Psalms", chapter: 23, verse: 1 });
  });

  it("parses numbered books", () => {
    const ref = parseReference("1 John 3:16");
    expect(ref).toEqual({ book: "1 John", chapter: 3, verse: 16 });
  });

  it("parses Revelation", () => {
    const ref = parseReference("Revelation 21:4");
    expect(ref).toEqual({ book: "Revelation", chapter: 21, verse: 4 });
  });

  it("parses chapter-only references", () => {
    const ref = parseReference("Genesis 1");
    expect(ref).toEqual({ book: "Genesis", chapter: 1 });
  });

  describe("common abbreviations", () => {
    it("parses Gen", () => {
      expect(parseReference("Gen 1:1").book).toBe("Genesis");
    });

    it("parses Psa", () => {
      expect(parseReference("Psa 119:105").book).toBe("Psalms");
    });

    it("parses Psalm", () => {
      expect(parseReference("Psalm 23:1").book).toBe("Psalms");
    });

    it("parses Rev", () => {
      expect(parseReference("Rev 1:1").book).toBe("Revelation");
    });

    it("parses Matt", () => {
      expect(parseReference("Matt 5:1").book).toBe("Matthew");
    });

    it("parses Exod", () => {
      expect(parseReference("Exod 3:14").book).toBe("Exodus");
    });

    it("parses 1Cor", () => {
      expect(parseReference("1Cor 13:4").book).toBe("1 Corinthians");
    });

    it("parses 2Tim", () => {
      expect(parseReference("2Tim 3:16").book).toBe("2 Timothy");
    });
  });

  describe("verse ranges", () => {
    it("parses same-chapter verse range", () => {
      const ref = parseReference("Ps 119:105-112");
      expect(ref).toEqual({
        book: "Psalms",
        chapter: 119,
        verse: 105,
        endChapter: 119,
        endVerse: 112,
      });
    });

    it("parses Genesis verse range", () => {
      const ref = parseReference("Genesis 1:1-5");
      expect(ref).toEqual({
        book: "Genesis",
        chapter: 1,
        verse: 1,
        endChapter: 1,
        endVerse: 5,
      });
    });
  });

  describe("chapter ranges", () => {
    it("parses chapter range without verses", () => {
      const ref = parseReference("Genesis 1-3");
      expect(ref).toEqual({
        book: "Genesis",
        chapter: 1,
        endChapter: 3,
      });
    });
  });

  describe("cross-chapter ranges", () => {
    it("parses cross-chapter verse range", () => {
      const ref = parseReference("Genesis 1:1-2:3");
      expect(ref).toEqual({
        book: "Genesis",
        chapter: 1,
        verse: 1,
        endChapter: 2,
        endVerse: 3,
      });
    });
  });

  describe("single-chapter books", () => {
    it("parses Jude with implied chapter 1", () => {
      const ref = parseReference("Jude 4");
      expect(ref).toEqual({ book: "Jude", chapter: 1, verse: 4 });
    });

    it("parses Philemon with implied chapter 1", () => {
      const ref = parseReference("Philemon 1");
      expect(ref).toEqual({ book: "Philemon", chapter: 1, verse: 1 });
    });

    it("parses 3 John with implied chapter 1", () => {
      const ref = parseReference("3 John 4");
      expect(ref).toEqual({ book: "3 John", chapter: 1, verse: 4 });
    });

    it("parses Obadiah with implied chapter 1", () => {
      const ref = parseReference("Obadiah 3");
      expect(ref).toEqual({ book: "Obadiah", chapter: 1, verse: 3 });
    });

    it("parses single-chapter book verse range", () => {
      const ref = parseReference("Jude 4-6");
      expect(ref).toEqual({
        book: "Jude",
        chapter: 1,
        verse: 4,
        endChapter: 1,
        endVerse: 6,
      });
    });
  });

  describe("case insensitivity", () => {
    it("handles lowercase", () => {
      const ref = parseReference("genesis 1:1");
      expect(ref).toEqual({ book: "Genesis", chapter: 1, verse: 1 });
    });

    it("handles uppercase", () => {
      const ref = parseReference("GENESIS 1:1");
      expect(ref).toEqual({ book: "Genesis", chapter: 1, verse: 1 });
    });

    it("handles mixed case", () => {
      const ref = parseReference("GeNeSiS 1:1");
      expect(ref).toEqual({ book: "Genesis", chapter: 1, verse: 1 });
    });
  });

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace", () => {
      const ref = parseReference("  Genesis 1:1  ");
      expect(ref).toEqual({ book: "Genesis", chapter: 1, verse: 1 });
    });

    it("handles extra spaces between book and chapter", () => {
      const ref = parseReference("Genesis   1:1");
      expect(ref).toEqual({ book: "Genesis", chapter: 1, verse: 1 });
    });
  });
});

describe("toLogosUrlRef", () => {
  it("converts simple reference", () => {
    expect(toLogosUrlRef("Genesis 1:1")).toBe("Ge1.1");
  });

  it("converts same-chapter verse range", () => {
    expect(toLogosUrlRef("Genesis 1:1-3")).toBe("Ge1.1-1.3");
  });

  it("converts cross-chapter range", () => {
    expect(toLogosUrlRef("Genesis 1:1-2:3")).toBe("Ge1.1-2.3");
  });

  it("converts single-chapter book", () => {
    expect(toLogosUrlRef("Jude 4")).toBe("Jud1.4");
  });

  it("converts numbered book", () => {
    expect(toLogosUrlRef("1 John 3:16")).toBe("1Jn3.16");
  });

  it("converts Psalms", () => {
    expect(toLogosUrlRef("Psalms 23:1")).toBe("Ps23.1");
  });

  it("converts chapter-only reference", () => {
    expect(toLogosUrlRef("Genesis 1")).toBe("Ge1");
  });

  it("converts chapter range", () => {
    expect(toLogosUrlRef("Genesis 1-3")).toBe("Ge1-3");
  });
});

describe("toBibliaRef", () => {
  it("converts simple reference", () => {
    expect(toBibliaRef("Genesis 1:1")).toBe("Genesis+1:1");
  });

  it("converts multi-word book name", () => {
    expect(toBibliaRef("Song of Solomon 1:1")).toBe("Song+of+Solomon+1:1");
  });

  it("converts numbered book", () => {
    expect(toBibliaRef("1 Corinthians 13:4")).toBe("1+Corinthians+13:4");
  });

  it("converts verse range", () => {
    expect(toBibliaRef("Genesis 1:1-5")).toBe("Genesis+1:1-5");
  });

  it("converts cross-chapter range", () => {
    expect(toBibliaRef("Genesis 1:1-2:3")).toBe("Genesis+1:1-2:3");
  });

  it("converts chapter-only", () => {
    expect(toBibliaRef("Genesis 1")).toBe("Genesis+1");
  });
});

describe("toHumanReadable", () => {
  it("converts simple Logos ref", () => {
    expect(toHumanReadable("Ge1.1")).toBe("Genesis 1:1");
  });

  it("converts numbered book Logos ref", () => {
    expect(toHumanReadable("1Jn3.16")).toBe("1 John 3:16");
  });

  it("converts chapter-only Logos ref", () => {
    expect(toHumanReadable("Ge1")).toBe("Genesis 1");
  });

  it("converts verse range Logos ref", () => {
    expect(toHumanReadable("Ge1.1-1.3")).toBe("Genesis 1:1-3");
  });

  it("converts cross-chapter Logos ref", () => {
    expect(toHumanReadable("Ge1.1-2.3")).toBe("Genesis 1:1-2:3");
  });

  it("round-trips Genesis 1:1", () => {
    const logos = toLogosUrlRef("Genesis 1:1");
    expect(toHumanReadable(logos)).toBe("Genesis 1:1");
  });

  it("round-trips 1 John 3:16", () => {
    const logos = toLogosUrlRef("1 John 3:16");
    expect(toHumanReadable(logos)).toBe("1 John 3:16");
  });

  it("round-trips Psalms 119:105-112", () => {
    const logos = toLogosUrlRef("Psalms 119:105-112");
    expect(toHumanReadable(logos)).toBe("Psalms 119:105-112");
  });
});

describe("expandRange", () => {
  it("expands with default context (5 verses)", () => {
    expect(expandRange("John 3:16")).toBe("John 3:11-21");
  });

  it("expands with custom context", () => {
    expect(expandRange("John 3:16", 3)).toBe("John 3:13-19");
  });

  it("clamps start verse to minimum 1", () => {
    expect(expandRange("Genesis 1:2", 5)).toBe("Genesis 1:1-7");
  });

  it("clamps start verse at verse 1", () => {
    expect(expandRange("Genesis 1:1", 5)).toBe("Genesis 1:1-6");
  });

  it("returns as-is for chapter-only reference", () => {
    expect(expandRange("Genesis 1")).toBe("Genesis 1");
  });
});

describe("parseReference error messages", () => {
  it("includes the unparseable input", () => {
    expect(() => parseReference("not a reference")).toThrow(
      'Cannot parse reference: "not a reference"'
    );
  });

  it("includes accepted formats and examples", () => {
    expect(() => parseReference("not a reference")).toThrow(
      'Expected formats like "John 3:16"'
    );
    expect(() => parseReference("not a reference")).toThrow('"1 Cor 13:4-7"');
    expect(() => parseReference("not a reference")).toThrow('"Ps 23"');
    expect(() => parseReference("not a reference")).toThrow(
      "chapter[:verse[-endVerse]]"
    );
  });

  it("still throws a plain unknown-book error for a valid shape with a bad book", () => {
    expect(() => parseReference("NotABook 3:16")).toThrow(
      'Unknown book: "NotABook"'
    );
  });
});

describe("Spanish book names", () => {
  it("resolves full Spanish names with and without accents", () => {
    expect(toLogosUrlRef("Génesis 1:1")).toBe("Ge1.1");
    expect(toLogosUrlRef("Genesis 1:1")).toBe("Ge1.1");
    expect(toLogosUrlRef("Romanos 8:28")).toBe("Ro8.28");
    expect(toLogosUrlRef("1 Corintios 1:4-9")).toBe("1Co1.4-1.9");
    expect(toLogosUrlRef("Apocalipsis 21:1-4")).toBe("Re21.1-21.4");
    expect(toLogosUrlRef("Éxodo 20:1-17")).toBe("Ex20.1-20.17");
  });
  it("resolves Reina-Valera abbreviations", () => {
    expect(toLogosUrlRef("Sal 23")).toBe("Ps23");
    expect(toLogosUrlRef("Hch 2:21")).toBe("Ac2.21");
    expect(toLogosUrlRef("1 Co 13:4-7")).toBe("1Co13.4-13.7");
    expect(toLogosUrlRef("Stg 1:2")).toBe("Jas1.2");
    expect(toLogosUrlRef("Ef 2:8")).toBe("Eph2.8");
    expect(toLogosUrlRef("Mr 1:1")).toBe("Mk1.1");
  });
  it("keeps English aliases intact where a Spanish form could collide", () => {
    expect(toLogosUrlRef("Judg 4")).toBe("Jdg4");
    expect(toLogosUrlRef("Jud 4")).toBe("Jud1.4");
    expect(toLogosUrlRef("Is 53:5")).toBe("Is53.5");
  });
  it("handles single-chapter books in Spanish", () => {
    expect(toLogosUrlRef("Filemón 4")).toBe("Phm1.4");
    expect(toLogosUrlRef("Judas 4")).toBe("Jud1.4");
  });
});

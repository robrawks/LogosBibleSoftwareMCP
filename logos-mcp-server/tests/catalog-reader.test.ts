import { describe, it, expect } from "vitest";
import {
  typeLabel,
  resolveTypeFilter,
} from "../src/services/catalog-reader.js";

describe("typeLabel", () => {
  it("returns the human label for a known raw type", () => {
    expect(typeLabel("text.monograph.dictionary.lexicon.greek")).toBe(
      "Greek Lexicon"
    );
    expect(typeLabel("text.monograph.commentary.bible")).toBe("Commentary");
  });

  it("falls back to the last dotted segment for unknown types", () => {
    expect(typeLabel("unknown.dotted.type")).toBe("type");
  });
});

describe("resolveTypeFilter", () => {
  it("passes raw dotted types through unchanged", () => {
    expect(resolveTypeFilter("text.monograph.commentary.bible")).toEqual([
      "text.monograph.commentary.bible",
    ]);
  });

  it("translates a human label to its raw type", () => {
    expect(resolveTypeFilter("Greek Lexicon")).toEqual([
      "text.monograph.dictionary.lexicon.greek",
    ]);
  });

  it("translates labels case-insensitively", () => {
    expect(resolveTypeFilter("greek lexicon")).toEqual([
      "text.monograph.dictionary.lexicon.greek",
    ]);
    expect(resolveTypeFilter("COMMENTARY")).toEqual([
      "text.monograph.commentary.bible",
      "text.monograph.commentary",
    ]);
  });

  it("returns all raw types that share a label", () => {
    expect(resolveTypeFilter("Bible")).toEqual([
      "text.monograph.bible",
      "text.bible",
    ]);
    expect(resolveTypeFilter("Study Bible")).toEqual([
      "text.monograph.study.bible",
    ]);
  });

  it("returns the input unchanged when it matches no label", () => {
    expect(resolveTypeFilter("bogus type")).toEqual(["bogus type"]);
    expect(resolveTypeFilter("")).toEqual([""]);
  });
});

describe("licensing and language filters", () => {
  it("treats Availability 2 as licensed and anything else as not", async () => {
    const { isLicensed } = await import("../src/services/catalog-reader.js");
    expect(isLicensed(2)).toBe(true);
    expect(isLicensed(3)).toBe(false);
    expect(isLicensed(null)).toBe(false);
  });
  it("builds a whole-token language clause", async () => {
    const { languageClause } = await import("../src/services/catalog-reader.js");
    const c = languageClause(" ES ");
    expect(c.params).toEqual(["es", "es %", "% es", "% es %"]);
    expect(c.sql).toContain("LOWER(Languages)");
  });
});

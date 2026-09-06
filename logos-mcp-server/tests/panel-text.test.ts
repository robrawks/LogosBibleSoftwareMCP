import { describe, it, expect } from "vitest";
import { splitCitation, mergeOverlap } from "../src/services/panel-text.js";
import { parseTextOffsets } from "../src/services/panel-text.js";

describe("splitCitation", () => {
  it("separates body from the %X citation block", () => {
    const raw = "Texto del comentario.\n\n%T The First Epistle\n%E Lias, J. J.\n%D 1905\n%P 31–32\n";
    const { body, citation } = splitCitation(raw);
    expect(body).toBe("Texto del comentario.");
    expect(citation).toEqual({ title: "The First Epistle", editor: "Lias, J. J.", year: "1905", pages: "31–32" });
  });
  it("returns the whole text when there is no citation", () => {
    expect(splitCitation("solo texto")).toEqual({ body: "solo texto", citation: {} });
  });
});

describe("mergeOverlap", () => {
  it("drops the part of the next screen already seen", () => {
    const a = "La gracia de Dios que os fue dada en Cristo Jesús; porque en todas las cosas fuisteis enriquecidos en él";
    const b = "porque en todas las cosas fuisteis enriquecidos en él, en toda palabra y en toda ciencia";
    expect(mergeOverlap(a, b)).toBe(a + "\n, en toda palabra y en toda ciencia");
  });
  it("ignores whitespace differences in the overlap", () => {
    const a = "uno dos tres cuatro cinco seis siete ocho nueve diez once doce";
    const b = "cuatro cinco  seis\nsiete ocho nueve diez once doce trece";
    expect(mergeOverlap(a, b)).toBe(a + "\ntrece");
  });
  it("keeps both when there is no overlap", () => {
    expect(mergeOverlap("aaa", "bbb")).toBe("aaa\n\nbbb");
    expect(mergeOverlap("", "bbb")).toBe("bbb");
  });
});

describe("parseTextOffsets (LOGOS_PANEL_TEXT_OFFSETS)", () => {
  const d = { top: 165, left: 20, right: 40, bottom: 10 };
  it("returns defaults when unset or blank", () => {
    expect(parseTextOffsets(undefined, d)).toEqual(d);
    expect(parseTextOffsets("  ", d)).toEqual(d);
  });
  it("parses top,left,right,bottom", () => {
    expect(parseTextOffsets("130, 20,40 ,10", d)).toEqual({ top: 130, left: 20, right: 40, bottom: 10 });
  });
  it("falls back on malformed values", () => {
    expect(parseTextOffsets("130,20,40", d)).toEqual(d);
    expect(parseTextOffsets("a,b,c,d", d)).toEqual(d);
    expect(parseTextOffsets("-5,20,40,10", d)).toEqual(d);
    expect(parseTextOffsets("1.5,20,40,10", d)).toEqual(d);
  });
});

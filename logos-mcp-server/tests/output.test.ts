import { describe, it, expect } from "vitest";
import { resolveLimit, toJsonText, MAX_JSON_LIMIT } from "../src/utils/output.js";

describe("resolveLimit", () => {
  it("uses the tool default when no limit is given", () => {
    expect(resolveLimit(undefined, 20, undefined)).toBe(20);
    expect(resolveLimit(undefined, 20, "text")).toBe(20);
    expect(resolveLimit(undefined, 20, "json")).toBe(20);
  });

  it("leaves text-mode limits uncapped, as before", () => {
    expect(resolveLimit(5000, 20, "text")).toBe(5000);
  });

  it("caps JSON-mode limits at 1,000", () => {
    expect(MAX_JSON_LIMIT).toBe(1000);
    expect(resolveLimit(5000, 20, "json")).toBe(1000);
    expect(resolveLimit(999, 20, "json")).toBe(999);
  });
});

describe("toJsonText", () => {
  it("pretty-prints with two-space indentation", () => {
    expect(toJsonText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
  });

  it("keeps nulls", () => {
    expect(toJsonText({ title: null })).toBe('{\n  "title": null\n}');
  });
});

import { describe, it, expect } from "vitest";
import { stripXml, stripRichText, decodeEntities } from "../src/utils/strip-markup.js";

describe("stripXml", () => {
  it("removes HTML/XML tags", () => {
    expect(stripXml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(stripXml("faith &amp; grace &lt;3&gt;")).toBe("faith & grace <3>");
  });

  it("normalizes whitespace", () => {
    expect(stripXml("hello   \n  world")).toBe("hello world");
  });

  it("returns null for null input", () => {
    expect(stripXml(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(stripXml("")).toBeNull();
  });
});

describe("stripRichText", () => {
  it("extracts text from Logos XAML Run elements", () => {
    const xaml = '<Paragraph><Run FontSize="12" Text="Grace alone"/></Paragraph>';
    expect(stripRichText(xaml)).toBe("Grace alone");
  });

  it("joins multiple Run elements with spaces", () => {
    const xaml = '<Paragraph><Run Text="Hello"/><Run Text="world"/></Paragraph>';
    expect(stripRichText(xaml)).toBe("Hello world");
  });

  it("adds newlines between paragraphs", () => {
    const xaml = '<Paragraph><Run Text="Line one"/></Paragraph><Paragraph><Run Text="Line two"/></Paragraph>';
    expect(stripRichText(xaml)).toBe("Line one\nLine two");
  });

  it("falls back to stripXml for non-XAML content", () => {
    expect(stripRichText("<p>Simple HTML</p>")).toBe("Simple HTML");
  });

  it("returns null for null input", () => {
    expect(stripRichText(null)).toBeNull();
  });

  it("returns null for whitespace-only result", () => {
    const xaml = '<Paragraph><Run Text="   "/></Paragraph>';
    expect(stripRichText(xaml)).toBeNull();
  });

  it("handles Text attributes with single quotes", () => {
    const xaml = "<Paragraph><Run Text='Grace alone'/></Paragraph>";
    expect(stripRichText(xaml)).toBe("Grace alone");
  });
});

describe("decodeEntities", () => {
  it("decodes named entities", () => {
    expect(decodeEntities("Jacob &amp; Esau &gt; Isaac")).toBe("Jacob & Esau > Isaac");
  });

  it("decodes numeric entities, including the newline Logos emits", () => {
    expect(decodeEntities("line one&#10;line two")).toBe("line one\nline two");
    expect(decodeEntities("&#39;quoted&#39;")).toBe("'quoted'");
    expect(decodeEntities("&#x2019;")).toBe("\u2019");
  });

  it("decodes &amp; last so an escaped entity is not double-decoded", () => {
    expect(decodeEntities("&amp;gt;")).toBe("&gt;");
  });
});

describe("stripRichText — quote handling regression", () => {
  // The original regex used a single [^"']* class for both quote styles, so a
  // double-quoted value stopped at its first apostrophe. A real note collapsed
  // from a full paragraph to the word "God".
  it("keeps apostrophes inside double-quoted Text attributes", () => {
    const xaml = `<Paragraph><Run Text="He's worked salvation"/></Paragraph>`;
    expect(stripRichText(xaml)).toBe("He's worked salvation");
  });

  it("does not truncate a run at an embedded apostrophe", () => {
    const xaml = `<Paragraph><Run Text="God's worthy of praise due to His doings."/></Paragraph>`;
    expect(stripRichText(xaml)).toBe("God's worthy of praise due to His doings.");
  });

  it("keeps double quotes inside single-quoted Text attributes", () => {
    const xaml = `<Paragraph><Run Text='He said "come" to them'/></Paragraph>`;
    expect(stripRichText(xaml)).toBe('He said "come" to them');
  });

  it("decodes entities inside XAML runs rather than leaking them", () => {
    const xaml = '<Paragraph><Run Text="Law &amp; Gospel &gt; works"/></Paragraph>';
    expect(stripRichText(xaml)).toBe("Law & Gospel > works");
  });
});

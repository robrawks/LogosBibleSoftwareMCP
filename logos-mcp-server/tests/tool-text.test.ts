import { describe, it, expect } from "vitest";
import { uiFollowUpHint, logosStateText, formatKnowledgeChoices } from "../src/utils/tool-text.js";

describe("uiFollowUpHint", () => {
  it("suggests confirming with window titles or a screenshot on macOS", () => {
    expect(uiFollowUpHint("bible", "darwin")).toBe(
      " Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'bible') to see the results."
    );
  });

  it("suggests nothing where those tools cannot work", () => {
    expect(uiFollowUpHint("bible", "win32")).toBe("");
    expect(uiFollowUpHint("guide", "linux")).toBe("");
  });
});

describe("logosStateText", () => {
  it("lists window titles on macOS", () => {
    expect(logosStateText(["Logos", "John 5"], "darwin")).toBe("Logos is running. Window titles:\n- Logos\n- John 5");
    expect(logosStateText([], "darwin")).toBe("Logos is running. Window titles:\n- (no named windows found)");
  });

  it("says titles are unavailable on Windows instead of implying none are open", () => {
    expect(logosStateText([], "win32")).toBe("Logos is running. Window titles are not available on Windows.");
  });
});

describe("formatKnowledgeChoices", () => {
  it("lists each entry with its ID, kind and description", () => {
    expect(
      formatKnowledgeChoices([
        { id: "bk.#Moses", label: "Moses", kind: "Man", description: "Man, Judge" },
        { id: "bk.to:DBT-5333", label: "Healing", kind: "PreachingTheme", description: null },
        { id: "bk.%X", label: "X", kind: null, description: null },
      ])
    ).toBe(
      "- `bk.#Moses` — Moses (Man): Man, Judge\n- `bk.to:DBT-5333` — Healing (PreachingTheme)\n- `bk.%X` — X"
    );
  });
});

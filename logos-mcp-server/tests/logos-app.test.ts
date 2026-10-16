import { describe, it, expect } from "vitest";
import { launchLogosUrl } from "../src/services/logos-app.js";

describe("launchLogosUrl", () => {
  it("returns a failed result without launching when the link cannot be built", async () => {
    const result = await launchLogosUrl(() => {
      throw new Error('Cannot parse reference: "nonsense"');
    });
    expect(result).toEqual({ success: false, command: "", error: 'Cannot parse reference: "nonsense"' });
  });
});

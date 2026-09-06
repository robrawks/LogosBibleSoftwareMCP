import { describe, it, expect } from "vitest";
import { withUiLock } from "../src/utils/ui-lock.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withUiLock", () => {
  it("runs concurrent callers one after another, in order", async () => {
    const log: string[] = [];
    const a = withUiLock(async () => { log.push("a:start"); await sleep(40); log.push("a:end"); return "A"; });
    const b = withUiLock(async () => { log.push("b:start"); await sleep(10); log.push("b:end"); return "B"; });
    expect(await Promise.all([a, b])).toEqual(["A", "B"]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });
  it("releases the lock when the callback throws", async () => {
    await expect(withUiLock(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withUiLock(async () => 42)).toBe(42);
  });
});

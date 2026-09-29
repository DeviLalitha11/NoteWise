import { describe, expect, it } from "vitest";
import { chunkPages, isHeading, splitSentences } from "../src/lib/chunker";

const sentence = (i: number) => `This is sentence number ${i} about operating systems and memory.`; // 10 words

describe("isHeading", () => {
  it.each(["UNIT - III", "3.2 Deadlock Avoidance", "Banker's Algorithm", "INTRODUCTION", "Chapter 4: Paging"])("detects %s", (h) =>
    expect(isHeading(h)).toBe(true),
  );
  it.each([
    "A deadlock occurs when every process waits for another.",
    "the process is blocked",
    "Processes can be in one of five states, namely new, ready, running, waiting and terminated",
  ])("rejects body text: %s", (t) => expect(isHeading(t)).toBe(false));
});

describe("splitSentences", () => {
  it("does not split on abbreviations or decimals", () => {
    expect(splitSentences("Use a lock, e.g. a mutex. Pi is 3.14 roughly. Done!")).toEqual([
      "Use a lock, e.g. a mutex.",
      "Pi is 3.14 roughly.",
      "Done!",
    ]);
  });
});

describe("chunkPages", () => {
  it("never lets a chunk span two pages", () => {
    const pages = [1, 2, 3].map((page) => ({ page, text: Array.from({ length: 25 }, (_, i) => sentence(i)).join(" ") }));
    const chunks = chunkPages("d", pages, { targetWords: 60, maxWords: 100 });
    for (const c of chunks) {
      expect(pages[c.page - 1].text).toContain(c.text.split(". ")[0]);
    }
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2, 3]));
  });

  it("respects maxWords and overlaps one sentence", () => {
    const text = Array.from({ length: 30 }, (_, i) => sentence(i)).join(" ");
    const chunks = chunkPages("d", [{ page: 1, text }], { targetWords: 50, maxWords: 80, overlapSentences: 1 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(80);
    const lastOfFirst = splitSentences(chunks[0].text).at(-1)!;
    expect(chunks[1].text.startsWith(lastOfFirst)).toBe(true);
  });

  it("labels chunks with the nearest heading, carried across pages", () => {
    const chunks = chunkPages("d", [
      { page: 1, text: "Deadlock Avoidance\nThe system checks every request before granting it." },
      { page: 2, text: "It uses the safety algorithm to decide." },
      { page: 3, text: "3.3 Paging\nMemory is split into frames." },
    ]);
    expect(chunks.map((c) => [c.page, c.heading])).toEqual([
      [1, "Deadlock Avoidance"],
      [2, "Deadlock Avoidance"],
      [3, "3.3 Paging"],
    ]);
  });

  it("hard-splits a giant run-on sentence", () => {
    const text = Array.from({ length: 450 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkPages("d", [{ page: 1, text }], { maxWords: 200 });
    expect(chunks.every((c) => c.text.split(" ").length <= 200)).toBe(true);
    expect(chunks.map((c) => c.text).join(" ")).toContain("w449");
  });

  it("skips empty pages and produces stable ids", () => {
    const chunks = chunkPages("doc1", [{ page: 1, text: "   " }, { page: 2, text: "Some real content here." }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe("doc1:2:0");
  });
});

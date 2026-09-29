import { describe, expect, it, vi } from "vitest";
import { downloadPolicy } from "../src/lib/network";
import { cleanOcrText, needsOcr } from "../src/lib/ocr";
import { buildAnswerPrompt, NOT_FOUND, parseCitations } from "../src/lib/prompt";
import type { SearchHit } from "../src/lib/types";
import { createProgressTracker, withStallTimeout } from "../src/workers/loadModel";

const hit = (page: number, text: string, heading?: string): SearchHit => ({
  chunk: { id: `d:${page}:0`, docId: "d", page, index: 0, heading, text },
  docTitle: "OS Notes",
  docKind: "pdf",
  score: 1,
  via: { keyword: true, semantic: false },
});

describe("buildAnswerPrompt", () => {
  it("numbers passages with their page and puts the question last", () => {
    const { messages, used } = buildAnswerPrompt("What is paging?", [hit(4, "Paging divides memory.", "Memory"), hit(9, "Frames are fixed size.")]);
    const c = messages[0].content;
    expect(used).toHaveLength(2);
    expect(c).toContain("[1] (OS Notes, page 4, Memory)\nPaging divides memory.");
    expect(c).toContain("[2] (OS Notes, page 9)");
    expect(c).toContain(NOT_FOUND);
    expect(c.trim().endsWith("Question: What is paging?")).toBe(true);
  });
  it("stays within the character budget", () => {
    const long = "word ".repeat(600);
    const { messages, used } = buildAnswerPrompt("q", [hit(1, long), hit(2, long), hit(3, long)], 1500);
    expect(used.length).toBeLessThan(3);
    expect(messages[0].content.length).toBeLessThan(1500 + 900); // passages budget + fixed instructions
  });
  it("labels photo notes as photos", () => {
    const h = { ...hit(3, "Text from a photo."), docKind: "photos" as const };
    expect(buildAnswerPrompt("q", [h]).messages[0].content).toContain("(OS Notes, photo 3)");
  });
});

describe("parseCitations", () => {
  it("splits text and citations, including grouped ones", () => {
    expect(parseCitations("Paging avoids fragmentation [1]. Frames [2, 3].", 3)).toEqual([
      { type: "text", text: "Paging avoids fragmentation " },
      { type: "cite", n: 1 },
      { type: "text", text: ". Frames " },
      { type: "cite", n: 2 },
      { type: "cite", n: 3 },
      { type: "text", text: "." },
    ]);
  });
  it("drops citations to passages that don't exist", () => {
    expect(parseCitations("Made up [7].", 2)).toEqual([
      { type: "text", text: "Made up " },
      { type: "text", text: "." },
    ]);
  });
});

describe("downloadPolicy", () => {
  it("downloads automatically unless on mobile data or Data Saver", () => {
    expect(downloadPolicy(undefined)).toBe("auto");
    expect(downloadPolicy({ type: "wifi" })).toBe("auto");
    expect(downloadPolicy({ type: "cellular" })).toBe("ask");
    expect(downloadPolicy({ type: "wifi", saveData: true })).toBe("ask");
  });
});

describe("OCR helpers", () => {
  it("detects pages without a real text layer", () => {
    expect(needsOcr("  12 \n ")).toBe(true);
    expect(needsOcr("A deadlock is a situation where processes wait forever.")).toBe(false);
  });
  it("joins hyphenated line breaks and drops noise lines", () => {
    expect(cleanOcrText("Banker's algo-\nrithm avoids   deadlock\n~ .\n3.2 Paging")).toBe("Banker's algorithm avoids deadlock\n3.2 Paging");
  });
});

describe("withStallTimeout", () => {
  it("keeps waiting while progress keeps arriving, gives up after a real stall", async () => {
    vi.useFakeTimers();
    const tracker = createProgressTracker(() => {});
    let finish!: (v: string) => void;
    const slowDownload = withStallTimeout(new Promise<string>((r) => (finish = r)), tracker, 5000);
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(3000); // 18 s total, longer than the stall limit…
      tracker.callback({ status: "progress", file: "model.onnx", loaded: i, total: 10 }); // …but it's making progress
    }
    finish("loaded");
    await expect(slowDownload).resolves.toBe("loaded");

    const hung = withStallTimeout(new Promise<string>(() => {}), createProgressTracker(() => {}), 5000);
    const assertion = expect(hung).rejects.toThrow(/no progress/);
    await vi.advanceTimersByTimeAsync(7000);
    await assertion;
    vi.useRealTimers();
  });
});

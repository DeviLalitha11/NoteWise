import { describe, expect, it } from "vitest";
import { Bm25Index, stem, tokenize } from "../src/lib/bm25";
import { reciprocalRankFusion } from "../src/lib/fusion";
import { highlight } from "../src/lib/highlight";
import { dot, normalize, topK } from "../src/lib/vector";

describe("tokenize / stem", () => {
  it("drops stopwords and exam filler words", () => {
    expect(tokenize("Explain the concept of Deadlock with an example")).toEqual(["concept", "deadlock"]);
  });
  it("maps word forms to the same stem", () => {
    expect(stem("scheduling")).toBe(stem("schedule"));
    expect(stem("processes")).toBe(stem("process"));
    expect(stem("policies")).toBe(stem("policy"));
    expect(stem("queues")).toBe(stem("queue"));
    expect(stem("status")).toBe("status");
  });
  it("keeps Telugu words whole (combining vowel signs)", () => {
    expect(tokenize("ప్రక్రియ నిర్వహణ")).toEqual(["ప్రక్రియ", "నిర్వహణ"]);
  });
});

describe("Bm25Index", () => {
  const idx = new Bm25Index([
    { id: "a", text: "Deadlock happens when processes wait for each other forever." },
    { id: "b", text: "Paging divides memory into fixed size frames and pages." },
    { id: "c", text: "The Banker's algorithm avoids deadlock by checking safe states." },
    { id: "d", text: "CPU scheduling decides which process runs next." },
  ]);
  it("ranks matching passages first", () => {
    const hits = idx.search("how to avoid deadlock");
    expect(hits.map((h) => h.id).slice(0, 2).sort()).toEqual(["a", "c"]);
  });
  it("prefers rare, specific terms", () => {
    expect(idx.search("banker deadlock")[0].id).toBe("c");
  });
  it("returns nothing for unrelated queries and supports removal", () => {
    expect(idx.search("photosynthesis")).toEqual([]);
    idx.remove("c");
    expect(idx.search("banker")).toEqual([]);
    expect(idx.size).toBe(3);
  });
});

describe("vector search", () => {
  it("normalises and scores by cosine", () => {
    const q = normalize([1, 0, 0]);
    expect(dot(q, normalize([2, 0, 0]))).toBeCloseTo(1);
    const hits = topK(q, [
      { id: "same", embedding: normalize([1, 0.1, 0]) },
      { id: "orthogonal", embedding: normalize([0, 1, 0]) },
      { id: "pending" },
    ]);
    expect(hits.map((h) => h.id)).toEqual(["same"]);
  });
  it("rejects mismatched dimensions", () => {
    expect(() => dot(new Float32Array(2), new Float32Array(3))).toThrow(/Dimension/);
  });
});

describe("reciprocalRankFusion", () => {
  it("rewards agreement between retrievers", () => {
    const fused = reciprocalRankFusion({
      keyword: [{ id: "x" }, { id: "both" }],
      semantic: [{ id: "y" }, { id: "both" }],
    });
    expect(fused[0].id).toBe("both");
    expect([...fused[0].sources].sort()).toEqual(["keyword", "semantic"]);
  });
});

describe("highlight", () => {
  it("marks stemmed matches only", () => {
    const segs = highlight("Processes wait. The process is blocked.", "process");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["Processes", "process"]);
    expect(segs.map((s) => s.text).join("")).toBe("Processes wait. The process is blocked.");
  });
});

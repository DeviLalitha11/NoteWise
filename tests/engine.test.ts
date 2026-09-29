import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDBForTests } from "../src/lib/db";
import { Engine } from "../src/lib/engine";

/** Toy embedding: bag of a few topic words. Enough to test fusion and persistence. */
const TOPICS = ["deadlock", "memory", "schedul", "network", "wait"];
const fakeEmbed = async (texts: string[]) =>
  texts.map((t) => Float32Array.from(TOPICS.map((w) => (t.toLowerCase().includes(w) ? 1 : 0.01))));

const pages = [
  { page: 1, text: "Deadlocks\nA deadlock is a situation where processes wait forever for resources held by each other." },
  { page: 2, text: "Memory Management\nPaging splits memory into frames. Segmentation uses variable sized segments." },
  { page: 3, text: "CPU Scheduling\nRound robin gives each process a fixed time quantum." },
];

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await resetDBForTests();
});

describe("Engine", () => {
  it("answers with keyword search immediately, with page citations", async () => {
    const engine = new Engine({ embed: fakeEmbed, canEmbed: () => false });
    await engine.init();
    const doc = await engine.addDocument("OS Unit 3", pages);
    expect(doc.chunkCount).toBe(3);
    const [top] = await engine.search("what is paging");
    expect(top.chunk.page).toBe(2);
    expect(top.docTitle).toBe("OS Unit 3");
    expect(top.via).toEqual({ keyword: true, semantic: false });
  });

  it("adds semantic results once embeddings exist, and persists them", async () => {
    let ready = false;
    const engine = new Engine({ embed: fakeEmbed, canEmbed: () => ready });
    await engine.init();
    await engine.addDocument("OS", pages);
    ready = true;
    await engine.embedPending();
    expect(engine.listDocs()[0].embedded).toBe(true);

    // A fresh engine (like reopening the app) sees the saved embeddings.
    const reopened = new Engine({ embed: fakeEmbed, canEmbed: () => true });
    await reopened.init();
    const hits = await reopened.search("processes stuck waiting");
    expect(hits[0].chunk.page).toBe(1);
    expect(hits[0].via.semantic).toBe(true);
  });

  it("removes a document and all of its chunks", async () => {
    const engine = new Engine({ embed: fakeEmbed, canEmbed: () => false });
    await engine.init();
    const doc = await engine.addDocument("OS", pages);
    await engine.removeDocument(doc.id);
    expect(engine.listDocs()).toEqual([]);
    expect(await engine.search("deadlock")).toEqual([]);
    const reopened = new Engine({ embed: fakeEmbed, canEmbed: () => false });
    await reopened.init();
    expect(reopened.chunkCount).toBe(0);
  });

  it("explains unreadable files instead of silently adding nothing", async () => {
    const engine = new Engine({ embed: fakeEmbed, canEmbed: () => false });
    await engine.init();
    await expect(engine.addDocument("scan", [{ page: 1, text: "" }])).rejects.toThrow(/No readable text/);
  });
});

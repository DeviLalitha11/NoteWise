import { Bm25Index } from "./bm25";
import { chunkPages } from "./chunker";
import * as db from "./db";
import { reciprocalRankFusion } from "./fusion";
import type { Chunk, NoteDoc, PageText, SearchHit } from "./types";
import { normalize, topK } from "./vector";

export interface EngineDeps {
  /** Returns one L2-normalised vector per input text. */
  embed: (texts: string[]) => Promise<Float32Array[]>;
  /** Whether semantic search can be used right now (model downloaded and loaded). */
  canEmbed: () => boolean;
}

export interface EngineEvents {
  onChange?: () => void;
  onEmbedProgress?: (docId: string, done: number, total: number) => void;
}

const EMBED_BATCH = 16;
const CANDIDATES = 30;

/**
 * The search engine: owns the in-memory indexes and keeps them in sync with IndexedDB.
 *
 * Retrieval is hybrid:
 *   keyword (BM25)  ─┐
 *                    ├─ Reciprocal Rank Fusion ─> top passages with page numbers
 *   semantic (MiniLM)┘
 * Keyword search works the moment a PDF is added. Semantic search joins in as
 * soon as that document's embeddings are computed in the background.
 */
export class Engine {
  private chunks = new Map<string, Chunk>();
  private docs = new Map<string, NoteDoc>();
  private keyword = new Bm25Index();
  private embedding = new Set<string>(); // docIds currently being embedded

  constructor(
    private deps: EngineDeps,
    private events: EngineEvents = {},
  ) {}

  /** Load everything saved on this device and rebuild the in-memory indexes. */
  async init(): Promise<void> {
    const [docs, chunks] = await Promise.all([db.listDocuments(), db.getAllChunks()]);
    this.docs = new Map(docs.map((d) => [d.id, d]));
    this.chunks = new Map(chunks.map((c) => [c.id, c]));
    this.keyword = new Bm25Index(chunks.map((c) => ({ id: c.id, text: indexText(c) })));
    this.events.onChange?.();
  }

  listDocs(): NoteDoc[] {
    return [...this.docs.values()].sort((a, b) => b.addedAt - a.addedAt);
  }

  get chunkCount() {
    return this.chunks.size;
  }

  /** Add a document from already-extracted pages. Returns immediately usable for keyword search. */
  async addDocument(title: string, pages: PageText[], kind: NoteDoc["kind"] = "pdf"): Promise<NoteDoc> {
    const id = makeId();
    const chunks = chunkPages(id, pages);
    if (chunks.length === 0) {
      throw new Error("No readable text found. If these are handwritten notes, try a clearer, well-lit photo; OCR reads printed text best.");
    }
    const doc: NoteDoc = { id, title, kind, pageCount: pages.length, chunkCount: chunks.length, addedAt: Date.now(), embedded: false };
    await db.saveDocument(doc, chunks);
    this.docs.set(id, doc);
    for (const c of chunks) {
      this.chunks.set(c.id, c);
      this.keyword.add({ id: c.id, text: indexText(c) });
    }
    this.events.onChange?.();
    return doc;
  }

  async removeDocument(docId: string): Promise<void> {
    await db.deleteDocument(docId);
    this.docs.delete(docId);
    for (const [id, c] of this.chunks) {
      if (c.docId === docId) {
        this.chunks.delete(id);
        this.keyword.remove(id);
      }
    }
    this.events.onChange?.();
  }

  /**
   * Compute embeddings for every document that doesn't have them yet.
   * Saves after each batch, so closing the tab midway loses at most one batch.
   */
  async embedPending(): Promise<void> {
    if (!this.deps.canEmbed()) return;
    for (const doc of this.listDocs()) {
      if (doc.embedded || this.embedding.has(doc.id)) continue;
      this.embedding.add(doc.id);
      try {
        await this.embedDoc(doc);
      } finally {
        this.embedding.delete(doc.id);
      }
    }
  }

  private async embedDoc(doc: NoteDoc) {
    const all = [...this.chunks.values()].filter((c) => c.docId === doc.id);
    const todo = all.filter((c) => !c.embedding);
    let done = all.length - todo.length;
    this.events.onEmbedProgress?.(doc.id, done, all.length);
    for (let i = 0; i < todo.length; i += EMBED_BATCH) {
      if (!this.docs.has(doc.id)) return; // deleted meanwhile
      const batch = todo.slice(i, i + EMBED_BATCH);
      const vectors = await this.deps.embed(batch.map(indexText));
      const saved = new Map<string, Float32Array>();
      batch.forEach((c, j) => {
        const v = normalize(vectors[j]);
        this.chunks.set(c.id, { ...c, embedding: v });
        saved.set(c.id, v);
      });
      done += batch.length;
      const complete = done >= all.length;
      await db.saveEmbeddings(doc.id, saved, complete);
      if (complete) this.docs.set(doc.id, { ...doc, embedded: true });
      this.events.onEmbedProgress?.(doc.id, done, all.length);
    }
    this.events.onChange?.();
  }

  /** Hybrid search. Falls back to keyword-only when the model isn't available. */
  async search(query: string, limit = 8): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q || this.chunks.size === 0) return [];

    const keywordHits = this.keyword.search(q, CANDIDATES);
    let semanticHits: { id: string; score: number }[] = [];
    if (this.deps.canEmbed()) {
      try {
        const [qv] = await this.deps.embed([q]);
        semanticHits = topK(normalize(qv), this.chunks.values(), CANDIDATES);
      } catch (err) {
        console.warn("[notewise] semantic search failed, keyword results only:", err);
      }
    }

    return reciprocalRankFusion({ keyword: keywordHits, semantic: semanticHits })
      .slice(0, limit)
      .map(({ id, score, sources }) => {
        const chunk = this.chunks.get(id)!;
        return {
          chunk,
          docTitle: this.docs.get(chunk.docId)?.title ?? "Unknown document",
          docKind: this.docs.get(chunk.docId)?.kind ?? "pdf",
          score,
          via: { keyword: sources.has("keyword"), semantic: sources.has("semantic") },
        };
      });
  }
}

/** Headings are searchable too: "deadlock" should find a chunk under "Deadlock Avoidance". */
function indexText(c: Chunk): string {
  return c.heading ? `${c.heading}. ${c.text}` : c.text;
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

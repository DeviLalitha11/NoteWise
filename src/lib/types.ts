/** One page of text pulled out of a PDF. Page numbers are 1-based, like the PDF viewer shows. */
export interface PageText {
  page: number;
  text: string;
}

/** A document the student added to their library. */
export interface NoteDoc {
  id: string;
  title: string;
  pageCount: number;
  chunkCount: number;
  addedAt: number;
  /** Where the text came from. Photo notes cite "photo 3" rather than "page 3". */
  kind?: "pdf" | "photos";
  /** True once every chunk has an embedding. Until then search is keyword-only. */
  embedded: boolean;
}

/**
 * A small passage of a document — the unit we search over and cite.
 * Chunks never cross a page boundary, so every answer can point to one exact page.
 */
export interface Chunk {
  id: string;
  docId: string;
  page: number;
  /** Position of this chunk within its page, for stable ordering. */
  index: number;
  /** Nearest heading above the chunk, if one was detected. Shown as context. */
  heading?: string;
  text: string;
  /** L2-normalised sentence embedding. Missing until the model has processed it. */
  embedding?: Float32Array;
}

export interface SearchHit {
  chunk: Chunk;
  docTitle: string;
  docKind: "pdf" | "photos";
  /** Fused rank score — only meaningful relative to other hits in the same search. */
  score: number;
  /** Which retrievers found it. Useful in the UI and when explaining results. */
  via: { keyword: boolean; semantic: boolean };
}

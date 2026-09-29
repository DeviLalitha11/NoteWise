import type { Chunk, PageText } from "./types";

export interface ChunkOptions {
  /** Aim for chunks around this many words. Small enough to be precise, big enough to carry meaning. */
  targetWords?: number;
  /** Never exceed this many words, even if a single sentence is enormous. */
  maxWords?: number;
  /** Repeat this many trailing sentences at the start of the next chunk so ideas aren't cut in half. */
  overlapSentences?: number;
}

const DEFAULTS: Required<ChunkOptions> = { targetWords: 120, maxWords: 200, overlapSentences: 1 };

/**
 * Heuristic heading detector for lecture notes and textbooks.
 * Matches things like "UNIT - III", "3.2 Deadlock Avoidance", "Banker's Algorithm", "INTRODUCTION".
 */
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 80) return false;
  const words = t.split(/\s+/);
  if (words.length > 9) return false;
  if (/[.,;:]$/.test(t)) return false; // headings rarely end in punctuation
  if (/^(unit|chapter|module|part|section)\b[\s\-–:]*[\divxlc]+/i.test(t)) return true;
  if (/^\d+(\.\d+){0,3}[.)]?\s+\p{L}/u.test(t)) return true; // "3.2 Deadlock"
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 3 && letters === letters.toUpperCase() && /\p{Lu}/u.test(letters)) return true; // ALL CAPS
  // Title Case: most words start with a capital letter.
  const capitalised = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  return words.length <= 6 && capitalised / words.length >= 0.75;
}

/** Split text into sentences without breaking on "e.g." or decimals like "3.14". */
export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"'(])/u);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    // Re-join fragments produced by common abbreviations.
    if (prev && /\b(e\.g|i\.e|etc|vs|fig|eq|no|dr|mr|mrs|ms)\.$/i.test(prev)) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Hard-split a sentence that is longer than maxWords (tables and bullet dumps do this). */
function splitLong(sentence: string, maxWords: number): string[] {
  const words = sentence.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) out.push(words.slice(i, i + maxWords).join(" "));
  return out;
}

/**
 * Turn extracted pages into search-sized chunks.
 *
 * Rules:
 *  - a chunk never spans two pages (so citations are exact)
 *  - headings are not emitted on their own; they label the chunks that follow them,
 *    including on later pages until a new heading appears
 *  - consecutive chunks share `overlapSentences` sentences of context
 */
export function chunkPages(docId: string, pages: PageText[], options: ChunkOptions = {}): Chunk[] {
  const { targetWords, maxWords, overlapSentences } = { ...DEFAULTS, ...options };
  const chunks: Chunk[] = [];
  let heading: string | undefined;

  for (const { page, text } of pages) {
    let index = 0;
    let buffer: string[] = [];
    let bufferWords = 0;

    const flush = (keepOverlap: boolean) => {
      if (bufferWords === 0) return;
      chunks.push({ id: `${docId}:${page}:${index}`, docId, page, index, heading, text: buffer.join(" ") });
      index++;
      const kept = keepOverlap && overlapSentences > 0 ? buffer.slice(-overlapSentences) : [];
      // Don't carry overlap if it alone would already fill a chunk.
      buffer = kept.reduce((n, s) => n + wordCount(s), 0) < targetWords ? kept : [];
      bufferWords = buffer.reduce((n, s) => n + wordCount(s), 0);
    };

    // Work paragraph by paragraph so headings can be recognised on their own line.
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let paragraph: string[] = [];

    const consumeParagraph = () => {
      if (!paragraph.length) return;
      for (const raw of splitSentences(paragraph.join(" "))) {
        for (const sentence of wordCount(raw) > maxWords ? splitLong(raw, maxWords) : [raw]) {
          const n = wordCount(sentence);
          if (bufferWords > 0 && bufferWords + n > maxWords) flush(true);
          buffer.push(sentence);
          bufferWords += n;
          if (bufferWords >= targetWords) flush(true);
        }
      }
      paragraph = [];
    };

    for (const line of lines) {
      if (isHeading(line)) {
        consumeParagraph();
        flush(false); // a new section starts: don't bleed the old section into it
        buffer = [];
        bufferWords = 0;
        heading = line.replace(/\s+/g, " ");
      } else {
        paragraph.push(line);
      }
    }
    consumeParagraph();
    // Only emit the leftover if it is new content, not just the overlap we carried forward.
    if (buffer.length && !(index > 0 && isOnlyOverlap(chunks, buffer))) flush(false);
  }
  return chunks;
}

function isOnlyOverlap(chunks: Chunk[], buffer: string[]): boolean {
  const last = chunks[chunks.length - 1];
  return !!last && last.text.endsWith(buffer.join(" "));
}

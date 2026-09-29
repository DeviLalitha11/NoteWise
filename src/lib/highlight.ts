import { tokenize } from "./bm25";

export interface Segment {
  text: string;
  match: boolean;
}

/**
 * Split `text` into segments, marking words that match the query after the
 * same tokenising/stemming BM25 uses — so "processes" highlights "process".
 */
export function highlight(text: string, query: string): Segment[] {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [{ text, match: false }];
  const segments: Segment[] = [];
  const re = /[\p{L}\p{M}\p{N}]+/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const [tok] = tokenize(m[0]);
    if (tok && terms.has(tok)) {
      if (m.index > last) segments.push({ text: text.slice(last, m.index), match: false });
      segments.push({ text: m[0], match: true });
      last = m.index + m[0].length;
    }
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

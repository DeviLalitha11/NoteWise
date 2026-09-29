/**
 * BM25 keyword search — the same ranking family used by Elasticsearch and Lucene.
 *
 * Why keep a keyword search when we have embeddings?
 *  - it works instantly, before the embedding model has downloaded
 *  - it runs on any phone, however old
 *  - exact terms ("Banker's algorithm", "TCP", a formula name) are where
 *    small embedding models are weakest and keywords are strongest
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can do does for from had has have how i if in into is it its " +
    "of on or so such than that the their then there these they this to was were what when where " +
    "which while who why will with you your explain define describe write short note notes briefly " +
    "detail about give example examples discuss"
  ).split(" "),
);

/** Very light English stemmer: enough to match "processes"/"process", "scheduling"/"schedule". */
export function stem(word: string): string {
  if (!/^[a-z]+$/.test(word) || word.length <= 4) return word;
  let w = word;
  // 1. plurals
  if (w.endsWith("ies")) w = w.slice(0, -3) + "y"; // policies -> policy
  else if (w.endsWith("sses")) w = w.slice(0, -2); // processes -> process
  else if (/(ch|sh|x|z)es$/.test(w)) w = w.slice(0, -2); // switches -> switch
  else if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1); // threads -> thread
  // 2. verb endings
  if (w.endsWith("ing") && w.length > 6) w = w.slice(0, -3); // scheduling -> schedul
  else if (w.endsWith("ed") && w.length > 5) w = w.slice(0, -2); // scheduled -> schedul
  // 3. a trailing "e", so "schedule" and "scheduling" meet at "schedul"
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  return w;
}

/**
 * Lowercase, split on anything that isn't a letter, combining mark or digit,
 * drop stopwords, stem. \p{M} matters: Telugu vowel signs are combining marks,
 * and without it every Telugu word would be split into pieces.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []) {
    if (raw.length < 2 && !/\p{N}/u.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export interface Bm25Doc {
  id: string;
  text: string;
}

export class Bm25Index {
  private readonly k1 = 1.4;
  private readonly b = 0.75;
  private postings = new Map<string, Map<string, number>>(); // term -> (docId -> term frequency)
  private lengths = new Map<string, number>();
  private totalLength = 0;

  constructor(docs: Iterable<Bm25Doc> = []) {
    for (const d of docs) this.add(d);
  }

  get size(): number {
    return this.lengths.size;
  }

  add(doc: Bm25Doc): void {
    if (this.lengths.has(doc.id)) this.remove(doc.id);
    const terms = tokenize(doc.text);
    this.lengths.set(doc.id, terms.length);
    this.totalLength += terms.length;
    for (const t of terms) {
      let p = this.postings.get(t);
      if (!p) this.postings.set(t, (p = new Map()));
      p.set(doc.id, (p.get(doc.id) ?? 0) + 1);
    }
  }

  remove(id: string): void {
    const len = this.lengths.get(id);
    if (len === undefined) return;
    this.totalLength -= len;
    this.lengths.delete(id);
    for (const [term, p] of this.postings) {
      if (p.delete(id) && p.size === 0) this.postings.delete(term);
    }
  }

  search(query: string, limit = 10): { id: string; score: number }[] {
    const n = this.lengths.size;
    if (n === 0) return [];
    const avgLen = this.totalLength / n || 1;
    const scores = new Map<string, number>();
    for (const term of new Set(tokenize(query))) {
      const p = this.postings.get(term);
      if (!p) continue;
      // Lucene-style IDF: never negative, rare terms weigh more.
      const idf = Math.log(1 + (n - p.size + 0.5) / (p.size + 0.5));
      for (const [id, tf] of p) {
        const len = this.lengths.get(id)!;
        const s = (idf * tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + (this.b * len) / avgLen));
        scores.set(id, (scores.get(id) ?? 0) + s);
      }
    }
    return [...scores]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }
}

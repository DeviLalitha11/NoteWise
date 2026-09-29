/**
 * Semantic search over sentence embeddings.
 *
 * Embeddings are stored L2-normalised, so cosine similarity is just a dot product.
 * A brute-force scan is the right call here: a whole semester of notes is a few
 * thousand chunks x 384 numbers, which a phone scans in a few milliseconds.
 * An approximate index (HNSW) would add complexity with no visible gain at this size.
 */

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface VectorItem {
  id: string;
  embedding?: Float32Array;
}

/**
 * Top-k by cosine similarity. Items without an embedding yet are skipped, and
 * anything under `minScore` is dropped so unrelated notes don't pad the results.
 */
export function topK(query: Float32Array, items: Iterable<VectorItem>, k = 10, minScore = 0.2) {
  const hits: { id: string; score: number }[] = [];
  for (const item of items) {
    if (!item.embedding) continue;
    const score = dot(query, item.embedding);
    if (score >= minScore) hits.push({ id: item.id, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
}

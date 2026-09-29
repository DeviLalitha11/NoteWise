/**
 * Reciprocal Rank Fusion: merge several ranked lists into one.
 *
 * BM25 scores and cosine similarities live on completely different scales, so
 * adding them is meaningless. RRF ignores raw scores and uses only rank:
 *   score(d) = sum over lists of 1 / (k + rank of d in that list)
 * A passage that both retrievers like rises to the top. k = 60 is the value
 * from the original paper (Cormack et al., 2009) and works well untuned.
 */
export function reciprocalRankFusion(lists: Record<string, { id: string }[]>, k = 60) {
  const fused = new Map<string, { id: string; score: number; sources: Set<string> }>();
  for (const [source, list] of Object.entries(lists)) {
    list.forEach(({ id }, rank) => {
      const entry = fused.get(id) ?? { id, score: 0, sources: new Set<string>() };
      entry.score += 1 / (k + rank + 1);
      entry.sources.add(source);
      fused.set(id, entry);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

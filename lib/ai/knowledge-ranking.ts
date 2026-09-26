/**
 * KNOWLEDGE RANKING — plain, deterministic arithmetic. Not a learning system.
 *
 * Retrieval returns candidates from the sets ASSIGNED to a tool; this decides
 * which of them the engine uses. Feedback (👍/👎) moves an example up or down
 * here and nowhere else: it never edits a prompt, never publishes a version,
 * never writes an instruction.
 *
 * STABLE SCORING. Quality is a Bayesian average: the admin's rating (or a
 * neutral 0.5) acts as PRIOR_WEIGHT imaginary votes, and real votes count only
 * once an example has MIN_SAMPLE of them. One 👍 therefore cannot put an
 * example on top, and one 👎 cannot bury it.
 */

export const PRIOR_WEIGHT = 10;
export const MIN_SAMPLE = 5;
const RELEVANCE_WEIGHT = 0.6;
const QUALITY_WEIGHT = 0.4;

export type KnowledgeCandidate = {
  id: string;
  similarity: number | null;
  resultRating: number | null;
  usageCount: number;
  positiveCount: number;
  negativeCount: number;
  scene: string | null;
};

export type KnowledgeStrategy = "proven" | "diverse";

/** The admin rating (1–5) as a prior in 0.2–0.8; neutral 0.5 without one. */
export function priorQuality(rating: number | null): number {
  if (typeof rating !== "number" || rating < 1 || rating > 5) return 0.5;
  return 0.2 + ((rating - 1) / 4) * 0.6;
}

/** Bayesian quality with a minimum sample: below MIN_SAMPLE votes the
 *  feedback is recorded but does not move the score yet. */
export function qualityScore(c: Pick<KnowledgeCandidate, "resultRating" | "positiveCount" | "negativeCount">): number {
  const prior = priorQuality(c.resultRating);
  const pos = Math.max(0, c.positiveCount);
  const neg = Math.max(0, c.negativeCount);
  if (pos + neg < MIN_SAMPLE) return prior;
  return (pos + prior * PRIOR_WEIGHT) / (pos + neg + PRIOR_WEIGHT);
}

export function candidateScore(c: KnowledgeCandidate): number {
  const relevance = typeof c.similarity === "number" ? Math.min(Math.max(c.similarity, 0), 1) : 0.5;
  return RELEVANCE_WEIGHT * relevance + QUALITY_WEIGHT * qualityScore(c);
}

/** Small seeded PRNG so "diverse" is reproducible for a given run id. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `topK` examples.
 *   proven  — the best scores, in order, every time.
 *   diverse — the best one always, the rest drawn (weighted by score) from a
 *             pool twice as large, so good-but-less-used examples get seen.
 */
export function rankCandidates(
  candidates: KnowledgeCandidate[], opts: { strategy: KnowledgeStrategy; topK: number; seed: string },
): KnowledgeCandidate[] {
  const topK = Math.max(1, Math.min(opts.topK, 5));
  const scored = candidates
    .map((c) => ({ c, s: candidateScore(c) }))
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id));
  if (opts.strategy !== "diverse" || scored.length <= topK) return scored.slice(0, topK).map((x) => x.c);

  const rand = seededRandom(opts.seed);
  const picked = [scored[0]];
  const pool = scored.slice(1, topK * 2);
  while (picked.length < topK && pool.length > 0) {
    const total = pool.reduce((sum, x) => sum + Math.max(x.s, 0.01), 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= Math.max(pool[idx].s, 0.01);
      if (r <= 0) break;
    }
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked.map((x) => x.c);
}

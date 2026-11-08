/**
 * GROVBASE SHOT — DIAGNOSTICS (pure, no I/O).
 *
 * Compares, for one Nano Banana Pro call, the three lists the process view
 * shows side by side:
 *   planned   the plan's references (order photo numbers, in order);
 *   prepared  what the engine handed the image adapter (photo → bytes, sha);
 *   sent      what the observed network request carried (inline images in
 *             the order of the request's parts, and its text part).
 * Any difference is an issue the panel shows in red. "Not observed" is an
 * issue too — an unobserved request is never reported as matching.
 */

export type PreparedRef = { n: number; photo: number; source_sha256: string; sent_sha256: string };
export type ObservedImage = { n: number; sha256: string; bytes?: number; mime?: string | null };
export type ObservedRequest = { provider?: string; observable?: boolean; body?: unknown; images?: ObservedImage[] };

export type ReferenceIssue =
  | "not_observed"
  | "no_request"
  | "plan_prepared_mismatch"
  | "count_mismatch"
  | "bytes_or_order_mismatch"
  | "prompt_mismatch"
  | "images_not_inline";

export type ReferenceCheck = {
  observed: boolean;
  ok: boolean;
  issues: ReferenceIssue[];
  /** Per position of the REAL request: which order photo it is (by hash), or null. */
  sent: { n: number; sha256: string; photo: number | null }[];
  prompt_matches: boolean | null;
};

/** The text parts and inline images of a Gemini generateContent body, in order. */
export function geminiParts(body: unknown): { texts: string[]; imageRefs: number[]; partOrder: ("text" | "image")[] } {
  const contents = (body as { contents?: unknown })?.contents;
  const texts: string[] = [];
  const imageRefs: number[] = [];
  const partOrder: ("text" | "image")[] = [];
  if (!Array.isArray(contents)) return { texts, imageRefs, partOrder };
  for (const c of contents) {
    const parts = (c as { parts?: unknown })?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      const o = p as Record<string, unknown>;
      if (typeof o.text === "string") { texts.push(o.text); partOrder.push("text"); }
      const inline = o.inlineData as Record<string, unknown> | undefined;
      const ref = inline && typeof inline.data === "object" && inline.data ? (inline.data as { $image?: unknown }).$image : undefined;
      if (typeof ref === "number") { imageRefs.push(ref); partOrder.push("image"); }
    }
  }
  return { texts, imageRefs, partOrder };
}

export function referenceCheck(
  planned: number[], prepared: PreparedRef[], requests: ObservedRequest[], promptText: string | null,
): ReferenceCheck {
  const issues: ReferenceIssue[] = [];
  const planOk = planned.length === prepared.length && planned.every((p, i) => prepared[i]?.photo === p);
  if (!planOk) issues.push("plan_prepared_mismatch");
  const google = requests.filter((r) => r.provider === "google" || r.provider === undefined);
  const last = google[google.length - 1];
  if (!last) {
    return { observed: false, ok: false, issues: [...issues, "no_request"], sent: [], prompt_matches: null };
  }
  if (last.observable === false || last.body === null || last.body === undefined) {
    return { observed: false, ok: false, issues: [...issues, "not_observed"], sent: [], prompt_matches: null };
  }
  const parts = geminiParts(last.body);
  const imgs = (last.images ?? []).slice().sort((a, b) => a.n - b.n);
  // Every image of the request must be an inline part of its contents.
  const inlineOrder = parts.imageRefs.map((ref) => imgs.find((i) => i.n === ref)).filter((x): x is ObservedImage => Boolean(x));
  if (inlineOrder.length !== imgs.length) issues.push("images_not_inline");
  const bySha = new Map(prepared.map((p) => [p.sent_sha256, p.photo]));
  const sent = inlineOrder.map((img, i) => ({ n: i + 1, sha256: img.sha256, photo: bySha.get(img.sha256) ?? null }));
  if (sent.length !== prepared.length) issues.push("count_mismatch");
  else if (sent.some((s, i) => s.sha256 !== prepared[i].sent_sha256)) issues.push("bytes_or_order_mismatch");
  const promptMatches = promptText === null ? null : parts.texts.length === 1 && parts.texts[0] === promptText;
  if (promptMatches === false) issues.push("prompt_mismatch");
  return { observed: true, ok: issues.length === 0, issues, sent, prompt_matches: promptMatches };
}

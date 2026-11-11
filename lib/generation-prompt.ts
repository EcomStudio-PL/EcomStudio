/**
 * WHAT A CUSTOMER MAY READ OF A GENERATION'S PROMPT — one rule, used by every
 * server projection that hands generation data to a browser.
 *
 * A customer buys the RESULT of a GrovBase tool, not the instructions the
 * engine wrote for it. So the only prompt text that ever leaves the server
 * for a customer is the text THEY typed:
 *
 *   „Stwórz zdjęcie” (and any job the database marks as the customer's own,
 *   prompt_origin = 'custom')  →  the customer's prompt, exactly as typed —
 *   without the "AVOID: …" line the app appends from the negative field.
 *   Everything else — GrovShot, Miniaturka, Packshot (Retusz), every tool,
 *   and any row whose origin is not explicitly 'custom' (older rows stored
 *   engine text with no origin)  →  null; the preview says „Ujęcie
 *   zaprojektowane przez GrovBase.”
 *
 * Decided by the stored origin (written by the server; customers can no
 * longer write generation_jobs — migration 0171), never by a page's URL or a
 * tool's display name. The engine-written description of a concept
 * (generated_prompts.customer_description) is never projected at all.
 */
export type PromptOriginRow = {
  prompt_origin: string | null;
  prompt_text: string | null;
  settings?: { negative?: unknown } | null;
};

export function customerPrompt(job: PromptOriginRow | null | undefined): string | null {
  if (!job || job.prompt_origin !== "custom") return null;
  let text = job.prompt_text ?? "";
  // runGeneration stores `${prompt}\nAVOID: ${negative}` — the second line is
  // the app's wrapper around the customer's negative field, not their prompt.
  const negative = typeof job.settings?.negative === "string" ? job.settings.negative.trim() : "";
  if (negative) {
    const suffix = `\nAVOID: ${negative}`;
    if (text.endsWith(suffix)) text = text.slice(0, -suffix.length);
  }
  const clean = text.trim();
  return clean ? clean : null;
}

/** The origin a customer sees: their own prompt, or GrovBase's design. */
export function promptOrigin(job: { prompt_origin: string | null; prompt_id?: string | null } | null | undefined): "custom" | "engine" | null {
  if (!job) return null;
  if (job.prompt_origin === "custom") return "custom";
  if (job.prompt_origin === "ecomstudio" || job.prompt_id) return "engine";
  return null;
}

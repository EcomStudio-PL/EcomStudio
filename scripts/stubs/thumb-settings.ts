/** lib/server/thumbnail/settings.ts for the tests: the environment is
 *  whatever the test puts into db().env. */
import { parseThumbnailConfig, type ThumbnailConfig } from "@/lib/thumbnail/config";
import { sha256 } from "@/lib/thumbnail/openai-request";
import { db } from "./thumb-db";

export async function readThumbnailConfig(): Promise<ThumbnailConfig | null> {
  return parseThumbnailConfig(db().env.config);
}
export async function readPublishedPrompt() {
  const e = db().env;
  const prompt = {
    text: e.promptText, version: e.promptVersion, sha256: sha256(e.promptText), digest: e.promptDigest,
    approved: e.approved, approvedBy: e.approved ? ("reference" as const) : null,
  };
  return { prompt, blocker: e.approved ? null : ("prompt_not_approved" as const) };
}
export async function readThumbnailService() {
  const c = db().env.thumbnailCredits;
  return c === null ? null : { credits: c, enabled: true, maintenance: false, apiCostUsdMicros: 0 };
}
export async function openaiCredential() { return db().env.credential; }
export async function readRetouchOffer() { return db().env.retouch; }
export async function readThumbnailState() {
  const e = db().env;
  const { prompt } = await readPublishedPrompt();
  return {
    ready: e.ready, blockers: e.blockers, config: parseThumbnailConfig(e.config),
    thumbnailCredits: e.thumbnailCredits, retouch: e.retouch, prompt,
  };
}

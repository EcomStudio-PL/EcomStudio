/**
 * MINIATURKA — PHOTOS ALREADY RETOUCHED, USED AGAIN WITHOUT PAYING AGAIN.
 *
 * A Miniaturka made with „Packshot AI” keeps every retouched photo (each is a
 * Retusz job of its own, in the library). „Użyj w kolejnej generacji” in the
 * preview hands them to the Miniaturka form as `retouched:<that job's id>` —
 * a reference the server resolves itself (lib/server/thumbnail/run.ts): the
 * workspace's own Retusz job, its stored file, checked like a reused pass.
 * Never a URL: a signed URL expires and could point anywhere.
 *
 * Pure and client-safe: the merge rule the tests hold, and the hand-over
 * between the preview and the form (one module, one sessionStorage key —
 * it survives a navigation between screens and a component remount).
 */

export const RETOUCHED_PREFIX = "retouched:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `retouched:<uuid>` → the Retusz job id, else null. */
export function retouchedJobId(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(RETOUCHED_PREFIX)) return null;
  const id = ref.slice(RETOUCHED_PREFIX.length);
  return UUID.test(id) ? id : null;
}
export const retouchedRef = (jobId: string) => `${RETOUCHED_PREFIX}${jobId}`;

/** One retouched photo offered to the form: its reference, the original it
 *  was retouched from (a storage path; null when unknown) and a picture. */
export type RetouchedPhoto = { ref: string; original: string | null; url: string };
/** The form's own photo entry (components/genv3/types.ts UploadedRef). */
export type FormPhoto = { key: string; path: string; url: string };

export type MergeResult = {
  photos: FormPhoto[];
  /** Appended at the end, in the order they were offered. */
  added: number;
  /** Did not fit under the limit. */
  skipped: number;
  /** Already in the form (a second click, the same photo twice). */
  duplicates: number;
};

/**
 * The form's photos with the retouched ones ADDED AT THE END (17.11.2026):
 *   · nothing in the form is replaced, moved or removed — an original and its
 *     retouched version are two different files and may both be there;
 *   · one already in the form (the same Retusz job — its durable reference,
 *     never a signed URL) is not added again;
 *   · the rest are appended in the order the earlier Miniaturka had them, as
 *     long as the limit allows — the rest are counted, never forced in, and
 *     no photo of the customer's is dropped to make room.
 */
export function mergeRetouched(current: readonly FormPhoto[], incoming: readonly RetouchedPhoto[], max: number): MergeResult {
  const photos = current.slice();
  let added = 0;
  let skipped = 0;
  let duplicates = 0;
  for (const r of incoming) {
    if (!retouchedJobId(r.ref)) continue;
    if (photos.some((p) => p.key === r.ref || p.path === r.ref)) {
      duplicates++;
      continue;
    }
    if (photos.length >= max) {
      skipped++;
      continue;
    }
    photos.push({ key: r.ref, path: r.ref, url: r.url });
    added++;
  }
  return { photos, added, skipped, duplicates };
}

/* ── the hand-over: preview → Miniaturka form ──────────────────────────── */

const KEY = "gb.thumb.retouched.v1";
/** Fired on the window when retouched photos are offered (the form may be on screen). */
export const RETOUCHED_EVENT = "gb:thumb-retouched";
/** An offer older than this is stale (its signed pictures too). */
const TTL_MS = 30 * 60 * 1000;
let pending: { photos: RetouchedPhoto[]; at: number } | null = null;

export function offerRetouched(photos: RetouchedPhoto[]): void {
  pending = { photos, at: Date.now() };
  try { sessionStorage.setItem(KEY, JSON.stringify(pending)); } catch { /* private mode: the module copy carries it */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RETOUCHED_EVENT));
}

/** The photos offered and not taken yet (taking them clears the offer). */
export function takeRetouched(): RetouchedPhoto[] | null {
  let offer = pending;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) offer = JSON.parse(raw) as typeof pending;
    sessionStorage.removeItem(KEY);
  } catch { /* the module copy */ }
  pending = null;
  if (!offer || !Array.isArray(offer.photos) || typeof offer.at !== "number" || Date.now() - offer.at > TTL_MS) return null;
  const photos = offer.photos.filter((p): p is RetouchedPhoto =>
    !!p && typeof p.url === "string" && retouchedJobId(p.ref) !== null && (p.original === null || typeof p.original === "string"));
  return photos.length > 0 ? photos : null;
}

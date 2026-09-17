"use client";

/**
 * SAVING A FILE — one implementation for every "Pobierz" in the product.
 *
 * WHAT WAS WRONG. Some buttons were an `<a href={signedStorageUrl} download>`.
 * A desktop browser honours `download` and saves the file; SAFARI ON iOS
 * ignores it for a cross-origin URL and NAVIGATES instead — so "Pobierz" took
 * the customer out of GrovBase and dropped them on `…supabase.co` looking at
 * their own photo with no obvious way to keep it. The storage host is our
 * plumbing; it has no business appearing in front of anyone.
 *
 * WHAT HAPPENS NOW. The bytes are fetched first, and then:
 *
 *   · on a phone or tablet that can share files, the native sheet opens —
 *     "Zapisz obraz", Files, AirDrop, Messages, WhatsApp. That is what a
 *     download means on a touch device, and it never leaves the app;
 *   · everywhere else (and whenever sharing is refused or unavailable) an
 *     object URL is handed to a temporary anchor, which is the one way a
 *     click genuinely saves rather than opens.
 *
 * NO URL IS EVER OPENED. Not as a fallback, not on failure. A failure says so
 * in a toast; it does not quietly show the customer our storage bucket.
 */

/** File extension for a MIME type, so a saved file opens by double-click. */
export function extOf(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("avif")) return "avif";
  if (m.includes("tiff")) return "tiff";
  if (m.includes("gif")) return "gif";
  if (m.includes("zip")) return "zip";
  if (m.includes("mp4")) return "mp4";
  return "img";
}

/** `grovbase-2026-09-17-0331` — a name that means something in a camera roll,
 *  rather than the storage object's uuid. */
export function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}`;
}

/**
 * Build a filename: `grovbase-<seed>-<stamp>.<ext>`, with the seed reduced to
 * something a file system is happy with. An empty seed is simply left out.
 */
export function fileNameFor(seed: string | null | undefined, mime: string): string {
  const slug = (seed ?? "")
    .toLowerCase()
    // `ł` carries no combining mark, so NFD leaves it whole and the ASCII
    // filter below would drop it: "Żółta" became "zo-ta". The other Polish
    // letters (ą ć ę ń ó ś ź ż) do decompose and are handled by the strip.
    .replace(/ł/g, "l").replace(/đ/g, "d").replace(/ø/g, "o").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `grovbase${slug ? `-${slug}` : ""}-${stamp()}.${extOf(mime)}`;
}

/** A touch device, where the share sheet is the natural way to keep a file. */
function isTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  // `maxTouchPoints` catches iPadOS, which reports a desktop user agent.
  return navigator.maxTouchPoints > 1 || /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

/** The anchor path: an object URL is same-origin, so `download` is honoured. */
function saveViaAnchor(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  // Appended to the document: Firefox ignores a click on a detached anchor.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late — some browsers finish reading the blob after the click.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** What `saveBlob` reports back, so a caller can stay quiet on a cancel. */
export type SaveOutcome = "shared" | "saved" | "cancelled";

/**
 * Save bytes the app already holds. Tries the native share sheet on a touch
 * device and falls back to a download everywhere else.
 *
 * `cancelled` is returned when the customer dismisses the sheet. That is not
 * an error and must not become a red toast — they simply changed their mind.
 */
export async function saveBlob(blob: Blob, filename: string, title = "GrovBase"): Promise<SaveOutcome> {
  if (isTouchDevice() && typeof navigator !== "undefined" && navigator.share) {
    try {
      const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return "shared";
      }
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === "AbortError") return "cancelled";
      // NotAllowedError means the user gesture expired while the bytes were
      // being fetched — common on Android when the image is large. Saving
      // still works, so fall through rather than failing the action.
    }
  }
  saveViaAnchor(blob, filename);
  return "saved";
}

/**
 * Fetch an image and hand it to the customer.
 *
 * Throws when the bytes cannot be read, so the caller shows its own message.
 * It deliberately has no "open the URL instead" branch: that is the behaviour
 * this module exists to remove.
 */
export async function saveImageFrom(
  url: string,
  opts: { seed?: string | null; filename?: string; title?: string } = {},
): Promise<SaveOutcome> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
  const blob = await res.blob();
  return saveBlob(blob, opts.filename ?? fileNameFor(opts.seed, blob.type), opts.title);
}

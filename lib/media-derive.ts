"use client";

/**
 * ASK FOR AN IMAGE'S SMALLER COPIES.
 *
 * One call, from both places a file can be uploaded — the media library and a
 * CMS field's own uploader — so neither has to know how derivatives are made
 * and neither can forget to ask.
 *
 * DELIBERATELY BEST EFFORT. An image with no derivatives still renders: the
 * original is the `src` and always has been. So a failure here is a slower
 * page, not a broken one, and it must never turn a successful upload into an
 * error the person has to think about.
 */
export async function deriveMedia(assetId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/media/derive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

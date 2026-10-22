import "server-only";
import { createClient } from "@/lib/supabase/server";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import { ICE_IMAGE_MIMES, ICE_MAX_SAMPLE_BYTES, ICE_VIDEO_MIMES, maxBytesFor } from "@/lib/ice/sniff";
import { isLegalSlug } from "@/lib/legal/docs";
import type { IceAsset, IceLocale, IceResult } from "@/lib/ice/types";

/**
 * WHAT EVERY VISUAL-EDITOR ACTION SHARES — who may call, how a refusal is
 * answered, how a path and a library file are read. Moved out of actions.ts
 * when the launch page's galleries got their own module (gallery.ts), so the
 * two use ONE gate rather than two copies of it that could drift apart.
 */

export type Client = Awaited<ReturnType<typeof createClient>>;

export class IceRefusal extends Error {
  constructor(code: string, readonly current?: unknown) {
    super(code);
  }
}

export async function requireIceAdmin(): Promise<{ supabase: Client; adminId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new IceRefusal("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new IceRefusal("not_admin");
  // The same gate the admin panel's layout applies: a session on a device the
  // step-up has not verified edits nothing.
  if (await enforceLoginSecurity(supabase)) throw new IceRefusal("step_up_required");
  return { supabase, adminId: user.id };
}

export async function run<T>(fn: () => Promise<T>): Promise<IceResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof IceRefusal) return { ok: false, error: e.message, ...(e.current !== undefined ? { current: e.current } : {}) };
    console.error("ice action failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "generic" };
  }
}

export const isLocale = (v: unknown): v is IceLocale => v === "pl" || v === "en" || v === "de";

/** What a database function raised, as one of our codes. */
export function dbCode(message: string | undefined): string {
  const m = message ?? "";
  for (const code of ["not_admin", "conflict", "noop", "invalid_text", "draft_diverged", "not_published",
    "not_in_snapshot", "block_missing", "bad_path", "bad_action", "bad_writes"]) {
    if (m.includes(code)) return code;
  }
  if (/violates check constraint/.test(m)) return "invalid";
  return "generic";
}

/** Who made each change, by profile id: the name, else the e-mail. */
export async function authorNames(supabase: Client, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (unique.length) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique);
    for (const p of data ?? []) names.set(p.id, p.full_name?.trim() || p.email);
  }
  return names;
}

/* ── pages ───────────────────────────────────────────────────────────────── */

const PATH = /^\/[a-z0-9_\-/]{0,120}$/i;

export function cleanPath(path: unknown): string | null {
  if (typeof path !== "string" || !PATH.test(path)) return null;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export type CmsPageRow = {
  id: string; slug: string; title: string; kind: string; status: string; is_homepage: boolean;
  published_snapshot: unknown; published_at?: string | null;
};

/**
 * A LEGAL DOCUMENT IS NEVER OPENED IN THE VISUAL EDITOR.
 *
 * The Regulamin, the policies and the DPA are edited whole in Strony WWW
 * (one `legal` section, its text stored exactly as given — lib/legal/content.ts),
 * never a line at a time on the live page, where the editor's own rules
 * (2000 characters, folded whitespace) would rewrite them. Every way into the
 * editor asks this: the launcher's list, the edit session, the page map, a
 * save and the markers.
 */
export function iceRefusesPath(path: string): boolean {
  return path !== "/" && isLegalSlug(path.replace(/^\/+/, "").replace(/\/+$/, ""));
}

/** The published CMS page a path shows ("/" = the homepage), or null —
 *  null for a legal document too, wherever it is served. */
export async function cmsPageAt(supabase: Client, path: string): Promise<CmsPageRow | null> {
  if (iceRefusesPath(path)) return null;
  const query = supabase.from("cms_pages").select("id, slug, title, kind, status, is_homepage, published_snapshot");
  let row: CmsPageRow | null = null;
  if (path === "/") {
    const { data } = await query.eq("is_homepage", true).maybeSingle();
    row = data as CmsPageRow | null;
  } else {
    const slug = path.slice(1);
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) return null;
    const { data } = await query.eq("slug", slug).maybeSingle();
    row = data as CmsPageRow | null;
    // The homepage is edited at "/", where visitors see it.
    if (row?.is_homepage) return null;
  }
  if (!row || row.status !== "published" || row.kind === "app") return null;
  // "/" serving a legal document (it can be made the homepage) is refused too.
  if (isLegalSlug(row.slug)) return null;
  return row;
}

/* ── the library ─────────────────────────────────────────────────────────── */

export const ASSET_COLUMNS = "id, kind, storage_path, external_url, poster_url, title, alt, mime, size_bytes, width, height, variants, created_at";
export type AssetRow = {
  id: string; kind: string; storage_path: string | null; external_url: string | null; poster_url: string | null;
  title: string | null; alt: string | null; mime: string | null; size_bytes: number | null;
  width: number | null; height: number | null; variants: unknown; created_at: string;
};

export function toAsset(supabase: Client, a: AssetRow, usage = 0): IceAsset {
  const url = a.storage_path ? supabase.storage.from("media").getPublicUrl(a.storage_path).data.publicUrl : (a.external_url ?? "");
  const variants: Record<string, string> = {};
  if (a.variants && typeof a.variants === "object" && !Array.isArray(a.variants)) {
    for (const [k, v] of Object.entries(a.variants as Record<string, unknown>)) {
      if (/^\d{2,5}$/.test(k) && typeof v === "string" && /^https:\/\//.test(v)) variants[k] = v;
    }
  }
  return {
    id: a.id,
    kind: a.kind === "video" ? "video" : a.kind === "image" ? "image" : "file",
    url,
    posterUrl: a.poster_url,
    title: a.title ?? (a.storage_path ? a.storage_path.split("/").pop() ?? null : null),
    alt: a.alt,
    mime: a.mime,
    sizeBytes: a.size_bytes,
    width: a.width,
    height: a.height,
    variants,
    createdAt: a.created_at,
    usage,
  };
}

export type AssetFacts = Pick<AssetRow, "kind" | "mime" | "size_bytes" | "storage_path" | "external_url">;

/** A library file may fill a slot of this kind: same kind, one of the six
 *  formats, within the size limit (a sample: ≤ 10 MiB, what a tool takes). */
export function checkAsset(a: AssetFacts | undefined | null, kind: "image" | "video", sample: boolean): void {
  if (!a) throw new IceRefusal("asset_missing");
  if (a.kind !== kind) throw new IceRefusal("asset_kind");
  if (!a.storage_path && !a.external_url) throw new IceRefusal("asset_missing");
  const allowed = kind === "image" ? ICE_IMAGE_MIMES : ICE_VIDEO_MIMES;
  if (!a.mime || !(allowed as readonly string[]).includes(a.mime)) throw new IceRefusal("asset_format");
  const cap = sample ? ICE_MAX_SAMPLE_BYTES : kind === "image" ? maxBytesFor("image/jpeg") : maxBytesFor("video/mp4");
  if (a.size_bytes !== null && a.size_bytes > cap) throw new IceRefusal("asset_too_large");
}

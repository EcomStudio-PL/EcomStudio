import "server-only";
import type { Client } from "@/lib/services/workspace";

/**
 * GENERATION GALLERY — the one server-side projection every gallery surface
 * uses. One card per generated IMAGE (asset), newest first, keyset-paginated.
 *
 * PROMPT SAFETY is enforced here by column choice, not by trust downstream:
 * the customer-visible text is generation_jobs.prompt_text (populated ONLY
 * for the customer's own prompts — engine jobs store NULL by design) or the
 * concept's customer_description (seller-facing copy written for their
 * eyes). The encrypted engine prompt never appears in any select this file
 * makes.
 */

export type GallerySessionType = "advertising" | "lifestyle";

export type GalleryItem = {
  generationId: string;
  assetId: string;
  path: string;
  url: string;
  /** Small derivative for grids; equals `url` for pre-derivative assets. */
  thumbUrl: string;
  width: number | null;
  height: number | null;
  ratio: string | null;
  resolution: string | null;
  /** Customer-facing model display name. */
  model: string | null;
  product: string | null;
  sessionType: GallerySessionType | null;
  origin: "engine" | "custom" | null;
  /** Customer-safe text: their own prompt, or the concept's seller copy. */
  prompt: string | null;
  favorite: boolean;
  note: string | null;
  createdAt: string;
};

export type GalleryPage = { items: GalleryItem[]; nextCursor: string | null };

export type GalleryFilter = {
  cursor?: string | null;
  limit?: number;
  sessionType?: GallerySessionType | null;
  favorite?: boolean;
  /** Case-insensitive product-name match. */
  q?: string | null;
  /** "desc" = newest first (default), "asc" = oldest first. */
  order?: "desc" | "asc";
};

const SELECT_BASE = `
  id, favorite, user_note, created_at,
  products(name),
  generation_assets(id, storage_path, width, height, metadata),
  generation_jobs!inner(
    aspect_ratio, resolution, prompt_origin, prompt_text, prompt_id, status,
    ai_models(display_name, name),
    prompt_sessions(session_type),
    generated_prompts!generation_jobs_prompt_id_fkey(customer_description)
  )
`;

type Row = {
  id: string;
  favorite: boolean;
  user_note: string | null;
  created_at: string;
  products: { name: string } | null;
  generation_assets: {
    id: string; storage_path: string; width: number | null; height: number | null;
    metadata: { thumb?: string | null } | null;
  }[];
  generation_jobs: {
    aspect_ratio: string | null;
    resolution: string | null;
    prompt_origin: string | null;
    prompt_text: string | null;
    prompt_id: string | null;
    status: string;
    ai_models: { display_name: string | null; name: string } | null;
    prompt_sessions: { session_type: string | null } | null;
    generated_prompts: { customer_description: string | null } | null;
  } | null;
};

export async function listGalleryItems(
  supabase: Client, workspaceId: string, filter: GalleryFilter = {},
): Promise<GalleryPage> {
  const limit = Math.min(Math.max(filter.limit ?? 24, 1), 48);
  const bySession = filter.sessionType === "advertising" || filter.sessionType === "lifestyle";
  const asc = filter.order === "asc";

  // Session filter needs the whole chain to exist — inner joins narrow it.
  const select = bySession ? SELECT_BASE.replace("prompt_sessions(", "prompt_sessions!inner(") : SELECT_BASE;
  let query = supabase
    .from("generations")
    .select(select as typeof SELECT_BASE)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: asc })
    .limit(limit + 1);
  if (bySession) query = query.eq("generation_jobs.prompt_sessions.session_type", filter.sessionType!);
  if (filter.favorite) query = query.eq("favorite", true);
  if (filter.cursor) query = asc ? query.gt("created_at", filter.cursor) : query.lt("created_at", filter.cursor);

  const { data, error } = await query;
  if (error || !data) return { items: [], nextCursor: null };

  let rows = data as unknown as Row[];
  const hasMore = rows.length > limit;
  rows = rows.slice(0, limit);

  // Product-name search is applied to the fetched window (names are not
  // indexed for ilike through the embed) — the client widens by paging.
  const q = filter.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      (r.products?.name ?? "").toLowerCase().includes(q)
      || (r.generation_jobs?.ai_models?.display_name ?? r.generation_jobs?.ai_models?.name ?? "").toLowerCase().includes(q)
      || (r.generation_jobs?.prompt_text ?? r.generation_jobs?.generated_prompts?.customer_description ?? "").toLowerCase().includes(q));
  }

  // ONE batched signing call for everything on the page (originals + thumbs).
  const paths = new Set<string>();
  for (const r of rows) {
    for (const a of r.generation_assets ?? []) {
      paths.add(a.storage_path);
      if (a.metadata?.thumb) paths.add(a.metadata.thumb);
    }
  }
  const signedMap = new Map<string, string>();
  if (paths.size > 0) {
    const { data: signed } = await supabase.storage
      .from("generation-assets").createSignedUrls([...paths], 3600);
    signed?.forEach((s) => { if (s.signedUrl && s.path) signedMap.set(s.path, s.signedUrl); });
  }

  const items: GalleryItem[] = [];
  for (const r of rows) {
    const job = r.generation_jobs;
    if (job && job.status !== "completed") continue;
    const model = job?.ai_models ? (job.ai_models.display_name || job.ai_models.name) : null;
    const st = job?.prompt_sessions?.session_type;
    const origin: GalleryItem["origin"] = job?.prompt_origin === "custom" ? "custom"
      : job?.prompt_origin === "ecomstudio" ? "engine"
        : job?.prompt_text ? "custom" : job?.prompt_id ? "engine" : null;
    const prompt = job?.prompt_text?.trim()
      || job?.generated_prompts?.customer_description?.trim()
      || null;
    for (const a of r.generation_assets ?? []) {
      const url = signedMap.get(a.storage_path);
      if (!url) continue;
      items.push({
        generationId: r.id,
        assetId: a.id,
        path: a.storage_path,
        url,
        thumbUrl: (a.metadata?.thumb && signedMap.get(a.metadata.thumb)) || url,
        width: a.width,
        height: a.height,
        ratio: job?.aspect_ratio ?? null,
        resolution: job?.resolution ?? null,
        model,
        product: r.products?.name ?? null,
        sessionType: st === "advertising" || st === "lifestyle" ? st : null,
        origin,
        prompt,
        favorite: r.favorite,
        note: r.user_note,
        createdAt: r.created_at,
      });
    }
  }

  return {
    items,
    nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].created_at : null,
  };
}

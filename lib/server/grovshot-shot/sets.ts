import "server-only";
import type { Client } from "@/lib/services/workspace";
import { listGalleryItems, type GalleryItem } from "@/lib/server/gallery";

/**
 * GROVBASE SHOT — THE CUSTOMER'S SETS (Etap 2). One lifestyle order = one set,
 * shots in plan order; every shot lists its versions (the order's image, then
 * each paid regeneration's, oldest first) and the one the customer chose (the
 * ZIP takes it; none chosen = the newest delivered). Everything comes from
 * grovshot_sets (a closed vocabulary — no prompt, card or model) and the
 * member's own library rows (RLS), never from a run row directly.
 */

export const SHOT_KINDS = ["hero", "uzycie", "detal"] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

export type ShotVersion = Pick<GalleryItem, "generationId" | "assetId" | "path" | "url" | "thumbUrl" | "previewUrl" | "width" | "height" | "createdAt"> & { regenRunId: string | null };
export type SetShot = {
  n: number; title: string | null; kind: ShotKind | null;
  state: "queued" | "working" | "delivered" | "not_delivered"; reason: string | null; refunded: boolean;
  versions: ShotVersion[]; chosen: string | null;
  /** A regeneration of this shot is still running. */
  regenerating: boolean;
  /** The last regeneration ended without an image (nothing charged). */
  regenFailed: boolean;
};
export type ShotSet = {
  id: string; createdAt: string; status: string; stage: string | null; product: string | null;
  ordered: number; ratio: string; resolution: string; unit: number; shots: SetShot[];
};

type RawShot = { shot: number; state: string; reason: string | null; refunded: boolean; job_id: string | null };
type RawSet = {
  id: string; created_at: string; status: string; stage: string | null; ordered: number; ratio: string; resolution: string; unit: number;
  product: string | null; shots: RawShot[]; kinds: string[] | null; titles: (string | null)[] | null;
  regens: { id: string; shot: number; status: string; created_at: string; state: RawShot | null }[];
  chosen: Record<string, string>;
};

const STATES = new Set(["queued", "working", "delivered", "not_delivered"]);

export async function readSets(supabase: Client, workspaceId: string, limit = 10): Promise<ShotSet[] | null> {
  const { data, error } = await supabase.rpc("grovshot_sets", { p_workspace_id: workspaceId, p_limit: limit });
  if (error || !Array.isArray(data)) return null;
  const raw = data as unknown as RawSet[];
  // Every delivered job (orders and regenerations) → its library item.
  const jobIds = raw.flatMap((s) => [
    ...s.shots.map((x) => x.job_id),
    ...s.regens.map((r) => r.state?.job_id ?? null),
  ]).filter((x): x is string => Boolean(x));
  const items = new Map<string, GalleryItem>();
  for (let i = 0; i < jobIds.length; i += 30) {
    const page = await listGalleryItems(supabase, workspaceId, { jobIds: jobIds.slice(i, i + 30), limit: 48 });
    const gens = page.items.map((x) => x.generationId);
    const { data: rows } = gens.length ? await supabase.from("generations").select("id, job_id").in("id", gens) : { data: [] };
    for (const it of page.items) {
      const job = (rows ?? []).find((r) => r.id === it.generationId)?.job_id;
      if (job && !items.has(job)) items.set(job, it);
    }
  }
  const version = (jobId: string | null, regenRunId: string | null): ShotVersion | null => {
    const it = jobId ? items.get(jobId) : undefined;
    return it ? {
      generationId: it.generationId, assetId: it.assetId, path: it.path, url: it.url, thumbUrl: it.thumbUrl, previewUrl: it.previewUrl,
      width: it.width, height: it.height, createdAt: it.createdAt, regenRunId,
    } : null;
  };
  return raw.map((s) => ({
    id: s.id, createdAt: s.created_at, status: s.status, stage: s.stage, product: s.product,
    ordered: s.ordered, ratio: s.ratio, resolution: s.resolution, unit: s.unit,
    shots: s.shots.map((x, i) => {
      const regens = s.regens.filter((r) => r.shot === x.shot);
      const versions = [version(x.job_id, null), ...regens.map((r) => version(r.state?.job_id ?? null, r.id))].filter((v): v is ShotVersion => v !== null);
      const last = regens[regens.length - 1];
      const kind = s.kinds?.[i];
      return {
        n: x.shot, title: s.titles?.[i] ?? null, kind: (SHOT_KINDS as readonly string[]).includes(kind ?? "") ? kind as ShotKind : null,
        state: (STATES.has(x.state) ? x.state : "queued") as SetShot["state"], reason: x.reason, refunded: x.refunded,
        versions, chosen: s.chosen[String(x.shot)] ?? null,
        regenerating: regens.some((r) => r.status === "queued" || r.status === "running"),
        regenFailed: Boolean(last && last.status !== "queued" && last.status !== "running" && last.state?.state !== "delivered"),
      };
    }),
  }));
}

/** The version a set uses for a shot: the chosen one, else the newest delivered. */
export function usedVersion(shot: SetShot): ShotVersion | null {
  return shot.versions.find((v) => v.generationId === shot.chosen) ?? shot.versions[shot.versions.length - 1] ?? null;
}

/** "01_hero.png" — the gallery order, the shot's kind, the file's real type. */
export function zipName(n: number, kind: ShotKind | null, path: string): string {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(path)?.[1] ?? "png").toLowerCase();
  return `${String(n).padStart(2, "0")}_${kind ?? "zdjecie"}.${ext}`;
}

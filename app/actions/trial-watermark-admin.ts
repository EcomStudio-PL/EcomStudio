"use server";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { dispatchToken } from "@/lib/server/server-token";
import { watermarkAssetStatus } from "@/lib/server/trial-watermark/asset";
import { rpcStats } from "@/lib/server/trial-watermark/rpc";
import type { TrialWatermarkInfo } from "@/lib/server/trial-watermark/engine";
import {
  TRIAL_WATERMARK_DEFAULTS, TRIAL_WATERMARK_PREVIEW, TRIAL_WATERMARK_SETTING_KEY,
  parseTrialWatermarkConfig, serializeTrialWatermarkConfig, validateTrialWatermarkInput,
  type TrialWatermarkConfig, type TrialWatermarkInvalid,
} from "@/lib/trial-watermark/config";

/**
 * ADMIN — the trial watermark: its one settings row, the numbers behind it
 * and a preview on a real photo.
 *
 * The row is written ONLY here (the generic /admin/system editor neither lists
 * nor saves it): validated strictly, one bad field and nothing is saved,
 * audited with the row before and after. Turning it ON is the one change that
 * reaches customers, so it needs the operator's explicit confirmation, the
 * approved asset and the server key — without either of those every trial
 * image would be refused, not delivered clean. Turning it off is always
 * allowed and never touches an image that already exists.
 *
 * The preview draws the mark with the submitted values on an uploaded photo
 * or a media-library file and hands back a downscaled JPEG. Nothing is
 * stored, no model is called.
 *
 * The role is re-checked on every call: a server action is its own entry
 * point. Error codes: forbidden · invalid · migration_pending ·
 * confirm_required · asset_unavailable · server_key_missing · generic.
 */

const PAGE = "/admin/settings/onboarding";
const KEY = TRIAL_WATERMARK_SETTING_KEY;
const STATS_DAYS = 30;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return null;
  return { supabase, adminId: user.id };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const stamp = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/* ── the panel ─────────────────────────────────────────────────────────── */

const STATUSES = ["pending", "locked", "unlocking", "unlocked", "expired", "deleted", "orphaned"] as const;
type OriginalStatus = (typeof STATUSES)[number];

export type TrialWatermarkStats = {
  days: number;
  /** Every original now, by status (not windowed). */
  status: Record<OriginalStatus, number>;
  /** Intent over the window, from the marker-written events: distinct workspaces. */
  funnel: {
    clicked: number;
    paywallWorkspaces: number;
    paywalls: number;
    planSelected: number;
    subscriptionConfirmed: number;
    /** Workspaces that opened the paywall and have a paid subscription created after it. */
    converted: number;
  };
  /** Over the window, from the originals themselves (R8). */
  items: { created: number; unlocked: number; expired: number; lockedLive: number; expiring24h: number; purgeBacklog: number; purged: number };
  /** Bulk unlocks finished in the window. */
  bulk: number;
  /** pg_cron's sweep job: absent (no pg_cron), unreadable, or its last runs. */
  sweep: { state: "absent" } | { state: "unreadable" } | { state: "ok"; lastStart: string | null; lastSuccess: string | null; lastStatus: string | null };
  /** The daily purge's last heartbeat; null = it never ran. */
  purge: { ranAt: string; listed: number; removed: number; marked: number; error: string | null } | null;
};

/** trial_watermark_stats' reply → the panel's numbers. Anything missing reads as 0 / never. */
function readStats(raw: Record<string, unknown>): TrialWatermarkStats {
  const status = isObj(raw.status) ? raw.status : {};
  const events = isObj(raw.events) ? raw.events : {};
  const items = isObj(raw.items) ? raw.items : {};
  const event = (action: string) => {
    const e = isObj(events[action]) ? events[action] : {};
    return { events: count(e.events), workspaces: count(e.workspaces), paywalls: count(e.paywalls) };
  };
  let sweep: TrialWatermarkStats["sweep"] = { state: "absent" };
  if (isObj(raw.sweep)) {
    sweep = typeof raw.sweep.error === "string"
      ? { state: "unreadable" }
      : { state: "ok", lastStart: stamp(raw.sweep.last_start), lastSuccess: stamp(raw.sweep.last_success), lastStatus: stamp(raw.sweep.last_status) };
  }
  let purge: TrialWatermarkStats["purge"] = null;
  if (isObj(raw.purge) && stamp(raw.purge.ran_at)) {
    const report = isObj(raw.purge.report) ? raw.purge.report : {};
    purge = {
      ranAt: raw.purge.ran_at as string,
      listed: count(report.listed), removed: count(report.removed), marked: count(report.marked),
      error: stamp(report.error),
    };
  }
  const opened = event("watermark_paywall_opened");
  return {
    days: count(raw.days) || STATS_DAYS,
    status: Object.fromEntries(STATUSES.map((s) => [s, count(status[s])])) as Record<OriginalStatus, number>,
    funnel: {
      clicked: event("watermark_unlock_clicked").workspaces,
      paywallWorkspaces: opened.workspaces,
      paywalls: opened.paywalls,
      planSelected: event("watermark_plan_selected").workspaces,
      subscriptionConfirmed: event("watermark_subscription_confirmed").workspaces,
      converted: count(items.converted_workspaces),
    },
    items: {
      created: count(items.created), unlocked: count(items.unlocked), expired: count(items.expired),
      lockedLive: count(items.locked_live), expiring24h: count(items.expiring_24h),
      purgeBacklog: count(items.purge_backlog), purged: count(items.purged),
    },
    bulk: event("watermark_bulk_unlocked").events,
    sweep,
    purge,
  };
}

export type TrialWatermarkPanel = {
  config: TrialWatermarkConfig;
  /** false until migration 0143 has seeded (and made private) the row: nothing can be saved. */
  installed: boolean;
  updatedAt: string | null;
  asset: { ok: true; sha256: string; width: number; height: number } | { ok: false; code: string };
  /** The server key exists (sealing an original needs it). */
  serverKey: boolean;
  stats: TrialWatermarkStats | null;
};

/** Everything the section shows. Null = not an admin, or the row could not be read. */
export async function trialWatermarkPanelAction(): Promise<TrialWatermarkPanel | null> {
  try {
    const admin = await requireAdmin();
    if (!admin) return null;
    const [row, asset, stats] = await Promise.all([
      admin.supabase.from("app_settings").select("value, updated_at").eq("key", KEY).maybeSingle(),
      watermarkAssetStatus(),
      rpcStats(admin.supabase, STATS_DAYS),
    ]);
    // A failed read is a failure, never the defaults shown as if they were saved.
    if (row.error) return null;
    return {
      config: parseTrialWatermarkConfig(row.data?.value ?? null),
      installed: !!row.data,
      updatedAt: row.data?.updated_at ?? null,
      asset,
      serverKey: dispatchToken() !== null,
      stats: stats.ok ? readStats(stats.data) : null,
    };
  } catch {
    return null;
  }
}

/* ── save ──────────────────────────────────────────────────────────────── */

export type TrialWatermarkSaveResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "migration_pending" | "confirm_required" | "asset_unavailable" | "server_key_missing" | "generic";
      field?: TrialWatermarkInvalid;
    };

/**
 * Save the whole row. `confirmEnable` is the operator's answer to the
 * confirmation dialog; a save that would switch the mark ON without it is
 * refused, so neither a stale form nor a replayed call can switch it on.
 */
export async function saveTrialWatermarkAction(input: unknown, confirmEnable = false): Promise<TrialWatermarkSaveResult> {
  try {
    const admin = await requireAdmin();
    if (!admin) return { ok: false, error: "forbidden" };
    const v = validateTrialWatermarkInput(input);
    if (!v.ok) return { ok: false, error: "invalid", field: v.field };

    const { data: row, error: readError } = await admin.supabase
      .from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (readError) return { ok: false, error: "generic" };
    // 0143 seeds the row and adds it to app_setting_is_private. Before that a
    // save would create a row every visitor can read — it names accounts.
    if (!row) return { ok: false, error: "migration_pending" };

    const before = parseTrialWatermarkConfig(row.value);
    const turningOn = v.config.enabled && !before.enabled;
    if (turningOn && confirmEnable !== true) return { ok: false, error: "confirm_required" };
    // Both are needed to deliver a trial image at all: with either missing,
    // switching on would refuse every trial generation — and so would adding
    // a forced test account, which is marked even while the switch is off.
    const addsForced = v.config.forceTrialUserIds.some((id) => !before.forceTrialUserIds.includes(id));
    if (turningOn || addsForced) {
      if (!dispatchToken()) return { ok: false, error: "server_key_missing" };
      if (!(await watermarkAssetStatus()).ok) return { ok: false, error: "asset_unavailable" };
    }

    const after = serializeTrialWatermarkConfig(v.config);
    const { error } = await admin.supabase.from("app_settings").upsert(
      { key: KEY, value: after as never, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: "generic" };

    // The row as it was stored (not as it read back), and as it is now.
    await logAudit(admin.supabase, {
      actorId: admin.adminId,
      action: turningOn ? "admin.trial_watermark_enabled"
        : before.enabled && !v.config.enabled ? "admin.trial_watermark_disabled"
        : "admin.trial_watermark_saved",
      entityType: "app_settings", entityId: KEY,
      before: isObj(row.value) ? row.value : { value: row.value ?? null },
      after,
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/* ── preview ───────────────────────────────────────────────────────────── */

export type TrialWatermarkPreviewError =
  | "forbidden" | "invalid" | "no_image" | "bad_source" | "too_large" | "not_found"
  | "unsupported_format" | "unreadable" | "too_small"
  | "asset_missing" | "asset_mismatch" | "asset_unreadable" | "generic";

export type TrialWatermarkPreviewResult =
  | {
      ok: true;
      /** The marked image, downscaled to ≤ maxSide, as a JPEG data URL. */
      dataUrl: string;
      info: TrialWatermarkInfo;
      sourceBytes: number;
      markedBytes: number;
      markedMime: string;
      shown: { width: number; height: number };
      ms: number;
    }
  | { ok: false; error: TrialWatermarkPreviewError; field?: TrialWatermarkInvalid };

/** What the preview draws; the rest of the row is not its business. */
const VISUAL = ["widthRatio", "opacity", "luminanceThreshold", "darkColor", "glowRadiusRatio", "glowOpacity"] as const;
/** A media-bucket object name: relative, no `.`/`..` segment, no control characters. */
const MEDIA_NAME = /^[A-Za-z0-9._()\- /]{1,400}$/;
const ENGINE_CODES = new Set<TrialWatermarkPreviewError>([
  "unsupported_format", "unreadable", "too_small", "asset_missing", "asset_mismatch", "asset_unreadable",
]);
const MAX_PIXELS = 50_000_000;

const mediaNameOk = (name: string) =>
  MEDIA_NAME.test(name) && !name.startsWith("/") && name.split("/").every((s) => s !== "" && s !== "." && s !== "..");

/**
 * FormData: `params` (JSON of the form's visual values), and exactly one of
 * `file` (an image, ≤ 10 MB) or `media` (an object name in the media bucket).
 */
export async function previewTrialWatermarkAction(form: FormData): Promise<TrialWatermarkPreviewResult> {
  try {
    const admin = await requireAdmin();
    if (!admin) return { ok: false, error: "forbidden" };
    if (!(form instanceof FormData)) return { ok: false, error: "invalid" };

    let params: unknown = null;
    try { params = JSON.parse(String(form.get("params") ?? "")); } catch { params = null; }
    const submitted = isObj(params) ? params : {};
    // Strict on every value the mark is drawn with: a missing one is invalid,
    // never quietly the default. The other fields are the defaults' — the
    // preview neither reads nor saves them.
    const v = validateTrialWatermarkInput({
      ...TRIAL_WATERMARK_DEFAULTS, ...Object.fromEntries(VISUAL.map((k) => [k, submitted[k]])),
    });
    if (!v.ok) return { ok: false, error: "invalid", field: v.field };

    const file = form.get("file");
    const media = form.get("media");
    const hasFile = file instanceof File;
    const hasMedia = typeof media === "string" && media !== "";
    if (hasFile && hasMedia) return { ok: false, error: "bad_source" };
    if (!hasFile && !hasMedia) return { ok: false, error: "no_image" };

    let input: Buffer;
    if (hasFile) {
      if (file.size === 0) return { ok: false, error: "no_image" };
      if (file.size > TRIAL_WATERMARK_PREVIEW.maxBytes) return { ok: false, error: "too_large" };
      input = Buffer.from(await file.arrayBuffer());
    } else {
      const name = media as string;
      if (!mediaNameOk(name)) return { ok: false, error: "bad_source" };
      const { data, error } = await admin.supabase.storage.from("media").download(name);
      if (error || !data) return { ok: false, error: "not_found" };
      if (data.size > TRIAL_WATERMARK_PREVIEW.maxBytes) return { ok: false, error: "too_large" };
      input = Buffer.from(await data.arrayBuffer());
    }
    if (input.length > TRIAL_WATERMARK_PREVIEW.maxBytes) return { ok: false, error: "too_large" };

    const started = Date.now();
    const meta = await sharp(input, { failOn: "none" }).metadata().catch(() => null);
    if (meta?.width && meta.height && meta.width * meta.height > MAX_PIXELS) return { ok: false, error: "too_large" };
    // The production engine, exactly as a producer runs it.
    const { applyTrialWatermark } = await import("@/lib/server/trial-watermark/engine");
    const out = await applyTrialWatermark(input, v.config);
    // Shown on white, like the luminance was measured: a cutout keeps reading
    // as the page it is usually placed on.
    const shown = await sharp(out.bytes, { failOn: "none" })
      .resize({ width: TRIAL_WATERMARK_PREVIEW.maxSide, height: TRIAL_WATERMARK_PREVIEW.maxSide, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${shown.data.toString("base64")}`,
      info: out.info,
      sourceBytes: input.length,
      markedBytes: out.bytes.length,
      markedMime: out.mime,
      shown: { width: shown.info.width, height: shown.info.height },
      ms: Date.now() - started,
    };
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "";
    return ENGINE_CODES.has(code as TrialWatermarkPreviewError)
      ? { ok: false, error: code as TrialWatermarkPreviewError }
      : { ok: false, error: "generic" };
  }
}

/**
 * GENERATOR STUDIO — the plain logic behind the two generator modes
 * (GrovBase Shot 1.0 / Stwórz zdjęcie) on one screen.
 *
 * Nothing here renders and nothing here talks to a server: it is the tab in
 * the URL, the shot plan, how many product photos a mode really sends, and
 * how a saved draft is read back. The panel (components/genv3/workspace.tsx)
 * holds the state; this file only decides things about it, which is what
 * lets the rules be tested without a browser.
 */

/** The two modes. GrovShot plans the session itself; Stwórz is the
 *  customer's own prompt. */
export type StudioTab = "grovshot" | "stworz";

/** `?tryb=` — the only two values a link may carry. */
export function parseTab(raw: string | null | undefined): StudioTab | null {
  return raw === "grovshot" || raw === "stworz" ? raw : null;
}

/** Shot range of the managed engine (lib/server/prompt-engine.ts clampShots:
 *  MIN_SHOTS 1, MAX_SHOTS 10, default 5). Mirrored, not imported: that module
 *  is server-only. */
export const SHOTS_MIN = 1;
export const SHOTS_MAX = 10;
export const SHOTS_DEFAULT = 5;

/** Product photos one session may carry (the uploader's cap, and the planner's
 *  MAX_REFS). */
export const STUDIO_MAX_REFS = 10;

/* ── the shot plan ─────────────────────────────────────────────────────── */

/**
 * One row of "Plan ujęć". `photo` is the STABLE key of an uploaded photo
 * (its ref key — the storage path for a member, a local id for a visitor),
 * never its position: reordering the photos must not re-aim a shot.
 */
export type PlanRow = { text: string; photo: string | null; keepFraming: boolean };

export const PLAN_TEXT_MAX = 400;

export const EMPTY_ROW: PlanRow = { text: "", photo: null, keepFraming: false };

/** A row says something the engine will use. */
export function rowPlanned(row: PlanRow | undefined): boolean {
  return !!row && (row.text.trim().length > 0 || row.photo !== null);
}

/** "Zaplanowane: 2 z 5" — only the rows inside the shot count. */
export function plannedCount(plan: readonly PlanRow[], count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (rowPlanned(plan[i])) n++;
  return n;
}

/** Edit one row, growing the list as needed. Rows past the shot count are
 *  KEPT: lowering the count and raising it again brings them back. */
export function patchRow(plan: readonly PlanRow[], index: number, patch: Partial<PlanRow>): PlanRow[] {
  const next = plan.slice(0, SHOTS_MAX);
  while (next.length <= index) next.push({ ...EMPTY_ROW });
  const row = { ...next[index]!, ...patch };
  if (row.photo === null) row.keepFraming = false;
  next[index] = row;
  return next;
}

/** A photo left the pool: every row that chose it goes back to "Dowolne". */
export function dropPhoto(plan: readonly PlanRow[], key: string): PlanRow[] {
  return plan.map((r) => (r.photo === key ? { ...r, photo: null, keepFraming: false } : r));
}

/** Rewrite photo keys after a restore handed the photos new keys. */
export function remapPhotos(plan: readonly PlanRow[], keys: ReadonlyMap<string, string>): PlanRow[] {
  return plan.map((r) => {
    if (r.photo === null) return r;
    const next = keys.get(r.photo);
    return next ? { ...r, photo: next } : { ...r, photo: null, keepFraming: false };
  });
}

/** What the planner receives for one shot: the customer's words and, when a
 *  photo was assigned, that photo's STORAGE PATH — the server checks it is one
 *  of this request's reference photos and turns it into the engine's index. */
export type ShotBriefOut = { text?: string; keepFraming: boolean; refPath?: string };

export function planToBriefs(
  plan: readonly PlanRow[], count: number, refs: readonly { key: string; path: string }[],
): ShotBriefOut[] {
  return Array.from({ length: count }, (_, i) => {
    const row = plan[i];
    const ref = row?.photo ? refs.find((r) => r.key === row.photo) : undefined;
    const text = row?.text.trim().slice(0, PLAN_TEXT_MAX) || undefined;
    return {
      ...(text ? { text } : {}),
      keepFraming: !!row?.keepFraming && !!ref,
      ...(ref ? { refPath: ref.path } : {}),
    };
  });
}

/* ── how many product photos a mode really sends ───────────────────────── */

/**
 * Stwórz zdjęcie: the server keeps the FIRST product photos that fit the
 * model's reference slots, two of which go to inspiration when there is any
 * (lib/server/generation.ts: productBudget). The panel says so and sends only
 * those, so nothing is uploaded, priced or described that the model drops.
 * A model without reference images uses none.
 */
export function customPhotoBudget(
  model: { supportsRefs: boolean; maxRefs?: number | null } | undefined, inspirations: number,
): number {
  if (!model?.supportsRefs) return 0;
  const maxRefs = model.maxRefs && model.maxRefs > 0 ? model.maxRefs : 6;
  const reserved = inspirations > 0 ? Math.min(2, inspirations) : 0;
  return reserved > 0 ? Math.max(1, maxRefs - reserved) : maxRefs;
}

/* ── the draft ─────────────────────────────────────────────────────────── */

export type GrovshotSettings = {
  sessionType: "advertising" | "lifestyle";
  choices: Record<string, string>;
  modelId: string;
  ratio: string;
  resolution: string;
  quality: string;
  count: number;
  plan: PlanRow[];
};

export type StworzSettings = {
  prompt: string;
  modelId: string;
  ratio: string;
  resolution: string;
  quality: string;
  count: number;
};

/** What a draft keeps besides the photos (which travel as files). The mode
 *  on screen is NOT kept: the address says it (/prompts, /generator,
 *  ?tryb=) — a GrovShot card never opens on Stwórz because of a draft. */
export type StudioDraft = {
  v: 3;
  grovshot: GrovshotSettings;
  stworz: StworzSettings;
};

const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined);

function readRows(raw: unknown): PlanRow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, SHOTS_MAX).map((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const photo = typeof o.photo === "string" && o.photo ? o.photo : null;
    return { text: str(o.text, PLAN_TEXT_MAX) ?? "", photo, keepFraming: photo !== null && o.keepFraming === true };
  });
}

/**
 * Read a saved draft back over the panel's defaults — defensively: a draft is
 * data from this browser, and an older one (or a hand-edited one) must never
 * break the panel. Unknown keys are dropped, every value is re-checked.
 *
 * A draft from before the two modes shared one screen is FLAT (prompt,
 * modelId, ratio, … at the top). It belongs to the mode its page was —
 * `legacyTab` — and its positional shot rows (`briefs[].refIndex`) are turned
 * into photo keys with `legacyKeys` (the photos in their saved order).
 */
export function readStudioDraft(
  raw: unknown, defaults: StudioDraft, legacyTab: StudioTab, legacyKeys: readonly string[] = [],
): StudioDraft {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (src: Record<string, unknown>, base: GrovshotSettings | StworzSettings) => ({
    modelId: str(src.modelId) ?? base.modelId,
    ratio: str(src.ratio, 12) ?? base.ratio,
    resolution: str(src.resolution, 12) ?? base.resolution,
    quality: str(src.quality, 12) ?? base.quality,
    count: Math.max(1, int(src.count) ?? base.count),
  });
  const grovFrom = (src: Record<string, unknown>, rows: PlanRow[] | undefined): GrovshotSettings => ({
    ...defaults.grovshot,
    ...pick(src, defaults.grovshot),
    sessionType: src.sessionType === "lifestyle" || src.sessionType === "advertising" ? src.sessionType : defaults.grovshot.sessionType,
    choices: src.choices && typeof src.choices === "object" && !Array.isArray(src.choices)
      ? Object.fromEntries(Object.entries(src.choices as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]))
      : defaults.grovshot.choices,
    plan: rows ?? defaults.grovshot.plan,
  });
  const stworzFrom = (src: Record<string, unknown>): StworzSettings => ({
    ...defaults.stworz,
    ...pick(src, defaults.stworz),
    prompt: str(src.prompt, 4000) ?? defaults.stworz.prompt,
  });

  if (o.v === 3) {
    const g = (o.grovshot && typeof o.grovshot === "object" ? o.grovshot : {}) as Record<string, unknown>;
    const s = (o.stworz && typeof o.stworz === "object" ? o.stworz : {}) as Record<string, unknown>;
    return { v: 3, grovshot: grovFrom(g, readRows(g.plan)), stworz: stworzFrom(s) };
  }

  // The flat shape of the previous release.
  if (legacyTab === "stworz") return { ...defaults, stworz: stworzFrom(o) };
  const rows = Array.isArray(o.briefs)
    ? (o.briefs as unknown[]).slice(0, SHOTS_MAX).map((b) => {
      const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      const at = int(r.refIndex);
      const photo = at && at >= 1 ? legacyKeys[at - 1] ?? null : null;
      return { text: str(r.text, PLAN_TEXT_MAX) ?? "", photo, keepFraming: photo !== null && r.keepFraming === true };
    })
    : undefined;
  return { ...defaults, grovshot: grovFrom(o, rows) };
}

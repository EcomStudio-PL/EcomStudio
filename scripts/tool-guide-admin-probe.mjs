/**
 * TOOL GUIDES — THE ADMIN EDITOR ("Samouczek i galeria startowa" on
 * /admin/ai/[tool] → Samouczek, ?tab=guide), DRIVEN IN A REAL BROWSER AGAINST
 * STUBBED ACTIONS.
 *
 * The editor (components/admin/tool-guide-editor.tsx) reaches the server two
 * ways: saveToolGuideAction ("Zapisz i opublikuj") and showToolGuideAgainAction
 * ("Pokaż ponownie wszystkim", a confirmed version bump), both in
 * app/actions/tool-guides.ts. In a THROWAWAY COPY of the working tree this
 * probe replaces that file with a "use server" stub of the same exports that
 * answers like the real actions would for an in-memory row (compare-and-set
 * on updated_at, version bump, pictures by position, normalizeGuideContent)
 * and records every call, so the checks can assert the exact payloads.
 * Nothing talks to Supabase; nothing is written anywhere but the dev
 * server's memory.
 *
 * The v2 UI it holds the editor to: a status block (saved / never saved,
 * version, last saved at/by, live for customers), "Pokaż ponownie wszystkim"
 * as a button + confirm (disabled while the form is dirty), step cards with
 * the current illustration and one "Zmień ilustrację" chooser (library photo
 * or a drawing), delete-with-confirm, a per-step preview, and NO starter
 * controls for the four tools without a results gallery (editor,
 * tool_upscale, tool_expand, tool_watermark).
 *
 * THE HARNESS (written by `--harness` into the CURRENT directory, which must
 * NOT be the repository — the script refuses):
 *   app/actions/tool-guides.ts               the recording stub (replaces the real one)
 *   app/probe-tmp/admin-guide/store.ts       in-memory rows/slots/calls (globalThis, per `tgp_sid` cookie)
 *   app/probe-tmp/admin-guide/page.tsx       the REAL ToolGuideEditor, props built the way
 *                                            components/admin/tool-guide-section.tsx builds them
 *                                            (defaultGuideContent, slots by position, library,
 *                                            catalogue fallback), inside the admin I18nScope,
 *                                            the admin <main> frame and the section's Card
 *   app/probe-tmp/admin-guide/probe-tools.tsx hydration marker + a sibling router.refresh()
 *                                            button (what ToolConfigForm does after its own save)
 *   app/probe-tmp/admin-guide/calls/route.ts GET ?sid=…[&force=a,b][&bump=<tool>][&reset=1]
 *                                            → { calls, answers, rows, slots }
 *   Query: ?tool=<any guide tool: retouch, compress, editor, tool_upscale, …>
 *          &row=none|custom|off|max   (saved-row variant, seeded once per sid+tool;
 *                                  max = tutorial_version at the 1000000 bound)
 *          &cat=0                 (no catalogue picture → the drawn showcase)
 *          &live=0                (the status block's "not live for customers" state)
 *   Locale = the ecs_locale cookie, theme = next-themes' localStorage.
 *   Forced answers (one-shot, queued): conflict, images_failed (row written,
 *   pictures not), images_failed_early (nothing written — the real action's
 *   early return when the slot read fails), conflict_images, invalid_*,
 *   generic, not_admin, step_up_required …
 *
 * RUN (rsync is not installed; tar works):
 *   SCRATCH=<dir>; mkdir -p $SCRATCH/copy $SCRATCH/shots
 *   tar -C <repo> --exclude=./node_modules --exclude=./.next --exclude=./.git -cf - . | tar -C $SCRATCH/copy -xf -
 *   ln -s <repo>/node_modules $SCRATCH/copy/node_modules
 *   (cd $SCRATCH/copy && node <repo>/scripts/tool-guide-admin-probe.mjs --harness)
 *   (cd $SCRATCH/copy && setsid npx next dev -p 3331 > $SCRATCH/dev.log 2>&1 & echo $! > $SCRATCH/dev.pid)
 *   TGA_PROBE_SRC=$SCRATCH/copy TGA_PROBE_SHOTS=$SCRATCH/shots node <repo>/scripts/tool-guide-admin-probe.mjs http://127.0.0.1:3331
 *   kill -- -$(cat $SCRATCH/dev.pid)     # the whole group: killing npx's PID alone orphans next-server
 *
 * Env: TGA_PROBE_SHOTS (screenshot dir), TGA_PROBE_CHROME (browser binary),
 * TGA_PROBE_ONLY (comma list of check groups, e.g. "1,4,7"), TGA_PROBE_SRC
 * (the tree the dev server runs — dictionaries and lib/tool-guides.ts are read
 * from there; default: this repository).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = "app/probe-tmp/admin-guide";
const ACTION = "app/actions/tool-guides.ts";

/* ── harness sources (no template literals inside: they live in one) ───── */

const STORE_SRC = `import type { GuideContent, GuideImage } from "@/lib/tool-guides";
import type { LibraryItem } from "@/lib/services/media-slots";

/** Tool-guide ADMIN probe harness (scripts/tool-guide-admin-probe.mjs). Not part of the app. */

export type ProbeRow = {
  tutorial_enabled: boolean;
  starter_enabled: boolean;
  tutorial_version: number;
  content: GuideContent | null;
  updated_at: string;
};
/** A media_slots row: a removal keeps the row with media_id null (media_slots_write). */
export type ProbeSlot = { mediaId: string | null; updatedAt: string };
export type ProbeSession = {
  rows: Record<string, ProbeRow | null>;
  slots: Record<string, ProbeSlot | undefined>;
  seeded: Record<string, string>;
  calls: unknown[];
  answers: unknown[];
  force: string[];
};

function lib(id: string, url: string | null, title: string, width: number | null, height: number | null, kind = "image"): LibraryItem {
  return {
    id, kind, url, posterUrl: null, title, alt: title, folder: "probe", tags: ["probe"], width, height,
    sizeBytes: 123456, mime: kind === "image" ? "image/webp" : "video/mp4", createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export const LIBRARY: LibraryItem[] = [
  lib("aaaaaaaa-0000-4000-8000-000000000001", "/launch/hero-dino.webp", "A hero-dino.webp", 1808, 1152),
  lib("bbbbbbbb-0000-4000-8000-000000000002", "/showcase/moda-ghost.webp", "B moda-ghost.webp", 340, 425),
  lib("cccccccc-0000-4000-8000-000000000003", "/brand/app-icon.png", "C app-icon.png", 1024, 1024),
  lib("dddddddd-0000-4000-8000-000000000004", "/brand/logo-on-light.png", "D a-very-long-file-name-for-the-banner-logo-on-a-light-background-final-v2.png", 922, 200),
  lib("eeeeeeee-0000-4000-8000-000000000005", "/showcase/tool-shadow.webp", "E video (must not be offered)", 340, 425, "video"),
  lib("ffffffff-0000-4000-8000-000000000006", null, "F no url (must not be offered)", null, null),
];

export const CATALOGUE: GuideImage = { url: "/showcase/ecommerce-packshot.webp", width: 340, height: 425, alt: "" };

export const CUSTOM: GuideContent = {
  tutorial: {
    title: { pl: "Własny samouczek (probe)", en: "Custom tutorial (probe)" },
    body: { pl: "Opis własny." },
    steps: [
      { title: { pl: "Własny krok 1", en: "Custom step 1" }, body: { pl: "Treść 1" }, art: "upload" },
      { title: { pl: "Własny krok 2" }, body: {}, art: "settings" },
      { title: { pl: "Własny krok 3", de: "Eigener Schritt 3" }, body: { pl: "Treść 3" }, art: "result" },
    ],
  },
  starter: { title: { pl: "Własna galeria (probe)", en: "Custom gallery (probe)" }, body: { pl: "Opis galerii." } },
};

const G = globalThis as unknown as { __tgAdminProbe?: Map<string, ProbeSession>; __tgAdminClock?: number };

export function session(sid: string): ProbeSession {
  if (!G.__tgAdminProbe) G.__tgAdminProbe = new Map();
  let s = G.__tgAdminProbe.get(sid);
  if (!s) {
    s = { rows: {}, slots: {}, seeded: {}, calls: [], answers: [], force: [] };
    G.__tgAdminProbe.set(sid, s);
  }
  return s;
}

export function dropSession(sid: string) {
  G.__tgAdminProbe?.delete(sid);
}

/** A fresh updated_at in Postgres's own spelling (microseconds, +00:00), always later than the last. */
export function stamp(): string {
  const now = Math.max(Date.now(), (G.__tgAdminClock ?? 0) + 7);
  G.__tgAdminClock = now;
  return new Date(now).toISOString().slice(0, 23) + "456+00:00";
}

export function seed(s: ProbeSession, tool: string, variant: string) {
  if (s.seeded[tool]) return;
  s.seeded[tool] = variant;
  if (variant === "custom") {
    s.rows[tool] = { tutorial_enabled: true, starter_enabled: true, tutorial_version: 3, content: CUSTOM, updated_at: "2026-10-01T08:00:00.111111+00:00" };
    s.slots["guide." + tool + ".tutorial.1"] = { mediaId: LIBRARY[3].id, updatedAt: "2026-10-01T07:59:00.100001+00:00" };
    s.slots["guide." + tool + ".tutorial.2"] = { mediaId: LIBRARY[1].id, updatedAt: "2026-10-01T07:59:00.100002+00:00" };
    s.slots["guide." + tool + ".starter.1"] = { mediaId: LIBRARY[2].id, updatedAt: "2026-10-01T07:59:00.100003+00:00" };
  } else if (variant === "off") {
    s.rows[tool] = { tutorial_enabled: false, starter_enabled: false, tutorial_version: 2, content: null, updated_at: "2026-10-02T09:30:00.222222+00:00" };
  } else if (variant === "max") {
    s.rows[tool] = { tutorial_enabled: true, starter_enabled: true, tutorial_version: 1000000, content: null, updated_at: "2026-10-03T10:00:00.333333+00:00" };
  } else {
    s.rows[tool] = null;
  }
}

/** Another admin saves this tool's guide right now (what makes a real conflict). */
export function bump(s: ProbeSession, tool: string) {
  const cur = s.rows[tool] ?? null;
  const base = cur?.content ?? CUSTOM;
  s.rows[tool] = {
    tutorial_enabled: cur ? cur.tutorial_enabled : true,
    starter_enabled: cur ? cur.starter_enabled : true,
    tutorial_version: cur ? cur.tutorial_version : 1,
    content: { ...base, tutorial: { ...base.tutorial, title: { pl: "Zmiana innego admina" } } },
    updated_at: stamp(),
  };
}

/** A picture changed outside this form (Admin → Media "Zamień wszędzie"). */
export function slotBump(s: ProbeSession, key: string, mediaId: string | null) {
  s.slots[key] = { mediaId, updatedAt: stamp() };
}
`;

const ACTION_SRC = `"use server";
import { cookies } from "next/headers";
import {
  DEFAULT_STEP_ARTS, GUIDE_MAX_STEPS, guideHasStarter, guideSlotKey, isGuideTool, normalizeGuideContent,
  type GuideContent, type GuideToolKey,
} from "@/lib/tool-guides";
import { LIBRARY, session, stamp, type ProbeSession } from "@/app/probe-tmp/admin-guide/store";

/**
 * PROBE STUB of app/actions/tool-guides.ts — written by
 * scripts/tool-guide-admin-probe.mjs into a THROWAWAY COPY only. Same export
 * names and signature; answers like the real action would for an in-memory
 * row, and records every call (per tgp_sid cookie) for the probe to assert.
 */

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export type SaveToolGuideInput = {
  tool: string;
  tutorialEnabled: boolean;
  starterEnabled: boolean;
  content: unknown;
  images: { steps: (string | null)[]; starter: string | null };
  base: string | null;
  imageBases?: Record<string, string | null>;
  showAgain: boolean;
};

type Saved = { updatedAt: string; version: number; imageBases: Record<string, string | null> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveToolGuideAction(input: SaveToolGuideInput): Promise<Result<Saved>> {
  const jar = await cookies();
  const s = session(jar.get("tgp_sid")?.value ?? "default");
  s.calls.push(JSON.parse(JSON.stringify(input)));
  const res = answer(s, input);
  s.answers.push(res);
  return res;
}

/** The real action's order: validate → read pictures → picture CAS → row CAS
 *  → write pictures (all-or-nothing) → write row → answer with both bases.
 *  Every failure writes nothing. Forced codes (one-shot): images_failed /
 *  conflict_images = the media_slots_write RPC fails; slots_read_failed =
 *  readGuideSlots → null ("generic"); anything else is answered as is. */
function answer(s: ProbeSession, input: SaveToolGuideInput): Result<Saved> {
  const forced = s.force.shift() ?? null;
  if (forced === "slots_read_failed") return { ok: false, error: "generic" };
  if (forced && forced !== "images_failed" && forced !== "conflict_images") return { ok: false, error: forced };

  if (!isGuideTool(input.tool)) return { ok: false, error: "unknown_tool" };
  const tool: GuideToolKey = input.tool;
  let content: GuideContent | null = null;
  let stepCount = DEFAULT_STEP_ARTS[tool].length;
  if (input.content !== null) {
    const n = normalizeGuideContent(input.content);
    if (!n.ok) return { ok: false, error: "invalid_" + n.problem };
    content = n.content;
    stepCount = n.content.tutorial.steps.length;
  }
  const wanted = new Map<string, string | null>();
  const stepImages = Array.isArray(input.images?.steps) ? input.images.steps : [];
  for (let i = 0; i < GUIDE_MAX_STEPS; i++) {
    wanted.set(guideSlotKey(tool, "tutorial", i + 1), i < stepCount ? stepImages[i] ?? null : null);
  }
  wanted.set(guideSlotKey(tool, "starter", 1), input.images?.starter ?? null);
  const ids = Array.from(new Set(Array.from(wanted.values()).filter((v): v is string => v !== null)));
  if (ids.some((id) => !UUID.test(id))) return { ok: false, error: "invalid_image" };
  const okIds = new Set(LIBRARY.filter((a) => a.kind === "image" && a.url).map((a) => a.id));
  if (ids.some((id) => !okIds.has(id))) return { ok: false, error: "invalid_image" };

  const instant = (v: string | null | undefined) => (v ? Date.parse(v) : null);
  if (input.imageBases) {
    for (const key of Array.from(wanted.keys())) {
      if (instant(s.slots[key]?.updatedAt) !== instant(input.imageBases[key] ?? null)) return { ok: false, error: "conflict_images" };
    }
  }
  const current = s.rows[tool] ?? null;
  if (instant(current?.updated_at) !== instant(input.base)) return { ok: false, error: "conflict" };

  // 1. The pictures that changed (media_slots_write: all or nothing).
  if (forced === "images_failed" || forced === "conflict_images") return { ok: false, error: forced };
  const written: Record<string, string> = {};
  wanted.forEach((mediaId, key) => {
    const cur = s.slots[key];
    if ((cur?.mediaId ?? null) === mediaId) return;
    if (!cur && mediaId === null) return;
    const at = stamp();
    s.slots[key] = { mediaId, updatedAt: at };
    written[key] = at;
  });
  // 2. The row.
  const version = Math.min((current?.tutorial_version ?? 1) + (input.showAgain ? 1 : 0), 1000000);
  const updatedAt = stamp();
  s.rows[tool] = {
    tutorial_enabled: Boolean(input.tutorialEnabled), starter_enabled: Boolean(input.starterEnabled),
    tutorial_version: version, content, updated_at: updatedAt,
  };
  const imageBases: Record<string, string | null> = {};
  wanted.forEach((_, key) => { imageBases[key] = written[key] ?? s.slots[key]?.updatedAt ?? null; });
  return { ok: true, data: { updatedAt, version, imageBases } };
}

export type ShowToolGuideAgainInput = { tool: string; base: string | null };

/** "Pokaż ponownie wszystkim" (showToolGuideAgainAction): the version and the
 *  stamp only, compare-and-set on updated_at; no row yet = the shipped
 *  default kept, at v2 (starter on only where a starter exists). Recorded in
 *  calls as { showAgainAction: true, tool, base }. */
export async function showToolGuideAgainAction(input: ShowToolGuideAgainInput): Promise<Result<{ updatedAt: string; version: number }>> {
  const jar = await cookies();
  const s = session(jar.get("tgp_sid")?.value ?? "default");
  s.calls.push({ showAgainAction: true, ...JSON.parse(JSON.stringify(input)) });
  const res = again(s, input);
  s.answers.push(res);
  return res;
}

function again(s: ProbeSession, input: ShowToolGuideAgainInput): Result<{ updatedAt: string; version: number }> {
  const forced = s.force.shift() ?? null;
  if (forced) return { ok: false, error: forced };
  if (!input || !isGuideTool(input.tool)) return { ok: false, error: "unknown_tool" };
  const tool: GuideToolKey = input.tool;
  const instant = (v: string | null | undefined) => (v ? Date.parse(v) : null);
  const current = s.rows[tool] ?? null;
  if (instant(current?.updated_at) !== instant(input.base)) return { ok: false, error: "conflict" };
  const version = Math.min((current?.tutorial_version ?? 1) + 1, 1000000);
  const updatedAt = stamp();
  s.rows[tool] = current
    ? { ...current, tutorial_version: version, updated_at: updatedAt }
    : { tutorial_enabled: true, starter_enabled: guideHasStarter(tool), tutorial_version: version, content: null, updated_at: updatedAt };
  return { ok: true, data: { updatedAt, version } };
}
`;

const ROUTE_SRC = `import { NextResponse } from "next/server";
import { bump, dropSession, session, slotBump } from "../store";

/** Tool-guide ADMIN probe harness (scripts/tool-guide-admin-probe.mjs). Not part of the app. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const sid = u.searchParams.get("sid") ?? "default";
  if (u.searchParams.get("reset") === "1") dropSession(sid);
  const s = session(sid);
  const force = u.searchParams.get("force");
  if (force) s.force.push(...force.split(",").filter(Boolean));
  const b = u.searchParams.get("bump");
  if (b) bump(s, b);
  const sb = u.searchParams.get("slotbump");
  if (sb) slotBump(s, sb, u.searchParams.get("media") || null);
  return NextResponse.json(
    { calls: s.calls, answers: s.answers, rows: s.rows, slots: s.slots, force: s.force },
    { headers: { "cache-control": "no-store" } },
  );
}
`;

const TOOLS_SRC = `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Tool-guide ADMIN probe harness. A hydration marker, the server's base as
 *  the page was last rendered, and a sibling router.refresh() — what
 *  ToolConfigForm on the same Podstawowe tab does after its own save. */
export function ProbeTools({ serverBase, serverVersion }: { serverBase: string; serverVersion: number }) {
  const router = useRouter();
  useEffect(() => {
    (window as unknown as { __probeHydrated?: number }).__probeHydrated = Date.now();
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint" data-probe-tools>
      <span>probe · server base: <code data-probe-server-base>{serverBase}</code> · v<span data-probe-server-version>{serverVersion}</span></span>
      <button type="button" data-probe-refresh onClick={() => router.refresh()} className="rounded-md border border-line px-2 py-1">
        probe: router.refresh()
      </button>
    </div>
  );
}
`;

const PAGE_SRC = `import { cookies } from "next/headers";
import { BookOpen } from "lucide-react";
import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { Card, CardHeader } from "@/components/ui/card";
import { defaultGuideContent, guideChrome } from "@/lib/server/tool-guides";
import { GUIDE_MAX_STEPS, guideHasStarter, guideSlotKey, isGuideTool, normalizeGuideContent, type GuideToolKey } from "@/lib/tool-guides";
import { ToolGuideEditor } from "@/components/admin/tool-guide-editor";
import { CATALOGUE, LIBRARY, seed, session } from "./store";
import { ProbeTools } from "./probe-tools";

export const dynamic = "force-dynamic";

/** Tool-guide ADMIN probe harness (scripts/tool-guide-admin-probe.mjs). Not part of the app.
 *  Props are built exactly the way components/admin/tool-guide-section.tsx builds them. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const tool: GuideToolKey = isGuideTool(q.tool) ? q.tool : "retouch";
  const sid = (await cookies()).get("tgp_sid")?.value ?? q.sid ?? "default";
  const s = session(sid);
  seed(s, tool, q.row ?? "none");
  const row = s.rows[tool] ?? null;

  const [{ dict }, { dict: adminDict }] = await Promise.all([getDictionary(), getScopedDictionary("admin")]);
  const t = makeT(dict);

  const stepKeys = Array.from({ length: GUIDE_MAX_STEPS }, (_, i) => guideSlotKey(tool, "tutorial", i + 1));
  const starterKey = guideSlotKey(tool, "starter", 1);
  const defaults = defaultGuideContent(tool);
  const stored = row?.content != null ? normalizeGuideContent(row.content) : null;
  const content = stored?.ok ? stored.content : null;
  const stepImages = stepKeys.map((k) => s.slots[k]?.mediaId ?? null);
  const starterImage = s.slots[starterKey]?.mediaId ?? null;
  const imageBases = Object.fromEntries([...stepKeys, starterKey].map((k) => [k, s.slots[k]?.updatedAt ?? null]));

  return (
    <I18nScope dict={adminDict}>
      <div className="flex min-h-dvh w-full min-w-0">
        <aside className="rail sticky top-0 hidden h-dvh w-[var(--rail-w)] shrink-0 flex-col px-3.5 py-5 lg:flex" data-probe-rail>
          <p className="text-[12px] text-faint">Admin (probe)</p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-4 pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 lg:px-6 lg:pb-12 lg:pt-6 xl:px-7">
            <div className="space-y-4">
              <Card className="p-5" data-tool-guide-admin={tool}>
                <CardHeader icon={BookOpen} title={t("aicc.guide.title")} sub={t("aicc.guide.sub")} />
                <div className="pt-4">
                  <ToolGuideEditor
                    tool={tool}
                    defaults={defaults}
                    chrome={guideChrome()}
                    status={{ live: q.live !== "0", availability: q.live === "0" ? "Wkrótce" : null, savedBy: row ? "Probe Admin" : null }}
                    initial={{
                      tutorialEnabled: row ? row.tutorial_enabled : true,
                      starterEnabled: row ? row.starter_enabled : guideHasStarter(tool),
                      content,
                      stepImages,
                      starterImage,
                      base: row?.updated_at ?? null,
                      imageBases,
                      version: row?.tutorial_version ?? 1,
                    }}
                    library={LIBRARY}
                    catalogueImage={q.cat === "0" ? null : CATALOGUE}
                  />
                </div>
              </Card>
              <ProbeTools serverBase={row?.updated_at ?? ""} serverVersion={row?.tutorial_version ?? 1} />
            </div>
          </main>
        </div>
      </div>
    </I18nScope>
  );
}
`;

if (process.argv.includes("--harness") || process.argv.includes("--clean")) {
  const cwd = path.resolve(process.cwd());
  // The harness REPLACES app/actions/tool-guides.ts: never in the repository.
  if (cwd === REPO || fs.realpathSync(cwd) === fs.realpathSync(REPO)) {
    console.error("refusing: run --harness/--clean inside a throwaway COPY of the working tree, not the repository");
    process.exit(2);
  }
  if (!fs.existsSync(path.join(cwd, ACTION)) || !fs.existsSync(path.join(cwd, "components/admin/tool-guide-editor.tsx"))) {
    console.error("refusing: the current directory is not a copy of this app");
    process.exit(2);
  }
  if (process.argv.includes("--harness")) {
    fs.mkdirSync(path.join(DIR, "calls"), { recursive: true });
    fs.writeFileSync(path.join(DIR, "store.ts"), STORE_SRC);
    fs.writeFileSync(path.join(DIR, "page.tsx"), PAGE_SRC);
    fs.writeFileSync(path.join(DIR, "probe-tools.tsx"), TOOLS_SRC);
    fs.writeFileSync(path.join(DIR, "calls/route.ts"), ROUTE_SRC);
    fs.writeFileSync(ACTION, ACTION_SRC);
    console.log(`harness written to ${cwd}/${DIR}; ${ACTION} replaced by the recording stub (copy only)`);
  } else {
    fs.rmSync(DIR, { recursive: true, force: true });
    if (fs.existsSync("app/probe-tmp") && fs.readdirSync("app/probe-tmp").length === 0) fs.rmSync("app/probe-tmp", { recursive: true });
    fs.copyFileSync(path.join(REPO, ACTION), ACTION);
    console.log("harness removed; action restored from the repository");
  }
  process.exit(0);
}

/* ── setup ─────────────────────────────────────────────────────────────── */

const BASE = (process.argv[2] ?? "http://127.0.0.1:3331").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.TGA_PROBE_SHOTS ?? null;
const CHROME = process.env.TGA_PROBE_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ONLY = process.env.TGA_PROBE_ONLY ? new Set(process.env.TGA_PROBE_ONLY.split(",").map((s) => s.trim())) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// Expectations come from the tree the dev server runs (the copy), not from a
// repository that may have moved on since the copy was taken.
const SRC = process.env.TGA_PROBE_SRC ? path.resolve(process.env.TGA_PROBE_SRC) : REPO;
const LOCALES = ["pl", "en", "de"];
const DICT = Object.fromEntries(LOCALES.map((l) => [l,
  JSON.parse(fs.readFileSync(path.join(SRC, `lib/i18n/dictionaries/${l}.json`), "utf8"))]));
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
function A(l, k, vars) {
  const s = DICT[l].aicc[`guide.${k}`];
  if (typeof s !== "string") throw new Error(`missing aicc.guide.${k} in ${l}`);
  return vars ? fill(s, vars) : s;
}
const TG = (l, k, vars) => (vars ? fill(DICT[l].toolGuide[k], vars) : DICT[l].toolGuide[k]);
const COMMON = (l, k) => DICT[l].common[k];

// The contract, read from lib/tool-guides.ts itself so the probe cannot drift from it.
const TG_SRC = fs.readFileSync(path.join(SRC, "lib/tool-guides.ts"), "utf8");
const MAX_STEPS = Number(/GUIDE_MAX_STEPS = (\d+)/.exec(TG_SRC)[1]);
const LIMITS = Object.fromEntries([.../GUIDE_LIMITS = \{([^}]*)\}/.exec(TG_SRC)[1].matchAll(/(\w+): (\d+)/g)].map((m) => [m[1], Number(m[2])]));
const ARTS = Object.fromEntries([.../DEFAULT_STEP_ARTS[^=]*= \{([\s\S]*?)\n\};/.exec(TG_SRC)[1].matchAll(/(\w+): \[([^\]]*)\]/g)]
  .map((m) => [m[1], m[2].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean)]));
const TOOLS = ["retouch", "ecommerce_thumbnail", "compress", "fashion_flat_lay"];
/** The v2 screens with no results gallery: guideHasStarter(tool) === false
 *  (lib/tool-guides.ts surfaces "editor" / "workbench"). */
const NO_STARTER = ["editor", "tool_upscale", "tool_expand", "tool_watermark"];
{
  const keys = /GUIDE_TOOL_KEYS = \[([\s\S]*?)\] as const/.exec(TG_SRC)[1];
  const wb = /WORKBENCH_TOOLS: readonly GuideToolKey\[\] = \[([^\]]*)\]/.exec(TG_SRC)[1];
  const missing = NO_STARTER.filter((t) => !keys.includes(`"${t}"`) || !ARTS[t] || (t !== "editor" && !wb.includes(`"${t}"`)));
  if (missing.length) throw new Error(`lib/tool-guides.ts no longer lists ${missing.join(", ")} as no-starter guide tools`);
}
const hasStarter = (tool) => !NO_STARTER.includes(tool);
const MAX_VERSION = 1000000;

/** defaultGuideContent's shipped(): this language, else Polish. */
function shipped(l, tool, keyPath) {
  const get = (loc) => keyPath.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), DICT[loc].toolGuideDefaults[tool]);
  const v = get(l) ?? get("pl");
  return typeof v === "string" ? v : "";
}
const defStepTitle = (l, tool, i) => shipped(l, tool, `tutorial.steps.s${i}.title`);

/** Mirrors STORE_SRC's LIBRARY. */
const LIB = {
  A: { id: "aaaaaaaa-0000-4000-8000-000000000001", url: "/launch/hero-dino.webp", title: "A hero-dino.webp", dims: "1808×1152" },
  B: { id: "bbbbbbbb-0000-4000-8000-000000000002", url: "/showcase/moda-ghost.webp", title: "B moda-ghost.webp", dims: "340×425" },
  C: { id: "cccccccc-0000-4000-8000-000000000003", url: "/brand/app-icon.png", title: "C app-icon.png", dims: "1024×1024" },
  D: { id: "dddddddd-0000-4000-8000-000000000004", url: "/brand/logo-on-light.png", title: "D a-very-long-file-name-for-the-banner-logo-on-a-light-background-final-v2.png" },
  E: { id: "eeeeeeee-0000-4000-8000-000000000005" },
  F: { id: "ffffffff-0000-4000-8000-000000000006" },
};
const CATALOGUE_URL = "/showcase/ecommerce-packshot.webp";
const idName = Object.fromEntries(Object.entries(LIB).map(([k, v]) => [v.id, k]));
const names = (arr) => (Array.isArray(arr) ? arr.map((id) => (id === null ? "null" : idName[id] ?? id)).join(",") : String(arr));

const VP = {
  390: { width: 390, height: 844, touch: true },
  834: { width: 834, height: 1112, touch: false },
  1440: { width: 1440, height: 900, touch: false },
};

const ED = "[data-tool-guide-editor]";
const DLG = '[data-tool-tutorial] [role="dialog"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 10000, step = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await sleep(step);
  }
  try { return Boolean(await fn()); } catch { return false; }
}

/* ── bookkeeping ───────────────────────────────────────────────────────── */

const GROUPS = [
  ["1", "renders for 8 tools (4 with a starter, 4 without) with the shipped defaults, PL/EN/DE labels, no raw keys"],
  ["Z", "editor / tool_upscale / tool_expand / tool_watermark: no starter controls; tutorial edit + save + preview work"],
  ["S", "status block: saved / never saved, last saved at + by, copy, version, steps, live / not live, published line"],
  ["2", "switches → tutorialEnabled / starterEnabled in the payload"],
  ["3", "per-language editing, PL title required, limits, markup, invisible chars"],
  ["4", "steps: add ≤6, delete WITH confirm, reorder; pictures move WITH their step; Zmień ilustrację"],
  ["5", "pictures: Zmień ilustrację → AssetPicker (portal) pick / replace / remove, Escape"],
  ["6", "preview: real TutorialModal (whole + per step) + starter desktop/phone frames"],
  ["7", "save & publish: payload, base chain, conflict, images_failed, reset"],
  ["A", "Pokaż ponownie wszystkim: button + confirm → showToolGuideAgainAction, disabled while dirty / off / at max"],
  ["8", "layout 390/834/1440 × light/dark × pl/en/de (+ a no-starter tool and the illustration chooser)"],
  ["9", "keyboard / a11y: names, focus visible, dialog focus trap + restore"],
  ["N", "network: nothing reaches Supabase or any other origin from the browser"],
  ["C", "console: no unexpected errors / page errors"],
];
const results = new Map(GROUPS.map(([id]) => [id, { pass: 0, fail: [] }]));
const shots = [];
function check(id, name, cond, detail) {
  const r = results.get(String(id));
  if (cond) { r.pass++; console.log(`  ✓ ${id}. ${name}`); }
  else {
    const d = detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail);
    r.fail.push(`${name}${d ? ` — ${d}` : ""}`);
    console.error(`  ✗ ${id}. ${name}${d ? ` — ${d}` : ""}`);
  }
  return Boolean(cond);
}
const info = (id, text) => console.log(`  · ${id}. ${text}`);

const allPages = [];
const consoleExpected = [
  /Download the React DevTools/, /\[Fast Refresh\]/, /\[HMR\]/,
  // the dev server forwarding its own sandbox-only logs (no Supabase here)
  /content-overrides: read failed/, /\[redirects\] load failed/,
];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

/** In every page: hide `next dev`'s tools bubble (it sits over the corner buttons). */
const INIT = () => {
  const hide = () => {
    if (document.getElementById("probe-hide-next-dev")) return;
    const st = document.createElement("style");
    st.id = "probe-hide-next-dev";
    st.textContent = "nextjs-portal{display:none!important;pointer-events:none!important}";
    document.documentElement.appendChild(st);
  };
  if (document.documentElement) { hide(); new MutationObserver(hide).observe(document.documentElement, { childList: true }); }
};

let sidN = 0;
const newSid = () => `p${process.pid}x${Date.now().toString(36)}x${++sidN}`;

async function newContext({ vp = VP[1440], theme = "light", locale = "pl", sid }) {
  const ctx = await browser.newContext({
    // bypassCSP: `next dev` evaluates its modules, which the app's CSP forbids.
    viewport: { width: vp.width, height: vp.height }, colorScheme: theme, bypassCSP: true,
    hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1,
  });
  await ctx.addCookies([
    { name: "ecs_locale", value: locale, url: BASE },
    { name: "tgp_sid", value: sid, url: BASE },
  ]);
  await ctx.addInitScript((th) => { try { localStorage.setItem("theme", th); } catch { /* private mode */ } }, theme);
  await ctx.addInitScript(INIT);
  return ctx;
}

async function handle(P, route) {
  const req = route.request();
  let u;
  try { u = new URL(req.url()); } catch { return route.fallback(); }
  try {
    if (u.hostname.endsWith("supabase.co") || u.hostname.endsWith("supabase.in")) {
      P.rec.supabase.push(`${req.method()} ${u.hostname}${u.pathname}`);
      return await route.abort();
    }
    if (u.origin !== ORIGIN) { P.rec.external.push(`${req.method()} ${u.href}`); return await route.abort(); }
    if (req.method() === "POST" && req.headers()["next-action"]) P.rec.actions.push(u.pathname + u.search);
    // router.refresh() = a GET for the RSC payload of the page.
    if (req.method() === "GET" && req.headers()["rsc"] === "1") P.rec.rsc.push(u.pathname + u.search);
    return await route.fallback();
  } catch { /* page closed */ }
}

async function openEditor(o = {}) {
  const sid = o.sid ?? newSid();
  const vp = o.vp ?? VP[1440];
  const theme = o.theme ?? "light";
  const locale = o.locale ?? "pl";
  const ctx = await newContext({ vp, theme, locale, sid });
  const page = await ctx.newPage();
  const P = {
    ctx, page, sid, vp, theme, locale, tool: o.tool ?? "retouch", row: o.row ?? "none", cat: o.cat !== false, live: o.live !== false,
    rec: { supabase: [], external: [], actions: [], rsc: [], console: [], errors: [] },
  };
  allPages.push(P);
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") P.rec.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => P.rec.errors.push(String(e?.stack ?? e).slice(0, 400)));
  await page.route("**/*", (route) => handle(P, route));
  await goEditor(P);
  return P;
}
async function goEditor(P) {
  const q = new URLSearchParams({ tool: P.tool, row: P.row });
  if (!P.cat) q.set("cat", "0");
  if (!P.live) q.set("live", "0");
  await P.page.goto(`${BASE}/probe-tmp/admin-guide?${q}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await hydrated(P);
}
async function hydrated(P) {
  await P.page.waitForSelector(ED, { timeout: 240000 });
  await P.page.waitForFunction(() => window.__probeHydrated, null, { timeout: 120000 });
  // `next dev`'s tools bubble again, after hydration (it covers corner buttons in screenshots).
  await P.page.addStyleTag({ content: "nextjs-portal{display:none!important;pointer-events:none!important}" }).catch(() => {});
  await sleep(150);
}
async function close(P) { await P.ctx.close().catch(() => {}); }

async function api(sid, params = {}) {
  const q = new URLSearchParams({ sid, ...params });
  const r = await fetch(`${BASE}/probe-tmp/admin-guide/calls?${q}`, { cache: "no-store" });
  return r.json();
}

async function shot(P, name, opts = {}) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, `${name}.png`);
  await P.page.screenshot({ path: file, fullPage: opts.fullPage ?? false, animations: "disabled" }).catch((e) => info("S", `screenshot ${name} failed: ${e.message}`));
  shots.push(file);
}

/* ── editor helpers ────────────────────────────────────────────────────── */

const L = (P) => {
  const p = P.page;
  const l = P.locale;
  return {
    card: p.locator("[data-tool-guide-admin]"),
    tutTitle: p.locator("[data-guide-tutorial-form] > div.grid input"),
    tutBody: p.locator("[data-guide-tutorial-form] > div.grid textarea"),
    steps: p.locator("[data-guide-step-form]"),
    step: (n) => p.locator(`[data-guide-step-form="${n}"]`),
    stepTitle: (n) => p.locator(`[data-guide-step-form="${n}"] input`),
    stepBody: (n) => p.locator(`[data-guide-step-form="${n}"] textarea`),
    /** The step card's "Aktualna ilustracja" block (data value photo | art). */
    stepIll: (n) => p.locator(`[data-guide-step-form="${n}"] [data-guide-step-illustration]`),
    changeIll: (n) => p.locator(`[data-guide-change-illustration="${n}"]`),
    stepPreview: (n) => p.locator(`[data-guide-step-preview="${n}"]`),
    // "Zmień ilustrację": the shared Modal holding the photo button and the drawings.
    chooser: p.locator('[role="dialog"][aria-modal="true"]').filter({ has: p.locator("[data-guide-illustration-chooser]") }),
    chooserPick: p.locator("[data-guide-illustration-chooser]").getByRole("button", { name: new RegExp(`^(${esc(A(l, "pickFromLibrary"))}|${esc(A(l, "changePhoto"))})$`) }),
    chooserRemovePhoto: p.locator("[data-guide-illustration-chooser]").getByRole("button", { name: A(l, "illustration.removePhoto"), exact: true }),
    chooserArt: (art) => p.locator(`[data-guide-illustration-chooser] [data-guide-art="${art}"]`),
    starterTitle: p.locator("[data-guide-starter-form] input"),
    starterBody: p.locator("[data-guide-starter-form] textarea"),
    lang: (code) => p.locator(`${ED} [role="group"][aria-label="${A(l, "lang.label")}"] button`).nth(LOCALES.indexOf(code)),
    switches: p.locator(`${ED} [role="switch"]`),
    tutSwitch: p.locator(`${ED} [role="switch"]`).nth(0),
    staSwitch: p.locator(`${ED} [role="switch"]`).nth(1),
    save: p.locator("[data-guide-save]"),
    status: p.locator(`${ED} span[aria-live="polite"]`),
    statusBlock: p.locator("[data-guide-status]"),
    version: p.locator("[data-guide-version]"),
    published: p.locator("[data-guide-published]"),
    savedAt: p.locator("[data-guide-saved-at]"),
    savedBy: p.locator("[data-guide-saved-by]"),
    savedNote: p.locator("[data-guide-saved-note]"),
    live: p.locator("[data-guide-live]"),
    notLive: p.locator("[data-guide-not-live]"),
    again: p.locator("[data-guide-show-again]"),
    againConfirm: p.locator(`[role="dialog"][aria-label="${A(l, "again.confirmTitle")}"]`),
    error: p.locator("[data-guide-error]"),
    conflict: p.locator("[data-guide-conflict]"),
    add: p.getByRole("button", { name: A(l, "step.add"), exact: true }),
    up: (n) => p.getByRole("button", { name: A(l, "step.up", { n }), exact: true }),
    down: (n) => p.getByRole("button", { name: A(l, "step.down", { n }), exact: true }),
    remove: (n) => p.getByRole("button", { name: A(l, "step.remove", { n }), exact: true }),
    removeConfirm: (n) => p.locator(`[role="dialog"][aria-label="${A(l, "step.removeConfirmTitle", { n })}"]`),
    stepClear: (n) => p.locator(`[data-guide-step-form="${n}"]`).getByRole("button", { name: A(l, "illustration.removePhoto"), exact: true }),
    starterPick: p.locator("[data-guide-starter-form]").getByRole("button", { name: new RegExp(`^(${esc(A(l, "pickFromLibrary"))}|${esc(A(l, "changePhoto"))})$`) }),
    starterClear: p.locator("[data-guide-starter-form]").getByRole("button", { name: A(l, "removePhoto"), exact: true }),
    picker: p.locator('[role="dialog"][aria-modal="true"]').filter({ has: p.locator("[data-picker-search]") }),
    previewTut: p.locator("[data-guide-preview-tutorial]"),
    previewSta: p.locator("[data-guide-preview-starter]"),
    starterPreview: p.locator("[data-guide-starter-preview]"),
    dialog: p.locator(DLG),
    reset: p.getByRole("button", { name: A(l, "resetDefaults"), exact: true }),
    confirm: p.locator(`[role="dialog"][aria-label="${A(l, "resetConfirmTitle")}"]`),
    serverBase: p.locator("[data-probe-server-base]"),
  };
};
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** A text field's state: value, aria-invalid, the inline problem, the counter. */
async function field(loc) {
  return loc.evaluate((el) => {
    const meta = document.getElementById(el.getAttribute("aria-describedby") || "");
    const counter = meta?.children[1];
    return {
      value: el.value, invalid: el.getAttribute("aria-invalid"),
      problem: meta?.children[0]?.textContent ?? null, counter: counter?.textContent ?? null,
      counterDanger: counter ? counter.className.includes("text-danger") : null, maxLength: el.maxLength,
    };
  });
}
/** Set a value the way a script (not a keyboard) would: bypasses maxLength. */
async function setRaw(loc, v) {
  await loc.evaluate((el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
}
const langMeta = async (P, code) => (await L(P).lang(code).locator("span").nth(1).textContent())?.trim();
const pressed = async (P, code) => (await L(P).lang(code).getAttribute("aria-pressed")) === "true";

/** The starter's PhotoControl: its own button opens the AssetPicker. */
async function pick(P, opener, key) {
  await opener.click();
  const dlg = L(P).picker;
  await dlg.waitFor({ state: "visible", timeout: 10000 });
  await dlg.locator(`[data-picker-item="${LIB[key].id}"]`).click();
  await dlg.waitFor({ state: "detached", timeout: 10000 });
}
/** A step's photo: "Zmień ilustrację" → the chooser's library button → the
 *  AssetPicker → the file. */
async function pickStep(P, n, key) {
  const E = L(P);
  await E.changeIll(n).click();
  await E.chooser.waitFor({ state: "visible", timeout: 10000 });
  await E.chooserPick.click();
  await E.chooser.waitFor({ state: "detached", timeout: 10000 });
  await E.picker.waitFor({ state: "visible", timeout: 10000 });
  await E.picker.locator(`[data-picker-item="${LIB[key].id}"]`).click();
  await E.picker.waitFor({ state: "detached", timeout: 10000 });
}
/** A drawing picked in step n's chooser. */
async function chooseArt(P, n, art) {
  const E = L(P);
  await E.changeIll(n).click();
  await E.chooser.waitFor({ state: "visible", timeout: 10000 });
  await E.chooserArt(art).click();
  await E.chooser.waitFor({ state: "detached", timeout: 10000 });
}
/** Delete step n through its confirm dialog. */
async function removeStep(P, n) {
  const E = L(P);
  await E.remove(n).click();
  const c = E.removeConfirm(n);
  await c.waitFor({ state: "visible", timeout: 10000 });
  await c.getByRole("button", { name: A(P.locale, "step.removeConfirm"), exact: true }).click();
  await c.waitFor({ state: "detached", timeout: 10000 });
}
/** Which library file a PhotoControl shows (by its thumbnail), or null. */
async function photoOf(loc) {
  return loc.evaluate((el) => {
    // PhotoControl's 48 px thumbnail (not the starter preview's pictures).
    const img = el.querySelector("span.h-12.w-12 img");
    return img ? new URL(img.getAttribute("src"), location.href).pathname : null;
  });
}
/** What step n's card shows as its current illustration: the photo's path, or null (a drawing). */
async function stepPhoto(P, n) {
  return L(P).stepIll(n).evaluate((el) => {
    const img = el.querySelector("img");
    return img ? new URL(img.getAttribute("src"), location.href).pathname : null;
  });
}
/** The drawing step n names ("Rysunek: <art>"), as the art key, or null. */
async function stepArtOf(P, n) {
  const cap = (await L(P).stepIll(n).locator("p").nth(1).textContent())?.trim() ?? "";
  for (const art of Object.keys(DICT[P.locale].aicc).filter((k) => k.startsWith("guide.art.")).map((k) => k.slice("guide.art.".length))) {
    if (cap === A(P.locale, "illustration.drawing", { name: A(P.locale, `art.${art}`) })) return art;
  }
  return null;
}
/** A sentence with {placeholders} as a pattern (formatInstant's output is not predicted). */
function pattern(s) {
  return new RegExp(`^${s.split(/(\{\w+\})/).map((part) => (/^\{\w+\}$/.test(part) ? ".+" : esc(part))).join("")}$`);
}
const versionShown = async (P) => Number((await L(P).version.textContent())?.trim());
const againHint = async (P) => P.page.evaluate(() => {
  const b = document.querySelector("[data-guide-show-again]");
  return document.getElementById(b?.getAttribute("aria-describedby") ?? "")?.textContent?.trim() ?? null;
});

/** Click "Zapisz i opublikuj" and wait for the stub's answer (and the refresh). */
async function save(P, { waitRefresh = true } = {}) {
  const before = (await api(P.sid)).calls.length;
  await L(P).save.click();
  await until(async () => (await api(P.sid)).answers.length > before, 30000);
  const st = await api(P.sid);
  await until(async () => (await L(P).save.textContent()) !== COMMON(P.locale, "saving"), 10000);
  if (waitRefresh) {
    const want = st.rows[P.tool]?.updated_at ?? "";
    await until(async () => (await L(P).serverBase.textContent()) === want, 15000);
  }
  await sleep(250);
  return { call: st.calls[before], answer: st.answers[before], row: st.rows[P.tool], st, n: st.calls.length - before };
}
/** Click save expecting the client to block it: no call reaches the action. */
async function saveBlocked(P) {
  const before = (await api(P.sid)).calls.length;
  await L(P).save.click();
  await sleep(900);
  const after = (await api(P.sid)).calls.length;
  return { blocked: after === before, error: (await L(P).error.count()) ? (await L(P).error.textContent()) : null };
}
const statusText = async (P) => (await L(P).status.textContent())?.trim();
const isDirty = async (P) => (await statusText(P)) === A(P.locale, "dirty");
const sameInstant = (a, b) => a !== null && b !== null && a !== undefined && b !== undefined && Date.parse(a) === Date.parse(b);

/** Text problems: raw keys, undefined/NaN, humanised fallbacks of missing keys. */
function humanize(key) {
  const last = key.split(".").filter(Boolean).pop() ?? key;
  const w = last.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : key;
}
function humanizedFor(l) {
  const keys = [
    ...Object.keys(DICT.pl.aicc).filter((k) => k.startsWith("guide.")).map((k) => `aicc.${k}`),
    ...Object.keys(DICT.pl.toolGuide).map((k) => `toolGuide.${k}`),
    ...["search", "upload", "dropHint", "emptyBody", "noMatchesBody"].map((k) => `media.${k}`),
    ...["close", "cancel", "saving"].map((k) => `common.${k}`),
  ];
  const values = new Set(keys.map((k) => {
    const [ns, ...rest] = k.split(".");
    const tail = rest.join(".");
    return ns === "aicc" ? DICT[l].aicc[tail] : DICT[l][ns]?.[tail];
  }).filter(Boolean));
  return [...new Set(keys.map(humanize))].filter((h) => !values.has(h));
}
async function textProblems(P, scope = "[data-tool-guide-admin]") {
  return P.page.evaluate(({ scope, hum }) => {
    const out = [];
    const H = new Set(hum);
    const RAW = /\b(aicc|toolGuide|toolGuideDefaults|media|common)\.[A-Za-z_]+[A-Za-z_.]*/;
    const BAD = /\bundefined\b|\bNaN\b|\[object Object\]|\{(n|max|next|lang|langs|total)\}|\bnull\b/;
    for (const root of document.querySelectorAll(scope)) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const s = n.textContent.trim();
        if (!s) continue;
        if (RAW.test(s)) out.push(`raw key: "${s}"`);
        if (BAD.test(s)) out.push(`bad text: "${s}"`);
        if (H.has(s) || H.has(s.split(" · ")[0])) out.push(`humanised (missing) key: "${s}"`);
      }
      for (const el of root.querySelectorAll("[aria-label],[title],[placeholder],[alt]")) {
        for (const a of ["aria-label", "title", "placeholder", "alt"]) {
          const v = el.getAttribute(a);
          if (v === null) continue;
          if (RAW.test(v) || BAD.test(v)) out.push(`${a}="${v}"`);
          if (H.has(v)) out.push(`humanised ${a}="${v}"`);
        }
      }
    }
    return out;
  }, { scope, hum: humanizedFor(P.locale) });
}

/** Tutorial dialog contents: title, counter, every step's title/image/art. */
async function dialogState(P) {
  return P.page.evaluate((sel) => {
    const d = document.querySelector(sel);
    if (!d) return null;
    const own = (el) => [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join("").trim();
    return {
      title: d.querySelector("h2")?.textContent?.trim() ?? null,
      intro: d.querySelector("h2 + p")?.textContent?.trim() ?? null,
      counter: d.querySelector("[data-guide-counter]")?.textContent?.trim() ?? null,
      steps: [...d.querySelectorAll("[data-guide-step]")].map((s) => ({
        title: own(s.querySelector("h3")),
        img: s.querySelector("img") ? new URL(s.querySelector("img").getAttribute("src"), location.href).pathname : null,
        art: Boolean(s.querySelector("svg")),
        body: s.querySelector("p")?.textContent?.trim() ?? "",
      })),
      next: d.querySelector("[data-guide-next]")?.textContent?.trim() ?? null,
      skip: d.querySelector("[data-guide-skip]")?.textContent?.trim() ?? null,
      overline: d.querySelector("p.overline")?.textContent?.trim() ?? null,
    };
  }, DLG);
}

const shouldRun = (id) => !ONLY || ONLY.has(String(id));

/* ── 1. RENDERS ────────────────────────────────────────────────────────── */

async function group1() {
  console.log("\n[1] renders for each tool with the shipped defaults, PL/EN/DE labels");
  for (const tool of [...TOOLS, ...NO_STARTER]) {
    const starter = hasStarter(tool);
    for (const l of LOCALES) {
      const P = await openEditor({ tool, locale: l });
      const E = L(P);
      const n = ARTS[tool].length;
      const tag = `${tool}/${l}`;
      check(1, `${tag}: ${n} default steps rendered (DEFAULT_STEP_ARTS.${tool})`, (await E.steps.count()) === n, { got: await E.steps.count(), want: n });
      const text = (await E.card.textContent()).replace(/\s+/g, " ");
      const want = [
        A(l, "title"), A(l, "sub"), A(l, "settings.heading"),
        A(l, "status.heading"), A(l, "status.publication"), A(l, "status.neverSaved"), A(l, "status.copy"), A(l, "usingDefault"),
        A(l, "status.version"), A(l, "status.steps"), A(l, "status.customers"), A(l, "status.live"),
        A(l, "status.neverSavedHint"), A(l, "status.liveHint"), A(l, "again.button"), A(l, "again.hint", { n: 1, next: 2 }),
        A(l, "tutorialEnabled"), A(l, "tutorialEnabledHint"), A(l, "lang.label"),
        A(l, "lang.required"), A(l, "lang.optional"), A(l, "lang.hint"), A(l, "tutorial.heading"),
        A(l, "preview.tutorial"), `${A(l, "tutorial.title")} · PL`, `${A(l, "tutorial.body")} · PL`,
        A(l, "steps.heading", { n, max: MAX_STEPS }), A(l, "step.label", { n: 1 }), `${A(l, "step.title")} · PL`,
        `${A(l, "step.body")} · PL`, A(l, "illustration.current"), A(l, "illustration.change"),
        A(l, "illustration.drawing", { name: A(l, `art.${ARTS[tool][0]}`) }),
        A(l, "step.add"), A(l, "starter.heading"),
        ...(starter ? [
          A(l, "starterEnabled"), A(l, "starterEnabledHint"), A(l, "preview.starter"),
          `${A(l, "starter.title")} · PL`, A(l, "starter.image"), A(l, "starter.usingCatalogue"),
          A(l, "starter.fallbackNote"), A(l, "pickFromLibrary"),
        ] : [A(l, "starter.none")]),
        A(l, "resetDefaults"), A(l, "clean"), A(l, "save"), A(l, "required"), A(l, "optional"),
      ].map((s) => s.replace(/\s+/g, " "));
      const missing = want.filter((s) => !text.includes(s));
      check(1, `${tag}: every expected aicc.guide label is on screen in ${l.toUpperCase()}`, missing.length === 0, missing);
      check(1, `${tag}: status block — version 1, ${n} steps, live`, (await versionShown(P)) === 1
        && (await E.statusBlock.textContent()).includes(A(l, "status.steps")) && (await E.live.getAttribute("data-guide-live")) === "yes",
        { version: await E.version.textContent(), live: await E.live.getAttribute("data-guide-live") });
      // The arts each step card draws, as the shipped tutorial has them.
      const arts = await Promise.all(Array.from({ length: n }, (_, i) => stepArtOf(P, i + 1)));
      check(1, `${tag}: each step card shows its shipped drawing (${ARTS[tool].join(", ")}) in the tutorial's frame`,
        JSON.stringify(arts) === JSON.stringify(ARTS[tool])
        && (await P.page.locator('[data-guide-step-illustration="art"] div[class*="aspect-[16/10]"]').evaluateAll((els) => els.filter((e) => e.querySelector("svg") && !e.querySelector("img")).length)) === n, arts);
      // The shipped copy, per language tab.
      for (const code of LOCALES) {
        if (code !== "pl") await E.lang(code).click();
        const vals = {
          tt: await E.tutTitle.inputValue(), tb: await E.tutBody.inputValue(),
          ...(starter ? { st: await E.starterTitle.inputValue(), sb: await E.starterBody.inputValue() } : {}),
          steps: await Promise.all(Array.from({ length: n }, (_, i) => E.stepTitle(i + 1).inputValue())),
        };
        const exp = {
          tt: shipped(code, tool, "tutorial.title"), tb: shipped(code, tool, "tutorial.body"),
          ...(starter ? { st: shipped(code, tool, "starter.title"), sb: shipped(code, tool, "starter.body") } : {}),
          steps: Array.from({ length: n }, (_, i) => defStepTitle(code, tool, i + 1)),
        };
        check(1, `${tag}: form holds the shipped ${code.toUpperCase()} copy (titles, bodies, ${n} step titles)`,
          JSON.stringify(vals) === JSON.stringify(exp), { vals, exp });
        const lbl = await E.tutTitle.evaluate((el) => el.labels?.[0]?.textContent ?? "");
        check(1, `${tag}: field labels follow the edited language (${code.toUpperCase()})`, lbl === `${A(l, "tutorial.title")} · ${code.toUpperCase()}`, lbl);
        if (code !== "pl") {
          const hint = await E.tutTitle.evaluate((el) => el.closest("div")?.querySelector("span.text-faint")?.textContent ?? "");
          check(1, `${tag}: ${code.toUpperCase()} tab hints "${A(l, "fallbackPl")}"`, hint === A(l, "fallbackPl"), hint);
        }
      }
      await E.lang("pl").click();
      if (!starter) {
        const ns = {
          switches: await E.switches.count(),
          starterInputs: await P.page.locator("[data-guide-starter-form] input, [data-guide-starter-form] textarea").count(),
          previewSta: await E.previewSta.count(),
          starterButtons: await P.page.locator("[data-guide-starter-form] button").count(),
          none: (await P.page.locator('[data-guide-starter-form="none"]').textContent().catch(() => ""))?.replace(/\s+/g, " ").trim(),
          leaked: [A(l, "starterEnabled"), A(l, "starter.image"), A(l, "starter.fallbackNote"), A(l, "preview.starter"), `${A(l, "starter.title")} · `]
            .filter((s) => text.includes(s)),
        };
        check(1, `${tag}: NO starter controls — one switch (tutorial), no starter fields/picture/preview, only the "${A(l, "starter.none").slice(0, 40)}…" note`,
          ns.switches === 1 && ns.starterInputs === 0 && ns.previewSta === 0 && ns.starterButtons === 0
          && ns.none === `${A(l, "starter.heading")}${A(l, "starter.none")}`.replace(/\s+/g, " ") && ns.leaked.length === 0, ns);
      } else {
        check(1, `${tag}: two switches (tutorial, starter) and the starter form`, (await E.switches.count()) === 2 && (await E.starterTitle.count()) === 1);
      }
      const probs = await textProblems(P);
      check(1, `${tag}: no raw keys / "undefined" / humanised missing keys`, probs.length === 0, probs.slice(0, 8));
      check(1, `${tag}: save starts disabled (nothing to save)`, await E.save.isDisabled());
      if (l === "pl" && !starter) await shot(P, `1-${tool}-1440-light-pl`, { fullPage: true });
      await close(P);
    }
  }
}

/* ── Z. NO-STARTER TOOLS ───────────────────────────────────────────────── */

async function groupZ() {
  console.log("\n[Z] the four tools without a results gallery");
  for (const tool of NO_STARTER) {
    const P = await openEditor({ tool, row: "none" });
    const E = L(P);
    const l = P.locale;
    const n = ARTS[tool].length;
    check("Z", `${tool}: tutorial switch starts on; no starter switch`, (await E.switches.count()) === 1 && (await E.tutSwitch.getAttribute("aria-checked")) === "true");
    // The tutorial preview works on these screens too.
    await E.previewTut.click();
    await E.dialog.waitFor();
    const d = await dialogState(P);
    check("Z", `${tool}: preview opens the TutorialModal with ${n} steps ("${TG(l, "counter", { n: 1, total: n })}") and the shipped title`,
      d?.counter === TG(l, "counter", { n: 1, total: n }) && d?.steps?.length === n && d?.title === shipped("pl", tool, "tutorial.title"), d && { counter: d.counter, steps: d.steps.length, title: d.title });
    await P.page.keyboard.press("Escape");
    await E.dialog.waitFor({ state: "detached" });
    // An edit to the copy saves; the hidden starter copy goes as it was (the
    // validator's Polish starter title is never the admin's problem here).
    await E.tutTitle.fill(`Samouczek ${tool} (probe)`);
    await pickStep(P, 2, "B");
    const r = await save(P);
    check("Z", `${tool}: save ok; payload starterEnabled=false (as it was), images.starter=null, step 2 = B, length ${n}`,
      r.answer?.ok === true && r.call?.starterEnabled === false && r.call?.images?.starter === null
      && r.call?.images?.steps?.[1] === LIB.B.id && r.call?.images?.steps?.length === n, { answer: r.answer, call: r.call && { starterEnabled: r.call.starterEnabled, images: r.call.images } });
    check("Z", `${tool}: payload content has the edited title and the shipped (hidden) starter copy, untouched`,
      r.call?.content?.tutorial?.title?.pl === `Samouczek ${tool} (probe)` && r.call?.content?.starter?.title?.pl === shipped("pl", tool, "starter.title"),
      { tutorial: r.call?.content?.tutorial?.title, starter: r.call?.content?.starter?.title });
    check("Z", `${tool}: stub row written with starter_enabled=false`, r.row?.starter_enabled === false && r.row?.tutorial_enabled === true, r.row);
    // Switching the tutorial off on such a tool: the one switch, the one flag.
    await E.tutSwitch.click();
    const q = await save(P);
    check("Z", `${tool}: tutorial switched off → payload tutorialEnabled=false, starterEnabled=false`, q.call?.tutorialEnabled === false && q.call?.starterEnabled === false && q.answer?.ok === true, q.call);
    check("Z", `${tool}: …and "${A(l, "again.button")}" is disabled with the 'switched off' hint`,
      (await E.again.isDisabled()) && (await againHint(P)) === A(l, "again.offHint"), { disabled: await E.again.isDisabled(), hint: await againHint(P) });
    await close(P);
  }
}

/* ── S. STATUS BLOCK ───────────────────────────────────────────────────── */

async function groupS() {
  console.log("\n[S] status block");
  for (const l of ["pl", "de"]) {
    // Never saved, live.
    {
      const P = await openEditor({ tool: "retouch", row: "none", locale: l });
      const E = L(P);
      const sb = (await E.statusBlock.textContent()).replace(/\s+/g, " ");
      check("S", `[${l}] no row: "${A(l, "status.neverSaved")}", no last-saved line, the never-saved hint, "${A(l, "usingDefault")}", version 1, 4 steps, "${A(l, "status.live")}" + live hint`,
        sb.includes(A(l, "status.neverSaved")) && (await E.savedAt.count()) === 0 && sb.includes(A(l, "status.neverSavedHint"))
        && sb.includes(A(l, "usingDefault")) && (await versionShown(P)) === 1 && sb.includes(`${A(l, "status.steps")}4`)
        && (await E.live.getAttribute("data-guide-live")) === "yes" && sb.includes(A(l, "status.liveHint")) && (await E.notLive.count()) === 0, sb);
      check("S", `[${l}] the published line is empty before any write of this session`, ((await E.published.textContent()) ?? "").trim() === "");
      await E.add.click();
      check("S", `[${l}] steps count follows the form (add → 5) and the copy badge flips to "${A(l, "usingCustom")}"`,
        (await E.statusBlock.textContent()).replace(/\s+/g, " ").includes(`${A(l, "status.steps")}5`) && (await E.statusBlock.textContent()).includes(A(l, "usingCustom")));
      await E.stepTitle(5).fill("Krok piąty (probe)");
      const r = await save(P);
      const pub = ((await E.published.textContent()) ?? "").trim();
      check("S", `[${l}] after a save: "${A(l, "status.saved")}", last saved = the answer's time, by "Probe Admin", the published line "${A(l, "status.publishedAt").replace("{when}", "…")}", the saved note`,
        r.answer?.ok === true && (await E.statusBlock.textContent()).includes(A(l, "status.saved"))
        && sameInstant(await E.savedAt.getAttribute("datetime"), r.answer.data.updatedAt)
        && ((await E.savedBy.textContent()) ?? "").trim() === A(l, "status.by", { name: "Probe Admin" })
        && pattern(A(l, "status.publishedAt")).test(pub) && pattern(A(l, "status.publishedShort")).test(((await E.savedNote.textContent()) ?? "").trim()),
        { pub, savedAt: await E.savedAt.getAttribute("datetime"), by: await E.savedBy.textContent().catch(() => null), answer: r.answer });
      await shot(P, `S-status-after-save-1440-light-${l}`);
      await close(P);
    }
    // A saved custom row, not live (switchboard "Wkrótce").
    {
      const P = await openEditor({ tool: "fashion_flat_lay", row: "custom", locale: l, live: false });
      const E = L(P);
      const sb = (await E.statusBlock.textContent()).replace(/\s+/g, " ");
      check("S", `[${l}] saved custom row: "${A(l, "status.saved")}", saved at 2026-10-01T08:00:00.111111, by Probe Admin, "${A(l, "usingCustom")}", version 3, 3 steps, no never-saved hint`,
        sb.includes(A(l, "status.saved")) && sameInstant(await E.savedAt.getAttribute("datetime"), "2026-10-01T08:00:00.111111+00:00")
        && ((await E.savedBy.textContent()) ?? "").trim() === A(l, "status.by", { name: "Probe Admin" })
        && sb.includes(A(l, "usingCustom")) && (await versionShown(P)) === 3 && sb.includes(`${A(l, "status.steps")}3`) && !sb.includes(A(l, "status.neverSavedHint")), sb);
      const nl = ((await E.notLive.textContent()) ?? "").trim();
      check("S", `[${l}] not live: "${A(l, "status.notLive")}" badge and the status sentence naming "Wkrótce"`,
        (await E.live.getAttribute("data-guide-live")) === "no" && (await E.live.textContent()).includes(A(l, "status.notLive"))
        && nl === A(l, "status.notLiveStatus", { status: "Wkrótce" }) && !sb.includes(A(l, "status.liveHint")), { nl });
      await shot(P, `S-status-not-live-1440-light-${l}`);
      await close(P);
    }
  }
}

/* ── 2. SWITCHES ───────────────────────────────────────────────────────── */

async function group2() {
  console.log("\n[2] switches");
  const P = await openEditor({ tool: "retouch", row: "none" });
  const E = L(P);
  const l = P.locale;
  check(2, "both switches start on (no saved row)",
    (await E.tutSwitch.getAttribute("aria-checked")) === "true" && (await E.staSwitch.getAttribute("aria-checked")) === "true");
  await E.tutSwitch.click();
  check(2, "tutorial switch → aria-checked=false, the 'switched off' note appears",
    (await E.tutSwitch.getAttribute("aria-checked")) === "false"
    && (await P.page.getByText(A(l, "preview.offTutorial"), { exact: true }).count()) === 1);
  check(2, "a switch alone makes the form dirty and the save enabled", (await isDirty(P)) && !(await E.save.isDisabled()));
  let r = await save(P);
  check(2, "payload: tutorialEnabled=false, starterEnabled=true, content=null (copy untouched)",
    r.call?.tutorialEnabled === false && r.call?.starterEnabled === true && r.call?.content === null, r.call);
  check(2, "answer ok and the form is clean again", r.answer?.ok === true && !(await isDirty(P)), { answer: r.answer, status: await statusText(P) });
  await E.staSwitch.click();
  check(2, "starter switch → the 'switched off' note appears",
    (await P.page.getByText(A(l, "preview.offStarter"), { exact: true }).count()) === 1);
  r = await save(P);
  check(2, "payload: tutorialEnabled=false, starterEnabled=false", r.call?.tutorialEnabled === false && r.call?.starterEnabled === false, r.call);
  await E.tutSwitch.click();
  await E.staSwitch.click();
  r = await save(P);
  check(2, "payload after both back on: true/true", r.call?.tutorialEnabled === true && r.call?.starterEnabled === true, r.call);
  await close(P);

  const Q = await openEditor({ tool: "compress", row: "off" });
  const F = L(Q);
  check(2, "saved row 'switched off': both switches load off, both notes shown, version 2",
    (await F.tutSwitch.getAttribute("aria-checked")) === "false" && (await F.staSwitch.getAttribute("aria-checked")) === "false"
    && (await Q.page.getByText(A(l, "preview.offTutorial"), { exact: true }).count()) === 1
    && (await Q.page.getByText(A(l, "preview.offStarter"), { exact: true }).count()) === 1
    && (await versionShown(Q)) === 2);
  await F.staSwitch.click();
  r = await save(Q);
  check(2, "row 'off' → starter on: payload tutorialEnabled=false, starterEnabled=true, base = the saved row's updated_at",
    r.call?.tutorialEnabled === false && r.call?.starterEnabled === true && r.call?.base === "2026-10-02T09:30:00.222222+00:00", r.call);
  await close(Q);
}

/* ── 3. TEXT PER LANGUAGE ──────────────────────────────────────────────── */

async function group3() {
  console.log("\n[3] text per language, validation");
  const tool = "fashion_flat_lay";
  const P = await openEditor({ tool, row: "none" });
  const E = L(P);
  const l = P.locale;

  await E.tutTitle.fill("Probe PL tytuł");
  check(3, "editing copy flips the badge to 'custom copy'", (await E.card.textContent()).includes(A(l, "usingCustom")));
  await E.lang("en").click();
  check(3, "EN tab shows the EN shipped title", (await E.tutTitle.inputValue()) === shipped("en", tool, "tutorial.title"));
  await E.tutTitle.fill("Probe EN title");
  await E.stepBody(1).fill("EN body 1");
  await E.lang("de").click();
  check(3, "DE tab shows the DE shipped title", (await E.tutTitle.inputValue()) === shipped("de", tool, "tutorial.title"));
  await E.tutTitle.fill("Probe DE Titel");
  await E.starterTitle.fill("DE Startgalerie (probe)");
  await E.lang("pl").click();
  check(3, "back on PL the PL edit is still there", (await E.tutTitle.inputValue()) === "Probe PL tytuł");
  let r = await save(P);
  const c = r.call?.content;
  check(3, "payload content.tutorial.title = {pl, en, de} exactly as typed",
    JSON.stringify(c?.tutorial?.title) === JSON.stringify({ pl: "Probe PL tytuł", en: "Probe EN title", de: "Probe DE Titel" }), c?.tutorial?.title);
  check(3, "payload: EN step-1 body is the edit, other locales keep the shipped copy",
    c?.tutorial?.steps?.[0]?.body?.en === "EN body 1" && c?.tutorial?.steps?.[0]?.body?.pl === shipped("pl", tool, "tutorial.steps.s1.body")
    && c?.tutorial?.steps?.[1]?.title?.de === defStepTitle("de", tool, 2), c?.tutorial?.steps?.[0]);
  check(3, "payload: DE starter title edited, PL starter title shipped",
    c?.starter?.title?.de === "DE Startgalerie (probe)" && c?.starter?.title?.pl === shipped("pl", tool, "starter.title"), c?.starter?.title);
  check(3, "answer ok", r.answer?.ok === true, r.answer);

  // Required: the Polish title.
  await E.tutTitle.fill("");
  let f = await field(E.tutTitle);
  check(3, "empty PL title → inline 'required' message + aria-invalid", f.problem === A(l, "problem.required") && f.invalid === "true", f);
  check(3, "language switch marks PL 'needs fixing'", (await langMeta(P, "pl")) === A(l, "lang.hasErrors"), await langMeta(P, "pl"));
  let b = await saveBlocked(P);
  check(3, "save blocked (no call) with the invalid_required sentence + 'fix (PL)'",
    b.blocked && b.error === `${A(l, "error.invalid_required")} ${A(l, "fixErrors", { langs: "PL" })}`, b);
  await E.lang("en").click();
  f = await field(E.tutTitle);
  check(3, "EN title is optional: no inline error on EN, EN meta 'optional', PL still marked",
    f.problem === "" && f.invalid === null && (await langMeta(P, "en")) === A(l, "lang.optional") && (await langMeta(P, "pl")) === A(l, "lang.hasErrors"),
    { f, en: await langMeta(P, "en"), pl: await langMeta(P, "pl") });
  await E.tutTitle.fill("");
  check(3, "an empty EN title is not an error (falls back to PL)", (await field(E.tutTitle)).problem === "");
  b = await saveBlocked(P);
  check(3, "saving from the EN tab with a PL problem switches the editor to PL", b.blocked && (await pressed(P, "pl")), b);
  await E.tutTitle.fill("Probe PL tytuł");
  check(3, "PL problem fixed → no language marked", (await langMeta(P, "pl")) === A(l, "lang.required"));

  // Limits: typing past the limit, and a value set past it by a script.
  const max = LIMITS.tutorialTitle;
  await E.tutTitle.fill("");
  await E.tutTitle.pressSequentially("x".repeat(max + 10), { delay: 0 });
  f = await field(E.tutTitle);
  check(3, `typing ${max + 10} chars into the PL title stops at ${max} (maxLength refuses the rest)`,
    f.value.length === max && f.maxLength === max && f.counter === A(l, "counter", { n: max, max }) && f.problem === "", f);
  await E.tutTitle.fill("y".repeat(max + 5));
  f = await field(E.tutTitle);
  info(3, `fill() of ${max + 5} chars kept ${f.value.length} chars`);
  await setRaw(E.tutTitle, "z".repeat(max + 1));
  f = await field(E.tutTitle);
  check(3, `a value past the limit (set by script) → inline too_long "max ${max}", red counter ${max + 1}/${max}`,
    f.problem === A(l, "problem.too_long", { max }) && f.counterDanger === true && f.counter === A(l, "counter", { n: max + 1, max }), f);
  b = await saveBlocked(P);
  check(3, "…and save is blocked with invalid_too_long", b.blocked && b.error?.startsWith(A(l, "error.invalid_too_long")), b);
  await setRaw(E.stepBody(2), "w".repeat(LIMITS.stepBody + 1));
  f = await field(E.stepBody(2));
  check(3, `step body limit is ${LIMITS.stepBody} (inline message names it)`, f.problem === A(l, "problem.too_long", { max: LIMITS.stepBody }), f);
  await E.stepBody(2).fill(shipped("pl", tool, "tutorial.steps.s2.body"));
  await E.tutTitle.fill("Probe PL tytuł");

  // Markup and invisible characters.
  await E.tutTitle.fill("Tytuł <b>pogrubiony</b>");
  f = await field(E.tutTitle);
  check(3, "markup <b> → inline 'markup' message", f.problem === A(l, "problem.markup") && f.invalid === "true", f);
  b = await saveBlocked(P);
  check(3, "…save blocked with invalid_markup", b.blocked && b.error?.startsWith(A(l, "error.invalid_markup")), b);
  await E.tutTitle.fill("Tytuł​niewidoczny");
  f = await field(E.tutTitle);
  check(3, "U+200B → inline 'invisible' message", f.problem === A(l, "problem.invisible") && f.invalid === "true", f);
  b = await saveBlocked(P);
  check(3, "…save blocked with invalid_invisible", b.blocked && b.error?.startsWith(A(l, "error.invalid_invisible")), b);
  await E.tutTitle.fill("Probe PL tytuł");

  // A problem in another language: marked on the switch, reported by save.
  await E.lang("en").click();
  await E.stepBody(2).fill("<i>x</i>");
  await E.lang("pl").click();
  check(3, "EN problem while on PL: EN marked 'needs fixing', PL fields show no error",
    (await langMeta(P, "en")) === A(l, "lang.hasErrors") && (await field(E.stepBody(2))).problem === "",
    { en: await langMeta(P, "en") });
  b = await saveBlocked(P);
  check(3, "save blocked, message names EN, the editor moves to the EN tab",
    b.blocked && b.error === `${A(l, "error.invalid_markup")} ${A(l, "fixErrors", { langs: "EN" })}` && (await pressed(P, "en")), b);
  await E.stepBody(2).fill("");
  check(3, "cleared EN field → no language marked", (await langMeta(P, "en")) === A(l, "lang.optional"));
  r = await save(P);
  check(3, "valid again → saved; an emptied EN field is simply absent from the (normalised) payload",
    r.answer?.ok === true && r.call?.content?.tutorial?.steps?.[1]?.body && !("en" in r.call.content.tutorial.steps[1].body),
    r.call?.content?.tutorial?.steps?.[1]?.body);
  await close(P);

  // The same messages in the German UI.
  const Q = await openEditor({ tool: "retouch", row: "none", locale: "de" });
  const G = L(Q);
  await G.tutTitle.fill("");
  check(3, "DE UI: required message in German", (await field(G.tutTitle)).problem === A("de", "problem.required"));
  await G.tutTitle.fill("a > b");
  check(3, "DE UI: markup message in German", (await field(G.tutTitle)).problem === A("de", "problem.markup"));
  await setRaw(G.tutTitle, "q".repeat(LIMITS.tutorialTitle + 3));
  check(3, "DE UI: too_long message in German", (await field(G.tutTitle)).problem === A("de", "problem.too_long", { max: LIMITS.tutorialTitle }));
  await G.tutTitle.fill("Ein​Titel");
  check(3, "DE UI: invisible message in German", (await field(G.tutTitle)).problem === A("de", "problem.invisible"));
  await close(Q);
}

/* ── 4. STEPS ──────────────────────────────────────────────────────────── */

async function group4() {
  console.log("\n[4] steps");
  {
    const tool = "ecommerce_thumbnail";
    const P = await openEditor({ tool, row: "none" });
    const E = L(P);
    const l = P.locale;
    const n0 = ARTS[tool].length;
    check(4, "first step: 'up' disabled; last step: 'down' disabled; remove enabled; every card has its own preview button",
      (await E.up(1).isDisabled()) && (await E.down(n0).isDisabled()) && !(await E.remove(1).isDisabled()) && !(await E.down(1).isDisabled())
      && (await P.page.locator("[data-guide-step-preview]").count()) === n0);
    while ((await E.steps.count()) < MAX_STEPS) await E.add.click();
    check(4, `add up to ${MAX_STEPS}: add disabled, 'max reached' shown, heading ${MAX_STEPS} of ${MAX_STEPS}`,
      (await E.steps.count()) === MAX_STEPS && (await E.add.isDisabled())
      && (await E.card.textContent()).includes(A(l, "step.maxReached", { max: MAX_STEPS }))
      && (await E.card.textContent()).includes(A(l, "steps.heading", { n: MAX_STEPS, max: MAX_STEPS })));
    const f = await field(E.stepTitle(MAX_STEPS));
    check(4, "a new step: empty title flagged 'required' (PL), its card shows the 'settings' drawing, no photo",
      f.value === "" && f.problem === A(l, "problem.required") && (await stepArtOf(P, MAX_STEPS)) === "settings"
      && (await E.stepIll(MAX_STEPS).getAttribute("data-guide-step-illustration")) === "art" && (await stepPhoto(P, MAX_STEPS)) === null, f);
    await E.add.click({ force: true }).catch(() => {});
    check(4, `a click on the disabled add button does not make a ${MAX_STEPS + 1}th step`, (await E.steps.count()) === MAX_STEPS);

    // DELETE ASKS FIRST: cancel, Escape and the X keep the step.
    await E.stepTitle(MAX_STEPS).fill("Do usunięcia (probe)");
    await E.remove(MAX_STEPS).click();
    const c = E.removeConfirm(MAX_STEPS);
    await c.waitFor({ state: "visible", timeout: 10000 });
    const cfm = await P.page.evaluate((lbl) => {
      const d = document.querySelector(`[role="dialog"][aria-label="${lbl}"]`);
      const btns = [...(d?.querySelectorAll("button") ?? [])].map((b) => ({ text: b.textContent.trim(), aria: b.getAttribute("aria-label"), cls: b.className }));
      return { parentIsBody: d?.parentElement === document.body, modal: d?.getAttribute("aria-modal"), text: d?.textContent ?? "", btns };
    }, A(l, "step.removeConfirmTitle", { n: MAX_STEPS }));
    check(4, `delete asks first: a portalled confirm "${A(l, "step.removeConfirmTitle", { n: MAX_STEPS })}" with its body, "${COMMON(l, "cancel")}" and a danger "${A(l, "step.removeConfirm")}"`,
      cfm.parentIsBody && cfm.modal === "true" && cfm.text.includes(A(l, "step.removeConfirmBody"))
      && cfm.btns.some((b) => b.text === COMMON(l, "cancel")) && cfm.btns.some((b) => b.text === A(l, "step.removeConfirm")), cfm);
    check(4, "…while it is open the step is still there", (await E.steps.count()) === MAX_STEPS);
    await c.getByRole("button", { name: COMMON(l, "cancel"), exact: true }).click();
    await c.waitFor({ state: "detached" });
    check(4, "cancel → the step stays (6 steps, its title kept)", (await E.steps.count()) === MAX_STEPS && (await E.stepTitle(MAX_STEPS).inputValue()) === "Do usunięcia (probe)");
    await E.remove(MAX_STEPS).click();
    await c.waitFor({ state: "visible" });
    await P.page.keyboard.press("Escape");
    await c.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    check(4, "Escape → the confirm closes, the step stays", (await c.count()) === 0 && (await E.steps.count()) === MAX_STEPS);
    await E.remove(MAX_STEPS).click();
    await c.waitFor({ state: "visible" });
    await c.getByRole("button", { name: COMMON(l, "close"), exact: true }).click();
    await c.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    check(4, "the confirm's X → the step stays", (await c.count()) === 0 && (await E.steps.count()) === MAX_STEPS);
    // The confirm names the RIGHT step: delete step 2 of 6, the others close up.
    const t3 = await E.stepTitle(3).inputValue();
    await removeStep(P, 2);
    check(4, "confirm on step 2 → step 2 removed, the old step 3 is now step 2", (await E.steps.count()) === MAX_STEPS - 1 && (await E.stepTitle(2).inputValue()) === t3,
      { count: await E.steps.count(), now2: await E.stepTitle(2).inputValue(), was3: t3 });
    while ((await E.steps.count()) > 1) await removeStep(P, await E.steps.count());
    check(4, "remove down to 1: remove/up/down disabled on the last remaining step",
      (await E.steps.count()) === 1 && (await E.remove(1).isDisabled()) && (await E.up(1).isDisabled()) && (await E.down(1).isDisabled()));
    const r = await save(P);
    check(4, "1-step save: content has 1 step, images.steps has length 1",
      r.answer?.ok === true && r.call?.content?.tutorial?.steps?.length === 1 && r.call?.images?.steps?.length === 1, { answer: r.answer, steps: r.call?.images?.steps });
    await close(P);
  }

  // CRUCIAL: pictures are stored BY POSITION — every move must carry them.
  const tool = "retouch";
  const P = await openEditor({ tool, row: "none" });
  const E = L(P);
  const t = (i) => defStepTitle("pl", tool, i);
  const ART = ARTS[tool];
  /** The model: [title, art, picture] per position, as the payload must carry it. */
  let model = [1, 2, 3, 4].map((i) => ({ title: t(i), art: ART[i - 1], img: null }));
  const expectSave = async (label, contentNull = false) => {
    const prev = (await api(P.sid)).answers.filter((a) => a.ok).pop();
    const r = await save(P);
    const steps = r.call?.images?.steps;
    const want = model.map((m) => (m.img ? LIB[m.img].id : null));
    check(4, `${label}: images.steps = [${names(want)}] (length ${model.length})`,
      JSON.stringify(steps) === JSON.stringify(want), { got: names(steps), want: names(want) });
    if (contentNull) check(4, `${label}: pictures only → content stays null (the shipped copy)`, r.call?.content === null, r.call?.content);
    else {
      const titles = r.call?.content?.tutorial?.steps?.map((s) => s.title.pl);
      const arts = r.call?.content?.tutorial?.steps?.map((s) => s.art);
      check(4, `${label}: each picture sits with its step's title and art`,
        JSON.stringify(titles) === JSON.stringify(model.map((m) => m.title)) && JSON.stringify(arts) === JSON.stringify(model.map((m) => m.art)),
        { titles, arts, want: model });
    }
    check(4, `${label}: answer ok`, r.answer?.ok === true, r.answer);
    if (prev) check(7, `${label}: base = the updatedAt the previous save answered`, r.call?.base === prev.data.updatedAt, { base: r.call?.base, prev: prev.data.updatedAt });
    return r;
  };
  await pickStep(P, 1, "A"); model[0].img = "A";
  await pickStep(P, 3, "B"); model[2].img = "B";
  await expectSave("assign A→1, B→3", true);
  await E.down(1).click(); [model[0], model[1]] = [model[1], model[0]];
  await expectSave("step 1 moved down");
  await E.up(3).click(); [model[1], model[2]] = [model[2], model[1]];
  await expectSave("step 3 moved up");
  await removeStep(P, 1); model.splice(0, 1);
  await expectSave("step 1 removed (confirmed)");
  await E.add.click(); model.push({ title: "Nowy krok (probe)", art: "settings", img: null });
  await E.stepTitle(4).fill("Nowy krok (probe)");
  await pickStep(P, 4, "C"); model[3].img = "C";
  await E.up(4).click(); [model[2], model[3]] = [model[3], model[2]];
  await expectSave("new step 4 with C, moved up to 3");
  await removeStep(P, 2); model.splice(1, 1);
  const shown = [];
  for (let i = 1; i <= model.length; i++) shown.push(await stepPhoto(P, i));
  const wantShown = model.map((m) => (m.img ? LIB[m.img].url : null));
  check(4, "the cards' current illustrations follow the steps too", JSON.stringify(shown) === JSON.stringify(wantShown), { shown, wantShown });
  const titlesShown = await Promise.all(model.map((_, i) => E.stepTitle(i + 1).inputValue()));
  check(4, "the form's titles follow the steps", JSON.stringify(titlesShown) === JSON.stringify(model.map((m) => m.title)), titlesShown);
  await expectSave("step 2 removed (confirmed)");

  // "Zmień ilustrację" → a DRAWING: the step shows it from now on, so a photo
  // lying over it goes; on a photo-less step it is a change of copy.
  const withPhoto = model.findIndex((m) => m.img) + 1;
  await chooseArt(P, withPhoto, "compare"); model[withPhoto - 1].art = "compare"; model[withPhoto - 1].img = null;
  check(4, `chooser → drawing "compare" on step ${withPhoto} (had a photo): the card now shows the drawing, the photo is gone`,
    (await stepArtOf(P, withPhoto)) === "compare" && (await stepPhoto(P, withPhoto)) === null, { art: await stepArtOf(P, withPhoto), photo: await stepPhoto(P, withPhoto) });
  const noPhoto = model.findIndex((m) => !m.img) + 1;
  await chooseArt(P, noPhoto, "download"); model[noPhoto - 1].art = "download";
  check(4, `chooser → drawing "download" on photo-less step ${noPhoto}`, (await stepArtOf(P, noPhoto)) === "download");
  await expectSave("drawings chosen in the chooser");
  // The chooser marks the current drawing (aria-pressed) and offers all of them.
  await E.changeIll(noPhoto).click();
  await E.chooser.waitFor();
  const ch = await P.page.evaluate(() => {
    const c = document.querySelector("[data-guide-illustration-chooser]");
    const arts = [...c.querySelectorAll("[data-guide-art]")];
    return { n: arts.length, pressed: arts.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-guide-art")) };
  });
  check(4, `chooser lists every drawing (${Object.keys(DICT.pl.aicc).filter((k) => k.startsWith("guide.art.")).length}) and marks only the current one ("download")`,
    ch.n === Object.keys(DICT.pl.aicc).filter((k) => k.startsWith("guide.art.")).length && JSON.stringify(ch.pressed) === '["download"]', ch);
  await P.page.keyboard.press("Escape");
  await E.chooser.waitFor({ state: "detached" });
  const st = await api(P.sid);
  const slots = Array.from({ length: MAX_STEPS }, (_, i) => st.slots[`guide.${tool}.tutorial.${i + 1}`]?.mediaId ?? null);
  info(4, `stub slots after the last save (mirrors the real action's by-position write): [${names(slots)}]`);
  await close(P);

  // The SAME drawing on a photo step only drops the photo: still the shipped copy.
  {
    const Q = await openEditor({ tool: "compress", row: "none" });
    const F = L(Q);
    await pickStep(Q, 2, "A");
    let q = await save(Q);
    check(4, "compress: photo A on step 2 alone → content null, images.steps[1] = A", q.call?.content === null && q.call?.images?.steps?.[1] === LIB.A.id, q.call);
    await chooseArt(Q, 2, ARTS.compress[1]);
    check(4, `…chooser → the step's own drawing ("${ARTS.compress[1]}") → photo removed, copy still the default (badge "${A(Q.locale, "usingDefault")}")`,
      (await stepPhoto(Q, 2)) === null && (await F.statusBlock.textContent()).includes(A(Q.locale, "usingDefault")));
    q = await save(Q);
    check(4, "…saved: content null, images.steps[1] null", q.call?.content === null && q.call?.images?.steps?.[1] === null && q.answer?.ok === true, q.call);
    await close(Q);
  }
}

/* ── 5. PICTURES / PICKER ──────────────────────────────────────────────── */

async function group5() {
  console.log("\n[5] pictures, the illustration chooser, AssetPicker");
  const P = await openEditor({ tool: "retouch", row: "none" });
  const E = L(P);
  const l = P.locale;
  // The chooser first: one place for both kinds of illustration.
  await E.changeIll(2).click();
  await E.chooser.waitFor({ state: "visible" });
  const chg = await P.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].find((x) => x.querySelector("[data-guide-illustration-chooser]"));
    return { label: d?.getAttribute("aria-label"), parentIsBody: d?.parentElement === document.body, text: d?.textContent.replace(/\s+/g, " ") ?? "" };
  });
  check(5, `"${A(l, "illustration.change")}" on step 2 opens a portalled chooser titled "… · ${A(l, "step.label", { n: 2 })}" with the photo and drawings sections`,
    chg.parentIsBody && chg.label === `${A(l, "illustration.change")} · ${A(l, "step.label", { n: 2 })}`
    && [A(l, "illustration.photoHeading"), A(l, "illustration.photoHint"), A(l, "illustration.drawingsHeading"), A(l, "illustration.drawingsHint"), A(l, "pickFromLibrary")].every((x) => chg.text.includes(x))
    && (await E.chooserRemovePhoto.count()) === 0, chg);
  await E.chooserPick.click();
  await E.chooser.waitFor({ state: "detached" });
  const dlg = E.picker;
  await dlg.waitFor({ state: "visible" });
  const label = await dlg.getAttribute("aria-label");
  check(5, "…its library button closes it and opens the picker titled '<pickTitle> · <step 2>'", label === `${A(l, "pickTitle")} · ${A(l, "step.label", { n: 2 })}`, label);
  const geo = await P.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].find((x) => x.querySelector("[data-picker-search]"));
    const r = d.getBoundingClientRect();
    const pts = [[innerWidth / 2, innerHeight / 2], [4, 4], [innerWidth - 4, innerHeight - 4], [innerWidth / 2, 60]];
    return {
      parentIsBody: d.parentElement === document.body,
      insideCard: Boolean(d.closest("[data-tool-guide-admin]")),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vw: innerWidth, vh: innerHeight,
      hits: pts.map(([x, y]) => d.contains(document.elementFromPoint(x, y))),
      items: [...d.querySelectorAll("[data-picker-item]")].map((b) => b.getAttribute("data-picker-item")),
      dialogs: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
    };
  });
  check(5, "picker is portalled to <body> (not inside the Card's backdrop-filter), and the only dialog open", geo.parentIsBody && !geo.insideCard && geo.dialogs === 1, geo);
  check(5, "picker covers the whole viewport and is the topmost element at centre/corners/top",
    geo.rect[0] === 0 && geo.rect[1] === 0 && geo.rect[2] === geo.vw && geo.rect[3] === geo.vh && geo.hits.every(Boolean), geo);
  check(5, "picker offers only images with a URL (A–D), not the video (E) nor the url-less file (F)",
    JSON.stringify(geo.items.map((id) => idName[id])) === JSON.stringify(["A", "B", "C", "D"]), geo.items.map((id) => idName[id]));
  await shot(P, "5-picker-1440-light-pl");
  await dlg.locator("[data-picker-search]").fill("moda");
  check(5, "picker search narrows the grid (\"moda\" → B only)",
    JSON.stringify(await dlg.locator("[data-picker-item]").evaluateAll((b) => b.map((x) => x.getAttribute("data-picker-item")))) === JSON.stringify([LIB.B.id]));
  await dlg.locator("[data-picker-search]").fill("");
  await dlg.locator(`[data-picker-item="${LIB.A.id}"]`).click();
  await dlg.waitFor({ state: "detached" });
  const s2 = (await E.step(2).textContent()).replace(/\s+/g, " ");
  check(5, "pick A → picker closes; step 2's card shows A as its current illustration, 'Zdjęcie z biblioteki: <name> · 1808×1152', and the remove-photo button",
    (await stepPhoto(P, 2)) === LIB.A.url && (await E.stepIll(2).getAttribute("data-guide-step-illustration")) === "photo"
    && s2.includes(A(l, "illustration.photo", { name: LIB.A.title })) && s2.includes(LIB.A.dims)
    && (await E.stepClear(2).count()) === 1, s2);
  await E.changeIll(2).click();
  await E.chooser.waitFor();
  const ch2 = (await E.chooser.textContent()).replace(/\s+/g, " ");
  check(5, "with a photo the chooser offers 'change photo' + 'remove photo' and warns that a drawing replaces the photo",
    ch2.includes(A(l, "changePhoto")) && (await E.chooserRemovePhoto.count()) === 1 && ch2.includes(A(l, "illustration.drawingsReplacePhoto"))
    && (await P.page.locator('[data-guide-illustration-chooser] [data-guide-art][aria-pressed="true"]').count()) === 0, ch2.slice(0, 200));
  await P.page.keyboard.press("Escape");
  await E.chooser.waitFor({ state: "detached" });
  await pickStep(P, 2, "B");
  check(5, "change → B replaces A on step 2", (await stepPhoto(P, 2)) === LIB.B.url);
  await E.stepClear(2).click();
  const s2b = (await E.step(2).textContent()).replace(/\s+/g, " ");
  check(5, "remove photo (on the card) → step 2 back to its drawing 'Rysunek: <art>'",
    (await stepPhoto(P, 2)) === null && s2b.includes(A(l, "illustration.drawing", { name: A(l, `art.${ARTS.retouch[1]}`) })) && (await E.stepClear(2).count()) === 0, s2b);
  await pickStep(P, 2, "C");
  await E.changeIll(2).click();
  await E.chooser.waitFor();
  await E.chooserRemovePhoto.click();
  await E.chooser.waitFor({ state: "detached" });
  check(5, "remove photo (in the chooser) → chooser closes, step 2 back to its drawing", (await stepPhoto(P, 2)) === null);

  // Escape closes the top dialog and nothing else.
  await E.previewSta.click();
  await E.starterPreview.waitFor();
  await E.changeIll(1).click();
  await E.chooser.waitFor({ state: "visible" });
  await P.page.keyboard.press("Escape");
  await E.chooser.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  check(5, "Escape closes the chooser (and nothing else)", (await E.chooser.count()) === 0 && (await E.starterPreview.count()) === 1);
  await E.changeIll(1).click();
  await E.chooser.waitFor({ state: "visible" });
  await E.chooserPick.click();
  await dlg.waitFor({ state: "visible" });
  await dlg.locator("[data-picker-search]").focus();
  await P.page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  check(5, "Escape (focus in the picker's search) closes the picker",
    (await dlg.count()) === 0 && (await E.chooser.count()) === 0);
  check(5, "…and nothing else: the starter preview stays open, the editor and its state stay",
    (await E.starterPreview.count()) === 1 && (await E.previewSta.getAttribute("aria-expanded")) === "true"
    && (await E.steps.count()) === ARTS.retouch.length);
  check(5, "…and the page scroll lock is released", (await P.page.evaluate(() => document.body.style.overflow)) === "");

  // The starter picture (its own PhotoControl, no chooser).
  await pick(P, E.starterPick, "C");
  const frames = await P.page.evaluate(() => [...document.querySelectorAll("[data-preview-frame] [data-starter-gallery] img")].map((i) => new URL(i.getAttribute("src"), location.href).pathname));
  check(5, "starter: pick C → its control and BOTH preview frames show C",
    (await photoOf(P.page.locator("[data-guide-starter-form]"))) === LIB.C.url && frames.length === 2 && frames.every((u) => u === LIB.C.url), frames);
  await pick(P, E.starterPick, "D");
  check(5, "starter: change → D", (await photoOf(P.page.locator("[data-guide-starter-form]"))) === LIB.D.url);
  let r = await save(P);
  check(5, "payload images.starter = D, steps all null (step 2's photo was removed)",
    r.call?.images?.starter === LIB.D.id && r.call?.images?.steps?.every((x) => x === null), r.call?.images);
  await E.starterClear.click();
  const sta = (await P.page.locator("[data-guide-starter-form]").textContent()).replace(/\s+/g, " ");
  check(5, "starter: remove → 'catalogue picture will be used' shown", sta.includes(A(l, "starter.usingCatalogue")), sta);
  r = await save(P);
  check(5, "payload images.starter = null after removal", r.call?.images?.starter === null, r.call?.images);
  await close(P);
}

/* ── 6. PREVIEW ────────────────────────────────────────────────────────── */

async function group6() {
  console.log("\n[6] preview");
  const tool = "retouch";
  const P = await openEditor({ tool, row: "none" });
  const E = L(P);
  const l = P.locale;
  const N = ARTS[tool].length;
  await E.tutTitle.fill("Podgląd PL (probe)");
  await E.stepTitle(2).fill("Krok drugi (probe)");
  await pickStep(P, 2, "B");
  await E.previewTut.click();
  await E.dialog.waitFor();
  let d = await dialogState(P);
  check(6, "preview opens the real TutorialModal with the edited title", d?.title === "Podgląd PL (probe)", d?.title);
  check(6, `counter "${TG(l, "counter", { n: 1, total: N })}"`, d?.counter === TG(l, "counter", { n: 1, total: N }), d?.counter);
  const want = [defStepTitle("pl", tool, 1), "Krok drugi (probe)", defStepTitle("pl", tool, 3), defStepTitle("pl", tool, 4)];
  check(6, "step titles in the dialog = the form's titles", JSON.stringify(d?.steps?.map((s) => s.title)) === JSON.stringify(want), d?.steps?.map((s) => s.title));
  check(6, "step 2 shows the chosen library photo (B); the others their drawn art",
    d?.steps?.[1]?.img === LIB.B.url && d.steps.filter((_, i) => i !== 1).every((s) => s.img === null && s.art), d?.steps);
  await shot(P, "6-tutorial-preview-1440-light-pl");
  // Keys aimed at something outside the dialog are not the dialog's.
  await P.page.evaluate(() => {
    const input = document.querySelector("[data-guide-tutorial-form] > div.grid input");
    for (const key of ["ArrowRight", "Escape"]) input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await sleep(150);
  d = await dialogState(P);
  check(6, "keydown ArrowRight/Escape aimed at an editor field outside the preview are ignored (still open, still step 1)",
    d !== null && d.counter === TG(l, "counter", { n: 1, total: N }), d?.counter ?? "dialog closed");
  await P.page.keyboard.press("ArrowRight");
  await sleep(150);
  const c2 = (await dialogState(P))?.counter;
  await P.page.keyboard.press("ArrowLeft");
  await sleep(150);
  check(6, "→ / ← with focus in the dialog move a step forward and back",
    c2 === TG(l, "counter", { n: 2, total: N }) && (await dialogState(P))?.counter === TG(l, "counter", { n: 1, total: N }), c2);
  for (let i = 1; i < N; i++) await P.page.locator(`${DLG} [data-guide-next]`).click();
  d = await dialogState(P);
  check(6, `next ×${N - 1} → "${TG(l, "counter", { n: N, total: N })}", primary = "${TG(l, "start")}"`,
    d?.counter === TG(l, "counter", { n: N, total: N }) && d?.next === TG(l, "start"), d);
  await P.page.locator(`${DLG} [data-guide-close]`).click();
  await E.dialog.waitFor({ state: "detached" });

  // PER-STEP PREVIEW: each card's eye opens the same dialog AT that step —
  // from its FIRST painted frame. A MutationObserver (every committed DOM
  // state, before paint) and a requestAnimationFrame loop (every frame) both
  // record which step section is the visible one, the counter and the
  // progressbar; nothing but step k may ever appear in either.
  const firstFrames = async (open, k) => {
    await P.page.evaluate((sel) => {
      const log = { mut: [], raf: [], frames: 0, firstFrameAt: null, done: false };
      window.__probeFirstFrame = log;
      const read = () => {
        const dlg = document.querySelector(sel);
        if (!dlg) return null;
        const secs = [...dlg.querySelectorAll("section[data-guide-step]")];
        return {
          on: secs.filter((s) => s.getAttribute("aria-hidden") === "false").map((s) => s.getAttribute("data-guide-step")).join(","),
          visible: secs.filter((s) => getComputedStyle(s).visibility === "visible").map((s) => s.getAttribute("data-guide-step")).join(","),
          counter: dlg.querySelector("[data-guide-counter]")?.textContent?.trim() ?? null,
          now: dlg.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") ?? null,
        };
      };
      const push = (arr) => {
        const r = read();
        if (!r) return;
        const key = JSON.stringify(r);
        if (arr.length && arr[arr.length - 1].key === key) return;
        arr.push({ key, ...r });
      };
      const mo = new MutationObserver(() => push(log.mut));
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      const tick = () => {
        if (document.querySelector(sel)) { if (log.firstFrameAt === null) log.firstFrameAt = log.frames; push(log.raf); }
        if (++log.frames < 60 && !log.done) requestAnimationFrame(tick); else mo.disconnect();
      };
      requestAnimationFrame(tick);
    }, DLG);
    await open();
    await E.dialog.waitFor();
    await until(() => P.page.evaluate(() => window.__probeFirstFrame.frames >= 60), 5000);
    const log = await P.page.evaluate(() => { const l = window.__probeFirstFrame; l.done = true; return { mut: l.mut, raf: l.raf, firstFrameAt: l.firstFrameAt }; });
    const want = { on: String(k), visible: String(k), counter: TG(l, "counter", { n: k, total: N }), now: String(k) };
    const bad = [...log.mut.map((s) => ["mutation", s]), ...log.raf.map((s) => ["frame", s])]
      .filter(([, s]) => s.on !== want.on || s.visible !== want.visible || s.counter !== want.counter || s.now !== want.now)
      .map(([w, s]) => `${w}: step ${s.visible || "none"} visible, "${s.counter}"`);
    return { ok: log.raf.length > 0 && log.mut.length > 0 && bad.length === 0, bad, states: { mut: log.mut.length, raf: log.raf.length, firstFrameAt: log.firstFrameAt }, first: log.raf[0] ?? null };
  };
  for (const k of [3, N, 1]) {
    const ff = await firstFrames(() => E.stepPreview(k).click(), k);
    check(6, `step ${k}'s preview: step ${k} is the visible one from the FIRST painted frame — no other step in any committed DOM state (MutationObserver) or frame (rAF)`,
      ff.ok, ff);
    await sleep(250);
    d = await dialogState(P);
    const cur = await P.page.evaluate((sel) => document.querySelector(`${sel} section[aria-hidden="false"]`)?.getAttribute("data-guide-step") ?? null, DLG);
    const nameOk = (await E.stepPreview(k).getAttribute("aria-label")) === A(l, "step.preview", { n: k });
    check(6, `step ${k}'s preview button ("${A(l, "step.preview", { n: k })}") opens the preview AT step ${k} ("${TG(l, "counter", { n: k, total: N })}")${k === N ? `, primary "${TG(l, "start")}"` : ""}`,
      nameOk && d?.counter === TG(l, "counter", { n: k, total: N }) && cur === String(k) && (k !== N || d?.next === TG(l, "start"))
      && d?.steps?.[k - 1]?.title === want[k - 1], { counter: d?.counter, cur, next: d?.next, title: d?.steps?.[k - 1]?.title, nameOk });
    await P.page.keyboard.press("Escape");
    await E.dialog.waitFor({ state: "detached" });
    await sleep(100);
    const back = await P.page.evaluate((n) => document.activeElement?.getAttribute("data-guide-step-preview") === String(n), k);
    check(6, `…Escape closes it and focus returns to step ${k}'s preview button`, back);
  }
  {
    // The last per-step preview above was step 1: open step N's again first,
    // so "starts at step 1" is measured right after a preview that was NOT at 1.
    await E.stepPreview(N).click();
    await E.dialog.waitFor();
    await P.page.keyboard.press("Escape");
    await E.dialog.waitFor({ state: "detached" });
    await sleep(100);
    const ff = await firstFrames(() => E.previewTut.click(), 1);
    check(6, `after step ${N}'s preview, the whole-tutorial preview shows step 1 from its first painted frame (no frame of step ${N})`, ff.ok, ff);
  }
  await sleep(200);
  check(6, "after a per-step preview, the whole-tutorial preview starts at step 1 again", (await dialogState(P))?.counter === TG(l, "counter", { n: 1, total: N }));
  await P.page.keyboard.press("Escape");
  await E.dialog.waitFor({ state: "detached" });

  // Another language: its own copy, Polish for what is empty.
  await E.add.click();
  await E.stepTitle(N + 1).fill("Tylko po polsku (probe)");
  await E.lang("en").click();
  await E.previewTut.click();
  await E.dialog.waitFor();
  d = await dialogState(P);
  const wantEn = [defStepTitle("en", tool, 1), defStepTitle("en", tool, 2), defStepTitle("en", tool, 3), defStepTitle("en", tool, 4), "Tylko po polsku (probe)"];
  check(6, "EN preview: EN title, EN step titles, the new step falls back to its PL title",
    d?.title === shipped("en", tool, "tutorial.title") && JSON.stringify(d?.steps?.map((s) => s.title)) === JSON.stringify(wantEn), { title: d?.title, steps: d?.steps?.map((s) => s.title) });
  check(6, "EN preview: the dialog's own words (counter, buttons, overline) are in the previewed language, as a customer would see them",
    d?.counter === TG("en", "counter", { n: 1, total: N + 1 }) && d?.next?.startsWith(TG("en", "next")) && d?.skip === TG("en", "skip"),
    { counter: d?.counter, next: d?.next, skip: d?.skip, overline: d?.overline, adminUi: l });
  await shot(P, "6-tutorial-preview-en-content-in-pl-ui");
  await P.page.keyboard.press("Escape");
  await E.dialog.waitFor({ state: "detached" });
  await E.lang("pl").click();

  // Starter preview: desktop and phone frames.
  await E.previewSta.click();
  await E.starterPreview.waitFor();
  const sp = await P.page.evaluate(() => {
    const out = {};
    for (const f of document.querySelectorAll("[data-preview-frame]")) {
      const w = f.getAttribute("data-preview-frame");
      const g = f.querySelector("[data-starter-gallery]");
      const box = f.querySelector(":scope > div");
      const inner = box?.firstElementChild;
      out[w] = {
        title: g?.querySelector("h2")?.textContent?.trim() ?? null,
        img: g?.querySelector("img") ? new URL(g.querySelector("img").getAttribute("src"), location.href).pathname : null,
        art: Boolean(g?.querySelector("svg")),
        innerW: inner ? Math.round(inner.getBoundingClientRect().width) : null, boxW: box ? box.clientWidth : null,
        innerH: inner ? Math.round(inner.getBoundingClientRect().height) : null, boxH: box ? box.clientHeight : null,
      };
    }
    return out;
  });
  check(6, "starter preview shows a 720 px desktop frame and a 360 px phone frame", Boolean(sp["720"] && sp["360"]), Object.keys(sp));
  check(6, "both frames: the starter title from the form and the catalogue fallback picture (no picture chosen)",
    ["720", "360"].every((w) => sp[w]?.title === shipped("pl", tool, "starter.title") && sp[w]?.img === CATALOGUE_URL), sp);
  check(6, "both frames: the scaled content fits its frame (no clipping)",
    ["720", "360"].every((w) => sp[w] && sp[w].innerW <= sp[w].boxW + 1 && sp[w].innerH <= sp[w].boxH + 2), sp);
  await E.starterTitle.fill("Galeria (probe)");
  await pick(P, E.starterPick, "A");
  const live = await P.page.evaluate(() => [...document.querySelectorAll("[data-preview-frame] [data-starter-gallery]")]
    .map((g) => [g.querySelector("h2")?.textContent?.trim(), g.querySelector("img") ? new URL(g.querySelector("img").getAttribute("src"), location.href).pathname : null]));
  check(6, "edits reach the open starter preview live (title + chosen picture)",
    live.length === 2 && live.every(([t, i]) => t === "Galeria (probe)" && i === LIB.A.url), live);
  await shot(P, "6-starter-preview-1440-light-pl", { fullPage: true });
  await close(P);

  // No catalogue picture → the drawn showcase.
  const Q = await openEditor({ tool: "compress", row: "none", cat: false });
  const F = L(Q);
  const sta = (await Q.page.locator("[data-guide-starter-form]").textContent()).replace(/\s+/g, " ");
  check(6, "no catalogue picture: the control says a drawn illustration is shown", sta.includes(A(l, "starter.usingArt")), sta);
  await F.previewSta.click();
  await F.starterPreview.waitFor();
  const art = await Q.page.evaluate(() => [...document.querySelectorAll("[data-preview-frame] [data-starter-gallery]")].map((g) => ({ img: Boolean(g.querySelector("img")), svg: Boolean(g.querySelector("svg")) })));
  check(6, "…and both frames draw the showcase (no <img>)", art.length === 2 && art.every((a) => !a.img && a.svg), art);
  await close(Q);

  // Own copy: an EMPTY intro / starter description stays empty in the preview
  // (no shipped fallback), as resolveGuide does on the customer side.
  {
    const tool2 = "ecommerce_thumbnail";
    const S = await openEditor({ tool: tool2, row: "none" });
    const K = L(S);
    const frameBodies = () => S.page.evaluate(() => [...document.querySelectorAll("[data-preview-frame] [data-starter-gallery]")]
      .map((g) => g.querySelector("h2 + p")?.textContent?.trim() ?? null));
    await K.previewTut.click();
    await K.dialog.waitFor();
    let d2 = await dialogState(S);
    check(6, "shipped copy: the preview intro is the shipped tutorial body", d2?.intro === shipped("pl", tool2, "tutorial.body"), d2?.intro);
    await S.page.keyboard.press("Escape");
    await K.dialog.waitFor({ state: "detached" });
    await K.previewSta.click();
    await K.starterPreview.waitFor();
    let fb = await frameBodies();
    check(6, "shipped copy: both frames show the shipped starter description",
      fb.length === 2 && fb.every((b) => b === shipped("pl", tool2, "starter.body")), fb);
    for (const code of LOCALES) { await K.lang(code).click(); await K.tutBody.fill(""); }
    await K.lang("pl").click();
    await K.starterBody.fill("");
    check(6, "emptying the texts switches to own copy (badge)", (await K.card.textContent()).includes(A(S.locale, "usingCustom")));
    fb = await frameBodies();
    check(6, "own copy, PL starter description empty → both frames show NO description (no shipped fallback)",
      fb.length === 2 && fb.every((b) => b === null), fb);
    await K.previewTut.click();
    await K.dialog.waitFor();
    d2 = await dialogState(S);
    check(6, "own copy, intro empty in every language → the preview has NO intro", d2?.intro === null && d2?.title === shipped("pl", tool2, "tutorial.title"), d2?.intro);
    await S.page.keyboard.press("Escape");
    await K.dialog.waitFor({ state: "detached" });
    await K.lang("en").click();
    fb = await frameBodies();
    check(6, "own copy in EN: the EN starter description still in the form is shown (PL emptiness does not leak)",
      fb.length === 2 && fb.every((b) => b === shipped("en", tool2, "starter.body")), fb);
    await K.lang("pl").click();
    const q = await save(S);
    check(6, "payload: tutorial.body = {} and starter.body without pl",
      JSON.stringify(q.call?.content?.tutorial?.body) === "{}" && q.call?.content?.starter?.body && !("pl" in q.call.content.starter.body)
      && q.call.content.starter.body.en === shipped("en", tool2, "starter.body"),
      { tb: q.call?.content?.tutorial?.body, sb: q.call?.content?.starter?.body });
    await shot(S, "6-empty-intro-own-copy-1440-light-pl", { fullPage: true });
    await close(S);
  }

  // Phone width: preview open, no sideways page scroll.
  const R = await openEditor({ tool: "fashion_flat_lay", row: "custom", vp: VP[390], locale: "de" });
  const H = L(R);
  await H.previewSta.click();
  await H.starterPreview.waitFor();
  await sleep(300);
  const ov = await R.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(6, "390 px (DE): starter preview open → no horizontal page scroll", ov.sw <= ov.cw, ov);
  await shot(R, "6-starter-preview-390-light-de", { fullPage: true });
  // The preview speaks the language of the tab being edited (PL by default),
  // as a customer in that language would see it: the DE tab for German words.
  await H.lang("de").click();
  await H.previewTut.click();
  await H.dialog.waitFor();
  await sleep(400);
  const dr = await R.page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { left: r.left, right: r.right, vw: innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  }, DLG);
  check(6, "390 px: tutorial preview sheet fits the viewport, no sideways scroll", dr.left >= 0 && dr.right <= dr.vw + 0.5 && dr.sw <= dr.cw, dr);
  const d390 = await dialogState(R);
  check(6, "saved custom copy (3 steps), DE tab → German counter, the saved step titles (DE where written, else PL); step 1 shows D, step 2 shows B",
    d390?.counter === TG("de", "counter", { n: 1, total: 3 }) && d390?.steps?.[0]?.img === LIB.D.url && d390?.steps?.[1]?.img === LIB.B.url
    && d390?.steps?.[0]?.title === "Własny krok 1" && d390?.steps?.[2]?.title === "Eigener Schritt 3", d390);
  await shot(R, "6-tutorial-preview-390-light-de");
  await close(R);

  // The preview's footer on narrow phones: "Back" is its arrow alone below
  // 381 px (named for screen readers); nothing in the footer is clipped.
  const footer = (P) => P.page.evaluate((sel) => {
    const d = document.querySelector(sel);
    const dr = d.getBoundingClientRect();
    const back = d.querySelector("[data-guide-back]");
    const label = back.querySelector("span");
    const ls = getComputedStyle(label);
    const btns = [...d.querySelectorAll("[data-guide-skip], [data-guide-back], [data-guide-next]")].map((b) => {
      const r = b.getBoundingClientRect();
      return { k: b.getAttribute("data-guide-next") ?? (b.hasAttribute("data-guide-back") ? "back" : "skip"),
        clipped: b.scrollWidth > b.clientWidth + 1, inside: r.left >= dr.left - 0.5 && r.right <= dr.right + 0.5 };
    });
    return { backName: back.getAttribute("aria-label"), labelSrOnly: ls.position === "absolute" && parseFloat(ls.width) <= 1, btns };
  }, DLG);
  for (const [w, sr] of [[375, true], [390, false]]) {
    const T = await openEditor({ tool: "retouch", row: "none", vp: { width: w, height: 812, touch: true }, locale: "de" });
    await L(T).lang("de").click();
    await L(T).previewTut.click();
    await L(T).dialog.waitFor();
    await sleep(400);
    const f = await footer(T);
    check(6, `${w} px (DE): Back label ${sr ? "is screen-reader-only (arrow alone)" : "is visible"}; the button keeps its name "${TG("de", "back")}"`,
      f.labelSrOnly === sr && f.backName === TG("de", "back"), f);
    check(6, `${w} px (DE): skip/back/next not clipped and inside the sheet`, f.btns.every((b) => !b.clipped && b.inside), f.btns);
    await shot(T, `6-tutorial-footer-${w}-light-de`);
    await close(T);
  }
}

/* ── 7. SAVE & PUBLISH ─────────────────────────────────────────────────── */

async function group7() {
  console.log("\n[7] save & publish");
  const tool = "retouch";
  const P = await openEditor({ tool, row: "none" });
  const E = L(P);
  const l = P.locale;
  await E.tutTitle.fill("Zapis 1 (probe)");
  await pickStep(P, 2, "A");
  let r = await save(P);
  check(7, "payload has exactly {tool, tutorialEnabled, starterEnabled, content, images:{steps, starter}, base, imageBases, showAgain}",
    JSON.stringify(Object.keys(r.call ?? {}).sort()) === JSON.stringify(["base", "content", "imageBases", "images", "showAgain", "starterEnabled", "tool", "tutorialEnabled"])
    && JSON.stringify(Object.keys(r.call?.images ?? {}).sort()) === JSON.stringify(["starter", "steps"]) && r.call?.tool === tool, r.call && Object.keys(r.call));
  const slotKeys = [...Array.from({ length: MAX_STEPS }, (_, i) => `guide.${tool}.tutorial.${i + 1}`), `guide.${tool}.starter.1`];
  check(7, "first save on a tool without a row: base = null, showAgain = false, imageBases = every slot key → null",
    r.call?.base === null && r.call?.showAgain === false
    && JSON.stringify(Object.keys(r.call?.imageBases ?? {}).sort()) === JSON.stringify([...slotKeys].sort())
    && Object.values(r.call?.imageBases ?? {}).every((v) => v === null), r.call);
  const firstBases = r.answer?.data?.imageBases;
  check(7, "a successful save refreshes the page (RSC refetch observed — the control for the 'no refresh' checks)", P.rec.rsc.length > 0, P.rec.rsc);
  check(7, "after success: not dirty, save disabled, success toast",
    !(await isDirty(P)) && (await E.save.isDisabled()) && (await P.page.locator("[data-sonner-toast]").filter({ hasText: A(l, "saved") }).count()) >= 1,
    { status: await statusText(P) });
  const first = r.answer?.data?.updatedAt;
  const refreshed = await E.serverBase.textContent();
  await E.tutTitle.fill("Zapis 2 (probe)");
  r = await save(P);
  check(7, "second save sends base = the first answer's updatedAt (= the refreshed server value)",
    r.call?.base === first && sameInstant(first, refreshed), { base: r.call?.base, first, refreshed });
  check(7, "second save sends imageBases = the first answer's imageBases (step 2's new slot time, others null)",
    JSON.stringify(r.call?.imageBases) === JSON.stringify(firstBases) && typeof firstBases?.[`guide.${tool}.tutorial.2`] === "string",
    { sent: r.call?.imageBases, answered: firstBases });

  // A save never raises the version any more ("show again" is its own action, group A).
  check(7, "saves send showAgain = false and leave the version at 1", r.call?.showAgain === false && r.answer?.data?.version === 1 && (await versionShown(P)) === 1,
    { showAgain: r.call?.showAgain, answer: r.answer });
  check(7, "the form has no 'show again' checkbox any more", (await P.page.locator(`${ED} input[type="checkbox"]`).count()) === 0);

  // Conflict: another admin saved in between.
  await api(P.sid, { bump: tool });
  await E.tutTitle.fill("Zapis po cudzym (probe)");
  r = await save(P, { waitRefresh: false });
  await sleep(300);
  check(7, "someone else saved → answer 'conflict'", r.answer?.ok === false && r.answer?.error === "conflict", r.answer);
  const cf = L(P).conflict;
  check(7, "conflict panel beside the save button: conflict sentence + 'reload' button",
    (await cf.count()) === 1 && (await cf.textContent()).includes(A(l, "error.conflict"))
    && (await cf.getByRole("button", { name: A(l, "reload"), exact: true }).count()) === 1);
  const toastCf = P.page.locator("[data-sonner-toast]").filter({ hasText: A(l, "error.conflict") });
  check(7, "conflict toast with a 'reload' action", (await toastCf.count()) >= 1 && (await toastCf.locator("button").filter({ hasText: A(l, "reload") }).count()) >= 1);
  check(7, "form stays dirty and saveable after a conflict", (await isDirty(P)) && !(await E.save.isDisabled()));
  await shot(P, "7-conflict-1440-light-pl");
  await Promise.all([P.page.waitForEvent("load", { timeout: 60000 }), cf.getByRole("button", { name: A(l, "reload"), exact: true }).click()]);
  await hydrated(P);
  check(7, "reload → the other admin's version is loaded", (await L(P).tutTitle.inputValue()) === "Zmiana innego admina", await L(P).tutTitle.inputValue());
  const bumped = (await api(P.sid)).rows[tool].updated_at;
  await L(P).tutBody.fill("Po przeładowaniu (probe)");
  r = await save(P);
  check(7, "after reload the save is based on the other admin's row → ok", r.call?.base === bumped && r.answer?.ok === true, { base: r.call?.base, bumped, answer: r.answer });

  // images_failed: the media_slots_write RPC failed — with the current
  // action (pictures first, row second) NOTHING was written.
  await L(P).tutBody.fill("Zdjęcia nie zapisane (probe)");
  await pickStep(P, 1, "B");
  await api(P.sid, { force: "images_failed" });
  const rowBefore = (await api(P.sid)).rows[tool];
  const rscBefore = P.rec.rsc.length;
  r = await save(P, { waitRefresh: false });
  await sleep(800);
  check(7, "images_failed: the editor does not refresh the page (no RSC refetch)", P.rec.rsc.length === rscBefore, P.rec.rsc.slice(rscBefore));
  check(7, "images_failed → its sentence shown under the form + an error toast", r.answer?.error === "images_failed"
    && (await L(P).error.textContent()) === A(l, "error.images_failed")
    && (await P.page.locator("[data-sonner-toast]").filter({ hasText: A(l, "error.images_failed") }).count()) >= 1,
    { answer: r.answer, shown: await L(P).error.textContent().catch(() => null) });
  check(7, "…form stays dirty and saveable", (await isDirty(P)) && !(await L(P).save.isDisabled()));
  check(7, "…nothing written (row and version unchanged)", r.row.updated_at === rowBefore.updated_at && r.row.tutorial_version === rowBefore.tutorial_version, { before: rowBefore.updated_at, after: r.row.updated_at });
  check(7, "…'show again' is disabled while the failed changes are unsaved (dirty)", await L(P).again.isDisabled());
  r = await save(P);
  check(7, "retry after images_failed: same base as the failed attempt → ok", r.call?.base === rowBefore.updated_at && r.answer?.ok === true, { base: r.call?.base, answer: r.answer });
  check(7, "retry leaves the version where it was (a save never bumps it)",
    r.call?.showAgain === false && r.answer?.data?.version === rowBefore.tutorial_version, { showAgain: r.call?.showAgain, answer: r.answer, before: rowBefore.tutorial_version });
  check(7, "retry carries the picture (B on step 1)", r.call?.images?.steps?.[0] === LIB.B.id, names(r.call?.images?.steps));

  // conflict_images: a picture changed behind the form (Media → "Zamień wszędzie").
  await api(P.sid, { slotbump: `guide.${tool}.tutorial.1`, media: LIB.C.id });
  await L(P).tutBody.fill("Po podmianie w mediach (probe)");
  const rowCi = (await api(P.sid)).rows[tool];
  const rscCi = P.rec.rsc.length;
  r = await save(P, { waitRefresh: false });
  await sleep(800);
  check(7, "conflict_images: no refresh either (no RSC refetch)", P.rec.rsc.length === rscCi, P.rec.rsc.slice(rscCi));
  check(7, "picture replaced elsewhere → conflict_images: its sentence + a toast with 'reload', nothing written, still dirty",
    r.answer?.error === "conflict_images" && (await L(P).error.textContent()) === A(l, "error.conflict_images")
    && (await P.page.locator("[data-sonner-toast]").filter({ hasText: A(l, "error.conflict_images") }).locator("button").filter({ hasText: A(l, "reload") }).count()) >= 1
    && r.row.updated_at === rowCi.updated_at && (await isDirty(P)),
    { answer: r.answer, shown: await L(P).error.textContent().catch(() => null) });
  await Promise.all([P.page.waitForEvent("load", { timeout: 60000 }), P.page.reload()]);
  await hydrated(P);
  check(7, "after reload the form shows the replaced picture (C on step 1)", (await stepPhoto(P, 1)) === LIB.C.url);

  // A server-side validation answer.
  await L(P).tutBody.fill("Serwer odrzuca (probe)");
  await api(P.sid, { force: "invalid_required" });
  r = await save(P, { waitRefresh: false });
  check(7, "server answer invalid_required → its sentence shown, form still dirty",
    (await L(P).error.textContent()) === A(l, "error.invalid_required") && (await isDirty(P)), await L(P).error.textContent().catch(() => null));
  await api(P.sid, { force: "step_up_required" });
  r = await save(P, { waitRefresh: false });
  check(7, "server answer step_up_required → its sentence shown", (await L(P).error.textContent()) === A(l, "error.step_up_required"));
  r = await save(P);
  check(7, "then a normal save succeeds", r.answer?.ok === true, r.answer);
  await close(P);

  // A failed save (nothing written) + another admin's save + a sibling
  // form's router.refresh() must not let the form adopt the other admin's row.
  {
    const Q = await openEditor({ tool, row: "custom" });
    const F = L(Q);
    await F.tutTitle.fill("Moja zmiana (probe)");
    await api(Q.sid, { force: "images_failed" });
    const b0 = (await api(Q.sid)).rows[tool].updated_at;
    let q = await save(Q, { waitRefresh: false });
    check(7, "images_failed: error shown, row untouched", q.answer?.error === "images_failed" && q.row.updated_at === b0, { answer: q.answer, row: q.row.updated_at, b0 });
    await F.tutBody.fill("Druga próba (probe)");
    await api(Q.sid, { force: "slots_read_failed" });
    q = await save(Q, { waitRefresh: false });
    check(7, "picture read failed → 'generic' sentence, row untouched", q.answer?.error === "generic"
      && (await F.error.textContent()) === A(l, "error.generic") && q.row.updated_at === b0, { answer: q.answer });
    await api(Q.sid, { bump: tool });
    const b1 = (await api(Q.sid)).rows[tool].updated_at;
    await Q.page.locator("[data-probe-refresh]").click();
    await until(async () => (await F.serverBase.textContent()) === b1, 15000);
    await sleep(300);
    q = await save(Q, { waitRefresh: false });
    check(7, "no silent overwrite: after those failures, another admin's save + a sibling form's router.refresh() still end in 'conflict'",
      q.answer?.error === "conflict" && q.call?.base === b0,
      { sentBase: q.call?.base, ownBase: b0, otherAdminsBase: b1, answer: q.answer, rowNow: (await api(Q.sid)).rows[tool].content?.tutorial?.title });
    await close(Q);
  }

  // Reset to the shipped copy.
  {
    const R = await openEditor({ tool, row: "custom" });
    const H = L(R);
    check(7, "saved custom copy loads: badge 'custom', 3 steps, its PL title, version 3",
      (await H.card.textContent()).includes(A(l, "usingCustom")) && (await H.steps.count()) === 3
      && (await H.tutTitle.inputValue()) === "Własny samouczek (probe)" && (await versionShown(R)) === 3);
    check(7, "'restore default copy' enabled on custom copy", !(await H.reset.isDisabled()));
    await H.reset.click();
    await H.confirm.waitFor();
    const cfm = await R.page.evaluate((lbl) => {
      const d = document.querySelector(`[role="dialog"][aria-label="${lbl}"]`);
      return { parentIsBody: d?.parentElement === document.body, text: d?.textContent ?? "" };
    }, A(l, "resetConfirmTitle"));
    check(7, "reset asks first: a confirm dialog (portalled) with the body text", cfm.parentIsBody && cfm.text.includes(A(l, "resetConfirmBody")), cfm);
    await H.confirm.getByRole("button", { name: COMMON(l, "cancel"), exact: true }).click();
    await H.confirm.waitFor({ state: "detached" });
    check(7, "cancel → nothing changed", (await H.tutTitle.inputValue()) === "Własny samouczek (probe)" && !(await isDirty(R)));
    await H.reset.click();
    await H.confirm.waitFor();
    await R.page.keyboard.press("Escape");
    await H.confirm.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    check(7, "Escape closes the confirm without resetting", (await H.confirm.count()) === 0 && (await H.tutTitle.inputValue()) === "Własny samouczek (probe)");
    await H.reset.click();
    await H.confirm.waitFor();
    await H.confirm.getByRole("button", { name: A(l, "resetConfirm"), exact: true }).click();
    await H.confirm.waitFor({ state: "detached" });
    check(7, "confirm → shipped copy back (badge 'default', 4 steps, shipped PL title), reset disabled",
      (await H.card.textContent()).includes(A(l, "usingDefault")) && (await H.steps.count()) === ARTS[tool].length
      && (await H.tutTitle.inputValue()) === shipped("pl", tool, "tutorial.title") && (await H.reset.isDisabled()));
    const q = await save(R);
    check(7, "save after reset sends content = null; pictures keep their positions (D on 1, B on 2), length 4",
      q.call?.content === null && JSON.stringify(q.call?.images?.steps) === JSON.stringify([LIB.D.id, LIB.B.id, null, null]) && q.answer?.ok === true,
      { content: q.call?.content, steps: names(q.call?.images?.steps), answer: q.answer });
    await close(R);
  }
}

/* ── A. SHOW AGAIN ─────────────────────────────────────────────────────── */

/** "Pokaż ponownie wszystkim" → its confirm → `how` (confirm | cancel | escape | close).
 *  Returns the action's call/answer when one was made. */
async function showAgain(P, how = "confirm", { waitRefresh = true } = {}) {
  const E = L(P);
  const l = P.locale;
  const before = (await api(P.sid)).calls.length;
  await E.again.click();
  await E.againConfirm.waitFor({ state: "visible", timeout: 10000 });
  const dialog = await P.page.evaluate((lbl) => {
    const d = document.querySelector(`[role="dialog"][aria-label="${lbl}"]`);
    return { parentIsBody: d?.parentElement === document.body, modal: d?.getAttribute("aria-modal"), text: d?.textContent.replace(/\s+/g, " ") ?? "" };
  }, A(l, "again.confirmTitle"));
  if (how === "cancel") await E.againConfirm.getByRole("button", { name: COMMON(l, "cancel"), exact: true }).click();
  else if (how === "escape") await P.page.keyboard.press("Escape");
  else if (how === "close") await E.againConfirm.getByRole("button", { name: COMMON(l, "close"), exact: true }).click();
  else await E.againConfirm.getByRole("button", { name: A(l, "again.confirm"), exact: true }).click();
  if (how !== "confirm") {
    await E.againConfirm.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await sleep(600);
    const st = await api(P.sid);
    return { dialog, n: st.calls.length - before, closed: (await E.againConfirm.count()) === 0 };
  }
  await until(async () => (await api(P.sid)).answers.length > before, 30000);
  const st = await api(P.sid);
  await E.againConfirm.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  if (waitRefresh && st.answers[before]?.ok) {
    const want = st.rows[P.tool]?.updated_at ?? "";
    await until(async () => (await E.serverBase.textContent()) === want, 15000);
  }
  await sleep(300);
  return { dialog, call: st.calls[before], answer: st.answers[before], row: st.rows[P.tool], st, n: st.calls.length - before, closed: (await E.againConfirm.count()) === 0 };
}

async function groupA() {
  console.log("\n[A] Pokaż ponownie wszystkim");
  const tool = "retouch";
  const P = await openEditor({ tool, row: "none" });
  const E = L(P);
  const l = P.locale;
  const btn = await P.page.evaluate(() => {
    const b = document.querySelector("[data-guide-show-again]");
    const hint = document.getElementById(b?.getAttribute("aria-describedby") ?? "");
    return b ? { text: b.textContent.trim(), tag: b.tagName, type: b.getAttribute("type"), haspopup: b.getAttribute("aria-haspopup"), hint: hint?.textContent.trim() ?? null, inStatus: Boolean(b.closest("[data-guide-status]")) } : null;
  });
  check("A", `a BUTTON "${A(l, "again.button")}" in the status block (aria-haspopup dialog), described by "${A(l, "again.hint", { n: 1, next: 2 })}"`,
    btn?.tag === "BUTTON" && btn.text === A(l, "again.button") && btn.haspopup === "dialog" && btn.inStatus && btn.hint === A(l, "again.hint", { n: 1, next: 2 }), btn);
  check("A", "clean form, tutorial on, version 1 → the button is enabled", !(await E.again.isDisabled()));
  // Disabled while dirty: what opens again must be what is published.
  const original = await E.tutTitle.inputValue();
  await E.tutTitle.fill(`${original} (zmiana)`);
  check("A", `a pending edit → disabled, hint "${A(l, "again.dirtyHint")}"`, (await E.again.isDisabled()) && (await againHint(P)) === A(l, "again.dirtyHint"),
    { disabled: await E.again.isDisabled(), hint: await againHint(P) });
  // Typing the old text back is still "own copy" (the editor's rule: any
  // edit leaves the shipped copy) — logged; "Przywróć domyślne" is the way back.
  await E.tutTitle.fill(original);
  info("A", `text typed back to the shipped title → form ${await isDirty(P) ? "still dirty (own copy, by design)" : "clean"}; show-again ${await E.again.isDisabled() ? "disabled" : "enabled"}`);
  await E.reset.click();
  await E.confirm.waitFor();
  await E.confirm.getByRole("button", { name: A(l, "resetConfirm"), exact: true }).click();
  await E.confirm.waitFor({ state: "detached" });
  check("A", "'restore default copy' → clean again → enabled, hint back to 1 → 2", !(await isDirty(P)) && !(await E.again.isDisabled()) && (await againHint(P)) === A(l, "again.hint", { n: 1, next: 2 }),
    { status: await statusText(P), hint: await againHint(P) });
  await E.tutSwitch.click();
  check("A", "a switch change counts as dirty too (disabled, dirty hint)", (await E.again.isDisabled()) && (await againHint(P)) === A(l, "again.dirtyHint"));
  await E.tutSwitch.click();
  check("A", "switch back → clean → enabled again", !(await isDirty(P)) && !(await E.again.isDisabled()));
  // The confirm: cancel, Escape and the X call nothing.
  for (const how of ["cancel", "escape", "close"]) {
    const x = await showAgain(P, how);
    check("A", `confirm → ${how}: closed, NO action call`, x.closed && x.n === 0, x);
    if (how === "cancel") {
      check("A", `the confirm is portalled, aria-modal, titled "${A(l, "again.confirmTitle")}", body names version 1 → 2`,
        x.dialog.parentIsBody && x.dialog.modal === "true" && x.dialog.text.includes(A(l, "again.confirmBody", { n: 1, next: 2 })) && x.dialog.text.includes(A(l, "again.confirm")), x.dialog);
    }
  }
  check("A", "…and the version is still 1", (await versionShown(P)) === 1);
  // Confirmed: one call to showToolGuideAgainAction, nothing else.
  const rsc0 = P.rec.rsc.length;
  let r = await showAgain(P, "confirm");
  check("A", "confirm → exactly ONE call, to showToolGuideAgainAction, with {tool, base: null} (no row yet)",
    r.n === 1 && r.call?.showAgainAction === true && r.call?.tool === tool && r.call?.base === null
    && JSON.stringify(Object.keys(r.call ?? {}).sort()) === JSON.stringify(["base", "showAgainAction", "tool"]), r.call);
  check("A", "answer ok, version 2; the stub row: v2, content null (shipped copy kept), tutorial on, starter on (retouch has one)",
    r.answer?.ok === true && r.answer.data.version === 2 && r.row?.tutorial_version === 2 && r.row.content === null && r.row.tutorial_enabled === true && r.row.starter_enabled === true, { answer: r.answer, row: r.row });
  const pub = ((await E.published.textContent()) ?? "").trim();
  check("A", `after it: confirm closed, status shows version 2, "${A(l, "status.saved")}", the published line "${A(l, "status.shownAgainAt").replace("{n}", "2").replace("{when}", "…")}"`,
    r.closed && (await versionShown(P)) === 2 && (await E.statusBlock.textContent()).includes(A(l, "status.saved"))
    && pattern(A(l, "status.shownAgainAt").replace("{n}", "2")).test(pub), { pub, version: await versionShown(P) });
  check("A", `success toast "${A(l, "again.done", { n: 2 })}"; page refreshed (RSC); form still clean, save still disabled`,
    (await P.page.locator("[data-sonner-toast]").filter({ hasText: A(l, "again.done", { n: 2 }) }).count()) >= 1 && P.rec.rsc.length > rsc0
    && !(await isDirty(P)) && (await E.save.isDisabled()), { rsc: P.rec.rsc.length - rsc0, status: await statusText(P) });
  check("A", "the hint now names 2 → 3 and the button is enabled for another round", (await againHint(P)) === A(l, "again.hint", { n: 2, next: 3 }) && !(await E.again.isDisabled()));
  const firstAt = r.answer.data.updatedAt;
  r = await showAgain(P, "confirm");
  check("A", "a second round: base = the first answer's updatedAt → version 3", r.call?.base === firstAt && r.answer?.ok === true && r.answer.data.version === 3 && (await versionShown(P)) === 3,
    { base: r.call?.base, firstAt, answer: r.answer });
  // A save after it: based on the bump, does not bump again.
  const againAt = r.answer.data.updatedAt;
  await E.tutTitle.fill("Po pokazaniu ponownie (probe)");
  const s1 = await save(P);
  check("A", "the next save: base = the show-again answer's updatedAt, showAgain false, version stays 3",
    s1.call?.base === againAt && s1.call?.showAgain === false && s1.answer?.ok === true && s1.answer.data.version === 3 && (await versionShown(P)) === 3,
    { base: s1.call?.base, againAt, answer: s1.answer });
  check("A", `…and the published line switches to "${A(l, "status.publishedAt").replace("{when}", "…")}"`, pattern(A(l, "status.publishedAt")).test(((await E.published.textContent()) ?? "").trim()));
  // Another admin saved in between: conflict, nothing bumped.
  await api(P.sid, { bump: tool });
  const vBefore = (await api(P.sid)).rows[tool].tutorial_version;
  r = await showAgain(P, "confirm", { waitRefresh: false });
  await sleep(300);
  check("A", "someone else saved first → answer 'conflict'; the conflict panel + toast; the row's version unchanged",
    r.answer?.ok === false && r.answer.error === "conflict" && (await E.conflict.count()) === 1
    && (await P.page.locator("[data-sonner-toast]").filter({ hasText: A(l, "error.conflict") }).count()) >= 1 && r.row.tutorial_version === vBefore, { answer: r.answer });
  check("A", "…the button is disabled while the conflict stands", await E.again.isDisabled());
  await shot(P, "A-conflict-1440-light-pl");
  await close(P);

  // A forced failure (not_admin) shows its sentence, writes nothing.
  {
    const Q = await openEditor({ tool, row: "custom" });
    const F = L(Q);
    await api(Q.sid, { force: "not_admin" });
    const row0 = (await api(Q.sid)).rows[tool];
    const x = await showAgain(Q, "confirm", { waitRefresh: false });
    check("A", "forced not_admin → its sentence under the form, row untouched, confirm closed, version shown still 3",
      x.answer?.error === "not_admin" && (await F.error.textContent()) === A(Q.locale, "error.not_admin") && x.row.updated_at === row0.updated_at && x.closed && (await versionShown(Q)) === 3,
      { answer: x.answer, shown: await F.error.textContent().catch(() => null) });
    await close(Q);
  }
  // Switched off: nothing to show again.
  {
    const Q = await openEditor({ tool: "compress", row: "off" });
    const F = L(Q);
    check("A", `tutorial switched off (saved) → disabled, hint "${A(Q.locale, "again.offHint")}"`, (await F.again.isDisabled()) && (await againHint(Q)) === A(Q.locale, "again.offHint"));
    await F.tutSwitch.click();
    check("A", "…switching it on (unsaved) → still disabled, now with the dirty hint", (await F.again.isDisabled()) && (await againHint(Q)) === A(Q.locale, "again.dirtyHint"));
    await save(Q);
    check("A", "…saved on → enabled, hint 2 → 3", !(await F.again.isDisabled()) && (await againHint(Q)) === A(Q.locale, "again.hint", { n: 2, next: 3 }));
    await close(Q);
  }
  // At the database's bound.
  {
    const Q = await openEditor({ tool, row: "max" });
    const F = L(Q);
    check("A", `version ${MAX_VERSION} → disabled, hint "${A(Q.locale, "again.maxHint")}"`, (await F.again.isDisabled()) && (await againHint(Q)) === A(Q.locale, "again.maxHint") && (await versionShown(Q)) === MAX_VERSION);
    await close(Q);
  }
  // A tool without a starter: the row it creates keeps the starter off.
  {
    const Q = await openEditor({ tool: "tool_watermark", row: "none" });
    const x = await showAgain(Q, "confirm");
    check("A", "tool_watermark (no row): show again → v2 row with tutorial on, starter OFF (guideHasStarter false), content null",
      x.answer?.ok === true && x.row?.tutorial_version === 2 && x.row.tutorial_enabled === true && x.row.starter_enabled === false && x.row.content === null, x.row);
    await close(Q);
  }
  // The German UI's words.
  {
    const Q = await openEditor({ tool, row: "custom", locale: "de" });
    const x = await showAgain(Q, "cancel");
    check("A", "DE: button, hint and confirm in German", (await L(Q).again.textContent())?.trim() === A("de", "again.button")
      && (await againHint(Q)) === A("de", "again.hint", { n: 3, next: 4 }) && x.dialog.text.includes(A("de", "again.confirmBody", { n: 3, next: 4 })) && x.n === 0, x.dialog);
    await shot(Q, "A-status-1440-light-de");
    await close(Q);
  }
}

/* ── 8. LAYOUT ─────────────────────────────────────────────────────────── */

async function measure(P) {
  return P.page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const card = document.querySelector("[data-tool-guide-admin]");
    const cr = card.getBoundingClientRect();
    const desc = (el) => {
      const t = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
      return `${el.tagName.toLowerCase()}${el.hasAttribute("data-picker-item") ? "" : ""}"${t}"`;
    };
    const out = { pageOverflow: de.scrollWidth - vw, clipped: [], outside: [], truncated: [], truncatedFile: [] };
    for (const el of card.querySelectorAll("button, label, [role=switch], h2, h3, h4, p, figcaption, select, input, textarea, [class*=rounded-full]")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.closest(".sr-only")) continue;
      const inFrame = Boolean(el.closest("[data-preview-frame] > div"));
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!inFrame && el.clientWidth > 0 && !["SELECT", "INPUT", "TEXTAREA"].includes(el.tagName) && cs.textOverflow !== "ellipsis") {
        // The laid-out CONTENT against the element's box. scrollWidth/Height
        // would also count decorative pseudo-elements (the switch's 44 px
        // ::after touch area, .cta's ::before light), which clip nothing.
        const range = document.createRange();
        range.selectNodeContents(el);
        const cr2 = range.getBoundingClientRect();
        if (cr2.width > 0 && (cr2.right > r.right + 1 || cr2.left < r.left - 1)) out.clipped.push(`${desc(el)} content x [${Math.round(cr2.left)},${Math.round(cr2.right)}] box [${Math.round(r.left)},${Math.round(r.right)}]`);
        if (el.tagName === "BUTTON" && cr2.height > 0 && (cr2.bottom > r.bottom + 1 || cr2.top < r.top - 1)) out.clipped.push(`${desc(el)} content y [${Math.round(cr2.top)},${Math.round(cr2.bottom)}] box [${Math.round(r.top)},${Math.round(r.bottom)}]`);
      }
      if (!inFrame && (r.right > cr.right + 1 || r.left < cr.left - 1 || r.right > vw + 1)) out.outside.push(`${desc(el)} [${Math.round(r.left)},${Math.round(r.right)}] card [${Math.round(cr.left)},${Math.round(cr.right)}]`);
    }
    for (const el of card.querySelectorAll("*")) {
      if (el.closest("[data-preview-frame] > div")) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) {
        const isFile = /\.(png|webp|jpe?g)$/i.test(el.textContent.trim());
        (isFile ? out.truncatedFile : out.truncated).push(`${desc(el)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    return out;
  });
}

async function group8() {
  console.log("\n[8] layout");
  for (const w of [390, 834, 1440]) {
    for (const theme of ["light", "dark"]) {
      for (const l of LOCALES) {
        const P = await openEditor({ tool: "retouch", row: "custom", vp: VP[w], theme, locale: l });
        const E = L(P);
        // Long German labels are the stress case: a 4th step with a long title, starter preview open.
        await E.add.click();
        await E.stepTitle(4).fill(l === "de" ? "Ein ziemlich langer deutscher Schrittitel zum Testen der Umbrüche" : "Krok (probe)");
        await E.previewSta.click();
        await E.starterPreview.waitFor();
        await sleep(350);
        const isDark = await P.page.evaluate(() => document.documentElement.classList.contains("dark"));
        check(8, `${w}/${theme}/${l}: theme applied`, isDark === (theme === "dark"), { isDark });
        const m = await measure(P);
        check(8, `${w}/${theme}/${l}: no horizontal page overflow`, m.pageOverflow <= 0, m.pageOverflow);
        check(8, `${w}/${theme}/${l}: no clipped buttons/labels/texts`, m.clipped.length === 0, m.clipped.slice(0, 6));
        check(8, `${w}/${theme}/${l}: nothing pokes out of the card`, m.outside.length === 0, m.outside.slice(0, 6));
        check(8, `${w}/${theme}/${l}: no ellipsis-truncated label (file names excepted)`, m.truncated.length === 0, m.truncated.slice(0, 6));
        if (m.truncatedFile.length) info(8, `${w}/${theme}/${l}: long file names truncated with an ellipsis (intended): ${m.truncatedFile.length}`);
        await shot(P, `8-${w}-${theme}-${l}`, { fullPage: true });
        // The illustration chooser (a step with a photo: its longest state).
        await E.changeIll(1).click();
        await E.chooser.waitFor();
        await sleep(350);
        const ch = await chooserGeom(P);
        check(8, `${w}/${theme}/${l}: the illustration chooser fits the viewport, nothing in it clipped or sideways`,
          ch && ch.fits && ch.overflowX === false && ch.clipped.length === 0 && ch.pageOverflow <= 0, ch);
        await shot(P, `8-${w}-${theme}-${l}-chooser`);
        await P.page.keyboard.press("Escape");
        await E.chooser.waitFor({ state: "detached" });
        await close(P);
        // A screen without a starter gallery: the same card, one switch, no starter form.
        const Q = await openEditor({ tool: "tool_watermark", row: "none", vp: VP[w], theme, locale: l });
        const F = L(Q);
        await F.add.click();
        await F.stepTitle(6).fill(l === "de" ? "Ein ziemlich langer deutscher Schrittitel zum Testen der Umbrüche" : "Krok (probe)");
        await sleep(250);
        const n = await measure(Q);
        check(8, `${w}/${theme}/${l} tool_watermark: no page overflow, nothing clipped, nothing outside the card, no truncated label`,
          n.pageOverflow <= 0 && n.clipped.length === 0 && n.outside.length === 0 && n.truncated.length === 0,
          { pageOverflow: n.pageOverflow, clipped: n.clipped.slice(0, 4), outside: n.outside.slice(0, 4), truncated: n.truncated.slice(0, 4) });
        await shot(Q, `8-tool_watermark-${w}-${theme}-${l}`, { fullPage: true });
        await close(Q);
      }
    }
  }
}

/** The open "Zmień ilustrację" dialog: inside the viewport, no sideways scroll, no clipped label. */
async function chooserGeom(P) {
  return P.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].find((x) => x.querySelector("[data-guide-illustration-chooser]"));
    if (!d) return null;
    const box = d.querySelector(".overlay") ?? d.firstElementChild?.nextElementSibling;
    const r = box.getBoundingClientRect();
    const clipped = [];
    for (const el of box.querySelectorAll("button, p, h2, span")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.closest(".sr-only")) continue;
      const er = el.getBoundingClientRect();
      if (er.width === 0) continue;
      if (er.right > r.right + 1 || er.left < r.left - 1) clipped.push(`${el.tagName} "${el.textContent.trim().slice(0, 30)}" outside`);
      else if (el.tagName === "BUTTON" && el.scrollWidth > el.clientWidth + 1) clipped.push(`${el.tagName} "${el.textContent.trim().slice(0, 30)}" clipped`);
    }
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vw: innerWidth, vh: innerHeight,
      fits: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
      overflowX: box.scrollWidth > box.clientWidth + 1, scrollsY: box.scrollHeight > box.clientHeight + 1,
      arts: box.querySelectorAll("[data-guide-art]").length, clipped: clipped.slice(0, 6),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/* ── 9. KEYBOARD / A11Y ────────────────────────────────────────────────── */

async function group9() {
  console.log("\n[9] keyboard / a11y");
  for (const l of LOCALES) {
    const P = await openEditor({ tool: "retouch", row: "custom", locale: l });
    const names9 = await P.page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const nameOf = (el) => {
        if (el.getAttribute("aria-labelledby")) return el.getAttribute("aria-labelledby").split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim();
        if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
        if (el.labels && el.labels.length) return [...el.labels].map(text).join(" ").trim();
        return el.tagName === "BUTTON" ? text(el) : "";
      };
      const noName = [...root.querySelectorAll("input, textarea, select, button, [role=switch]")]
        .filter((el) => !nameOf(el)).map((el) => el.outerHTML.slice(0, 120));
      const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      const refs = [...root.querySelectorAll("[aria-describedby],[aria-labelledby],label[for]")].flatMap((el) =>
        (el.getAttribute("aria-describedby") || el.getAttribute("aria-labelledby") || el.getAttribute("for") || "").split(/\s+/).filter(Boolean)
          .filter((id) => !document.getElementById(id)).map((id) => `${el.tagName}→${id}`));
      return { noName, dup: [...new Set(dup)], refs, count: root.querySelectorAll("input, textarea, select, button, [role=switch]").length };
    }, ED);
    check(9, `${l}: all ${names9.count} inputs/selects/buttons/switches have an accessible name`, names9.noName.length === 0, names9.noName.slice(0, 5));
    check(9, `${l}: no duplicate ids, every aria-describedby/labelledby/for resolves`, names9.dup.length === 0 && names9.refs.length === 0, names9);
    const sw = await P.page.getByRole("switch", { name: A(l, "tutorialEnabled"), exact: true }).count();
    const grp = await P.page.getByRole("group", { name: A(l, "lang.label"), exact: true }).count();
    const tt = await P.page.getByRole("textbox", { name: `${A(l, "tutorial.title")} · PL`, exact: true }).count();
    check(9, `${l}: roles+names: switch '${A(l, "tutorialEnabled")}', group '${A(l, "lang.label")}', textbox '${A(l, "tutorial.title")} · PL'`, sw === 1 && grp === 1 && tt === 1, { sw, grp, tt });
    if (l !== "pl") { await close(P); continue; }

    // Focus visible, walking the whole editor with Tab: the focused style
    // (outline / box-shadow / border colour) must differ from the resting one.
    await L(P).tutSwitch.focus();
    const seen = [];
    for (let i = 0; i < 160; i++) {
      const s = await P.page.evaluate(({ sel, i }) => {
        const el = document.activeElement;
        if (!el || !document.querySelector(sel).contains(el)) return { out: true };
        const cs = getComputedStyle(el);
        el.setAttribute("data-probe-focus", String(i));
        return {
          out: false, i, tag: el.tagName, fv: el.matches(":focus-visible"),
          name: (el.getAttribute("aria-label") || el.textContent || el.id).replace(/\s+/g, " ").trim().slice(0, 40),
          st: [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor].join("|"),
        };
      }, { sel: ED, i });
      if (s.out) break;
      seen.push(s);
      await P.page.keyboard.press("Tab");
    }
    await P.page.evaluate(() => { document.activeElement?.blur?.(); });
    const resting = await P.page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-probe-focus]")].map((el) => {
      const cs = getComputedStyle(el);
      return [el.getAttribute("data-probe-focus"), [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor].join("|")];
    })));
    const noRing = seen.filter((s) => s.st === resting[String(s.i)]).map((s) => `${s.tag} "${s.name}"`);
    const tags = seen.reduce((m, s) => ({ ...m, [s.tag]: (m[s.tag] ?? 0) + 1 }), {});
    check(9, `Tab walks ${seen.length} controls in the editor (${JSON.stringify(tags)}); each looks different when focused`,
      seen.length > 20 && noRing.length === 0 && seen.every((s) => s.fv), noRing.slice(0, 8));

    // The preview dialog: focus in, trapped, restored.
    await L(P).previewTut.focus();
    await P.page.keyboard.press("Enter");
    await L(P).dialog.waitFor();
    await until(() => P.page.evaluate((sel) => document.querySelector(sel)?.contains(document.activeElement), DLG), 3000);
    const startIn = await P.page.evaluate((sel) => document.querySelector(sel)?.contains(document.activeElement), DLG);
    check(9, "keyboard-opened preview moves focus into the dialog", startIn);
    let escaped = 0;
    for (let i = 0; i < 12; i++) {
      await P.page.keyboard.press("Tab");
      if (!(await P.page.evaluate((sel) => document.querySelector(sel)?.contains(document.activeElement), DLG))) escaped++;
    }
    for (let i = 0; i < 12; i++) {
      await P.page.keyboard.press("Shift+Tab");
      if (!(await P.page.evaluate((sel) => document.querySelector(sel)?.contains(document.activeElement), DLG))) escaped++;
    }
    check(9, "Tab ×12 and Shift+Tab ×12 never leave the preview dialog", escaped === 0, { escaped });
    const lbl = await P.page.evaluate((sel) => {
      const d = document.querySelector(sel);
      return { labelled: document.getElementById(d.getAttribute("aria-labelledby"))?.textContent?.trim() ?? null, modal: d.getAttribute("aria-modal") };
    }, DLG);
    check(9, "preview dialog: aria-modal, labelled by its title", lbl.modal === "true" && lbl.labelled === "Własny samouczek (probe)", lbl);
    await P.page.keyboard.press("Escape");
    await L(P).dialog.waitFor({ state: "detached" });
    await sleep(100);
    const back = await P.page.evaluate(() => document.activeElement?.hasAttribute("data-guide-preview-tutorial") ?? false);
    check(9, "Escape closes the preview and focus returns to the preview button", back);

    // "Zmień ilustrację" and the picker it leads to (the shared Modal): focus
    // in on open, back to the opener on close.
    const inDlg = (sel) => P.page.evaluate((x) => {
      const d = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].find((y) => y.querySelector(x));
      return Boolean(d && d.contains(document.activeElement));
    }, sel);
    const where = () => P.page.evaluate(() => {
      const el = document.activeElement;
      return `${el?.tagName} "${(el?.getAttribute("aria-label") || el?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}" in step ${el?.closest("[data-guide-step-form]")?.getAttribute("data-guide-step-form") ?? "-"}`;
    });
    const onOpener = () => P.page.evaluate(() => document.activeElement?.getAttribute("data-guide-change-illustration") === "3");
    const opener = L(P).changeIll(3);
    await opener.focus();
    await P.page.keyboard.press("Enter");
    await L(P).chooser.waitFor();
    await sleep(200);
    let onOpen = await inDlg("[data-guide-illustration-chooser]");
    await P.page.keyboard.press("Tab");
    let afterTab = await inDlg("[data-guide-illustration-chooser]");
    check(9, "keyboard-opened 'Zmień ilustrację' chooser: focus is in the dialog (on open, or at the latest after one Tab)", onOpen || afterTab, { onOpen, afterTab, focusAfterTab: await where() });
    await P.page.keyboard.press("Escape");
    await L(P).chooser.waitFor({ state: "detached" });
    await opener.focus();
    await P.page.keyboard.press("Enter");
    await L(P).chooser.waitFor();
    await L(P).chooserArt("upload").focus();
    await P.page.keyboard.press("Escape");
    await L(P).chooser.waitFor({ state: "detached" });
    await sleep(100);
    check(9, "closing the chooser (Escape, focus inside it) returns focus to step 3's 'Zmień ilustrację'", await onOpener(), await where());
    // Chooser → picker, from the keyboard.
    await opener.focus();
    await P.page.keyboard.press("Enter");
    await L(P).chooser.waitFor();
    await L(P).chooserPick.focus();
    await P.page.keyboard.press("Enter");
    await L(P).picker.waitFor();
    await sleep(200);
    onOpen = await inDlg("[data-picker-search]");
    await P.page.keyboard.press("Tab");
    afterTab = await inDlg("[data-picker-search]");
    check(9, "keyboard: chooser → library picker: focus is in the picker (on open, or at the latest after one Tab)", onOpen || afterTab, { onOpen, afterTab, focusAfterTab: await where() });
    await L(P).picker.locator("[data-picker-search]").focus();
    await P.page.keyboard.press("Escape");
    await L(P).picker.waitFor({ state: "detached" });
    await sleep(100);
    check(9, "closing that picker returns focus to step 3's 'Zmień ilustrację' (its chooser is gone)", await onOpener(), await where());
    // The delete confirm.
    await L(P).remove(2).focus();
    await P.page.keyboard.press("Enter");
    await L(P).removeConfirm(2).waitFor();
    await sleep(150);
    const dIn = await P.page.evaluate((lbl) => document.querySelector(`[role="dialog"][aria-label="${lbl}"]`)?.contains(document.activeElement) ?? false, A(l, "step.removeConfirmTitle", { n: 2 }));
    check(9, "keyboard-opened delete confirm: focus moves into the dialog", dIn, { active: await where() });
    await P.page.keyboard.press("Escape");
    await L(P).removeConfirm(2).waitFor({ state: "detached" });
    await sleep(100);
    check(9, "…Escape keeps the step and returns focus to its delete button",
      (await L(P).steps.count()) === 3 && (await P.page.evaluate((lbl) => document.activeElement?.getAttribute("aria-label") === lbl, A(l, "step.remove", { n: 2 }))), await where());
    // The show-again confirm.
    await L(P).again.focus();
    await P.page.keyboard.press("Enter");
    await L(P).againConfirm.waitFor();
    await sleep(150);
    const aIn = await P.page.evaluate((lbl) => document.querySelector(`[role="dialog"][aria-label="${lbl}"]`)?.contains(document.activeElement) ?? false, A(l, "again.confirmTitle"));
    check(9, "keyboard-opened show-again confirm: focus moves into the dialog", aIn, { active: await where() });
    await P.page.keyboard.press("Escape");
    await L(P).againConfirm.waitFor({ state: "detached" });
    // The reset confirm uses the same Modal.
    await L(P).reset.focus();
    await P.page.keyboard.press("Enter");
    await L(P).confirm.waitFor();
    await sleep(150);
    const cIn = await P.page.evaluate((lbl) => document.querySelector(`[role="dialog"][aria-label="${lbl}"]`)?.contains(document.activeElement) ?? false, A(l, "resetConfirmTitle"));
    check(9, "keyboard-opened reset confirm: focus moves into the dialog", cIn, { active: await P.page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40)) });
    await P.page.keyboard.press("Escape");
    await L(P).confirm.waitFor({ state: "detached" });

    // Keyboard reorder keeps focus on the moved step's control.
    await L(P).down(1).focus();
    await P.page.keyboard.press("Enter");
    await sleep(150);
    const f1 = await P.page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
    info(9, `after keyboard 'move step 1 down', focus is on: ${f1}`);
    await close(P);
  }
}

/* ── run ───────────────────────────────────────────────────────────────── */

// Warm the dev server (first compile of the harness can take a minute or two).
{
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/probe-tmp/admin-guide/calls?sid=warmup`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await sleep(2000);
  }
  const w = await openEditor({ tool: "retouch" });
  await close(w);
  console.log(`dev server warm (${Math.round((Date.now() - t0) / 1000)} s)`);
}

const RUN = [["1", group1], ["Z", groupZ], ["S", groupS], ["2", group2], ["3", group3], ["4", group4], ["5", group5], ["6", group6], ["7", group7], ["A", groupA], ["8", group8], ["9", group9]];
for (const [id, fn] of RUN) {
  if (!shouldRun(id)) continue;
  try { await fn(); }
  catch (e) { check(id, `group ${id} ran to the end`, false, String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")); }
}

// N + C over every page this run opened.
{
  const supa = allPages.flatMap((P) => P.rec.supabase);
  const ext = allPages.flatMap((P) => P.rec.external);
  check("N", `no request from the browser reached Supabase (${allPages.length} pages)`, supa.length === 0, supa.slice(0, 5));
  check("N", "no request from the browser left the dev origin", ext.length === 0, ext.slice(0, 5));
  const acts = allPages.reduce((n, P) => n + P.rec.actions.length, 0);
  info("N", `server-action POSTs observed: ${acts} (all answered by the stub)`);
  const cons = allPages.flatMap((P) => P.rec.console.map((c) => `${P.tool}/${P.locale}: ${c}`)).filter((c) => !consoleExpected.some((re) => re.test(c)));
  const errs = allPages.flatMap((P) => P.rec.errors);
  check("C", "no unexpected console errors/warnings", cons.length === 0, [...new Set(cons)].slice(0, 8));
  check("C", "no page errors", errs.length === 0, [...new Set(errs)].slice(0, 5));
}

await browser.close();

console.log("\n══ SCOREBOARD ══");
let failed = 0;
for (const [id, title] of GROUPS) {
  const r = results.get(id);
  if (r.pass === 0 && r.fail.length === 0) { console.log(`  –  ${id}. ${title} (not run)`); continue; }
  console.log(`  ${r.fail.length ? "✗" : "✓"}  ${id}. ${title} — ${r.pass} passed, ${r.fail.length} failed`);
  for (const f of r.fail) console.log(`       ✗ ${f}`);
  failed += r.fail.length;
}
if (shots.length) console.log(`\nscreenshots (${shots.length}):\n  ${shots.join("\n  ")}`);
process.exit(failed ? 1 : 0);

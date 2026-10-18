/**
 * TRIAL WATERMARK — THE ADMIN SECTION. npm run test:trialwm:admin
 *
 *   A  the config row: parse / serialize / strict validation, including
 *      force_trial_user_ids (uuid[] ≤ 10), and the seed in 0143 carrying
 *      exactly the serializer's keys
 *   S  saveTrialWatermarkAction: the role re-check, strict validation, the
 *      migration gate, the confirmed switch-on (with its asset and server-key
 *      preconditions), the whole-row upsert, the audit entry before/after
 *   P  trialWatermarkPanelAction: the stats reply read defensively, a failed
 *      settings read is a failure (never the defaults), the asset check
 *   V  previewTrialWatermarkAction: admin only, strict visual params, exactly
 *      one source, the 10 MB / pixel caps, a media name that is an object
 *      name, the real engine on real pixels, ≤ 1600 px JPEG back, nothing
 *      written anywhere
 *   X  the generic editor: /admin/system hides the row, saveSettingAction
 *      refuses it (before any read), no nav entry, the layout key never named
 *   I  every key the section uses exists in all three locales of the scratch
 *      dictionary, and the policy text says what design-v2 D2/D5/R33 decide
 *
 * Mocks only — no network, no database, no AI.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import {
  TRIAL_WATERMARK_DEFAULTS, TRIAL_WATERMARK_FORCE_MAX, TRIAL_WATERMARK_PREVIEW, TRIAL_WATERMARK_SETTING_KEY,
  parseTrialWatermarkConfig, serializeTrialWatermarkConfig, validateTrialWatermarkInput,
} from "@/lib/trial-watermark/config";
import {
  previewTrialWatermarkAction, saveTrialWatermarkAction, trialWatermarkPanelAction,
} from "@/app/actions/trial-watermark-admin";
import { saveSettingAction } from "@/app/actions/admin";

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passes++; console.log(`  ✓ ${name}`); }
  else { failures++; console.error(`  ✗ ${name}${detail === undefined ? "" : ` — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300)}`}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SCRATCH = "/tmp/claude-0/-home-user-EcomStudio/bfec86f8-7073-55e5-8738-75a4d2a4aeac/scratchpad/wm/i18n-admin.json";
const U1 = "c0000000-0000-4000-8000-000000000001";
const U2 = "C0000000-0000-4000-8000-00000000000A";
const ids = (n: number) => Array.from({ length: n }, (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

/* ── a fake session client ───────────────────────────────────────────── */

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][]; opts?: unknown };
type FakeOpts = {
  user?: { id: string } | null;
  role?: string | null;
  /** The stored trial_watermark row; "error" = the read fails; null = no row (before 0143). */
  row?: { value: unknown; updated_at?: string } | null | "error";
  upsertError?: boolean;
  stats?: { data?: unknown; error?: { message: string; code?: string } };
  media?: Record<string, Blob>;
};

function fakeDb(o: FakeOpts) {
  const calls: Call[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const user = o.user === undefined ? { id: "admin-1" } : o.user;
  const from = (table: string) => {
    const q: Call = { table, op: "select", filters: [] };
    const b = {
      select() { return b; },
      eq(col: string, val: unknown) { q.filters.push([col, val]); return b; },
      not() { return b; },
      order() { return b; },
      limit() { return b; },
      async maybeSingle() {
        calls.push({ ...q });
        if (table === "profiles") return { data: user ? { role: o.role === undefined ? "admin" : o.role, id: user.id } : null, error: null };
        if (table === "app_settings") {
          if (o.row === "error") return { data: null, error: { message: "boom" } };
          return { data: o.row ?? null, error: null };
        }
        return { data: null, error: null };
      },
      upsert(payload: unknown, opts?: unknown) {
        calls.push({ table, op: "upsert", payload, filters: [], opts });
        return Promise.resolve({ error: o.upsertError ? { message: "denied" } : null });
      },
      insert(payload: unknown) {
        calls.push({ table, op: "insert", payload, filters: [] });
        return Promise.resolve({ error: null });
      },
      update(payload: unknown) {
        calls.push({ table, op: "update", payload, filters: [] });
        return b;
      },
    };
    return b;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from,
    rpc: async (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      if (fn === "trial_watermark_stats") return { data: o.stats?.data ?? null, error: o.stats?.error ?? null };
      return { data: null, error: { message: "unexpected rpc", code: "PGRST202" } };
    },
    storage: {
      from: (bucket: string) => ({
        download: async (name: string) => {
          calls.push({ table: `storage:${bucket}`, op: "download", payload: name, filters: [] });
          const blob = bucket === "media" ? o.media?.[name] : undefined;
          return blob ? { data: blob, error: null } : { data: null, error: { message: "Object not found" } };
        },
        upload: async (name: string) => {
          calls.push({ table: `storage:${bucket}`, op: "upload", payload: name, filters: [] });
          return { data: null, error: null };
        },
      }),
    },
  };
  (globalThis as unknown as { __apiFakeDb?: unknown }).__apiFakeDb = client;
  const writes = () => calls.filter((c) => c.op !== "select" && c.op !== "download");
  return { calls, rpcs, writes };
}

const SERVER_KEY = "test-server-key-0123456789abcdefghijklmnop";
const setServerKey = (on: boolean) => {
  delete process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  if (on) process.env.GROVBASE_SERVER_KEY = SERVER_KEY;
  else delete process.env.GROVBASE_SERVER_KEY;
};

const validInput = (over: Record<string, unknown> = {}) => ({ ...TRIAL_WATERMARK_DEFAULTS, ...over });
const storedRow = (over: Record<string, unknown> = {}) => ({
  value: { ...serializeTrialWatermarkConfig(TRIAL_WATERMARK_DEFAULTS), ...over },
  updated_at: "2026-10-01T10:00:00Z",
});

/* ── A ─────────────────────────────────────────────────────────────────── */

function sectionA() {
  console.log("\nA. the config row: force_trial_user_ids, strict validation, serializer ↔ 0143 seed");
  check("A1 defaults carry an empty force list", same(TRIAL_WATERMARK_DEFAULTS.forceTrialUserIds, []));
  check("A2 the cap is 10", TRIAL_WATERMARK_FORCE_MAX === 10);

  const parsed = parseTrialWatermarkConfig({
    force_trial_user_ids: ["not-a-uuid", 5, null, U2, U2.toLowerCase(), { id: 1 }, U1],
  });
  check("A3 parse keeps valid uuids only, lower-cased, first occurrence kept",
    same(parsed.forceTrialUserIds, [U2.toLowerCase(), U1]), parsed.forceTrialUserIds);
  check("A4 parse of a non-array is []", same(parseTrialWatermarkConfig({ force_trial_user_ids: U1 }).forceTrialUserIds, []));
  check("A5 parse of a missing row is the defaults", same(parseTrialWatermarkConfig(null), TRIAL_WATERMARK_DEFAULTS));
  check("A6 one bad field never resets the rest (force list kept beside a bad opacity)",
    (() => { const c = parseTrialWatermarkConfig({ opacity: "lots", force_trial_user_ids: [U1] }); return c.opacity === 0.38 && same(c.forceTrialUserIds, [U1]); })());

  const cfg = { ...TRIAL_WATERMARK_DEFAULTS, enabled: true, forceTrialUserIds: [U1, U2] };
  const row = serializeTrialWatermarkConfig(cfg);
  check("A7 serialize writes force_trial_user_ids lower-cased", same(row.force_trial_user_ids, [U1, U2.toLowerCase()]), row);
  check("A8 round trip parse(serialize(c)) equals c (ids normalised)",
    same(parseTrialWatermarkConfig(row), { ...cfg, forceTrialUserIds: [U1, U2.toLowerCase()] }));

  // The seed in 0143 must carry exactly the serializer's keys (SQL M7 checks the values).
  const mig = read("supabase/migrations/0143_trial_watermark.sql");
  const seed = /insert into public\.app_settings \(key, value\)\s*values \('trial_watermark', jsonb_build_object\(([\s\S]*?)\)\)\s*on conflict/.exec(mig);
  const seedKeys = seed ? [...seed[1].matchAll(/'([a-z_]+)',/g)].map((m) => m[1]).sort() : [];
  check("A9 the 0143 seed has exactly the serializer's keys", seed !== null && same(seedKeys, Object.keys(row).sort()), seedKeys);
  check("A10 SQL reads force_trial_user_ids with the same uuid shape",
    /force_trial_user_ids/.test(mig) && mig.includes("'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"));

  const ok = validateTrialWatermarkInput(validInput({ forceTrialUserIds: [U2] }));
  check("A11 validate accepts a uuid and lower-cases it", ok.ok && same(ok.config.forceTrialUserIds, [U2.toLowerCase()]));
  check("A12 validate accepts exactly 10", validateTrialWatermarkInput(validInput({ forceTrialUserIds: ids(10) })).ok);
  const bad = (v: unknown) => {
    const r = validateTrialWatermarkInput(validInput({ forceTrialUserIds: v }));
    return !r.ok && r.field === "forceTrialUserIds";
  };
  check("A13 11 ids → forceTrialUserIds", bad(ids(11)));
  check("A14 a non-uuid → forceTrialUserIds", bad([U1, "abc"]));
  check("A15 the same id twice (any case) → forceTrialUserIds", bad([U2, U2.toLowerCase()]));
  check("A16 not an array / missing → forceTrialUserIds", bad(U1) && bad(undefined) && bad(null) && bad([5]));
  // Nothing else in the validator moved.
  const field = (over: Record<string, unknown>) => { const r = validateTrialWatermarkInput(validInput(over)); return r.ok ? null : r.field; };
  check("A17 the existing fields are still validated first, in order",
    field({ enabled: "yes" }) === "enabled" && field({ widthRatio: 0.95 }) === "widthRatio" && field({ opacity: 0 }) === "opacity"
    && field({ darkColor: "red" }) === "darkColor" && field({ glowRadiusRatio: 0.2 }) === "glowRadiusRatio"
    && field({ originalRetentionDays: 1.5 }) === "originalRetentionDays" && field({ signedUrlTtlSeconds: 5 }) === "signedUrlTtlSeconds"
    && field({ exemptStaff: 1 }) === "exemptStaff" && field({ widthRatio: Number.NaN }) === "widthRatio");
  check("A18 a non-object is refused", !validateTrialWatermarkInput(null).ok && !validateTrialWatermarkInput([1]).ok);

  check("A19 preview caps: 10 MB, 1600 px, upload under the 4.5 MB action body",
    TRIAL_WATERMARK_PREVIEW.maxBytes === 10 * 1024 * 1024 && TRIAL_WATERMARK_PREVIEW.maxSide === 1600
    && TRIAL_WATERMARK_PREVIEW.uploadMaxBytes < 4.5 * 1024 * 1024 && TRIAL_WATERMARK_PREVIEW.uploadMaxBytes > 4 * 1024 * 1024
    && /bodySizeLimit: '4\.5mb'/.test(read("next.config.mjs")));
}

/* ── S ─────────────────────────────────────────────────────────────────── */

async function sectionS() {
  console.log("\nS. saveTrialWatermarkAction");
  setServerKey(true);

  let db = fakeDb({ user: null, row: storedRow() });
  let r = await saveTrialWatermarkAction(validInput());
  check("S1 no session → forbidden, nothing read or written", !r.ok && r.error === "forbidden" && db.writes().length === 0
    && !db.calls.some((c) => c.table === "app_settings"));

  db = fakeDb({ role: "user", row: storedRow() });
  r = await saveTrialWatermarkAction(validInput());
  check("S2 a customer → forbidden, nothing written", !r.ok && r.error === "forbidden" && db.writes().length === 0);

  db = fakeDb({ role: "user", row: storedRow() });
  r = await saveTrialWatermarkAction(validInput({ opacity: 7 }));
  check("S3 a customer with an invalid body still gets forbidden (validation is not an oracle)", !r.ok && r.error === "forbidden");

  db = fakeDb({ row: storedRow() });
  r = await saveTrialWatermarkAction(validInput({ forceTrialUserIds: ids(11) }));
  check("S4 admin + 11 forced ids → invalid/forceTrialUserIds, nothing written",
    !r.ok && r.error === "invalid" && r.field === "forceTrialUserIds" && db.writes().length === 0);

  db = fakeDb({ row: storedRow() });
  r = await saveTrialWatermarkAction({ ...validInput(), widthRatio: "0.5" });
  check("S5 a number sent as text is invalid (strict, not coerced)", !r.ok && r.field === "widthRatio" && db.writes().length === 0);

  db = fakeDb({ row: null });
  r = await saveTrialWatermarkAction(validInput());
  check("S6 no seeded row (0143 not applied) → migration_pending, nothing created", !r.ok && r.error === "migration_pending" && db.writes().length === 0);

  db = fakeDb({ row: "error" });
  r = await saveTrialWatermarkAction(validInput());
  check("S7 a failed read → generic, nothing written", !r.ok && r.error === "generic" && db.writes().length === 0);

  db = fakeDb({ row: storedRow({ opacity: 0.5, stray: "x" }) });
  const next = validInput({ widthRatio: 0.4, darkColor: "#ABCDEF", forceTrialUserIds: [U2] });
  r = await saveTrialWatermarkAction(next);
  const up = db.calls.find((c) => c.op === "upsert");
  const audit = db.calls.find((c) => c.table === "audit_logs" && c.op === "insert")?.payload as Record<string, unknown> | undefined;
  const expected = serializeTrialWatermarkConfig({ ...TRIAL_WATERMARK_DEFAULTS, widthRatio: 0.4, darkColor: "#abcdef", forceTrialUserIds: [U2.toLowerCase()] });
  check("S8 a valid edit saves", r.ok, r);
  check("S9 the whole row is upserted on its key, exactly as serialized",
    !!up && up.table === "app_settings" && (up.payload as { key: string }).key === TRIAL_WATERMARK_SETTING_KEY
    && same((up.payload as { value: unknown }).value, expected) && same(up.opts, { onConflict: "key" })
    && typeof (up.payload as { updated_at?: unknown }).updated_at === "string", up);
  check("S10 audited: actor, action, entity, the row as stored before and as written after",
    !!audit && audit.actor_id === "admin-1" && audit.action === "admin.trial_watermark_saved" && audit.entity_type === "app_settings"
    && audit.entity_id === "trial_watermark" && same(audit.before, storedRow({ opacity: 0.5, stray: "x" }).value) && same(audit.after, expected), audit);

  db = fakeDb({ row: storedRow() });
  r = await saveTrialWatermarkAction(validInput({ enabled: true }));
  check("S11 switching ON without the confirmation → confirm_required, nothing written",
    !r.ok && r.error === "confirm_required" && db.writes().length === 0);

  db = fakeDb({ row: storedRow() });
  r = await saveTrialWatermarkAction(validInput({ enabled: true }), "yes" as unknown as boolean);
  check("S12 only a literal true confirms", !r.ok && r.error === "confirm_required" && db.writes().length === 0);

  db = fakeDb({ row: storedRow() });
  r = await saveTrialWatermarkAction(validInput({ enabled: true }), true);
  const onAudit = db.calls.find((c) => c.table === "audit_logs")?.payload as Record<string, unknown> | undefined;
  check("S13 switching ON with the confirmation saves enabled:true and audits admin.trial_watermark_enabled",
    r.ok && (db.calls.find((c) => c.op === "upsert")?.payload as { value: { enabled: boolean } }).value.enabled === true
    && onAudit?.action === "admin.trial_watermark_enabled", r);

  db = fakeDb({ row: storedRow({ enabled: true }) });
  r = await saveTrialWatermarkAction(validInput({ enabled: true, opacity: 0.5 }));
  check("S14 an edit while already ON needs no confirmation", r.ok && (db.calls.find((c) => c.table === "audit_logs")?.payload as Record<string, unknown>).action === "admin.trial_watermark_saved");

  db = fakeDb({ row: storedRow({ enabled: true }) });
  r = await saveTrialWatermarkAction(validInput({ enabled: false }));
  check("S15 switching OFF needs no confirmation and is audited as disabled",
    r.ok && (db.calls.find((c) => c.table === "audit_logs")?.payload as Record<string, unknown>).action === "admin.trial_watermark_disabled");

  db = fakeDb({ row: storedRow({ enabled: "true" }) });
  r = await saveTrialWatermarkAction(validInput({ enabled: true }));
  check("S16 a stored \"true\" string is OFF (as SQL reads it), so ON still needs the confirmation", !r.ok && r.error === "confirm_required");

  setServerKey(false);
  db = fakeDb({ row: storedRow() });
  r = await saveTrialWatermarkAction(validInput({ enabled: true }), true);
  check("S17 no server key → switching ON refused (server_key_missing), nothing written",
    !r.ok && r.error === "server_key_missing" && db.writes().length === 0);
  db = fakeDb({ row: storedRow({ enabled: true }) });
  r = await saveTrialWatermarkAction(validInput({ enabled: false }));
  check("S18 …while switching OFF still works without it", r.ok);
  setServerKey(true);

  db = fakeDb({ row: storedRow(), upsertError: true });
  r = await saveTrialWatermarkAction(validInput());
  check("S19 a refused write → generic, no audit entry", !r.ok && r.error === "generic" && !db.calls.some((c) => c.table === "audit_logs"));

  const src = codeOnly(read("app/actions/trial-watermark-admin.ts"));
  check("S20 revalidates the section's page", /revalidatePath\(PAGE\)/.test(src) && /const PAGE = "\/admin\/settings\/onboarding";/.test(src));
}

/** Runs FIRST: the asset loader caches a success for the process, so its
 *  failure can only be seen before anything has loaded it. */
async function sectionS0() {
  console.log("\nS0. switching ON with the mark's file missing");
  setServerKey(true);
  const cwd = process.cwd();
  process.chdir(mkdtempSync(path.join(tmpdir(), "trialwm-admin-")));
  try {
    const db = fakeDb({ row: storedRow() });
    const r = await saveTrialWatermarkAction(validInput({ enabled: true }), true);
    check("S0a asset missing → asset_unavailable, nothing written", !r.ok && r.error === "asset_unavailable" && db.writes().length === 0, r);
    fakeDb({ row: storedRow(), stats: { data: { days: 30 } } });
    const p = await trialWatermarkPanelAction();
    check("S0b the panel reports the asset as missing", !!p && !p.asset.ok && p.asset.code === "asset_missing", p?.asset);
  } finally {
    process.chdir(cwd);
  }
}

/* ── P ─────────────────────────────────────────────────────────────────── */

async function sectionP() {
  console.log("\nP. trialWatermarkPanelAction");
  setServerKey(true);
  const statsReply = {
    days: 30,
    status: { locked: 4, unlocking: 1, unlocked: 3, expired: 2, deleted: 1, orphaned: 5, pending: 0 },
    events: {
      watermark_unlock_clicked: { events: 9, workspaces: 6, paywalls: 0 },
      watermark_paywall_opened: { events: 8, workspaces: 5, paywalls: 7 },
      watermark_plan_selected: { events: 3, workspaces: 3, paywalls: 3 },
      watermark_subscription_confirmed: { events: 2, workspaces: 2, paywalls: 2 },
      watermark_bulk_unlocked: { events: 1, workspaces: 1, paywalls: 0 },
    },
    items: { created: 20, unlocked: 3, expired: 2, locked_live: 5, expiring_24h: 1, purge_backlog: 6, purged: 4, converted_workspaces: 2 },
    sweep: { last_start: "2026-10-18T10:00:00Z", last_success: "2026-10-18T10:00:00Z", last_status: "succeeded" },
    purge: { ran_at: "2026-10-18T03:00:00Z", report: { swept: {}, listed: 7, removed: 6, marked: 6, error: null } },
  };
  let db = fakeDb({ row: storedRow({ enabled: true, force_trial_user_ids: [U1] }), stats: { data: statsReply } });
  let p = await trialWatermarkPanelAction();
  check("P1 the stored row, parsed", !!p && p.config.enabled && same(p.config.forceTrialUserIds, [U1]) && p.installed && p.updatedAt === "2026-10-01T10:00:00Z");
  check("P2 stats asked for 30 days, through the admin RPC", db.rpcs.some((x) => x.fn === "trial_watermark_stats" && same(x.args, { p_days: 30 })));
  const s = p?.stats;
  check("P3 counts by status (all seven)",
    !!s && same(s.status, { pending: 0, locked: 4, unlocking: 1, unlocked: 3, expired: 2, deleted: 1, orphaned: 5 }), s?.status);
  check("P4 the funnel: clicked → paywall workspaces → plan selected → confirmed, plus conversions",
    !!s && s.funnel.clicked === 6 && s.funnel.paywallWorkspaces === 5 && s.funnel.paywalls === 7 && s.funnel.planSelected === 3
    && s.funnel.subscriptionConfirmed === 2 && s.funnel.converted === 2, s?.funnel);
  check("P5 unlocked / expired from the originals, bulk from its event",
    !!s && s.items.unlocked === 3 && s.items.expired === 2 && s.bulk === 1 && s.items.created === 20 && s.items.lockedLive === 5
    && s.items.expiring24h === 1 && s.items.purgeBacklog === 6 && s.items.purged === 4);
  check("P6 the sweep's last runs", !!s && s.sweep.state === "ok" && s.sweep.lastStatus === "succeeded" && s.sweep.lastStart === "2026-10-18T10:00:00Z");
  check("P7 the purge heartbeat", !!s && same(s.purge, { ranAt: "2026-10-18T03:00:00Z", listed: 7, removed: 6, marked: 6, error: null }));
  check("P8 asset verified and server key present", !!p && p.asset.ok && p.serverKey);

  fakeDb({ row: storedRow(), stats: { data: { sweep: null, purge: null, events: "junk", status: [1], items: { unlocked: -3, created: "9" } } } });
  p = await trialWatermarkPanelAction();
  check("P9 a sparse or odd reply reads as zeros / never, not as an error",
    !!p?.stats && p.stats.sweep.state === "absent" && p.stats.purge === null && p.stats.items.unlocked === 0
    && p.stats.items.created === 0 && p.stats.funnel.paywallWorkspaces === 0 && p.stats.status.locked === 0 && p.stats.days === 30, p?.stats);

  fakeDb({ row: storedRow(), stats: { data: { sweep: { error: "unreadable" } } } });
  p = await trialWatermarkPanelAction();
  check("P10 an unreadable job history says so", p?.stats?.sweep.state === "unreadable");

  fakeDb({ row: storedRow(), stats: { error: { message: "forbidden", code: "P0001" } } });
  p = await trialWatermarkPanelAction();
  check("P11 a stats error → stats null, the form still shown", !!p && p.stats === null);

  fakeDb({ row: "error", stats: { data: statsReply } });
  check("P12 a failed settings read → null (never the defaults shown as saved)", (await trialWatermarkPanelAction()) === null);

  fakeDb({ row: null, stats: { error: { message: "missing", code: "PGRST202" } } });
  p = await trialWatermarkPanelAction();
  check("P13 before 0143: not installed, defaults shown", !!p && !p.installed && same(p.config, TRIAL_WATERMARK_DEFAULTS) && p.stats === null);

  fakeDb({ role: "user", row: storedRow(), stats: { data: statsReply } });
  check("P14 a customer gets nothing", (await trialWatermarkPanelAction()) === null);
  db = fakeDb({ user: null, row: storedRow() });
  check("P15 no session gets nothing, and no stats call is made", (await trialWatermarkPanelAction()) === null && db.rpcs.length === 0);

  setServerKey(false);
  fakeDb({ row: storedRow(), stats: { data: statsReply } });
  p = await trialWatermarkPanelAction();
  check("P16 the server key's absence is reported", !!p && p.serverKey === false);
  setServerKey(true);
}

/* ── V ─────────────────────────────────────────────────────────────────── */

const VISUAL = { widthRatio: 0.3, opacity: 0.5, luminanceThreshold: 0.55, darkColor: "#112233", glowRadiusRatio: 0.015, glowOpacity: 0.2 };

function form(parts: { params?: unknown; file?: File; media?: string; rawParams?: string }) {
  const f = new FormData();
  f.set("params", parts.rawParams ?? JSON.stringify(parts.params ?? VISUAL));
  if (parts.file) f.set("file", parts.file);
  if (parts.media !== undefined) f.set("media", parts.media);
  return f;
}
const fileOf = (buf: Buffer, name: string, type: string) => new File([new Uint8Array(buf)], name, { type });

/** A PNG that is (almost) only a header: IHDR says w×h, a few bytes of pixels follow. A cheap way to claim a huge image. */
function headerOnlyPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(100))), chunk("IEND", Buffer.alloc(0))]);
}

async function sectionV() {
  console.log("\nV. previewTrialWatermarkAction");
  const photo = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 235, g: 235, b: 230 } } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 20, g: 30, b: 40 } } }).jpeg().toBuffer();

  let db = fakeDb({ role: "user" });
  let r = await previewTrialWatermarkAction(form({ file: fileOf(photo, "p.png", "image/png") }));
  check("V1 a customer → forbidden", !r.ok && r.error === "forbidden");
  db = fakeDb({ user: null });
  r = await previewTrialWatermarkAction(form({ file: fileOf(photo, "p.png", "image/png") }));
  check("V2 no session → forbidden", !r.ok && r.error === "forbidden");

  db = fakeDb({});
  r = await previewTrialWatermarkAction(form({ params: { ...VISUAL, widthRatio: undefined }, file: fileOf(photo, "p.png", "image/png") }));
  check("V3 a missing visual value is invalid, never the default", !r.ok && r.error === "invalid" && r.field === "widthRatio", r);
  r = await previewTrialWatermarkAction(form({ params: { ...VISUAL, darkColor: "blue" }, file: fileOf(photo, "p.png", "image/png") }));
  check("V4 a bad colour → invalid/darkColor", !r.ok && r.field === "darkColor");
  r = await previewTrialWatermarkAction(form({ rawParams: "{not json", file: fileOf(photo, "p.png", "image/png") }));
  check("V5 params that are not JSON → invalid", !r.ok && r.error === "invalid");
  r = await previewTrialWatermarkAction(form({ params: { ...VISUAL, opacity: 0.01 }, file: fileOf(photo, "p.png", "image/png") }));
  check("V6 an out-of-range opacity → invalid/opacity", !r.ok && r.field === "opacity");

  r = await previewTrialWatermarkAction(form({}));
  check("V7 no image → no_image", !r.ok && r.error === "no_image");
  r = await previewTrialWatermarkAction(form({ file: fileOf(Buffer.alloc(0), "e.png", "image/png") }));
  check("V8 an empty file → no_image", !r.ok && r.error === "no_image");
  r = await previewTrialWatermarkAction(form({ file: fileOf(photo, "p.png", "image/png"), media: "a.png" }));
  check("V9 a file AND a media name → bad_source", !r.ok && r.error === "bad_source");
  r = await previewTrialWatermarkAction(form({ file: fileOf(Buffer.alloc(TRIAL_WATERMARK_PREVIEW.maxBytes + 1, 1), "big.png", "image/png") }));
  check("V10 a file over 10 MB → too_large", !r.ok && r.error === "too_large");
  r = await previewTrialWatermarkAction(form({ file: fileOf(headerOnlyPng(9000, 7000), "huge.png", "image/png") }));
  check("V11 over 50 MP (a 9000×7000 header) → too_large before any decode", !r.ok && r.error === "too_large", r);
  r = await previewTrialWatermarkAction(form({ file: fileOf(Buffer.from("this is not an image at all"), "x.png", "image/png") }));
  check("V12 bytes that are no image → unreadable", !r.ok && r.error === "unreadable", r);
  const tiny = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#ffffff" } }).png().toBuffer();
  r = await previewTrialWatermarkAction(form({ file: fileOf(tiny, "t.png", "image/png") }));
  check("V13 shorter side under 16 px → too_small", !r.ok && r.error === "too_small", r);
  const tiff = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080" } }).tiff().toBuffer();
  r = await previewTrialWatermarkAction(form({ file: fileOf(tiff, "t.tiff", "image/tiff") }));
  check("V14 a TIFF → unsupported_format", !r.ok && r.error === "unsupported_format", r);

  for (const bad of ["../secret.png", "/abs.png", "a/../b.png", "a//b.png", "./a.png", "a\u0000b.png", "x".repeat(401)]) {
    db = fakeDb({ media: { [bad]: new Blob([new Uint8Array(photo)]) } });
    r = await previewTrialWatermarkAction(form({ media: bad }));
    check(`V15 media name ${JSON.stringify(bad.length > 20 ? `${bad.slice(0, 8)}…(${bad.length})` : bad)} → bad_source, never downloaded`,
      !r.ok && r.error === "bad_source" && !db.calls.some((c) => c.op === "download"));
  }
  db = fakeDb({ media: {} });
  r = await previewTrialWatermarkAction(form({ media: "1700000000-missing.png" }));
  check("V16 a media name that is not there → not_found", !r.ok && r.error === "not_found");
  db = fakeDb({ media: { "big.jpg": new Blob([new Uint8Array(TRIAL_WATERMARK_PREVIEW.maxBytes + 1)]) } });
  r = await previewTrialWatermarkAction(form({ media: "big.jpg" }));
  check("V17 a media file over 10 MB → too_large", !r.ok && r.error === "too_large");

  db = fakeDb({});
  r = await previewTrialWatermarkAction(form({ file: fileOf(photo, "p.png", "image/png") }));
  check("V18 a real 2400×1800 PNG upload → ok", r.ok, r);
  if (r.ok) {
    const out = Buffer.from(r.dataUrl.replace(/^data:image\/jpeg;base64,/, ""), "base64");
    const meta = await sharp(out).metadata();
    check("V19 the answer is a JPEG data URL, ≤ 1600 px on its longer side, proportions kept",
      r.dataUrl.startsWith("data:image/jpeg;base64,") && meta.format === "jpeg" && meta.width === 1600 && meta.height === 1200
      && r.shown.width === 1600 && r.shown.height === 1200, `${meta.format} ${meta.width}x${meta.height}`);
    check("V20 the info is the engine's, with the SUBMITTED values (not the stored ones)",
      r.info.width === 2400 && r.info.height === 1800 && r.info.markWidth === Math.round(0.3 * 1800)
      && r.info.opacity === 0.5 && r.info.threshold === 0.55 && r.info.format === "png" && r.markedMime === "image/png"
      && r.info.variant === "dark" && r.sourceBytes === photo.length && r.markedBytes > 0, r.info);
    // Where the mark sits (centred, a dark variant on a light photo) the preview is darker than the plain photo.
    const centre = await sharp(out).extract({ left: 700, top: 560, width: 200, height: 80 }).greyscale().raw().toBuffer();
    const mean = centre.reduce((a, v) => a + v, 0) / centre.length;
    check("V21 the mark is really drawn (the centre is darker than the plain 235-grey photo)", mean < 232, mean);
  }
  check("V22 the preview wrote nothing anywhere (no row, no audit, no upload)", db.writes().length === 0, db.writes());

  db = fakeDb({ media: { "1700000000-dark_photo.jpg": new Blob([new Uint8Array(jpeg)]) } });
  r = await previewTrialWatermarkAction(form({ media: "1700000000-dark_photo.jpg" }));
  check("V23 a media-library JPEG → ok, read from the media bucket, light mark on a dark photo, nothing written",
    r.ok && r.info.format === "jpeg" && r.info.variant === "light" && r.shown.height === 1600 && r.shown.width === 1200
    && db.calls.some((c) => c.table === "storage:media" && c.op === "download" && c.payload === "1700000000-dark_photo.jpg")
    && db.writes().length === 0, r.ok ? r.info : r);

  const small = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  db = fakeDb({});
  r = await previewTrialWatermarkAction(form({ file: fileOf(small, "cut.png", "image/png") }));
  check("V24 a small transparent cutout is never enlarged and is shown on white",
    r.ok && r.shown.width === 800 && r.shown.height === 600 && r.info.variant === "dark", r.ok ? r.shown : r);

  const src = codeOnly(read("app/actions/trial-watermark-admin.ts"));
  check("V25 the preview calls no model and stores nothing (no upload / insert / upsert / rpc in its body)", (() => {
    const body = src.slice(src.indexOf("export async function previewTrialWatermarkAction"));
    return !/\.upload\(|\.insert\(|\.upsert\(|\.rpc\(|runGeneration|fetch\(/.test(body)
      && /await import\("@\/lib\/server\/trial-watermark\/engine"\)/.test(body);
  })());
}

/* ── X ─────────────────────────────────────────────────────────────────── */

async function sectionX() {
  console.log("\nX. the generic settings editor, the nav, the forbidden text");
  const system = read("app/admin/system/page.tsx");
  check("X1 /admin/system hides the row (its own filter line), keeping the existing exclusions",
    system.includes(".filter((s) => s.key !== TRIAL_WATERMARK_SETTING_KEY)")
    && system.includes("s.key !== REGISTRATION_SETTINGS_KEY && s.key !== TOOLS_LAYOUT_KEY")
    && /import \{ TRIAL_WATERMARK_SETTING_KEY \} from "@\/lib\/trial-watermark\/config";/.test(system));
  const admin = read("app/actions/admin.ts");
  check("X2 saveSettingAction refuses it on a line of its own, before the role check and any read",
    /\n {4}if \(key === TRIAL_WATERMARK_SETTING_KEY\) return \{ ok: false, error: "generic" \};\n/.test(admin)
    && admin.indexOf("if (key === TRIAL_WATERMARK_SETTING_KEY)") < admin.indexOf("const { supabase } = await requireAdmin();", admin.indexOf("export async function saveSettingAction"))
    && admin.includes("if (key === TOOLS_LAYOUT_KEY) return { ok: false, error: \"generic\" };"));
  const db = fakeDb({ row: storedRow() });
  const r = await saveSettingAction("trial_watermark", { enabled: true, opacity: 0 });
  check("X3 …and really does: an admin's raw save of trial_watermark is refused with nothing read or written",
    !r.ok && r.error === "generic" && db.calls.length === 0, db.calls);
  check("X4 the key is the one the migration seeds", TRIAL_WATERMARK_SETTING_KEY === "trial_watermark");
  const nav = read("lib/navigation.ts");
  check("X5 no new ADMIN_NAV entry", !/trial|znak|watermark/i.test(nav));
  const mine = ["app/actions/trial-watermark-admin.ts", "components/admin/trial-watermark-settings.tsx",
    "app/admin/settings/onboarding/page.tsx", "lib/trial-watermark/config.ts", "scripts/trialwm-admin-tests.ts"];
  check("X6 none of the section's files writes the forbidden layout key's text",
    mine.every((f) => !read(f).includes("tools" + "_layout")));
  check("X7 no migration newly names it either (0143)", !read("supabase/migrations/0143_trial_watermark.sql").includes("tools" + "_layout"));

  const actions = read("app/actions/trial-watermark-admin.ts");
  check("X8 the actions file is a server-action module exporting only async functions (and types)",
    actions.startsWith("\"use server\";") && [...actions.matchAll(/^export (?!async function |type )/gm)].length === 0);
  const fns = [...actions.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  check("X9 every action re-checks the role first", fns.length === 3 && fns.every((fn) => {
    const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
    const next = body.indexOf("\nexport ", 10);
    const own = next === -1 ? body : body.slice(0, next);
    return /const admin = await requireAdmin\(\);\s*if \(!admin\) return/.test(own);
  }), fns);
  check("X10 requireAdmin reads profiles.role through the session (like app/actions/thumbnail.ts)",
    /from\("profiles"\)\.select\("role"\)\.eq\("id", user\.id\)\.maybeSingle\(\)/.test(actions) && /profile\?\.role !== "admin"/.test(actions));

  const page = read("app/admin/settings/onboarding/page.tsx");
  check("X11 the onboarding page keeps its panel and adds the section below it",
    page.includes("<OnboardingPanel initial={config} stats={stats} />") && page.includes("<TrialWatermarkSettings panel={trialWatermark} />")
    && page.indexOf("<OnboardingPanel") < page.indexOf("<TrialWatermarkSettings") && page.includes("onboardingStatsAction(),"));

  const ui = read("components/admin/trial-watermark-settings.tsx");
  check("X12 switching ON goes through a ConfirmModal whose confirm is the only confirmed save",
    ui.includes("<ConfirmModal") && (ui.match(/persist\([^)]*, true\)/g) ?? []).length === 1
    && /onConfirm=\{\(\) => void persist\(\{ \.\.\.input, enabled: true \}, true\)\}/.test(ui)
    && /if \(!next \|\| stored\.enabled\) \{ patch\(\{ enabled: next \}\); return; \}/.test(ui));
  check("X13 the form validates with the server's own validator", /validateTrialWatermarkInput\(input\)/.test(ui));
  check("X14 the asset check, the stats and the preview are all on the section",
    ui.includes("data-trial-wm-asset") && ui.includes("data-trial-wm-stats") && ui.includes("data-trial-wm-preview")
    && ui.includes("data-trial-wm-policy") && ui.includes("data-trial-wm-funnel"));
  check("X15 the upload is pre-checked against the action body limit (larger photos go via the media library)",
    /file\.size > TRIAL_WATERMARK_PREVIEW\.uploadMaxBytes/.test(ui));
}

/* ── I ─────────────────────────────────────────────────────────────────── */

function sectionI() {
  console.log("\nI. i18n (scratch dictionary) and the policy text");
  const scratch = JSON.parse(read(SCRATCH)) as Record<"pl" | "en" | "de", Record<string, string>>;
  const files = ["components/admin/trial-watermark-settings.tsx", "app/admin/settings/onboarding/page.tsx"];
  const used = new Set(files.flatMap((f) => [...read(f).matchAll(/"(admin\.trialWm\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1])));
  const missing = [...used].flatMap((k) => (["pl", "en", "de"] as const).filter((l) => typeof scratch[l]?.[k] !== "string").map((l) => `${l}:${k}`));
  check(`I1 all ${used.size} admin.trialWm keys the section uses exist in pl, en and de`, missing.length === 0, missing.slice(0, 10));
  const keys = (l: "pl" | "en" | "de") => Object.keys(scratch[l]).sort().join("|");
  check("I2 the three locales carry the same keys", keys("pl") === keys("en") && keys("en") === keys("de"));
  const dead = Object.keys(scratch.pl).filter((k) => !used.has(k));
  check("I3 no dead keys in the scratch file", dead.length === 0, dead);
  check("I4 only the admin scope's namespace", Object.keys(scratch.pl).every((k) => k.startsWith("admin.trialWm.")));
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const drift = Object.keys(scratch.pl).filter((k) => vars(scratch.pl[k]) !== vars(scratch.en[k]) || vars(scratch.pl[k]) !== vars(scratch.de[k]));
  check("I5 every placeholder exists in all three translations", drift.length === 0, drift);

  const pl = scratch.pl;
  // D2: the three ways to be "paid"; refunded counts, disputed does not.
  check("I6 policy (D2): active paid subscription / Stripe payment (refund counts, dispute does not) / admin top-up",
    /aktywną płatną subskrypcję/.test(pl["admin.trialWm.policy.paid"]) && /Stripe/.test(pl["admin.trialWm.policy.paid"])
    && /zwróconą/.test(pl["admin.trialWm.policy.paid"]) && /sporna się nie liczy/.test(pl["admin.trialWm.policy.paid"])
    && /administratora/.test(pl["admin.trialWm.policy.paid"]));
  // R33 + D5: both the actor and the owner are admins; a forced (test) account
  // is in trial mode even while the switch is off and loses the staff
  // exemption, but never overrides paid.
  check("I7 policy (R33, D5): actor AND owner are admins; a forced account is trial even while off, never overrides paid",
    /zarówno osoba generująca, jak i właściciel workspace'u mają rolę admin/.test(pl["admin.trialWm.policy.staff"])
    && /także wtedy, gdy funkcja jest wyłączona/.test(pl["admin.trialWm.policy.staff"])
    && /traci zwolnienie personelu/.test(pl["admin.trialWm.policy.staff"]) && /nigdy nie nadpisuje płatności/.test(pl["admin.trialWm.policy.staff"]));
  check("I8 policy: retention frozen per original, key destroyed, marked image stays; enabled only for new ones",
    pl["admin.trialWm.policy.keep"].includes("{days}") && /klucz jest niszczony/.test(pl["admin.trialWm.policy.keep"])
    && /zostaje w bibliotece/.test(pl["admin.trialWm.policy.keep"])
    && /wyłącznie nowych generacji/.test(pl["admin.trialWm.policy.enabled"]) && /niczego nie odsłania/.test(pl["admin.trialWm.policy.enabled"]));
  check("I9 policy (D1): paid AI tools and Workflow ON blocked before the charge; 0-credit runs never marked",
    /Płatne narzędzia AI i Workflow ON/.test(pl["admin.trialWm.policy.who"]) && /0 kredytów nigdy/.test(pl["admin.trialWm.policy.who"]));
  check("I10 the section title is the one asked for", pl["admin.trialWm.title"] === "Znak wodny na generacjach próbnych");
}

async function main() {
  console.log("TRIAL WATERMARK — admin section");
  await sectionS0();
  sectionA();
  await sectionS();
  await sectionP();
  await sectionV();
  await sectionX();
  sectionI();
  console.log(failures === 0 ? `\nAll trial-watermark admin tests passed (${passes} passed).` : `\n${failures} TRIAL-WATERMARK ADMIN TEST(S) FAILED (${passes} passed).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

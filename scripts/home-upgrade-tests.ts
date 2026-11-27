/**
 * /HOME UPGRADE (27.11.2026) — the editor's side, without a browser:
 *
 *   npm run test:homeupgrade
 *
 *   W  the slot panel's draft → write: a banner's tablet file and frame, the
 *      phone shape, the dimming; nothing new for any other slot (byte-equal
 *      writes); an untouched draft is "not dirty"
 *   H  history: a snapshot of every new part, restored only where the slot
 *      has it; "clear" empties the tablet file too
 *   I  independence: saving the phone part keeps the tablet's, the dimming
 *      keeps everything else
 *   G  a GIF is offered to a carousel tile only, its still is part of the write
 *   S  the SQL of 0186 (additive; the shape check names t / pr / ov)
 */
import { readFileSync } from "node:fs";
import { draftOf, draftFrame, readSnapshot, snapshotWrite, writeOf, OVERLAY_DEFAULT, type Draft } from "@/components/ice/editor/media-panel";
import { precheck } from "@/components/ice/editor/upload";
import { slotSpec } from "@/lib/ice/registry";
import { PROMO_BANNERS, CAROUSEL } from "@/lib/seller-home-config";
import type { IceAsset, IceSlotSpec, IceSlotState } from "@/lib/ice/types";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || detail === "" ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600)}`}`);
}
const section = (s: string) => console.log(`\n${s}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const asset = (id: string, kind: "image" | "video", mime: string): IceAsset => ({
  id, kind, url: `https://x/${id}`, posterUrl: null, title: id, alt: null, mime, sizeBytes: 1000, width: 2400, height: 510, variants: {}, createdAt: "2026-11-01T00:00:00Z", usage: 0,
});
const D = asset("d", "image", "image/jpeg");
const TB = asset("t", "image", "image/webp");
const PH = asset("p", "image", "image/png");
const GIF = asset("g", "image", "image/gif");
const STILL = asset("s", "image", "image/jpeg");
const VID = asset("v", "video", "video/mp4");

const BANNER = slotSpec(PROMO_BANNERS.first.media.configKey) as IceSlotSpec;
const TILE = slotSpec(CAROUSEL[0].media.configKey) as IceSlotSpec;
const GRID = slotSpec("homeMedia.thumbnails.1") as IceSlotSpec;

const stateOf = (o: Partial<IceSlotState> = {}): IceSlotState => ({
  key: BANNER.key, exists: true, enabled: true, mediaType: "image", media: D, mobile: null, tablet: null, poster: null,
  alt: null, altI18n: {}, fit: "cover", position: "center center", crop: null, updatedAt: "2026-11-20T10:00:00.000Z", ...o,
});

/* ── W ─────────────────────────────────────────────────────────────────── */
section("W. DRAFT → WRITE");
{
  const st = stateOf();
  const d0 = draftOf(st);
  check("W1 an existing banner without the new settings drafts as: no tablet file, 1:1 phone, 100 % dimming", d0.tablet === null && d0.phoneRatio === "1:1" && d0.overlay === OVERLAY_DEFAULT && OVERLAY_DEFAULT === 100);
  const w0 = writeOf(BANNER, d0, st);
  check("W2 …and writes exactly what is stored: no crop, tabletMediaId null (an untouched draft is not dirty)", w0.crop === null && w0.tabletMediaId === null && same(w0, writeOf(BANNER, draftOf(st), st)));
  const d1: Draft = { ...d0, tablet: TB, cropT: { x: 10, y: 20, zoom: 1.5 }, mobile: PH, cropM: { x: 30, y: 40, zoom: 1 }, phoneRatio: "5:4", overlay: 40 };
  const w1 = writeOf(BANNER, d1, st);
  check("W3 three devices: tablet file + its frame, phone file + its frame, the phone shape and the dimming — one write",
    w1.tabletMediaId === "t" && w1.mobileMediaId === "p" && same(w1.crop, { x: 50, y: 50, zoom: 1, m: { x: 30, y: 40, zoom: 1 }, t: { x: 10, y: 20, zoom: 1.5 }, pr: "5:4", ov: 40 }), w1);
  const w2 = writeOf(BANNER, { ...d0, overlay: 0 }, st);
  check("W4 0 % dimming is a real value (stored as ov 0), not 'nothing'", same(w2.crop, { x: 50, y: 50, zoom: 1, ov: 0 }), w2.crop);
  const w3 = writeOf(BANNER, { ...d0, tablet: TB }, st);
  check("W5 a tablet file with an untouched frame: written with its centred frame only when something else is set; else no crop at all",
    w3.tabletMediaId === "t" && w3.crop === null, w3);
  const grid = writeOf(GRID, draftOf({ ...st, key: GRID.key }), { ...st, key: GRID.key });
  check("W6 every other slot writes exactly as before: no tabletMediaId key, no pr / ov in its frame", !("tabletMediaId" in grid) && grid.crop === null);
  const gridFrame = draftFrame(GRID, { ...d0, crop: { x: 20, y: 30, zoom: 1.2 }, phoneRatio: "5:4", overlay: 10 }, { mobile: false, tablet: false });
  check("W7 …even if a draft carried a phone shape or a dimming, a non-banner frame never contains them", same(gridFrame, { x: 20, y: 30, zoom: 1.2 }), gridFrame);
}

/* ── H ─────────────────────────────────────────────────────────────────── */
section("H. HISTORY / RESTORE / CLEAR");
{
  const row = {
    media_type: "image", media_id: "d", tablet_media_id: "t", mobile_media_id: "p", poster_media_id: null, alt_text: null, alt_i18n: null,
    object_fit: "cover", object_position: "center center", crop: { x: 1, y: 2, zoom: 1, m: { x: 3, y: 4, zoom: 1 }, t: { x: 5, y: 6, zoom: 2 }, pr: "5:4", ov: 25 },
    updated_at: "2026-11-19T10:00:00.000Z",
  };
  const snap = readSnapshot(row);
  check("H1 a history row reads back with the tablet file, its frame, the phone shape and the dimming",
    snap?.tabletId === "t" && same(snap?.crop, row.crop), snap);
  const st = stateOf();
  const w = snapshotWrite(BANNER, snap, st);
  check("H2 restoring it to the banner names the tablet file and puts back every part of the frame", w.tabletMediaId === "t" && same(w.crop, row.crop) && w.mobileMediaId === "p", w);
  const wNoTablet = snapshotWrite(BANNER, readSnapshot({ ...row, tablet_media_id: null }), st);
  check("H3 a snapshot without a tablet file restores without one (and without its frame — the server would refuse it)",
    wNoTablet.tabletMediaId === null && !("t" in (wNoTablet.crop ?? {})) && (wNoTablet.crop as { pr?: string })?.pr === "5:4", wNoTablet);
  const wGrid = snapshotWrite(GRID, snap, { ...st, key: GRID.key });
  check("H4 the same snapshot on a non-banner slot: no tablet key, no pr / ov / t", !("tabletMediaId" in wGrid) && same(wGrid.crop, { x: 1, y: 2, zoom: 1 }), wGrid);
  const prior = readSnapshot({ ...row, crop: null, tablet_media_id: null });
  const wPrior = snapshotWrite(BANNER, prior, st);
  check("H5 restoring a version from before the upgrade (no crop) brings back 1:1 and 100 % (crop null)", wPrior.crop === null && wPrior.tabletMediaId === null);
}

/* ── I ─────────────────────────────────────────────────────────────────── */
section("I. INDEPENDENT PARTS");
{
  const stored = stateOf({ tablet: TB, mobile: PH, crop: { x: 50, y: 50, zoom: 1, m: { x: 30, y: 40, zoom: 1 }, t: { x: 10, y: 20, zoom: 1.5 }, pr: "5:4", ov: 40 } });
  const d = draftOf(stored);
  check("I1 the stored banner drafts back whole", d.tablet?.id === "t" && d.mobile?.id === "p" && same(d.cropT, { x: 10, y: 20, zoom: 1.5 }) && d.phoneRatio === "5:4" && d.overlay === 40);
  const phoneOnly = writeOf(BANNER, { ...d, cropM: { x: 70, y: 80, zoom: 1.2 } }, stored);
  check("I2 changing only the phone frame keeps the tablet file, its frame, the shape and the dimming",
    phoneOnly.tabletMediaId === "t" && same(phoneOnly.crop, { x: 50, y: 50, zoom: 1, m: { x: 70, y: 80, zoom: 1.2 }, t: { x: 10, y: 20, zoom: 1.5 }, pr: "5:4", ov: 40 }), phoneOnly.crop);
  const dimOnly = writeOf(BANNER, { ...d, overlay: 75 }, stored);
  check("I3 changing only the dimming keeps every file and frame", dimOnly.tabletMediaId === "t" && dimOnly.mobileMediaId === "p"
    && same(dimOnly.crop, { x: 50, y: 50, zoom: 1, m: { x: 30, y: 40, zoom: 1 }, t: { x: 10, y: 20, zoom: 1.5 }, pr: "5:4", ov: 75 }), dimOnly.crop);
  const removePhone = writeOf(BANNER, { ...d, mobile: null }, stored);
  check("I4 removing the phone file drops only it (and its frame); the tablet's stays", removePhone.mobileMediaId === null && removePhone.tabletMediaId === "t"
    && !("m" in (removePhone.crop ?? {})) && "t" in (removePhone.crop ?? {}));
}

/* ── G ─────────────────────────────────────────────────────────────────── */
section("G. GIF AND THE STILL");
{
  const f = (type: string, size = 1000) => ({ type, size, name: "x" }) as unknown as File;
  check("G1 the upload precheck takes a GIF only where the place says so (a carousel tile), never a sample",
    precheck(f("image/gif"), { gif: true }) === null && precheck(f("image/gif")) === "format" && precheck(f("image/gif"), { gif: true, sample: true }) === "format"
    && precheck(f("image/png")) === null && precheck(f("video/webm")) === null);
  check("G2 a carousel tile's slot takes picture, GIF and clip; a grid slot takes no GIF", Boolean(TILE.gif && TILE.video) && !GRID.gif && !BANNER.gif);
  const st = stateOf({ key: TILE.key, media: GIF, poster: STILL });
  const w = writeOf(TILE, draftOf(st), st);
  check("G3 a GIF tile's write carries its first-frame still as the poster", w.mediaId === "g" && w.posterMediaId === "s" && w.mediaType === "image", w);
  const wImg = writeOf(TILE, { ...draftOf(st), media: D }, st);
  check("G4 …a plain picture carries none", wImg.posterMediaId === null);
  const wv = writeOf(TILE, { ...draftOf(st), media: VID, poster: STILL }, st);
  check("G5 a clip tile carries its poster", wv.mediaType === "video" && wv.posterMediaId === "s");
  const wg = writeOf(GRID, { ...draftOf({ ...st, key: GRID.key }), media: GIF, poster: STILL }, { ...st, key: GRID.key });
  check("G6 a GIF somewhere else never carries a still (the server refuses the GIF there anyway)", wg.posterMediaId === null);
}

/* ── S ─────────────────────────────────────────────────────────────────── */
section("S. MIGRATION 0186");
{
  const sql = readFileSync("supabase/migrations/0186_home_banner_frames.sql", "utf8");
  const code = sql.replace(/--.*$/gm, "");
  check("S1 additive: only CREATE OR REPLACE of the frame check and the frame reset — no table, column, row or policy touched",
    (code.match(/create or replace function/gi) ?? []).length === 2 && !/\b(drop|alter|delete|truncate|insert|update)\b/i.test(code)
    && !/grant|revoke|policy/i.test(code));
  check("S2 the frame check allows t (same bounds as m), pr in ('1:1','5:4'), ov an integer 0–100 — and nothing else",
    /- 'x' - 'y' - 'zoom' - 'm' - 't' - 'pr' - 'ov'\) = '\{\}'::jsonb/.test(code) && /c ->> 'pr' in \('1:1', '5:4'\)/.test(code)
    && /\(c ->> 'ov'\)::numeric = trunc\(\(c ->> 'ov'\)::numeric\)/.test(code) && /\(c ->> 'ov'\)::numeric between 0 and 100/.test(code)
    && /\(c -> 't' ->> 'zoom'\)::numeric between 1 and 2\.5/.test(code));
  check("S3 a tablet file swapped by another writer drops its frame (t), as the phone's drops m",
    /new\.tablet_media_id is distinct from old\.tablet_media_id[\s\S]*new\.crop := new\.crop - 't';/.test(code));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

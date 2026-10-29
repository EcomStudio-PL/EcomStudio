/**
 * /home — THE SELLER HOME (components/seller-home), and everything it must not
 * touch.
 *
 *   npm run test:sellerhome
 *
 * The page's layout and order, the config (every tool a real catalogue item,
 * every picture a slot with its size), the media slot's four states, the
 * honesty rules (an item that does not run is never a link), the upload tile's
 * handoff to the tool that runs it, the two writes (seller channel, "Powiadom
 * mnie") against a fake Supabase, i18n completeness, and SHA-256 pins of every
 * frozen file — the public "/", /start, the header, /tools, Retusz, the AI
 * request paths, Stripe and /plan — against the release they were frozen in.
 * Interactions in a real browser (carousel arrows and swipe, drag & drop, the
 * slider, overflow at 320–1920 px, both themes) are covered by the visual
 * probe; the assertions here are what can be proven without one.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BANNER_FRAME, BEFORE_AFTER, BEFORE_AFTER_SIZE, CAROUSEL, CHANNEL_DEFAULT_TOOL, DEFAULT_UPLOAD_TOOL, FEATURED, HANDOFF_ROUTES, INDUSTRIES,
  INTEREST_KEYS, PORTRAIT_4_5, PROMO_BANNERS, SECTION_COPY, SELLER_CHANNELS, SESSIONS, SHIPPED_TOOL_PHOTO, SHOWCASE, SQUARE, THUMBNAILS,
  TOOL_TILE, UPLOAD_LEAD_DEFAULT, UPLOAD_TOOLS, assetList, isInterestKey, isSellerChannel, ratioOf,
  type MediaSrc,
} from "@/lib/seller-home-config";
import {
  cannotAfford, channelFromSurvey, defaultUploadTool, resolveUploadTools, selectedUploadTool, shouldAskChannel,
  statusBadge, type ItemState, type ItemStatus,
} from "@/lib/seller-home-model";
import { registerFeatureInterest, saveSellerChannel } from "@/lib/services/seller-home";
import { stashHomeUpload, takeHomeUpload } from "@/lib/home-handoff";
import { isProtectedPath } from "@/lib/supabase/middleware";
import { catalogItem } from "@/lib/tool-cards";
import { PHOTO_THUMB_RATIO } from "@/components/tools/tool-thumb";
import { EmptyArt, MediaSlot } from "@/components/seller-home/media-slot";
import { BeforeAfter } from "@/components/seller-home/before-after";
import { GalleryCta, StatusBadge, ToolLink, TryLink } from "@/components/seller-home/parts";
import { BeforeAfterRow, PromoBanner, SessionsSection, Showcase, ThumbnailsSection } from "@/components/seller-home/sections";
import type { HomeSlots } from "@/components/seller-home/ice-slot-image";
import { ToolCarousel } from "@/components/seller-home/tool-carousel";
import { findCategory } from "@/lib/categories";
import { allElements, cardSlotKey, icePageFor } from "@/lib/ice/registry";
import { slotAltI18n, slotCrop } from "@/lib/media-slots";
import { SUPABASE_URL } from "@/lib/supabase/config";
import {
  HOME_SECTION_SLOT_KEYS, SAMPLE_MAX_WIDTH, SLOT_READ_CAP, filledHomeSlots, sampleSource, sellerHomeSlotKeys, withSampleSlots,
} from "@/lib/server/seller-home-slots";
import type { ResolvedSlot, SlotMap } from "@/lib/server/media-slots";
import type { Client } from "@/lib/services/workspace";

async function main() {

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
}
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const T = (k: string, v?: Record<string, string | number>) => (v ? `${k}(${Object.values(v).join(",")})` : k);

/* ── fixtures ─────────────────────────────────────────────────────────────*/

const S = (key: string, href: string, status: ItemStatus, credits: number | null): ItemState => ({ key, href, status, credits });
const LIVE: Record<string, ItemState> = {
  retouch: S("retouch", "/retusz", "live", 7),
  "ecommerce.thumbnail": S("ecommerce.thumbnail", "/k/ecommerce/thumbnail", "live", 4),
  "moda.street": S("moda.street", "/k/moda/street", "live", 4),
  "moda.ghostMannequin": S("moda.ghostMannequin", "/k/moda/ghostMannequin", "soon", 7),
};

const SH_FILES = [
  "seller-home.tsx", "tool-carousel.tsx", "upload-tile.tsx", "sections.tsx", "rail.tsx", "loop-rail.tsx", "parts.tsx",
  "coming-soon.tsx", "seller-modal.tsx", "no-credits-modal.tsx", "media-slot.tsx", "before-after.tsx", "task-store.ts",
  "ice-slot-image.tsx",
];
const SH = SH_FILES.map((f) => code(`components/seller-home/${f}`)).join("\n");
const body = code("components/seller-home/seller-home.tsx");
const upload = code("components/seller-home/upload-tile.tsx");
const rail = code("components/seller-home/rail.tsx");
const loopRail = code("components/seller-home/loop-rail.tsx");
const sections = code("components/seller-home/sections.tsx");
const carousel = code("components/seller-home/tool-carousel.tsx");
const loader = code("lib/server/seller-home.ts");
const config = code("lib/seller-home-config.ts");

/* ── 1. untouched surfaces ────────────────────────────────────────────────*/

section("1. THE PUBLIC PAGE, /start, /dashboard, THE HEADER AND THE SHELL ARE UNTOUCHED");
// Pinned to the release before the first redesign (5d966f0). A change to any
// of these is not part of a /home redesign and must be argued for on its own.
// RE-PINNED, argued for: Pre-launch Landing V2 (after efec08f) changed two of
// them and nothing about /home — app/page.tsx renders the long launch page
// (campaign values, galleries, consents) in its `kind = launch` branch only;
// app/(app)/layout.tsx gained one awaited call, ensurePrelaunchRewards (a
// no-op while the campaign's rewards are off), and re-reads the wallet only
// when that call granted credits, so the shell shows the new balance.
const FROZEN: readonly [string, string][] = [
  // Public pages V1: the launch branch now hands LaunchPage the site footer
  // (getGlobalSections + getNavPages, one <SiteFooter>); /home untouched.
  ["app/page.tsx", "9c4f5cb7c6c28a6e24e75b93625bdd00093d481145cb3d03bf9b5aee853bfc28"],
  // O nas V2: a CMS page with about_* sections reads their media slots and
  // where its start button leads (one read each, none on any other page),
  // and takes its share image from the about.seo.og slot; /start untouched.
  // Kontakt V2: a page with a contact_page section reads ?temat= and the
  // signed-in customer's own address for its form, and hands the site's
  // social profiles to the renderer (already loaded for the footer).
  // FAQ V1: a page with faq_page, about_faq or contact_page reads the FAQ
  // base (one cached read) and, for /faq, Kontakt's real channel links.
  // Public Tools V1 (one catalogue): while the app catalogue is a visitor's
  // page (switch on, or an admin's guest preview), /narzedzia answers 307 to
  // /tools and names it canonical; otherwise its CMS page renders as before.
  ["app/[slug]/page.tsx", "f05fa787574cd42284a0240c3ba8a6cfd33fbaf860fe551cf1c4df8417dc61d8"],
  ["lib/home-sections.ts", "d2a57f246d437d09545d3020943b613183e5c77668ebb4fd7122f612ad68cdb9"],
  ["lib/home-picks.ts", "c01b282598d0c5bff6768dee3bbf2f43429ba72ecf1ea3f040df41d274910fc6"],
  ["components/home/card-art.tsx", "b7c8b8bba3317e7fe64e9b9f29acfb11c7d91756a957416b4846a10a3b1b2faa"],
  ["components/home/drop-door.tsx", "25be913f198769d0f3e659694858fad373baf54c544d4cda231f8811f4e93ceb"],
  ["components/home/gate.tsx", "79533aaab1cd3dfa432ce102efca034d52a5c716c521a1ea967f38143511949f"],
  ["components/home/grovshot-banner.tsx", "987f1ece23fa4dcc42f7b23d7734cefb4f7755c74f82081d2bab0bfc06583d0f"],
  ["components/home/home-gallery.tsx", "dd9597815b72497e81ace369a5173530ca3bd1db4460cdc4ab0be1a17e62c4f0"],
  ["components/home/product-cards.tsx", "31faf2e26a61a57c5ab8425e55f67b8be62e60cdcda3a5e637db5a1c6de0c7e0"],
  ["components/home/product-home.tsx", "563ea47b70567fa4e661a615e48c479d6e01028df8599a83fd80eee0043edbdc"],
  ["components/home/product-surface.tsx", "192f808be79f5e9775f68b7199fd114eb4b453f03e8844117532f7c2aeeb1ce7"],
  ["components/home/start-box.tsx", "06e19ff01b8f8c458d787580ddbca692be5f4bd4d0bf2114a1fccbec1f12c8da"],
  ["app/(app)/dashboard/page.tsx", "200419c0840054885847a2cfca17918bd524644630b63c3be324e798b12c7eb2"],
  ["app/(app)/dashboard/layout.tsx", "091b1dad18ba00fa61c921d1969667191cb53626a046f6c3c184e3cc9805c4c6"],
  ["app/(app)/home/layout.tsx", "091b1dad18ba00fa61c921d1969667191cb53626a046f6c3c184e3cc9805c4c6"],
  // Public Tools V1: a visitor (or an admin's "Podgląd jako gość") on a
  // public tool page gets GuestShell — publicToolAudience decides, and with
  // the switch off nothing changes; the preview strip while previewing; the
  // local-draft resume banner above the page. Every other path as before.
  // Then: the resume banner also names a category's workflows (Moda, the
  // thumbnail), which a visitor can now prepare too — labels only.
  // Powiadomienia V2: the bell's state comes from one RPC (readBell — both
  // tabs, the important-only badge, the bar), and the „Ważny” bar plus the
  // off-panel "ready" toast are mounted under the header. Ulubione V2: the
  // shell carries `data-favorite-ring` (the admin's ring switch, read in the
  // same batch). Nothing else moved.
  // Generacje w toku V2: one more client component mounted beside the toast,
  // <InflightTitle /> (the "(2) GrovBase" tab prefix and the batch pump). It
  // renders nothing and touches no metadata.
  ["app/(app)/layout.tsx", "7c8191c821bb07927acb4a7e16bc3c43e70fb77ec065a6453e75ae57f38da7fc"],
  // Public Tools V1 (activation): a visitor's pages wear the same dock; with
  // `guest`, the account slots open the sign-in dialog in place. A member's
  // dock (no `guest`) renders and behaves exactly as before.
  ["components/layout/customer-bottom-nav.tsx", "ff387b6a2c72923921fcd1c06185605a596f471d42cc8c1b14d2f740ee6c8567"],
  ["components/layout/customer-drawer.tsx", "758aba86c7ee1a6fc88419038386d0bdde1b4b2949dd765630111e59482d6f1c"],
  // Kontakt V2: the dialog gained one line — a link to /kontakt?temat=problem
  // (a bug) or ?temat=inne (anything else); the button and the dialog's own
  // flow are unchanged.
  ["components/feedback/feedback-cta.tsx", "a899c76259c51712f172f211d3c5caea5a2180e72ceffa2193cb774281800019"],
  ["middleware.ts", "4f7eb9dbae73a29d4a225b54f84dd509bc04ca7592fefa361b0b4a40e6864761"],
];
for (const [file, digest] of FROZEN) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
// THE HEADER CHANGED BY ONE LINK, AND ONLY THAT. The /plany task (public
// cennik) sends a VISITOR's "Plany" to /plany instead of the login-gated /plan
// and lights the item on either path. Undo exactly that and the file is
// byte-identical to the frozen release — no other pixel of the bar moved.
{
  const bar = readFileSync("components/layout/mega-topbar.tsx", "utf8");
  const PLANY_NOTE = "          // A visitor goes to the PUBLIC cennik; /plan sits behind the login.\n";
  // Public Tools V1 (guest doors): login outlined, the long signup promise
  // from xl up. Undone here as well, so the frozen digest still holds.
  const PT_NOTE = "            {/* Outlined, then filled (Public Tools V1): the quiet door is still\n"
    + "                a button, not a stray word in the bar. The long promise on the\n"
    + "                primary only where the row has room for it — a phone keeps the\n"
    + "                short label, so the bar never wraps. A shut registration is the\n"
    + "                dialog's to explain (its pre-launch notice). */}\n";
  // Public Tools V1 (activation): the long promise only while signup is open
  // (`signupOpen`, default true — every other caller renders as before).
  const PT_SIGNUP_PROP = "  /** A visitor's primary door promises free credits only while signup is\n"
    + "   *  open; shut, it is the plain \"Załóż konto\" and the dialog explains. */\n"
    + "  signupOpen?: boolean;\n";
  // Powiadomienia V2: the bell takes the server's payload (`bell`) instead of
  // a list and a count. Undone here as well.
  const restored = bar
    .replace('import { NotificationsBell } from "./notifications-bell";\nimport type { BellPayload } from "@/lib/notifications/catalog";',
      'import { NotificationsBell, type NotificationItem } from "./notifications-bell";')
    .replace("navAdmin, bell, availability,", "navAdmin, notifications = [], unread = 0, availability,")
    .replace("  /** The bell's server copy (app layout). Absent → the bell asks once. */\n  bell?: BellPayload;",
      "  notifications?: NotificationItem[]; unread?: number;")
    .replace("<NotificationsBell initial={bell} />", "<NotificationsBell items={notifications} unread={unread} />")
    .replace(PT_SIGNUP_PROP, "")
    .replace("guest = false, signupOpen = true, menu:", "guest = false, menu:")
    .replace('{t(signupOpen ? "auth.signUpFree" : "auth.signUp")}', '{t("auth.signUpFree")}')
    .replace(PT_NOTE, "")
    .replace("border border-line px-3 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-raised sm:inline-flex",
      "px-3 text-sm font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-ink sm:inline-flex")
    .replace('              <span className="xl:hidden">{t("auth.signUp")}</span>\n              <span className="hidden xl:inline">{t("auth.signUpFree")}</span>\n',
      '              {t("auth.signUp")}\n')
    .replace(PLANY_NOTE, "")
    .replace('<Link href={guest ? "/plany" : "/plan"}', '<Link href="/plan"')
    .replace('isNavActive(pathname, "/plan") || isNavActive(pathname, "/plany")\n                ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",',
      'isNavActive(pathname, "/plan") ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",');
  check("components/layout/mega-topbar.tsx differs only by the visitor's cennik link (and the Public Tools V1 guest doors)",
    sha(restored) === "913fe0c30674ddd6651a6025bbb646859c08a92f9a462dcc59df672690d7937a" && restored !== bar);
}
// The shared media components are pinned against git, not a literal: the
// redesign reuses them and must not edit them.
check("…the shared media components and tool-thumb are byte-identical to the last release",
  ["components/tools/tool-thumb.tsx", "components/media/slot-media.tsx", "components/media/slot-video.tsx"]
    .every((f) => !gitChanged(f)));
// globals.css moved to a literal when Pre-launch Landing V2 edited it — inside
// `[data-launch-page]` only (the status colours of its dark ramp, the
// --hero-overlap token, a floor under --hero-art for phones in landscape).
// /home's rules are untouched; any further edit must be argued for here.
// Re-pinned by Public Tools V1: the desktop gen-shell viewport lock is lifted
// on a page that carries a visitor's tool block ([data-public-tool-seo]) —
// one selector change; /home's rules and the launch page's are untouched.
// Ulubione V2 added ONE block after `.card-rail` (the favourite's own red,
// the shared heart, the ring and its admin switch), and Generacje w toku V2
// its in-progress tile right after it, inside the same span. Taken out, the
// file is the same bytes as before.
{
  const css = readFileSync("app/globals.css", "utf8");
  const a = css.indexOf("\n/* ── ULUBIONE V2 ");
  const b = css.indexOf("\n/* ── AUTH FORMS ON A PHONE");
  check("…globals.css is the reviewed Pre-launch Landing V2 version (+ the Public Tools V1 lock exception, + the Ulubione V2 and Generacje w toku V2 blocks)",
    a > 0 && b > a && sha(css.slice(0, a) + css.slice(b)) === "8f024ebf826afd750357e2e33559e9be1fc7e7c30e77592b2fcfafc974f1ed73");
}
check("/home requires a session (middleware's protected paths)", isProtectedPath("/home") && isProtectedPath("/dashboard"));
check("/dashboard still forwards to /home", /redirect\("\/home"\)/.test(code("app/(app)/dashboard/page.tsx")));
const homePage = code("app/(app)/home/page.tsx");
check("/home renders the seller home, not the public surface", /<SellerHome \/>/.test(homePage) && !/ProductSurface|ProductHome/.test(homePage));
check("/start and \"/\" still render the shared public surface", /<ProductSurface \/>/.test(code("app/[slug]/page.tsx")) && /<ProductSurface \/>/.test(code("app/page.tsx")));
check("the seller home mounts no header, nav or feedback button of its own (the layout's stay)",
  !/MegaTopbar|CustomerBottomNav|FeedbackCTA|CustomerDrawer/.test(body));

/* ── 2. layout and order ──────────────────────────────────────────────────*/

section("2. FULL WIDTH, ONE RHYTHM, THE SPEC'S ORDER");
check("no narrow container: no max-w-5xl / max-w-6xl / 1200px wrapper on the page",
  !/max-w-(5xl|6xl|7xl)|max-w-\[1200px\]|max-width:\s*1200px/.test(body) && /w-full/.test(body));
check("…the 40px xl shell padding is trimmed to 32px (24–32px desktop margins)", /xl:-mx-2 xl:w-\[calc\(100%\+1rem\)\]/.test(body));
check("one --home-section-gap token: 14 / 18 / 22px, switching where the margins and rails do (sm, lg)", /\[--home-section-gap:14px\]/.test(body) && /sm:\[--home-section-gap:18px\]/.test(body)
  && /lg:\[--home-section-gap:22px\]/.test(body) && /gap-\[var\(--home-section-gap\)\]/.test(body));
check("the page clips sideways only (no body scroll, the halo is not cut vertically)", /\[overflow-x:clip\]/.test(body) && !/overflow-hidden/.test(body));
check("no visible H1 — the H1 is screen-reader only", /<h1 className="sr-only">/.test(body) && !/text-\[2\.\d+rem\]|text-\[1\.75rem\]/.test(SH));
const ORDER = ["<ToolCarousel", "<UploadTile", "<BeforeAfterRow", "PROMO_BANNERS.first", "<Showcase", "PROMO_BANNERS.second",
  "<ThumbnailsSection", "<SessionsSection", "<FeaturedTools", "PROMO_BANNERS.third", "<ComingSoon"];
const at = ORDER.map((m) => body.indexOf(m));
check("the eleven sections in the spec's exact order", at.every((p, i) => p > 0 && (i === 0 || p > at[i - 1])), at.join(","));
check("the carousel is first, with no heading above it", body.indexOf("<ToolCarousel") < body.indexOf("<UploadTile")
  && !/SectionHead/.test(carousel));
check("removed from the page: recent projects, H1 hero, radio task cards, credit panel, price anchor, all-tools grid, filters, „Zrób to samo”",
  !/RecentProjects|PriceAnchor|AllTools|imagesAffordable|filterGallery|doSame|chooseTaskAndFocusUpload|sellerHome\.(anchor|recent|hero|press|credits)\./.test(SH)
  && !existsSync("components/seller-home/gallery.tsx") && !existsSync("components/seller-home/hero.tsx"));
check("every section is positioned (paints above the upload halo)",
  /<section className="relative"/.test(sections) && /<section className="relative"/.test(carousel) && /relative isolate/.test(upload));

/* ── 3. the carousel ──────────────────────────────────────────────────────*/

section("3. THE TOOL CAROUSEL");
check("the spec's order: Miniaturka, Grovshot, Manekin, Retusz, Tło AI, Cień AI, Białe tło, W kontekście, Moda, Packshot, Własny prompt",
  CAROUSEL.map((c) => c.item).join(",") === "ecommerce.thumbnail,generator,moda.ghostMannequin,retouch,ai_background,ai_shadow,white_bg,ecommerce.context,cat:moda,ecommerce.packshot,custom");
check("…every tile is a real catalogue item (or a real category)", CAROUSEL.every((c) => c.item.startsWith("cat:") || Boolean(catalogItem(c.item))));
check("4.5 tiles on a desktop, 2.5 on a tablet, about 1.2 on a phone (the gaps unchanged)", /lg:\[--rail-cols:4\.5\]/.test(carousel)
  && /sm:\[--rail-cols:2\.5\]/.test(carousel) && /\[--rail-cols:1\.18\]/.test(carousel) && !/--rail-cols:3\.5/.test(carousel)
  && /\[--rail-gap:10px\] sm:\[--rail-cols:2\.5\] sm:\[--rail-gap:12px\] lg:\[--rail-cols:4\.5\] lg:\[--rail-gap:14px\]/.test(carousel));
check("…a card is (100% − whole gaps) ÷ cols wide", /w-\[calc\(\(100%_-_\(var\(--rail-cols\)_-_1\)_\*_var\(--rail-gap\)\)_\/_var\(--rail-cols\)\)\]/.test(rail));
check("arrows, scroll-snap, swipe (native scroll) and ←/→ between cards", /data-rail-prev/.test(rail) && /data-rail-next/.test(rail)
  && /snap-x snap-mandatory/.test(rail) && /overflow-x-auto/.test(rail) && /ArrowRight/.test(rail) && /ArrowLeft/.test(rail));
check("…←/→ focus the neighbour card even when the card itself is the link, stepping over cards that do not open",
  /it\.matches\(focusable\) \? it : it\.querySelector/.test(rail) && /i \+= step/.test(rail));
check("…a control inside a card keeps its own arrows (the before/after divider is never hijacked)",
  /closest\("input, textarea, select"\)\) return;/.test(rail));
check("…the left arrow is gone at the start, the right one at the end", /\{!edge\.start && \(/.test(rail) && /\{!edge\.end && \(/.test(rail));
check("…no arrow before the first measure (the server cannot know the row overflows)", /useState\(\{ start: true, end: true \}\)/.test(rail));
check("…an arrow that disappears while focused hands the focus on, never to <body>",
  /active === nextRef\.current/.test(rail) && /active === prevRef\.current/.test(rail) && /\.focus\(\{ preventScroll: true \}\)/.test(rail));
check("…a translated role description, a region only when no section already is one; focus outline drawn inside the card",
  /aria-roledescription=\{role\}/.test(rail) && /role=\{landmark \? "region" : "group"\}/.test(rail) && !/aria-roledescription="carousel"/.test(SH)
  && (sections.match(/landmark=\{false\}/g) ?? []).length === 2 && /outline-offset-\[-3px\]/.test(rail));
check("…smooth only without reduced motion", /prefers-reduced-motion: reduce/.test(rail) && /motion-reduce:scroll-auto/.test(rail));
check("tiles keep the catalogue frame 2336×1744 (not 5:4 — the /tools rule)", ratioOf(TOOL_TILE) === PHOTO_THUMB_RATIO && PHOTO_THUMB_RATIO === "2336/1744"
  && /ratio=\{ratioOf\(TOOL_TILE\)\}/.test(carousel));
check("…an admin's card picture fills an empty tile; the shipped example only for a live tool",
  /admin=\{slot \? \{ slot, slots: data\.slots \} : null\}/.test(carousel) && /shipped=\{live \? SHIPPED_TOOL_PHOTO\[def\.item\] \?\? null : null\}/.test(carousel)
  && Object.values(SHIPPED_TOOL_PHOTO).every((p) => existsSync(`public${p}`)));
check("…a whole live tile is the link; small name + one line under the picture", /<ToolLink key=\{def\.item\} state=\{state\}/.test(carousel)
  && /text-\[13px\] font-semibold/.test(carousel) && /text-\[12px\] leading-snug text-muted/.test(carousel));

/* ── 3b. the endless loop ─────────────────────────────────────────────────*/

section("3b. THE TOOL CAROUSEL GOES ROUND — BOTH WAYS, NO END");
check("five or more tools: the looping rail; fewer: the plain Rail, no copies",
  /const LOOP_MIN = 5;/.test(carousel) && /tiles\.length >= LOOP_MIN\s*\? <LoopRail /.test(carousel) && /: <Rail \{\.\.\.rail\}>/.test(carousel));
check("…the before/after row and the featured tools keep the plain Rail", (sections.match(/<Rail /g) ?? []).length === 2 && !/LoopRail/.test(sections));
check("the loop is one copy of the list on either side of the real cards: [copies] [cards] [copies]",
  /\{ready && copy\("before"\)\}/.test(loopRail) && /data-loop-item=\{i\}/.test(loopRail) && /\{copy\("after"\)\}/.test(loopRail));
check("…copies are aria-hidden drawings, out of the Tab order (links tabIndex -1), no tile key of their own",
  /aria-hidden="true" data-loop-clone=\{side\}/.test(loopRail) && /tabIndex=\{copy && live \? -1 : undefined\}/.test(carousel)
  && /copy \? \{ "data-carousel-clone": def\.item \} : \{ "data-carousel-tile": def\.item \}/.test(carousel)
  && /tabIndex=\{tabIndex\}/.test(code("components/seller-home/parts.tsx")));
check("…a pointer's focus never stays on a copy (a mouse's dropped on release, a tap's at once), yet a copy drags and clicks like its card",
  /if \(el && track\.contains\(el\) && el\.closest\("\[data-loop-clone\]"\)\) el\.blur\(\);/.test(loopRail) && !/onMouseDown/.test(loopRail)
  && /if \(el\.closest\("\[data-loop-clone\]"\)\) \{ if \(!pressRef\.current\) el\.blur\(\); return; \}/.test(loopRail)
  && /const onContextMenu = \(\) => \{ onRelease\(\); dropCopyFocus\(\); \};/.test(loopRail));
check("…Tab onto a real card the browser left half out of view brings it in (keyboard focus only)",
  /if \(keyRef\.current \|\| !el\.matches\(":focus-visible"\)\) return;/.test(loopRail)
  && /if \(glideRef\.current \|\| !shows\(g, where\(g\), k\)\) reveal\(k, dir\);/.test(loopRail)
  && /DOCUMENT_POSITION_PRECEDING\) \? -1 : 1;/.test(loopRail));
check("…a keyboard focus no identical view shows is brought in at rest too (Tab during a glide)",
  /if \(focus >= 0 && shown === undefined && document\.activeElement\?\.matches\(":focus-visible"\)\) \{\s*revealRef\.current\(focus, focus < best \? -1 : 1\);/.test(loopRail));
check("…anything focusable a copy renders later (a clip's controls) gets tabindex -1 too",
  /"video", "audio", "iframe", "\[tabindex\]"/.test(loopRail) && /new MutationObserver\(quiet\)/.test(loopRail) && /setAttribute\("tabindex", "-1"\)/.test(loopRail));
check("…a copy never preloads its picture (only the first real cards may)", /priority=\{!copy && index < 5\}/.test(carousel));
check("the copies before the list come after hydration, and the strip moves by their width in the same frame (no SSR jump)",
  /useLayoutEffect\(\(\) => \{ setReady\(true\); \}, \[\]\)/.test(loopRail) && /positioned\.current = true;\s*jump\(g\.track, g\.track\.scrollLeft \+ g\.origin\)/.test(loopRail));
check("at rest over the copies the strip moves — instantly, by one list's width — onto the real cards (the focused one kept in view)",
  /const options = \[near, near - n, near \+ n\]\.filter\(\(i\) => fits\(g, i\)\)/.test(loopRail) && /behavior: "instant"/.test(loopRail)
  && /options\.find\(\(i\) => shows\(g, i, focus\)\)/.test(loopRail) && /options\.find\(\(i\) => i >= 0 && i <= n - 1\)/.test(loopRail));
check("…stopped between two cards (only possible at the strip's very ends): eased onto the nearest card, never snapped with a jump",
  /if \(Math\.abs\(at - near\) > 0\.02\) \{ glideTo\(at, near, ALIGN_MS\); return; \}/.test(loopRail));
check("…rest = `scrollend`, or no scroll event, no finger and no held button for a moment (a click is never lost to a move)",
  /addEventListener\("scrollend", onEnd\)/.test(loopRail) && /const SETTLE_MS = 140;/.test(loopRail)
  && /if \(touchRef\.current \|\| pressRef\.current \|\| glideRef\.current\) return;/.test(loopRail)
  && /if \(e\.pointerType === "touch" \|\| \(e\.button !== 0 && e\.button !== 1\)\) return;\s*pressRef\.current = true;\s*if \(haltGlide\(\)\) track\.style\.scrollSnapType = "none";/.test(loopRail)
  && /window\.addEventListener\("blur", onRelease\);/.test(loopRail));
check("…a hold ends only when the LAST finger lifts", /const onTouchEnd = \(e: TouchEvent\) => \{\s*if \(\(e\.touches\?\.length \?\? 0\) > 0\) return;/.test(loopRail));
check("…Alt/Cmd/Ctrl/Shift + ←/→ are left to the browser (Back/Forward)", /if \(e\.altKey \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey\) return;/.test(loopRail));
check("…card + gap a multiple of 4px where round() exists, so the move between twins is exact on 1×/1.25×/1.5×/2×/3× screens",
  /supports-\[width:round\(down,1px,1px\)\]:\[&>\*\]:w-\[calc\(round\(nearest,calc\(.*_\+_var\(--rail-gap\)\),4px\)_-_var\(--rail-gap\)\)\]/.test(loopRail));
check("arrows: always both, one card per press, presses add up; the glide is drawn by its own frames, snap off, every frame at the identical spot inside the range",
  !/edge\./.test(loopRail) && /onClick=\{\(\) => step\(-1\)\}/.test(loopRail) && /onClick=\{\(\) => step\(1\)\}/.test(loopRail)
  && /glideTo\(from, \(glide \? glide\.to : Math\.round\(from\)\) \+ dir, STEP_MS\)/.test(loopRail)
  && /track\.style\.scrollSnapType = "none";/.test(loopRail) && /jump\(g\.track, place\(g, glide\.at\)\)/.test(loopRail)
  && /while \(left > g\.max \+ 0\.5\) left -= g\.period;/.test(loopRail) && /while \(left < -0\.5\) left \+= g\.period;/.test(loopRail));
check("…same arrows, same place, same look as the plain Rail (hidden on a phone, as before: swipe there)",
  loopRail.includes(rail.match(/const arrow = "[^"]+";/)?.[0] ?? "∅") && /data-rail-prev/.test(loopRail) && /data-rail-next/.test(loopRail));
check("…reduced motion: no glide, the strip is simply there", /prefers-reduced-motion: reduce/.test(loopRail) && /const d = reducedMotion\(\) \? 0 : duration;/.test(loopRail));
check("…a press during a glide carries its speed on (Hermite curve), never faster than an ease-out, never backwards",
  /const curve = \(g: Glide, s: number\) =>/.test(loopRail) && /Math\.min\(Math\.max\(Math\.abs\(prev\.v\), Math\.abs\(span\) \/ d\), \(3 \* Math\.abs\(span\)\) \/ d\)/.test(loopRail));
check("…a finger or a sideways wheel takes the strip: a glide stops where it is, snapping stays off (nothing jumps under the hand), and out over the copies the strip is first moved back invisibly",
  /touchRef\.current = true;\s*window\.clearTimeout\(timerRef\.current\);\s*takeOver\(\);/.test(loopRail) && /if \(e\.deltaX !== 0 \|\| e\.shiftKey\) takeOver\(true\);/.test(loopRail)
  && /const edge = wheel \? n \/ 2 : 0\.5;\s*const shift = at < -edge \? n : at >= n - 1 \+ edge \? -n : 0;/.test(loopRail) && !/stopGlide/.test(loopRail));
check("…snapping goes back on BEFORE settle's move, so the move replaces any old snap target of the browser's (same frame)",
  /if \(restoring\) g\.track\.style\.scrollSnapType = "";\s*if \(restoring \|\| Math\.abs\(g\.origin \+ best \* g\.pitch - g\.track\.scrollLeft\) > 0\.5\) jump\(g\.track, g\.origin \+ best \* g\.pitch\);/.test(loopRail)
  && !/glideRef\.current = null;\s*g\.track\.style\.scrollSnapType = "";/.test(loopRail));
check("…once the strip itself scrolls with the finger, snapping comes back on (the browser snaps at the swipe's end): one card per swipe, however fast; a page swipe leaves it alone",
  /if \(touchRef\.current && track\.style\.scrollSnapType && Math\.abs\(track\.scrollLeft - touchLeft\) > 1\) track\.style\.scrollSnapType = "";/.test(loopRail)
  && /const onScroll = \(\) => \{ resnapUnderFinger\(\); later\(\); \};/.test(loopRail) && /const onTouchMove = resnapUnderFinger;/.test(loopRail));
check("…←/→ aim from where a running glide will rest, and always glide the way the focus moved (never backwards, never a lap)",
  /const rest = glide \? glide\.to : Math\.round\(now\);/.test(loopRail) && /const start = dir > 0 \? end - ahead : end \+ \(\(n - ahead\) % n\);/.test(loopRail));
check("…every frame of a glide moves (the clock read in the frame, not the frame's older timestamp)",
  /Math\.min\(1, \(performance\.now\(\) - glide\.start\) \/ glide\.duration\)/.test(loopRail));
check("←/→ on a card: its neighbour, the last card's being the first, stepping over cards that do not open; the real card comes into view",
  /const k = \(\(\(at \+ dir \* s\) % n\) \+ n\) % n;/.test(loopRail) && /target\.focus\(\{ preventScroll: true \}\)/.test(loopRail) && /reveal\(k, dir\)/.test(loopRail)
  && /closest\("input, textarea, select"\)\) return;/.test(loopRail));
check("a new width puts the same real card back at the left edge; a height change (a font) does nothing",
  /if \(track\.clientWidth === width\) return;/.test(loopRail) && /new ResizeObserver/.test(loopRail));
check("every listener is removed on unmount, each added once; a glide in flight is cancelled",
  ["scroll", "scrollend", "touchstart", "touchmove", "touchend", "touchcancel", "wheel", "pointerdown", "contextmenu", "focusin", "pointerup", "pointercancel", "dragend", "blur"].every((ev) =>
    (loopRail.match(new RegExp(`addEventListener\\("${ev}"`, "g")) ?? []).length === 1
    && (loopRail.match(new RegExp(`removeEventListener\\("${ev}"`, "g")) ?? []).length === 1)
  && /ro\?\.disconnect\(\)/.test(loopRail) && /mo\?\.disconnect\(\)/.test(loopRail)
  && /window\.clearTimeout\(timerRef\.current\);\s*haltGlide\(\);\s*track\.removeEventListener/.test(loopRail));
check("no carousel library: native scrolling and scroll-snap, like Rail", !/from "(embla|swiper|keen-slider|react-slick|flickity)/.test(loopRail)
  && /snap-x snap-mandatory/.test(loopRail) && /overflow-x-auto/.test(loopRail));
{
  const carouselData = (hide: readonly string[] = []) => ({
    balance: 0, uploadTools: [], toolSlots: {}, channel: null, askChannel: false, interests: [], soon: [], pro: null,
    banners: [], slots: new Map(), isAdmin: false,
    items: Object.fromEntries(CAROUSEL.filter((c) => !hide.includes(c.item)).map((c) =>
      [c.item, S(c.item, `/t/${c.item}`, c.item === "moda.ghostMannequin" ? "soon" : c.item === "custom" ? "maintenance" : "live", 4)])),
  }) as unknown as Parameters<typeof ToolCarousel>[0]["data"];
  const out = html(createElement(ToolCarousel, { data: carouselData(), t: T }));
  const realTiles = (out.match(/data-carousel-tile="/g) ?? []).length;
  const copyTiles = (out.match(/data-carousel-clone="/g) ?? []).length;
  const copyLinks = out.match(/<a [^>]*data-carousel-clone="[^"]*"[^>]*>/g) ?? [];
  const realLinks = out.match(/<a [^>]*data-carousel-tile="[^"]*"[^>]*>/g) ?? [];
  check("server render: the 11 real cards once, the copies after them (the ones before come with hydration)",
    /data-loop-rail/.test(out) && realTiles === 11 && copyTiles === 11 && (out.match(/data-loop-clone="after"/g) ?? []).length === 11
    && !/data-loop-clone="before"/.test(out));
  check("…every copy link is tabindex=-1 inside aria-hidden; no real link is", copyLinks.length === 9 && copyLinks.every((a) => /tabindex="-1"/i.test(a))
    && realLinks.length === 9 && realLinks.every((a) => !/tabindex/i.test(a))
    && (out.match(/aria-hidden="true" data-loop-clone="after"/g) ?? []).length === 11);
  check("…a not-live tool is inert in its copy too (badge, no href); a copy opens the same tool as its card",
    /<span aria-disabled="true"[^>]*data-carousel-clone="moda\.ghostMannequin"/.test(out) && /<span aria-disabled="true"[^>]*data-carousel-clone="custom"/.test(out)
    && copyLinks.every((a) => { const key = a.match(/data-carousel-clone="([^"]*)"/)?.[1]; return a.includes(`href="/t/${key}"`); }));
  check("…no id anywhere in the carousel (copies cannot duplicate one)", !/\sid="/.test(out));
  const hidden = html(createElement(ToolCarousel, { data: carouselData(["retouch", "ai_shadow"]), t: T }));
  check("…a hidden tool is gone from the cards AND the copies", !/"retouch"|"ai_shadow"/.test(hidden.replace(/href="[^"]*"/g, ""))
    && (hidden.match(/data-carousel-tile="/g) ?? []).length === 9 && (hidden.match(/data-carousel-clone="/g) ?? []).length === 9);
  const few = html(createElement(ToolCarousel, { data: carouselData(CAROUSEL.slice(4).map((c) => c.item)), t: T }));
  check("…four tools: the plain Rail — no loop, no copies, nothing twice",
    !/data-loop-rail/.test(few) && !/data-carousel-clone/.test(few) && (few.match(/data-carousel-tile="/g) ?? []).length === 4);
}

/* ── 4. media slots ───────────────────────────────────────────────────────*/

section("4. MEDIA SLOTS — CONFIG, ADMIN, SHIPPED, EMPTY; IMAGE AND VIDEO");
const img = (src: string | null, extra: Partial<MediaSrc> = {}): MediaSrc => ({ configKey: "homeMedia.test", kind: "image", src, width: 1080, height: 1350, ...extra });
const emptyHtml = html(createElement(MediaSlot, { media: img(null), label: "Miniaturka 01", hint: "1080×1350 px", sizes: "1px" }));
check("an empty slot: brand gradient, its name and size, its frame — never an <img>",
  /data-media-slot="empty"/.test(emptyHtml) && /Miniaturka 01/.test(emptyHtml) && /1080×1350 px/.test(emptyHtml)
  && /radial-gradient/.test(emptyHtml) && /aspect-ratio:1080\/1350/.test(emptyHtml) && !/<img/.test(emptyHtml));
check("…six gradient variations, so a gallery of empty slots is not one tile repeated",
  html(createElement(EmptyArt, { tone: 0, label: "", hint: "" })) !== html(createElement(EmptyArt, { tone: 1, label: "", hint: "" })));
const filledHtml = html(createElement(MediaSlot, { media: img("/home/a.webp", { position: "50% 30%" }), label: "x", hint: "y", sizes: "1px" }));
check("a config image renders lazily, with its focus point", /data-media-slot="image"/.test(filledHtml) && /src="\/home\/a\.webp"/.test(filledHtml)
  && /loading="lazy"/.test(filledHtml) && /50% 30%/.test(filledHtml));
const phoneHtml = html(createElement(MediaSlot, { media: img("/home/wide.webp", { mobileSrc: "/home/square.webp" }), label: "x", hint: "y", sizes: "1px" }));
check("…a phone version replaces it below 640px (art direction)", /\/home\/square\.webp/.test(phoneHtml) && /sm:hidden/.test(phoneHtml) && /max-sm:hidden/.test(phoneHtml));
const videoHtml = html(createElement(MediaSlot, { media: { ...img("/home/clip.mp4"), kind: "video", poster: "/home/clip.webp" }, label: "x", hint: "y", sizes: "1px" }));
check("a clip: poster first, nothing fetched until near the viewport, muted, looping, inline",
  /<video/.test(videoHtml) && /poster="\/home\/clip\.webp"/.test(videoHtml) && /preload="none"/.test(videoHtml)
  && !/ src="\/home\/clip\.mp4"/.test(videoHtml) && /muted/.test(videoHtml) && /loop/.test(videoHtml) && /playsInline|playsinline/.test(videoHtml));
const slots: SlotMap = new Map([["tools.retouch.card", {
  mediaType: "image", desktop: "/admin/retouch.webp", alt: "", fit: "cover", position: "center",
  autoplay: false, muted: true, loop: true, controls: false,
} as unknown as never]]) as unknown as SlotMap;
const adminHtml = html(createElement(MediaSlot, { media: img(null), admin: { slot: "tools.retouch.card", slots }, label: "x", hint: "y", sizes: "1px" }));
check("an empty config slot shows the admin's card picture of that tool", /data-media-slot="admin"/.test(adminHtml) && /\/admin\/retouch\.webp/.test(adminHtml));
const shippedHtml = html(createElement(MediaSlot, { media: img(null), shipped: "/showcase/ecommerce-thumbnail.webp", label: "x", hint: "y", sizes: "1px" }));
check("…else a shipped example, shown whole over a blurred copy", /data-media-slot="shipped"/.test(shippedHtml) && /object-contain/.test(shippedHtml));
const containHtml = html(createElement(MediaSlot, { media: img("/home/a.webp", { fit: "contain" }), label: "x", hint: "y", sizes: "1px" }));
check("…`fit: \"contain\"` shows the whole file instead of cropping it", /object-contain/.test(containHtml) && !/object-cover/.test(containHtml)
  && /object-cover/.test(filledHtml));
check("MediaSlot reuses the existing SlotMedia / SlotVideo — no second media system",
  /from "@\/components\/media\/slot-media"/.test(code("components/seller-home/media-slot.tsx"))
  && /from "@\/components\/media\/slot-video"/.test(code("components/seller-home/media-slot.tsx")));
// Fixture changed by the inline-editor task: PRZED/PO became 1:1, so the
// frame and hint handed to the slider here follow BEFORE_AFTER_SIZE
// (1080×1080) instead of the old literal 4:5 (1080/1350). Nothing asserted
// below reads them — the checks are about the range and the pointer.
const ba = html(createElement(BeforeAfter, {
  pair: BEFORE_AFTER[0].media, ratio: ratioOf(BEFORE_AFTER_SIZE), sizes: "1px",
  labels: { before: "Przed", after: "Po", slider: "Porównanie", emptyBefore: "Zdjęcie przed", emptyAfter: "Efekt po",
    hint: `${BEFORE_AFTER_SIZE.width}×${BEFORE_AFTER_SIZE.height} px` },
}));
check("before/after: a labelled native range for the keyboard and screen readers",
  /type="range"/.test(ba) && /aria-label="Porównanie"/.test(ba) && /aria-valuetext="50%"/.test(ba));
const baSrc = code("components/seller-home/before-after.tsx");
check("…a phone swipe over the picture pans the rail: the range takes no pointer events, only the handle's strip is touch-action:none",
  /pointer-events-none absolute inset-0 z-20[^"]*opacity-0/.test(baSrc) && /data-before-after-grip/.test(baSrc)
  && /\[touch-action:none\]/.test(baSrc) && !/touch-action:pan-y/.test(baSrc) && /if \(e\.pointerType === "mouse"\) start\(e\)/.test(baSrc));
check("…the slider is NOT inside a link — only the caption links", !/<a\b/.test(ba)
  && /<BeforeAfter[\s\S]*?<\/div>\s*<ToolLink state=\{state\} data-ba-link/.test(sections));
check("every slot in the asset list has a key, a kind and a positive size; keys unique",
  assetList().every((r) => r.media.configKey && (r.media.kind === "image" || r.media.kind === "video") && r.media.width > 0 && r.media.height > 0)
  && new Set(assetList().map((r) => r.media.configKey)).size === assetList().length, String(assetList().length));
check("…it lists every banner's phone file and every clip's poster too",
  Object.values(PROMO_BANNERS).every((b) => assetList().some((r) => r.media.configKey === `${b.media.configKey}.mobile`))
  && assetList().filter((r) => r.media.kind === "video").every((v) => assetList().some((r) => r.media.configKey === `${v.media.configKey}.poster`)));

/* ── 5. honesty: what does not run is not a link ──────────────────────────*/

section("5. AN ITEM THAT DOES NOT RUN IS NEVER A LINK");
const inert = html(createElement(ToolLink, { state: S("moda.iron", "/k/moda/iron", "soon", 7), children: "x" }));
check("an inert tool renders no href, aria-disabled", !/href=/.test(inert) && /aria-disabled="true"/.test(inert));
const live = html(createElement(ToolLink, { state: LIVE.retouch, children: "x" }));
check("…a live tool links to its own existing route", /href="\/retusz"/.test(live));
check("…and carries a badge that says why", statusBadge("soon") === "soon" && statusBadge("live") === null
  && /sellerHome\.status\.soon/.test(html(createElement(StatusBadge, { status: "soon", t: T }))));
const bannerSoon = html(createElement(PromoBanner, { def: PROMO_BANNERS.first, items: { generator: S("generator", "/prompts", "soon", 4) }, t: T }));
check("a banner whose tool does not run draws no button — its badge says why",
  !/data-promo-cta/.test(bannerSoon) && /data-media-slot="empty"/.test(bannerSoon) && /sellerHome\.status\.soon/.test(bannerSoon));
check("…a banner about a tool this viewer may not see is not drawn at all",
  html(createElement(PromoBanner, { def: PROMO_BANNERS.first, items: {}, t: T })) === "");
const bannerLive = html(createElement(PromoBanner, {
  def: PROMO_BANNERS.second, items: { custom: S("custom", "/generator", "live", 4) }, t: T,
}));
check("…a live one links its button to the tool", /data-promo-cta="promo2"/.test(bannerLive) && /href="\/generator"/.test(bannerLive));
check("…banners: about 4.7:1 desktop, 5:2 tablet, square phone — frames from the config",
  ratioOf(BANNER_FRAME.wide) === "2400/510" && ratioOf(BANNER_FRAME.tablet) === "2000/800" && ratioOf(BANNER_FRAME.phone) === "1080/1080"
  && /aspect-\[var\(--ar-phone\)\][^"]*sm:aspect-\[var\(--ar-tablet\)\][^"]*lg:aspect-\[var\(--ar-wide\)\]/.test(sections)
  && /"--ar-wide": ratioOf\(BANNER_FRAME\.wide\)/.test(sections) && /aspect-\[var\(--ar-phone\)\]/.test(html(createElement(PromoBanner, {
    def: PROMO_BANNERS.second, items: { custom: S("custom", "/generator", "live", 4) }, t: T }))));
check("…the copy layer lets pointers through to a clip; only its button takes them",
  /pointer-events-none absolute inset-0 flex flex-col/.test(sections) && /"pointer-events-auto mt-1/.test(sections));
const soonX = S("x", "/x", "soon", 1);
const liveX = S("x", "/x", "live", 1);
check("try links and gallery buttons render only for a live tool (rendered, not grepped)",
  html(createElement(GalleryCta, { state: soonX, label: "L" })) === "" && html(createElement(TryLink, { state: soonX, label: "L" })) === ""
  && html(createElement(GalleryCta, { state: null, label: "L" })) === "" && html(createElement(TryLink, { state: undefined, label: "L" })) === ""
  && /href="\/x"/.test(html(createElement(GalleryCta, { state: liveX, label: "L" }))) && /href="\/x"/.test(html(createElement(TryLink, { state: liveX, label: "L" }))));
const sessSoon = html(createElement(SessionsSection, { items: { generator: S("generator", "/prompts", "soon", 4) }, t: T }));
check("session buttons: a link only while the tool runs; not running → badge; out of reach → not drawn",
  !/data-session-cta/.test(sessSoon) && /aria-disabled="true"/.test(sessSoon) && /sellerHome\.status\.soon/.test(sessSoon)
  && !/sellerHome\.sessions\.outdoor/.test(sessSoon)
  && html(createElement(SessionsSection, { items: {}, t: T })) === ""
  && /data-session-cta="generator"[^>]*|href="\/prompts"/.test(html(createElement(SessionsSection, { items: { generator: S("generator", "/prompts", "live", 4) }, t: T }))));
check("Miniaturki is the thumbnail tool's section: gone when the viewer may not see that tool",
  html(createElement(ThumbnailsSection, { items: {}, t: T })) === ""
  && /data-seller-thumbnails/.test(html(createElement(ThumbnailsSection, { items: { "ecommerce.thumbnail": LIVE["ecommerce.thumbnail"] }, t: T }))));
check("featured and carousel cards go through ToolLink (inert = no href), and only a live card lifts / zooms / glows on hover",
  /<ToolLink key=\{card\.item\} state=\{state\}/.test(sections) && /<ToolLink key=\{def\.item\} state=\{state\}/.test(carousel)
  && /live && "transition-transform duration-300 hover:-translate-y-0\.5/.test(sections) && /live && "transition-transform duration-500 ease-out group-hover:scale/.test(carousel)
  && !/className="[^"]*group-hover:scale/.test(sections + carousel));

/* ── 6. the upload tile ───────────────────────────────────────────────────*/

section("6. THE UPLOAD TILE — THE OLD BOX, THREE TOOLS, FIVE SAMPLES, THE EXISTING HANDOFF");
check("pills in order: Retusz zdjęć, Miniaturka, Sesja zewnątrz; Miniaturka by default",
  UPLOAD_TOOLS.map((u) => u.key).join(",") === "retouch,thumbnail,outdoor" && DEFAULT_UPLOAD_TOOL === "thumbnail");
check("…each pill is a real tool: /retusz, the thumbnail workflow, /tools' „Sesja zewnątrz” (moda.street)",
  UPLOAD_TOOLS.map((u) => u.item).join(",") === "retouch,ecommerce.thumbnail,moda.street" && UPLOAD_TOOLS.every((u) => Boolean(catalogItem(u.item)))
  && catalogItem("moda.street")?.href === "/k/moda/street");
check("…five example slots per tool, each with its own config key", UPLOAD_TOOLS.every((u) => u.samples.length === 5)
  && new Set(UPLOAD_TOOLS.flatMap((u) => u.samples.map((s) => s.configKey))).size === 15);
const tools = resolveUploadTools(LIVE);
check("Retusz takes no handed photo; the thumbnail and outdoor screens do", tools.find((x) => x.key === "retouch")?.handoff === false
  && tools.find((x) => x.key === "thumbnail")?.handoff === true && tools.find((x) => x.key === "outdoor")?.handoff === true);
check("…Retusz is never a handoff route; every receiving route is a workflow that renders the generator workspace (no Moda tool, nothing „soon”)",
  !HANDOFF_ROUTES.some((r) => r.includes("retusz")) && HANDOFF_ROUTES.every((r) => {
    const [, k, cat, wf] = r.split("/");
    const w = findCategory(cat)?.workflows.find((x) => x.key === wf);
    return k === "k" && Boolean(w) && !w?.tool && !w?.soon;
  }) && HANDOFF_ROUTES.includes("/k/moda/street") && !HANDOFF_ROUTES.includes("/k/moda/ghostMannequin"));
check("…a pill whose tool is unknown to the viewer is left out", resolveUploadTools({ retouch: LIVE.retouch }).length === 1);
const dead = resolveUploadTools({
  retouch: S("retouch", "/retusz", "soon", 7),
  "ecommerce.thumbnail": S("ecommerce.thumbnail", "/k/ecommerce/thumbnail", "unavailable", 4),
  "moda.street": S("moda.street", "/k/moda/street", "maintenance", 4),
});
check("…all three known but none running: drawn with badges, none selectable, nothing handed over",
  dead.length === 3 && dead.every((d) => !d.handoff) && defaultUploadTool(null, dead) === null
  && selectedUploadTool(dead, "thumbnail", "thumbnail") === null);
check("…each pill carries its tool's own price and route, which reach the no-credits check",
  tools.find((x) => x.key === "thumbnail")?.credits === 4 && tools.find((x) => x.key === "thumbnail")?.href === "/k/ecommerce/thumbnail"
  && tools.find((x) => x.key === "retouch")?.credits === 7
  && /balance=\{data\.balance\}/.test(body) && /perImage=\{tool\?\.credits \?\? null\}/.test(upload));
check("Miniaturka is the default for every channel, then the first live one",
  SELLER_CHANNELS.every((c) => defaultUploadTool(c, tools) === "thumbnail") && defaultUploadTool(null, tools) === "thumbnail"
  && defaultUploadTool(null, resolveUploadTools({ retouch: LIVE.retouch })) === "retouch"
  && defaultUploadTool(null, resolveUploadTools({})) === null);
check("…a remembered pick that went offline falls back — never a dead tool",
  selectedUploadTool(resolveUploadTools({ ...LIVE, "moda.street": { ...LIVE["moda.street"], status: "maintenance" } }), "outdoor", "thumbnail")?.key === "thumbnail"
  && /selectedUploadTool\(tools, picked, defaultTool\)/.test(upload));
check("the tile is the old Start box: centred, magenta rim + halo, upload glyph, one sentence, „Utwórz”",
  /max-w-\[56rem\]/.test(upload) && /border-\[rgb\(var\(--accent\)\/0\.5\)\]/.test(upload) && /shadow-\[0_0_46px_-10px/.test(upload)
  && /<Upload size=\{18\} \/>/.test(upload) && /sellerHome\.upload\.create/.test(upload));
check("the halo is not cut: closest-side layers, reaching below the section, never catching clicks",
  (upload.match(/closest-side/g) ?? []).length === 3 && /h-\[calc\(100%\+7rem\)\]/.test(upload) && /pointer-events-none absolute/.test(upload)
  && /-z-10/.test(upload));
check("the sentence is per tool (no prompt implied where the tool needs none); the default is the spec's",
  UPLOAD_TOOLS.every((u) => u.leadKey.startsWith("sellerHome.upload.lead.")) && UPLOAD_LEAD_DEFAULT === "sellerHome.upload.lead.default");
check("validates every file with the shared intake (MIME + 10 MB) before holding it",
  /acceptFiles\(list, HOME_LIMITS, 1\)/.test(upload) && /ALLOWED_MIME, ext: null, maxBytes: MAX_FILE_BYTES, maxFiles: 1/.test(upload));
check("„Utwórz”: no credits → the no-credits dialog; no photo → the picker; else hand over once and open the tool",
  /if \(cannotAfford\(balance, tool\.credits\)\) \{ setNoCredits\(true\); return; \}/.test(upload)
  && /if \(!file\) \{ inputRef\.current\?\.click\(\); return; \}/.test(upload)
  && /stashHomeUpload\(file, tool\.href\);[\s\S]{0,40}setBusy\(true\);[\s\S]{0,30}router\.push\(tool\.href\)/.test(upload));
check("…Retusz: „Utwórz” only opens /retusz — nothing stashed, the tile says the photo is added there",
  /if \(!handoff\) \{ setBusy\(true\); router\.push\(tool\.href\); return; \}/.test(upload) && /sellerHome\.upload\.opensTool/.test(upload));
const pickBody = upload.slice(upload.indexOf("const pickSample"), upload.indexOf("const handoff"));
check("picking a sample only fetches the sample and holds it — no navigation, no handoff, no request, no credit",
  pickBody.length > 100 && /take\(\[new File/.test(pickBody) && !/router\.|stashHomeUpload|setBusy|setNoCredits|\/api\//.test(pickBody));
check("…a slow sample never overwrites a photo chosen after it", /const mine = \+\+choice\.current;/.test(pickBody)
  && /if \(mine !== choice\.current\) return;/.test(pickBody) && /choice\.current \+= 1;\s*const res = acceptFiles/.test(upload));
check("…its file keeps the sample's own name (nothing language-bound in the UI)", !/przyklad/.test(upload) && /split\("\/"\)\.pop\(\)/.test(pickBody));
check("removing the photo returns the keyboard focus to the tile", /setFile\(null\);\s*document\.getElementById\(UPLOAD_ID\)\?\.focus\(\);/.test(upload)
  && /focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-\[rgb\(var\(--accent\)\)\]/.test(upload));
check("drag & drop: a file or a sample onto the tile; nothing is accepted for a tool that takes no photo",
  /SAMPLE_DRAG/.test(upload) && /draggable/.test(upload) && /if \(!handoff \|\| !tool\) return;/.test(upload)
  && /dropEffect = handoff \? "copy" : "none"/.test(upload));
check("…empty samples are placeholders, inert, with „Przykłady wkrótce”", /data-sample-empty/.test(upload) && /data-samples-soon/.test(upload));
check("the whole tile is one real button; „Utwórz” and „remove” sit above it, never inside it",
  /<button id=\{UPLOAD_ID\} type="button"/.test(upload) && /absolute inset-0 z-0/.test(upload) && /relative z-10 mt-4/.test(upload));
check("the pills are a radio group with arrow keys", /role="radiogroup"/.test(upload) && /role="radio"/.test(upload) && /aria-checked=\{on\}/.test(upload)
  && /ArrowRight/.test(upload));
check("the credit balance is no longer printed on the page (only the no-credits dialog states it)",
  !/sellerHome\.credits|formatCount\(balance\)/.test(SH.replace(code("components/seller-home/no-credits-modal.tsx"), "")));

/* ── 7. the sections ──────────────────────────────────────────────────────*/

section("7. BEFORE/AFTER, BANNERS, SHOWCASE, MINIATURKI, SESJE, FEATURED, NADCHODZI");
check("before/after: six large cards in one row (rail), each with its tool and industry",
  BEFORE_AFTER.length === 6 && BEFORE_AFTER.every((b) => Boolean(catalogItem(b.item)) && (INDUSTRIES as readonly string[]).includes(b.industry))
  && /xl:\[--rail-cols:5\]/.test(sections) && /2xl:\[--rail-cols:6\]/.test(sections));
check("three banners, one reusable component", Object.keys(PROMO_BANNERS).join(",") === "first,second,third"
  && (body.match(/<PromoBanner /g) ?? []).length === 3);
check("showcase: ~40/60 split, 12 results 3 × 4 fading into the panel, one button, no heading",
  /lg:grid-cols-\[2fr_3fr\]/.test(sections) && SHOWCASE.gallery.length === 12 && /cols="columns-2 sm:columns-3"/.test(sections)
  && Boolean(catalogItem(SHOWCASE.item)));
check("Miniaturki: 20 square tiles in an even grid — 5 / 3 / 2 columns, 4 rows on a desktop, one button to the thumbnail tool",
  THUMBNAILS.tiles.length === 20 && /\[--sq-cols:2\]/.test(sections) && /sm:\[--sq-cols:3\]/.test(sections) && /lg:\[--sq-cols:5\]/.test(sections)
  && /lg:\[--sq-rows:4\]/.test(sections) && /grid-cols-\[repeat\(var\(--sq-cols\),minmax\(0,1fr\)\)\] gap-\[var\(--sq-gap\)\]/.test(sections)
  && THUMBNAILS.item === "ecommerce.thumbnail" && /<SquareGallery tiles=\{THUMBNAILS\.tiles\}/.test(sections) && !/columns-2 sm:columns-3 lg:columns-5/.test(sections));
check("…every slot is 1:1, recommended 1200×1200; keys 1–20 unchanged, nothing filled in, nothing else in the list",
  THUMBNAILS.tiles.every((t, i) => t.media.configKey === `homeMedia.thumbnails.${i + 1}` && t.media.kind === "image"
    && t.media.width === 1200 && t.media.height === 1200 && t.media.src === null)
  && assetList().filter((r) => r.section === "7 Miniaturki").length === 20);
check("…the window is whole rows tall from its own width (no layout shift); the rows past it stay in the page",
  /\[container-type:inline-size\]/.test(sections) && /h-\[calc\(var\(--sq-rows\)_\*_\(\(100cqw_-_\(var\(--sq-cols\)_-_1\)_\*_var\(--sq-gap\)\)_\/_var\(--sq-cols\)\)_\+_\(var\(--sq-rows\)_-_1\)_\*_var\(--sq-gap\)\)\]/.test(sections));
check("…the last row melts into the page — a mask (the real background in either theme), never a painted white",
  /\[mask-image:linear-gradient\(to_bottom,black_67%,[^\]]*transparent_99%\)\]/.test(sections) && /lg:\[mask-image:linear-gradient\(to_bottom,black_75%,[^\]]*transparent_99%\)\]/.test(sections)
  && !/function SquareGallery[\s\S]*?(bg-white|from-white|#fff)[\s\S]*?\n}\n/.test(sections));
{
  const thumbs = html(createElement(ThumbnailsSection, { items: { "ecommerce.thumbnail": LIVE["ecommerce.thumbnail"] }, t: T }));
  const frames = thumbs.match(/<span[^>]*data-config-key="homeMedia\.thumbnails\.\d+"[^>]*>/g) ?? [];
  check("…rendered: 20 frames, every one aspect-ratio 1/1, every hint 1200×1200",
    frames.length === 20 && frames.every((f) => /aspect-ratio:1\/1/.test(f)) && (thumbs.match(/sellerHome\.slot\.size\(1200,1200\)/g) ?? []).length === 20);
  check("…the heading, its line and „Wypróbuj” unchanged; the button sits on the fade, above it",
    /id="seller-thumbs-title"[^>]*>sellerHome\.thumbs\.title</.test(thumbs) && />sellerHome\.thumbs\.sub</.test(thumbs) && /sellerHome\.thumbs\.try/.test(thumbs)
    && /absolute inset-x-0 bottom-\[5%\] z-\[1\] flex justify-center[^>]*>[\s\S]*sellerHome\.thumbs\.cta/.test(thumbs));
}
// Re-scoped by the inline-editor task: PRZED/PO became 1:1 (BEFORE_AFTER_SIZE
// = SQUARE, 1080×1080) — the one intended format change. The pin itself is
// KEPT: undo exactly that (the twelve "3 Przed / po" rows back at the old
// 1080×1350) and the list must hash to the last release's digest, so no other
// slot's key, kind or size can move under cover of this change; the BA rows
// must really be 1080×1080 for the undo to apply.
{
  const baRows = assetList().filter((r) => r.section.startsWith("3 "));
  const undo = (r: (typeof baRows)[number]) => r.section.startsWith("3 ") && r.media.width === 1080 && r.media.height === 1080
    ? [1080, 1350] : [r.media.width, r.media.height];
  check("no other slot changed format: outside Miniaturki every slot is the last release's (key, kind, size) — only PRZED/PO became 1:1",
    baRows.length === 12 && baRows.every((r) => r.media.width === 1080 && r.media.height === 1080)
    && createHash("sha256").update(JSON.stringify(assetList().filter((r) => !r.section.startsWith("7 "))
      .map((r) => [r.section, r.media.configKey, r.media.kind, ...undo(r)]))).digest("hex")
      === "cfb689940af98baa584c3234ef80c7fa1d5bdec89dc4661aba02901956eb68ca");
}
check("fading galleries: a fixed window (no layout shift) and a mask, CSS columns (nothing stretched)",
  /\[mask-image:linear-gradient\(to_bottom,black_72%,transparent_99%\)\]/.test(sections) && /break-inside-avoid/.test(sections));
const shapes = new Set(SESSIONS.tiles.map((t) => `${t.media.width}/${t.media.height}`));
check("Sesje produktowe: 16 slots across 1:1, 16:9, 4:5, 3:4, 9:16; studio → Grovshot, plener → „Sesja zewnątrz”",
  SESSIONS.tiles.length === 16 && ["1080/1080", "1920/1080", "1080/1350", "1080/1440", "1080/1920"].every((s) => shapes.has(s))
  && SESSIONS.studio.item === "generator" && SESSIONS.outdoor.item === "moda.street");
check("featured: Niewidzialny manekin, Leżący produkt, Wyprasuj — their real Moda tools",
  FEATURED.map((f) => f.item).join(",") === "moda.ghostMannequin,moda.flatlay,moda.iron" && FEATURED.every((f) => Boolean(catalogItem(f.item))));
check("…hover (live cards): subtle zoom, lift and rim; a rail on phones, three across on a desktop",
  /group-hover:scale-\[1\.04\]/.test(sections) && /hover:-translate-y-0\.5/.test(sections) && /lg:\[--rail-cols:3\]/.test(sections));
check("Nadchodzi keeps its five features and the same write", INTEREST_KEYS.join(",") === "ugc,video,ads,social,mailing"
  && /registerInterestAction\(key\)/.test(code("components/seller-home/coming-soon.tsx")));
check("section headings are small caps 13–14px", /text-\[13px\] font-bold uppercase tracking-\[0\.07em\]/.test(code("components/seller-home/parts.tsx")));

/* ── 8. availability ──────────────────────────────────────────────────────*/

section("8. THE SWITCHBOARD AND EACH TOOL'S RUNTIME DECIDE WHAT IS LIVE");
check("every item passes /tools' own reachability, its status badge and the layout's „Narzędzia” flag",
  /itemReachable\(availability, item, isAdmin\)/.test(loader) && /statusOfBadge\(itemBadge\(availability, item\)\)/.test(loader)
  && /layout\.flags\[key\]\?\.tools === false/.test(loader) && /getToolsLayout\(supabase\)/.test(loader));
check("…and each tool's own runtime: the engine, toolCatalogue, Retusz's prompt, the Moda tool, Własny prompt's model",
  /managedLive/.test(loader) && /entry\.available/.test(loader) && /retouchConfigured/.test(loader) && /fashionOn\.get\(wf\)/.test(loader)
  && /customModels\(usable\)\.map\(toClientModel\)\[0\]/.test(loader));
check("…a Moda workflow that is not a Moda tool (the street session) is a managed preset",
  /if \(cat === "moda" && isFashionTool\(wf\)\)/.test(loader) && /A managed preset/.test(read("lib/server/seller-home.ts")));
check("…customers never see a switched-off item; admins see it, marked", /s\.status !== "disabled" \|\| isAdmin/.test(loader));
check("prices are each tool's own (one click as its screen shows it) — none typed into the config",
  /unitPrice\(genModel/.test(loader) && /retouchPrice\(retouch/.test(loader) && /fashionPrice\(fashion/.test(loader)
  && /engineOutputsPerRun\(supabase, "retouch"\)/.test(loader)
  && !/\bcredits?\s*:/.test(config) && !/pricing|price_cents|perCredit|creditCost/.test(config));
check("the PRO offer goes to checkout only when Stripe would sell it and no plan is live",
  /sellable\(plan, "monthly"\)/.test(loader) && /\(activeSub\.data \?\? \[\]\)\.length === 0/.test(loader));
check("„Nadchodzi” drops a module once it is live", /menuBadge\(availability, INTEREST_GATES\[k\]\) !== null/.test(loader));
check("no recent-projects read any more (the Library keeps them)", !/listGalleryItems|recentCards/.test(loader));
check("no credits for one image → the no-credits moment", cannotAfford(3, 4) && !cannotAfford(4, 4) && !cannotAfford(0, 0) && !cannotAfford(0, null));

/* ── 9. seller channel ────────────────────────────────────────────────────*/

section("9. „GDZIE SPRZEDAJESZ?” — ASKED ONCE, SAVED ON THE PROFILE");
const base = { generations: 0, askedAt: null, channel: null, surveyChannel: null, bonusPending: false } as const;
check("asked only of a seller with 0 generations who was never asked", shouldAskChannel(base)
  && !shouldAskChannel({ ...base, generations: 1 }) && !shouldAskChannel({ ...base, askedAt: "2026-10-07" })
  && !shouldAskChannel({ ...base, channel: "allegro" }));
check("…not while the welcome-bonus dialog is due, nor when the bonus survey already answered",
  !shouldAskChannel({ ...base, bonusPending: true }) && !shouldAskChannel({ ...base, surveyChannel: "amazon" }));
check("…the loader uses that rule with a real count; an unreadable count never asks",
  /shouldAskChannel\(\{/.test(loader) && /from\("generations"\)\.select\("id", \{ count: "exact", head: true \}\)/.test(loader)
  && /generationCount\.error \? 1/.test(loader));
check("…the survey's answer maps onto ours", channelFromSurvey(["allegro"]) === "allegro" && channelFromSurvey(["shopify"]) === "own_store"
  && channelFromSurvey(["allegro", "amazon"]) === "multi" && channelFromSurvey(["not_selling_yet"]) === null);
check("…the answer pre-selects its pill (Miniaturka for every channel, per the spec)", SELLER_CHANNELS.every((c) => CHANNEL_DEFAULT_TOOL[c] === "thumbnail")
  && /setSelectedTool\(CHANNEL_DEFAULT_TOOL\[channel\]\)/.test(code("components/seller-home/seller-modal.tsx")));

type Call = { table: string; op: string; payload?: unknown; filter?: [string, unknown]; options?: unknown };
function fakeDb(rowsAfterUpsert: unknown[] = [{ feature_key: "video" }]) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      return {
        update(payload: unknown) {
          return { eq(col: string, val: unknown) { calls.push({ table, op: "update", payload, filter: [col, val] }); return Promise.resolve({ error: null }); } };
        },
        upsert(payload: unknown, options: unknown) {
          return { select() { calls.push({ table, op: "upsert", payload, options }); return Promise.resolve({ data: rowsAfterUpsert, error: null }); } };
        },
      };
    },
  };
  return { db: db as unknown as Client, calls };
}
{
  const { db, calls } = fakeDb();
  const r = await saveSellerChannel(db, "user-1", "amazon");
  const c = calls[0];
  check("the answer is saved on the caller's own profile row", r.ok && c.table === "profiles" && c.filter?.[0] === "id" && c.filter?.[1] === "user-1"
    && (c.payload as { seller_channel?: string }).seller_channel === "amazon" && Boolean((c.payload as { seller_channel_asked_at?: string }).seller_channel_asked_at));
  const d = fakeDb();
  await saveSellerChannel(d.db, "user-1", null);
  check("…closing it records only that it was asked", d.calls.length === 1 && !("seller_channel" in (d.calls[0].payload as object)));
  const e = fakeDb();
  const bad = await saveSellerChannel(e.db, "user-1", "ebay" as never);
  check("…an unknown channel is refused before any write", !bad.ok && e.calls.length === 0);
  check("…and the database CHECK holds the same four values", SELLER_CHANNELS.every((v) => read("supabase/migrations/0135_home_seller_channel_feature_interest.sql").includes(`'${v}'`))
    && !isSellerChannel("ebay"));
}

/* ── 10. "Powiadom mnie" ──────────────────────────────────────────────────*/

section("10. „POWIADOM MNIE” — IDEMPOTENT, THE USER FROM THE SESSION");
{
  const first = fakeDb([{ feature_key: "video" }]);
  const r1 = await registerFeatureInterest(first.db, "user-1", "ws-1", "video");
  const opts = first.calls[0].options as { onConflict?: string; ignoreDuplicates?: boolean };
  check("one row per (user, feature) — a conflict is a no-op, not a duplicate", r1.ok && r1.created
    && opts.onConflict === "user_id,feature_key" && opts.ignoreDuplicates === true);
  const again = fakeDb([]);
  const r2 = await registerFeatureInterest(again.db, "user-1", "ws-1", "video");
  check("…a repeat click reports success without creating anything", r2.ok && !r2.created);
  const nope = fakeDb();
  const r3 = await registerFeatureInterest(nope.db, "user-1", null, "teleport" as never);
  check("…an unknown feature is refused before any write", !r3.ok && nope.calls.length === 0 && !isInterestKey("teleport"));
}
const actions = code("app/actions/seller-home.ts");
const mig = read("supabase/migrations/0135_home_seller_channel_feature_interest.sql");
check("the actions take the user from the session — no user id or e-mail from the browser",
  /supabase\.auth\.getUser\(\)/.test(actions) && /export async function registerInterestAction\(feature: string\)/.test(actions)
  && /export async function saveSellerChannelAction\(channel: string \| null\)/.test(actions) && !/email/i.test(actions));
check("…RLS: a user inserts and reads only their own rows; admins read all",
  /with check \(\s*user_id = \(select auth\.uid\(\)\)/.test(mig) && /using \(user_id = \(select auth\.uid\(\)\) or \(select public\.is_admin\(\)\)\)/.test(mig)
  && /enable row level security/.test(mig) && !/for update|for delete/.test(mig) && /primary key \(user_id, feature_key\)/.test(mig));
check("…the demand readout runs under the caller's RLS (security invoker)", /security invoker/.test(mig) && /feature_interest_counts/.test(code("app/admin/page.tsx")));
check("…the table's CHECK lists the five features", INTEREST_KEYS.every((k) => mig.includes(`'${k}'`)));
check("…nothing here uses a service-role key", !/service_role|SERVICE_ROLE|createAdminClient/.test(actions + code("lib/services/seller-home.ts") + loader + SH));
// The redesign is the released range b631919..f579637 (3634db4 + f579637).
// Later tasks may add migrations of their own (0136 reserves the /plany slug);
// what this pins is that the /home redesign itself brought none.
check("no database change in this redesign: b631919..f579637 touches no migration",
  (() => {
    try { execFileSync("git", ["diff", "--quiet", "b631919", "f579637", "--", "supabase/migrations"], { stdio: "ignore" }); return true; }
    catch { return false; }
  })());

/* ── 11. AI, Stripe, Retusz ───────────────────────────────────────────────*/

section("11. AI REQUESTS, STRIPE, /plan, /tools AND RETUSZ ARE UNCHANGED");
const ENGINE: readonly [string, string][] = [
  ["lib/ai/providers/google-request.ts", "ebec5219ae0f40e51071c4305115c430f818573235f38737cfe71829d69a88d1"],
  // Re-pinned by Generacje w toku V2 (here and in fashion.ts and the two
  // routes below): the plan's slot marker and the acceptance hook pass through
  // to runGeneration, and the routes answer 202 once the job is accepted and
  // finish it in after(). No prompt, model, provider or request byte changes —
  // the forensic and parity suites hold the requests.
  ["lib/server/concept-generation.ts", "afc720c4d54937712b396d1cbfb994d335ef7b71274e86d8e2c41988840d62ec"],
  ["lib/server/prompt-engine.ts", "5ce9bf1074f34e8852cd06a6440e0c9640a4471049617493d3b1b506e74baf22"],
  // Re-pinned by the photo-tools task (four Photoroom panels: pinned provider,
  // sandbox gating, deliver + alreadyDelivered hooks, presets). Retusz never
  // imports this file.
  // Re-pinned by the trial-watermark task: one guard in runPaid, before the
  // free allowance and the charge — a trial workspace is refused a paid tool
  // (0 calls, 0 credits). No provider request byte changes.
  ["lib/server/image-tools.ts", "ac473b62ebbc13138de61e38293b970fab2127d5a395a9f56d1dbeaf9618a8a2"],
  ["lib/server/fashion.ts", "43147c3ec1602fb3afbdb94d698fc2a13732f7edc2fec1a4716c4fd59af343a8"],
  // Re-pinned by Generator UX V3 (Plan ujęć): the route filters the reference
  // paths FIRST and checks a shot's chosen photo against them
  // (lib/server/shot-plan.ts → invalid_shot_plan, before any paid call). The
  // engine, its prompts and the request it sends are untouched (test:genv3).
  ["app/api/prompts/generate/route.ts", "95657fea7aee587f0d80ad9b3effae4ebd98e55a01906a9f7a239e55fda7590d"],
  ["app/api/concepts/generate/route.ts", "7e9b4a0069bfc227e1aaec8f9189e84ef188a063930385dbc849f820fd1c0075"],
  // Re-pinned by the trial-watermark task: the route passes its own start
  // time (routeStartedAt) so the trial-image gate counts the hybrid engine's
  // analysis too. Nothing else; no request byte changes.
  ["app/api/generate/route.ts", "5d1d820fad55b6f14913a51ef54fee0609e29124401f8742cce2a36959176c6e"],
  // Re-pinned by the photo-tools task: the white_bg / ai_* screens' own
  // switches also gate this endpoint.
  ["app/api/tools/run/route.ts", "8bf75acfde6ebcd36b3fbcb70318f3f081559b8c04b80ef434cb22fbe17114c6"],
  // Re-pinned by the Miniaturka task: one OPT-IN prop (`onMove`, photo order
  // arrows). No other caller passes it, so every other uploader renders and
  // uploads exactly as before.
  // Drag & drop V2: the arrows became the shared reorderable grid
  // (SortablePhotoGrid) — still opt-in through `onMove`; uploading, intake and
  // the file limits are untouched.
  // Generator UX V3: two more OPT-IN props (`usable`, `usableNote`: a mode that
  // sends fewer photos greys the rest and says so) and the 14px section label.
  // Uploading, intake and the file limits are untouched.
  ["components/genv3/uploader.tsx", "1ebf12e2d3402c20fd99a2e2e9e742cdf38784d285ad13f7d59185c839809a24"],
  ["lib/images/file-intake.ts", "1dc99c83483f3fa80527e319501edb5a35b717d92771dd72c38eda17bd9acc29"],
  ["lib/services/images.ts", "e6adba31a68d9fa9afcfe69f242a63370032bd5ce31323cf1ef60236d2a3adcf"],
  ["lib/services/credits.ts", "1a25606a89ca4ebc6f2640542f59b9185da4595ebad973b69be9f82932cb74fb"],
];
for (const [file, digest] of ENGINE) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
// lib/server/gallery.ts — re-pinned by the trial-watermark task (each item
// carries its trial state). Ulubione V2 APPENDED one read, the favourites
// counter (countFavoriteAssets); with it taken out the projection is the
// same bytes as before. Generacje w toku V2 added one optional filter
// (`jobIds`: a tile turning into its own results) — re-pinned for that alone.
{
  const g = readFileSync("lib/server/gallery.ts", "utf8");
  const cut = g.indexOf("\n/**\n * ULUBIONE V2 — how many liked pictures");
  check("lib/server/gallery.ts unchanged (but for the appended favourites counter)",
    cut > 0 && sha(g.slice(0, cut)) === "20d848f41571c7c76463cfc9a24dd7ba8c1e4e393bd6400eaac5b1f655034c28");
}
// The generator workspace gained ONE receiver (in the first redesign) and
// nothing else /home depends on.
//
// Generator UX V3 REWROTE this file (one screen for GrovShot and Stwórz
// zdjęcie: per-mode state, the shared Generate bar, the member's draft). The
// earlier check took each later task's pieces back out and compared the rest
// with a digest — a method that cannot follow a rewrite. What this section is
// about is pinned piece by piece instead: /home's one entry point, and the
// Inteligentny prompt wiring (whose behaviour test:smartprompt holds); the
// request bodies are held by test:genv3, test:smartprompt and the V3 browser
// run. The whole file is re-pinned below so the NEXT change is seen again.
const ws = read("components/genv3/workspace.tsx");
const RECEIVER_IMPORT = 'import { useHomeHandoff } from "@/lib/home-handoff";\n';
const RECEIVER = '  // A photo chosen on /home for this screen: the same upload as a picked one.\n'
  + '  useHomeHandoff((file) => { void upload([file], "refs"); });\n';
const SMART_PIECES: readonly string[] = [
  'import { useSmartPrompt } from "@/components/genv3/smart-prompt";\nimport type { SmartPromptOffer } from "@/lib/smart-prompt";\n',
  "  smartPrompt?: SmartPromptOffer;\n",
  "  const smart = useSmartPrompt({\n    value: stw.prompt, onChange: setPrompt, offer: customData?.smartPrompt,\n    referencePaths: refPaths, onBalance: setBalance,\n  });\n",
  "  const canGenerate = !!model && !gate.atLimit && !smart.busy && ",
  " max={PROMPT_MAX} smart={smart} />",
];
check("…the Inteligentny prompt wiring is all present (a vanished piece is not a pass)", SMART_PIECES.every((piece) => ws.includes(piece)));
check("the generator workspace has exactly ONE /home receiver (and its import)",
  ws.split(RECEIVER).length === 2 && ws.split("useHomeHandoff(").length === 2 && ws.split(RECEIVER_IMPORT).length === 2);
// Re-pinned by Generator UX V3 (was 6937614c… with the earlier tasks' pieces
// taken out): the rewrite described above. Re-pinned by GrovShot V2 (was
// 42e5e976…): the Allegro description / dimensions fields, the engine notes
// and the V2 order dispatch — shown only when the server says the order goes
// to V2 (ManagedModeData.engineV2); every V1 path is unchanged.
check("the generator workspace differs only by the handoff receiver (and the Inteligentny prompt wiring, and the Public Tools V1 session)",
  sha(ws.replace(RECEIVER_IMPORT, "").replace(RECEIVER, "")) === "8f53d691d5e0b012917cedad0680d0d1d3c1bcdb09921dbbb7fef035c9ed248a");
check("…which feeds the screen's own upload and starts nothing", /useHomeHandoff\(\(file\) => \{ void upload\(\[file\], "refs"\); \}\)/.test(RECEIVER)
  && !/generate\(|fetch\(/.test(RECEIVER));
check("/home has no generation path: no AI route, no provider, no prompt",
  !/\/api\/(generate|concepts|prompts|tools|retouch)|runGeneration|lib\/ai\/|prompt_text/.test(SH + code("lib/home-handoff.ts")));
const PAY: readonly [string, string][] = [
  // Re-pinned by the /plany task (top-up gate, tier contract, offer switches).
  // The old pricing board is gone: /plan and /plany share components/plan/pricing-page.tsx.
  ["lib/server/checkout.ts", "d8ad102ad3c1dec1b846c0b88cf78d4de01a741c1fd09db0a1f38d8410261210"],
  ["lib/server/stripe-webhook.ts", "e9a03ea46af4bb7d5c91332969154e4b111b4c1634fbbe124a1ba6b8e03c95d2"],
  ["lib/stripe/config.ts", "0679ce3f018add12ead081c8a667511be4237661d15b9a024fb9ec578ed71df1"],
  ["components/plan/pricing-model.ts", "c696e3d3361e8f884eaa6e7b4835f5dea1db542c27ebbc6e98ae807de456e503"],
  // FAQ V1: only the FAQ question list left this file (the questions are the
  // FAQ base now); no price, plan, period, pack or Stripe value changed.
  ["components/plan/pricing-config.ts", "a857b44ac126e1a108659d90e1d02061a870d47d614c938e3a81f9c31e50c89d"],
  ["components/plan/credit-coin-stack.tsx", "e3dd4c91b1917edd8872c3105633c30f170513a97034ea90f59e102caa00247b"],
  ["components/plan/checkout-notice.tsx", "2828b7bece18d56cdf46a38c771c4c699914da8c62d6dc0ccf5627f51f0be75d"],
];
for (const [file, digest] of PAY) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
check("the no-credits dialog only links to the existing checkout intent and /plan",
  /planCheckoutHref\(pro\.id, "monthly"\)/.test(code("components/seller-home/no-credits-modal.tsx"))
  && !/stripe|fetch\(|checkout\./i.test(code("components/seller-home/no-credits-modal.tsx").replace(/planCheckoutHref/g, "")));
const RETUSZ: readonly [string, string][] = [
  // Re-pinned by Generacje w toku V2: one optional `track` (the plan's slot and
  // the acceptance hook) handed to runGeneration, and `limit` on the refusal.
  // The Gemini request, prompt, delivery and price are untouched — the
  // forensic suite still matches the golden request byte for byte.
  ["lib/server/retouch.ts", "5652e766f8a49f166e795f68a62c481b142028ee61f021a6ce073256a5f3952d"],
  ["lib/server/retouch-delivery.ts", "52d62017201d4c62227c13dbcb84deb5834615ef78bbcf800eda1ad63ca01e54"],
  // Re-pinned by Public Tools V1: the page's metadata and a visitor's branch
  // (the same workspace, priced through the server's own read, no wallet).
  // The member's branch, the route and the request are unchanged — the
  // forensic suite holds the request byte for byte.
  ["app/(app)/retusz/page.tsx", "7fd6fc379aa05f06ba6472df4eeb27df6288b1b6c3b43b0c889cdcacf3457427"],
];
for (const [file, digest] of RETUSZ) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
check("Retusz is reached only by its route — never prefilled, never imported", !/RetouchWorkspace|components\/retouch|runRetouch|retouchStepConfig/.test(SH + loader));
// The catalogue changed once since: the photo-tools task pointed four cards at
// their own screens (/tools/remove_bg, white_bg, ai_background, ai_shadow).
// Public Tools V1 gave the catalogue page its metadata and a visitor's branch
// (same layout, same switches, prices through the server's read, no banners);
// pinned to that version. The layout module is untouched.
check("/tools' own page and layout are untouched (but for the Public Tools V1 visitor branch); the catalogue only by the photo-tools task",
  sha(readFileSync("app/(app)/tools/page.tsx")) === "e5b9cd62f319853537f4b82c5cff48151a3baca143bf6bf5e48a8d1246a9a05a" && !gitChanged("lib/tool-layout.ts")
  && sha(readFileSync("lib/tool-cards.ts")) === "1a433b1509141bafab46e7142b3d1d2821ad45b89da16c94b00bc1ffb3b5a2c5");

/* ── 12. handoff ──────────────────────────────────────────────────────────*/

section("12. THE PHOTO HANDOFF (lib/home-handoff.ts)");
const photo = { name: "p.png" } as unknown as File;
stashHomeUpload(photo, "/k/ecommerce/thumbnail");
check("a photo meant for one route is not taken by another", takeHomeUpload("/generator") === null);
check("…the right route takes it once", takeHomeUpload("/k/ecommerce/thumbnail") === photo && takeHomeUpload("/k/ecommerce/thumbnail") === null);
check("…in memory only (no storage, no IndexedDB)", !/localStorage|sessionStorage|indexedDB/.test(code("lib/home-handoff.ts")));
check("…the handoff module is the previous release's, unchanged", !gitChanged("lib/home-handoff.ts"));

/* ── 13. i18n + honesty ───────────────────────────────────────────────────*/

section("13. COPY — EVERY KEY IN PL/EN/DE, NOTHING TYPED INTO MARKUP");
const dicts = Object.fromEntries((["pl", "en", "de"] as const).map((l) => [l, JSON.parse(read(`lib/i18n/dictionaries/${l}.json`))]));
const has = (d: Record<string, unknown>, key: string) => {
  const [ns, ...rest] = key.split(".");
  let cur: unknown = d[ns];
  const tail = rest.join(".");
  if (cur && typeof cur === "object" && tail in (cur as object)) return true;
  for (const part of rest) { cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined; }
  return typeof cur === "string";
};
const keys = new Set<string>();
CAROUSEL.forEach((c) => { keys.add(c.nameKey); keys.add(c.subKey); });
UPLOAD_TOOLS.forEach((u) => { keys.add(u.pillKey); keys.add(u.leadKey); });
keys.add(UPLOAD_LEAD_DEFAULT);
BEFORE_AFTER.forEach((b) => keys.add(b.nameKey));
INDUSTRIES.forEach((i) => keys.add(`sellerHome.industry.${i}`));
Object.values(PROMO_BANNERS).forEach((b) => [b.badgeKey, b.titleKey, b.subKey, b.ctaKey].forEach((k) => { if (k) keys.add(k); }));
keys.add(SHOWCASE.ctaKey);
[THUMBNAILS.titleKey, THUMBNAILS.subKey, THUMBNAILS.tryKey, THUMBNAILS.ctaKey, SESSIONS.titleKey, SESSIONS.subKey,
  SESSIONS.studio.labelKey, SESSIONS.outdoor.labelKey, SECTION_COPY.carousel, SECTION_COPY.beforeAfter.titleKey,
  SECTION_COPY.beforeAfter.subKey, SECTION_COPY.featured.titleKey, SECTION_COPY.featured.subKey].forEach((k) => keys.add(k));
FEATURED.forEach((f) => { keys.add(f.nameKey); keys.add(f.subKey); });
(["soon", "maintenance", "unavailable", "disabled"] as const).forEach((s) => keys.add(`sellerHome.status.${s}`));
INTEREST_KEYS.forEach((k) => keys.add(`sellerHome.soon.${k}`));
SELLER_CHANNELS.forEach((c) => keys.add(`sellerHome.channel.${c}`));
for (const m of SH.matchAll(/\bt\(\s*"([A-Za-z][\w.]*)"/g)) keys.add(m[1]);
const missing = [...keys].filter((k) => !(["pl", "en", "de"] as const).every((l) => has(dicts[l], k)));
check(`all ${keys.size} keys exist in pl, en and de`, missing.length === 0, missing.slice(0, 8).join(", "));
check("no Polish typed into the markup", !/>[^<{]*[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ][^<{]*</.test(SH));
check("no numbers formatted ad hoc — Polish formatting through the pricing formatters",
  !/toLocaleString|new Intl\.NumberFormat/.test(SH) && /formatCount|formatMoney/.test(SH));
check("the upload tile's default sentence is the spec's", dicts.pl.sellerHome.upload.lead.default === "Wrzuć zdjęcie produktu i opisz, co chcesz stworzyć");
check("the removed sections' copy is gone from the dictionaries",
  (["pl", "en", "de"] as const).every((l) => ["hero", "task", "anchor", "recent", "gallery", "press", "credits", "tools", "group"].every((g) => !(g in dicts[l].sellerHome))));
check("the probe route is not committed", !existsSync("app/probe-tmp"));

/* ── 14. the visual editor's /home slots ──────────────────────────────────*/

section("14. THE VISUAL EDITOR'S /home SLOTS — PAINTED WHEN FILLED, NOTHING DIFFERENT WHEN NOT");
{
  const storage = (p: string) => `${SUPABASE_URL}/storage/v1/object/public/media/${p}`;
  /** A filled slot as the reader returns it: a stored 2400px JPEG with
   *  Admin → Media's three WebP copies (the original is its own width key). */
  const filled = (key: string, extra: Partial<ResolvedSlot> = {}): ResolvedSlot => ({
    key, mediaType: "image", alt: "", fit: "cover", position: "center center",
    autoplay: true, muted: true, loop: true, controls: false,
    desktop: storage(`home/${key}.jpg`), desktopWidth: 2400, desktopHeight: 2400,
    variants: {
      "640": storage(`home/${key}_w640.webp`), "1024": storage(`home/${key}_w1024.webp`),
      "1600": storage(`home/${key}_w1600.webp`), "2400": storage(`home/${key}.jpg`),
    },
    ...extra,
  });
  const homeOf = (slots: Record<string, ResolvedSlot>, locale = "pl"): HomeSlots => ({ slots, locale });
  const tagOf = (out: string, tag: string) => out.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
  // Every item any section references, live — so every section renders.
  const REFERENCED = [...new Set([
    ...CAROUSEL.map((c) => c.item), ...UPLOAD_TOOLS.map((u) => u.item), ...BEFORE_AFTER.map((b) => b.item),
    ...Object.values(PROMO_BANNERS).map((b) => b.item as string), SHOWCASE.item, THUMBNAILS.item,
    SESSIONS.studio.item, SESSIONS.outdoor.item, ...FEATURED.map((f) => f.item),
  ])];
  const ALL = Object.fromEntries(REFERENCED.map((k) => [k, S(k, `/t/${k}`, "live", 4)]));
  const icePage = icePageFor("/home");
  const globalSpecs = icePage ? allElements(icePage).flatMap((e) => e.slots ?? []).filter((s) => s.entityType === "global") : [];

  // (e) — which keys, and how they are read.
  const expected = [
    ...UPLOAD_TOOLS.flatMap((u) => u.samples), ...BEFORE_AFTER.flatMap((b) => [b.media.before, b.media.after]),
    ...Object.values(PROMO_BANNERS).map((b) => b.media), SHOWCASE.visual, ...SHOWCASE.gallery,
    ...THUMBNAILS.tiles.map((x) => x.media), ...SESSIONS.tiles.map((x) => x.media),
  ].map((m) => m.configKey);
  check("(e) the section slots /home reads are the editor registry's „global” ones: 79 = samples 15 + before/after 12 + banners 3 + showcase 13 + Miniaturki 20 + Sesje 16",
    HOME_SECTION_SLOT_KEYS.length === 79 && expected.length === 79 && new Set(HOME_SECTION_SLOT_KEYS).size === 79
    && expected.every((k) => HOME_SECTION_SLOT_KEYS.includes(k)) && globalSpecs.length === 79
    && globalSpecs.every((s) => HOME_SECTION_SLOT_KEYS.includes(s.key) && s.entityId === "sellerHome"),
    String(HOME_SECTION_SLOT_KEYS.length));
  check("…not the carousel or featured tiles — they keep the tool-card slot they share with /tools",
    [...CAROUSEL, ...FEATURED].every((c) => !HOME_SECTION_SLOT_KEYS.includes(c.media.configKey)));
  const cardKeys = REFERENCED.map(cardSlotKey);
  const readKeys = sellerHomeSlotKeys(cardKeys, ["banner.a.media", "banner.b.media", "banner.c.media"]);
  check("…ONE batched read: every tool card, the 3 campaign banners and all 79 section slots, ≤ 200 keys (the resolver's bound)",
    SLOT_READ_CAP === 200 && readKeys.length <= SLOT_READ_CAP && new Set(readKeys).size === readKeys.length
    && HOME_SECTION_SLOT_KEYS.every((k) => readKeys.includes(k)) && cardKeys.every((k) => readKeys.includes(k))
    && /array_length\(p_keys, 1\) <= 200/.test(read("supabase/migrations/0141_inline_content_editor.sql")), String(readKeys.length));
  check("…the loader still makes exactly one loadSlots call, with that list",
    (loader.match(/loadSlots\(/g) ?? []).length === 1 && /loadSlots\(supabase, sellerHomeSlotKeys\(/.test(loader));
  {
    const quiet = console.error;
    console.error = () => {};
    const over = sellerHomeSlotKeys(Array.from({ length: 150 }, (_, i) => `tool.x${i}.card`), []);
    console.error = quiet;
    check("…past the bound the section slots are left out, never the cards (a read past 200 returns nothing at all)",
      over.length === 150 && !over.some((k) => HOME_SECTION_SLOT_KEYS.includes(k)));
  }

  // (a) — nothing filled, nothing different.
  const sectionsOf = (home?: HomeSlots) => [
    html(createElement(BeforeAfterRow, { items: ALL, t: T, ...(home ? { home } : {}) })),
    ...Object.values(PROMO_BANNERS).map((def) => html(createElement(PromoBanner, { def, items: ALL, t: T, ...(home ? { home } : {}) }))),
    html(createElement(Showcase, { items: ALL, t: T, ...(home ? { home } : {}) })),
    html(createElement(ThumbnailsSection, { items: ALL, t: T, ...(home ? { home } : {}) })),
    html(createElement(SessionsSection, { items: ALL, t: T, ...(home ? { home } : {}) })),
  ].join("\n");
  const bare = sectionsOf();
  check("(a) no slot filled: every section's markup is identical with no map, an empty map, or a map of other keys",
    bare.length > 10000 && sectionsOf(homeOf({})) === bare
    && sectionsOf(homeOf({ "tools.retouch.card": filled("tools.retouch.card") })) === bare && !/data-media-slot="global"/.test(bare));
  check("…and the page is handed nothing new: homeSlots absent (not {}), the pills resolveUploadTools' own, `home` undefined",
    filledHomeSlots(new Map()) === undefined
    && filledHomeSlots(new Map([["tools.retouch.card", filled("tools.retouch.card")]]) as SlotMap) === undefined
    && withSampleSlots(tools, undefined) === tools && /\.\.\.\(homeSlots \? \{ homeSlots \} : \{\}\)/.test(loader)
    && /const home = data\.homeSlots \? \{ slots: data\.homeSlots, locale \} : undefined;/.test(body));
  check("…the slider (a client component) is handed `before` / `after` only when filled — its props are otherwise the same",
    /\{\.\.\.\(before \? \{ before \} : \{\}\)\} \{\.\.\.\(after \? \{ after \} : \{\}\)\}/.test(sections));

  // (b) — a filled slot.
  const tile = THUMBNAILS.tiles[0].media;
  const tileProps = { media: tile, ratio: "1/1", label: "Miniaturka 01", hint: "1200×1200 px", sizes: "19vw" };
  const zoomed = filled(tile.configKey, { crop: { x: 30, y: 40, zoom: 1.5 }, alt: "Kubek", altI18n: { en: "Mug" } });
  const filledOut = html(createElement(MediaSlot, { ...tileProps, home: homeOf({ [tile.configKey]: zoomed }, "en") }));
  const emptyOut = html(createElement(MediaSlot, tileProps));
  const imgTag = tagOf(filledOut, "img");
  check("(b) a filled slot paints in the SAME frame element (classes, aspect-ratio, data-config-key), marked data-media-slot=\"global\"",
    /data-media-slot="global"/.test(tagOf(filledOut, "span")) && /data-media-slot="empty"/.test(tagOf(emptyOut, "span"))
    && tagOf(filledOut, "span").replace('data-media-slot="global"', "") === tagOf(emptyOut, "span").replace('data-media-slot="empty"', "")
    && /isolate overflow-hidden/.test(tagOf(filledOut, "span")));
  check("…an <img>: the crop's focal point as object-position, scale(zoom) around it, cover — never `fill`",
    /object-position:30% 40%/.test(imgTag) && /transform:scale\(1\.5\)/.test(imgTag) && /transform-origin:30% 40%/.test(imgTag)
    && /object-fit:cover/.test(imgTag) && /width:100%;height:100%/.test(imgTag) && imgTag.includes(`src="${zoomed.desktop}"`)
    && !/object-fit:\s*fill|objectFit: "fill"|object-fill/.test(filledOut + code("components/seller-home/ice-slot-image.tsx")));
  check("…srcset from the recorded variants (narrowest first) with sizes; lazy, async, the file's own width/height",
    /srcset="[^"]*_w640\.webp 640w, [^"]*_w1024\.webp 1024w, [^"]*_w1600\.webp 1600w, [^"]*\.jpg 2400w"/i.test(imgTag) && /sizes="19vw"/.test(imgTag)
    && /loading="lazy"/.test(imgTag) && /decoding="async"/.test(imgTag) && /width="2400"/.test(imgTag) && /height="2400"/.test(imgTag));
  const altIn = (slot: ResolvedSlot, locale: string, media: MediaSrc = tile) =>
    tagOf(html(createElement(MediaSlot, { ...tileProps, media, home: homeOf({ [media.configKey]: slot }, locale) })), "img").match(/alt="([^"]*)"/)?.[1];
  check("…alt in the viewer's language, else the slot's own, else the page's",
    altIn(zoomed, "en") === "Mug" && altIn(zoomed, "de") === "Kubek"
    && altIn(filled(tile.configKey), "pl", { ...tile, alt: "Z konfiguracji" }) === "Z konfiguracji" && altIn(filled(tile.configKey), "pl") === "");
  const flat = tagOf(html(createElement(MediaSlot, { ...tileProps, home: homeOf({ [tile.configKey]: filled(tile.configKey, { crop: { x: 10, y: 90, zoom: 1 } }) }) })), "img");
  const plain = tagOf(html(createElement(MediaSlot, { ...tileProps, home: homeOf({ [tile.configKey]: filled(tile.configKey, { position: "left top" }) }) })), "img");
  const whole = tagOf(html(createElement(MediaSlot, { ...tileProps, home: homeOf({ [tile.configKey]: filled(tile.configKey, { fit: "contain" }) }) })), "img");
  check("…zoom 1: the focal point only, no transform; no crop: the slot's own position; `contain` shows the whole file",
    /object-position:10% 90%/.test(flat) && !/transform/.test(flat) && /object-position:left top/.test(plain) && !/transform/.test(plain)
    && /object-fit:contain/.test(whole));
  const banner = PROMO_BANNERS.second.media;
  const phoneOut = html(createElement(MediaSlot, {
    media: banner, fill: true, label: "B", hint: "", sizes: "100vw",
    home: homeOf({ [banner.configKey]: filled(banner.configKey, {
      mobile: storage("home/square.jpg"), mobileVariants: { "640": storage("home/square_w640.webp") },
      crop: { x: 20, y: 50, zoom: 1.2, m: { x: 60, y: 40, zoom: 2 } },
    }) }),
  }));
  check("…a phone file: <picture> with a (max-width: 639px) source, its own frame (crop.m) in force below 640px",
    /<picture><source media="\(max-width: 639px\)" srcset="[^"]*square_w640\.webp 640w"/i.test(phoneOut)
    && /object-position:20% 50%/.test(phoneOut) && /--ice-phone-pos:60% 40%/.test(phoneOut) && /--ice-phone-transform:scale\(2\)/.test(phoneOut)
    && /max-sm:!\[object-position:var\(--ice-phone-pos\)\]/.test(phoneOut));
  const clipOut = html(createElement(MediaSlot, {
    media: SHOWCASE.visual, fill: true, label: "Showcase", hint: "", sizes: "40vw",
    home: homeOf({ [SHOWCASE.visual.configKey]: filled(SHOWCASE.visual.configKey, {
      mediaType: "video", desktop: storage("home/clip.mp4"), poster: storage("home/clip.webp"), variants: undefined,
      crop: { x: 50, y: 20, zoom: 1.25 },
    }) }),
  }));
  check("…a clip: the shared SlotVideo (poster first, nothing fetched until near), zoomed by a wrapper the frame clips",
    /<video/.test(clipOut) && /poster="[^"]*clip\.webp"/.test(clipOut) && /preload="none"/.test(clipOut) && !/clip\.mp4/.test(clipOut)
    && /object-position:50% 20%/.test(clipOut) && /transform:scale\(1\.25\)/.test(clipOut) && /playsinline/i.test(clipOut)
    && /from "@\/components\/media\/slot-video"/.test(code("components/seller-home/ice-slot-image.tsx")));
  check("…authority: a config file still wins over a filled slot; a filled slot wins over the admin's card picture",
    /data-media-slot="image"/.test(html(createElement(MediaSlot, { media: img("/home/a.webp"), label: "x", hint: "y", sizes: "1px", home: homeOf({ "homeMedia.test": filled("homeMedia.test") }) })))
    && /data-media-slot="global"/.test(html(createElement(MediaSlot, { media: img(null), label: "x", hint: "y", sizes: "1px",
      home: homeOf({ "homeMedia.test": filled("homeMedia.test") }), admin: { slot: "tools.retouch.card", slots } }))));

  // (c) — a banner.
  {
    const def = PROMO_BANNERS.third;
    const items = { [def.item ?? ""]: S(def.item ?? "", "/x", "live", 4) };
    const withSlot = html(createElement(PromoBanner, { def, items, t: T, home: homeOf({ [def.media.configKey]: filled(def.media.configKey) }) }));
    const without = html(createElement(PromoBanner, { def, items, t: T }));
    check("(c) a banner whose slot is filled (no config file) shows it: picture, scrim, white copy — not the empty banner",
      def.media.src === null && /data-media-slot="global"/.test(withSlot) && /<img/.test(withSlot) && !/data-media-slot="empty"/.test(withSlot)
      && /text-white/.test(withSlot) && /rgb\(0_0_0\/0\.42\)/.test(withSlot) && !/bg-surface/.test(withSlot)
      && /data-media-slot="empty"/.test(without) && !/text-white/.test(without) && /data-promo="promo3"/.test(withSlot));
  }

  // (d) — PRZED/PO is square.
  check("(d) PRZED/PO is 1:1, 1080×1080 — the constant, every pair's slots, the editor's spec",
    BEFORE_AFTER_SIZE === SQUARE && SQUARE.width === 1080 && SQUARE.height === 1080 && ratioOf(BEFORE_AFTER_SIZE) === "1080/1080"
    && BEFORE_AFTER.every((b) => [b.media.before, b.media.after].every((m) => m.width === 1080 && m.height === 1080))
    && globalSpecs.filter((s) => s.key.startsWith("homeMedia.beforeAfter.")).length === 12
    && globalSpecs.filter((s) => s.key.startsWith("homeMedia.beforeAfter.")).every((s) => s.ratio === "1080/1080" && s.width === 1080 && s.height === 1080));
  const baRow = html(createElement(BeforeAfterRow, { items: ALL, t: T }));
  const baFrames = baRow.match(/<div[^>]*\sdata-before-after="true"[^>]*>/g) ?? [];
  check("…rendered: six frames, every one aspect-ratio 1080/1080, every empty half's hint 1080×1080 — all derived, no 4:5 left",
    baFrames.length === 6 && baFrames.every((f) => /aspect-ratio:1080\/1080/.test(f)) && !/1080\/1350|1080,1350/.test(baRow)
    && (baRow.match(/sellerHome\.slot\.size\(1080,1080\)/g) ?? []).length === 12, `${baFrames.length}`);
  check("…the showcase and Sesje keep their own formats (4:5 visual and phone frame, the five session shapes)",
    SHOWCASE.visual.width === PORTRAIT_4_5.width && SHOWCASE.visual.height === PORTRAIT_4_5.height && ratioOf(SHOWCASE.frame.phone) === "1080/1350"
    && SESSIONS.tiles.filter((x) => x.media.height === 1350).length === 3);
  check("…each card is the editor's target as the registry names it: [data-ba-card=\"<key>\"] [data-before-after]",
    icePage !== null && allElements(icePage).filter((e) => e.kind === "pair").every((e, i) => e.dom === `[data-ba-card="${BEFORE_AFTER[i].key}"] [data-before-after]`)
    && BEFORE_AFTER.every((b) => new RegExp(`data-ba-card="${b.key}"[^>]*>(?:(?!data-ba-card=)[\\s\\S])*?data-before-after`).test(baRow)));
  {
    const first = BEFORE_AFTER[0];
    const cut = (row: string) => row.slice(row.indexOf(`data-ba-card="${first.key}"`), row.indexOf(`data-ba-card="${BEFORE_AFTER[1].key}"`));
    const half = filled(first.media.before.configKey, { crop: { x: 25, y: 75, zoom: 2 } });
    const row = html(createElement(BeforeAfterRow, { items: ALL, t: T, home: homeOf({ [first.media.before.configKey]: half }) }));
    const card = cut(row);
    const pic = tagOf(card, "img");
    check("a filled before/after half paints the library picture (its crop, not draggable); the other half keeps its placeholder",
      pic.includes(`src="${half.desktop}"`) && /draggable="false"/.test(pic) && /object-position:25% 75%/.test(pic) && /transform:scale\(2\)/.test(pic)
      && !/sellerHome\.slot\.before/.test(card) && /sellerHome\.slot\.after/.test(card));
    check("…the slider itself is unchanged (range, grip, badges) and every other card is byte-identical",
      /type="range"/.test(card) && /data-before-after-grip/.test(card) && /data-before-after-range/.test(card)
      && row.replace(card, "") === baRow.replace(cut(baRow), ""));
    check("…a clip assigned to a half is not painted (the slider compares two stills)",
      html(createElement(BeforeAfterRow, { items: ALL, t: T, home: homeOf({ [first.media.before.configKey]: filled(first.media.before.configKey, { mediaType: "video" }) }) })) === baRow);
  }

  // (f) — upload samples.
  {
    const key = UPLOAD_TOOLS.find((u) => u.key === "thumbnail")!.samples[1].configKey;
    const one = (variants: Record<string, string> | undefined, extra: Partial<ResolvedSlot> = {}) => filled(key, { variants, ...extra });
    check("(f) a sample is the largest WebP derivative ≤ 1600 px (not the 2400px original)",
      SAMPLE_MAX_WIDTH === 1600
      && sampleSource(one({ "640": storage("a_w640.webp"), "1024": storage("a_w1024.webp"), "1600": storage("a_w1600.webp"), "2400": storage("a.jpg") })) === storage("a_w1600.webp"));
    check("…wider files and non-WebP ones are skipped; nothing fits → the original",
      sampleSource(one({ "640": storage("a_w640.webp"), "1024": storage("a_w1024.webp"), "1200": storage("a.png") })) === storage("a_w1024.webp")
      && sampleSource(one({ "2400": storage("a_w2400.webp") })) === one(undefined).desktop && sampleSource(one(undefined)) === one(undefined).desktop);
    check("…a clip is never a sample; a file the tile could not fetch (off the Supabase project — the CSP's connect-src) stays a placeholder",
      sampleSource(one(undefined, { mediaType: "video" })) === null && sampleSource(one(undefined, { desktop: "https://cdn.example.com/a.jpg" })) === null);
    const config = JSON.stringify(UPLOAD_TOOLS);
    const thumbDef = UPLOAD_TOOLS.find((u) => u.key === "thumbnail")!;
    const pills = withSampleSlots(tools, { [key]: one({ "1024": storage("b_w1024.webp") }) });
    const pill = pills.find((x) => x.key === "thumbnail")!;
    const orig = tools.find((x) => x.key === "thumbnail")!;
    check("…handed to the tile as per-request COPIES: the filled sample gets the URL, the config's shared objects are untouched",
      pill !== orig && pill.samples !== orig.samples && pill.samples[1].src === storage("b_w1024.webp") && pill.samples[1] !== orig.samples[1]
      && pill.samples[0] === orig.samples[0] && orig.samples === thumbDef.samples && thumbDef.samples[1].src === null
      && JSON.stringify(UPLOAD_TOOLS) === config && pills.find((x) => x.key === "retouch") === tools.find((x) => x.key === "retouch"));
    check("…a sample the config already names keeps its own file",
      withSampleSlots([{ ...orig, samples: orig.samples.map((m, i) => (i === 1 ? { ...m, src: "/home/own.webp" } : m)) }], { [key]: one(undefined) })[0].samples[1].src === "/home/own.webp");
    check("…the loader builds the pills after the one read", /const uploadTools = withSampleSlots\(resolveUploadTools\(items\), homeSlots\);/.test(loader)
      && loader.indexOf("withSampleSlots(") > loader.indexOf("loadSlots("));
  }

  // The reader's half: what a row's 0141 columns may become.
  check("the slot reader keeps a crop only in range (x, y 0–100, zoom 1–2.5); a bad phone frame drops only `m`",
    JSON.stringify(slotCrop({ x: 30, y: 40, zoom: 1.5 })) === '{"x":30,"y":40,"zoom":1.5}'
    && JSON.stringify(slotCrop({ x: 0, y: 100, zoom: 2.5, m: { x: 1, y: 2, zoom: 1 } })) === '{"x":0,"y":100,"zoom":2.5,"m":{"x":1,"y":2,"zoom":1}}'
    && JSON.stringify(slotCrop({ x: 30, y: 40, zoom: 1.5, m: { x: 1, y: 2, zoom: 9 } })) === '{"x":30,"y":40,"zoom":1.5}'
    && [null, undefined, "x", [], { x: 30, y: 40 }, { x: -1, y: 40, zoom: 1 }, { x: 30, y: 101, zoom: 1 }, { x: 30, y: 40, zoom: 0.5 },
      { x: 30, y: 40, zoom: 3 }, { x: "30", y: 40, zoom: 1 }, { x: Number.NaN, y: 40, zoom: 1 }].every((v) => slotCrop(v) === undefined));
  check("…alt per language: pl / en / de only, non-blank strings only; nothing usable → absent",
    JSON.stringify(slotAltI18n({ pl: "Kubek", en: " ", de: 3, fr: "Tasse" })) === '{"pl":"Kubek"}'
    && slotAltI18n({}) === undefined && slotAltI18n(null) === undefined && slotAltI18n(["pl"]) === undefined);
  const reader = code("lib/server/media-slots.ts");
  check("…and toSlot spreads the three 0141 fields in only when present — a row without the columns reads exactly as before",
    /crop\?: unknown;/.test(reader) && /alt_i18n\?: unknown;/.test(reader) && /mobile_variants\?: unknown;/.test(reader)
    && /\.\.\.\(crop \? \{ crop \} : \{\}\)/.test(reader) && /\.\.\.\(altI18n \? \{ altI18n \} : \{\}\)/.test(reader)
    && /\.\.\.\(mobileVariants \? \{ mobileVariants \} : \{\}\)/.test(reader));
}

console.log(`\n${failed === 0 ? `All seller-home tests passed (${passed} checks).` : `${failed} SELLER-HOME TEST(S) FAILED`}`);
if (failed > 0) process.exit(1);
}

/** Changed against the last commit on main before this redesign (b631919)? */
function gitChanged(file: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", "b631919", "--", file], { stdio: "ignore" });
    return false;
  } catch (e) {
    // `git diff --quiet` exits 1 when there is a difference; anything else is
    // a broken check, not a "changed" answer.
    if ((e as { status?: number }).status === 1) return true;
    throw e;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

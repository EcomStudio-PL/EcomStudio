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
  BANNER_FRAME, BEFORE_AFTER, CAROUSEL, CHANNEL_DEFAULT_TOOL, DEFAULT_UPLOAD_TOOL, FEATURED, HANDOFF_ROUTES, INDUSTRIES,
  INTEREST_KEYS, PROMO_BANNERS, SECTION_COPY, SELLER_CHANNELS, SESSIONS, SHIPPED_TOOL_PHOTO, SHOWCASE, THUMBNAILS,
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
import { PromoBanner, SessionsSection, ThumbnailsSection } from "@/components/seller-home/sections";
import { ToolCarousel } from "@/components/seller-home/tool-carousel";
import { findCategory } from "@/lib/categories";
import type { SlotMap } from "@/lib/server/media-slots";
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
const FROZEN: readonly [string, string][] = [
  ["app/page.tsx", "1fb062ed1449314369c75e1abfe87d26d4b85163c159a4ecf7469fa22f7f52c1"],
  ["app/[slug]/page.tsx", "acc6b04382426e2df0aa75198da1dd4ce9ba9585c59db4a8a9d672eaeaf95cdb"],
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
  ["app/(app)/layout.tsx", "fc003f788c68cbc3f26bdf516905d845a4d21a7b9abf1bbc37fa66e205826129"],
  ["components/layout/customer-bottom-nav.tsx", "4c89edd41c3847467491bd290760b35ad69e92cd7695038d6edc1429297922d2"],
  ["components/layout/customer-drawer.tsx", "758aba86c7ee1a6fc88419038386d0bdde1b4b2949dd765630111e59482d6f1c"],
  ["components/feedback/feedback-cta.tsx", "d2406baf43ee849094e94fe01cc9a1620c1e01a354cd62a6049832cc2c1690a2"],
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
  const restored = bar
    .replace(PLANY_NOTE, "")
    .replace('<Link href={guest ? "/plany" : "/plan"}', '<Link href="/plan"')
    .replace('isNavActive(pathname, "/plan") || isNavActive(pathname, "/plany")\n                ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",',
      'isNavActive(pathname, "/plan") ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:bg-raised hover:text-ink",');
  check("components/layout/mega-topbar.tsx differs only by the visitor's cennik link",
    sha(restored) === "913fe0c30674ddd6651a6025bbb646859c08a92f9a462dcc59df672690d7937a" && restored !== bar);
}
// The shared media components and globals are pinned against git, not a
// literal: the redesign reuses them and must not edit them.
check("…the shared media components, tool-thumb and globals.css are byte-identical to the last release",
  ["components/tools/tool-thumb.tsx", "components/media/slot-media.tsx", "components/media/slot-video.tsx", "app/globals.css"]
    .every((f) => !gitChanged(f)));
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
const ba = html(createElement(BeforeAfter, {
  pair: BEFORE_AFTER[0].media, ratio: "1080/1350", sizes: "1px",
  labels: { before: "Przed", after: "Po", slider: "Porównanie", emptyBefore: "Zdjęcie przed", emptyAfter: "Efekt po", hint: "1080×1350 px" },
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
check("no other slot changed format: every slot outside Miniaturki is byte-for-byte the last release's (key, kind, size)",
  createHash("sha256").update(JSON.stringify(assetList().filter((r) => !r.section.startsWith("7 "))
    .map((r) => [r.section, r.media.configKey, r.media.kind, r.media.width, r.media.height]))).digest("hex")
    === "cfb689940af98baa584c3234ef80c7fa1d5bdec89dc4661aba02901956eb68ca");
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
  ["lib/server/concept-generation.ts", "788361ea576b19dc0ef58d325b63199cdeb51b24a4bf3b64bd1e111d55cf8341"],
  ["lib/server/prompt-engine.ts", "5ce9bf1074f34e8852cd06a6440e0c9640a4471049617493d3b1b506e74baf22"],
  // Re-pinned by the photo-tools task (four Photoroom panels: pinned provider,
  // sandbox gating, deliver + alreadyDelivered hooks, presets). Retusz never
  // imports this file.
  ["lib/server/image-tools.ts", "8574865baaf4d1c9e17189d4599b04ce6e28319d876db797e24e618f38211a32"],
  ["lib/server/fashion.ts", "dcde79b33cd35e9789caa3bbc9cc4ddbf406f570d9f02ee3fe7232ad069ab139"],
  ["app/api/prompts/generate/route.ts", "37db9bd3798b9bd5c4c4fc3bdf1056d57dec296f12754fd52bd9f5f97e204b5e"],
  ["app/api/concepts/generate/route.ts", "59ac0b7670179062229aae68505186bd2513953bd1ecad1e555bedf45f588e21"],
  ["app/api/generate/route.ts", "fa333ad425813b1e998494a046e694c63962352eabefd60e21f8addf93c36a22"],
  // Re-pinned by the photo-tools task: the white_bg / ai_* screens' own
  // switches also gate this endpoint.
  ["app/api/tools/run/route.ts", "8bf75acfde6ebcd36b3fbcb70318f3f081559b8c04b80ef434cb22fbe17114c6"],
  ["components/genv3/uploader.tsx", "cc7d9dbe8305d1fbdef75ae4727b1fce5f0147b1ccc7cf4e9d6e0b6ddf4d8df2"],
  ["lib/images/file-intake.ts", "1dc99c83483f3fa80527e319501edb5a35b717d92771dd72c38eda17bd9acc29"],
  ["lib/services/images.ts", "e6adba31a68d9fa9afcfe69f242a63370032bd5ce31323cf1ef60236d2a3adcf"],
  ["lib/server/gallery.ts", "7ecaa2ce9b145c9c5d21eb39952b5746746ba33d8f06fd3f9959bca4f8cb1d37"],
  ["lib/services/credits.ts", "1a25606a89ca4ebc6f2640542f59b9185da4595ebad973b69be9f82932cb74fb"],
];
for (const [file, digest] of ENGINE) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
// The generator workspace gained ONE receiver (in the first redesign) and
// nothing else: with those lines taken out it is byte-identical to before.
const ws = read("components/genv3/workspace.tsx");
const RECEIVER_IMPORT = 'import { useHomeHandoff } from "@/lib/home-handoff";\n';
const RECEIVER = ws.slice(ws.indexOf("  // A photo chosen on /home"), ws.indexOf("  /**\n   * A PICK FROM THE GROVBASE LIBRARY"));
check("the generator workspace differs only by the handoff receiver",
  sha(ws.replace(RECEIVER_IMPORT, "").replace(RECEIVER, "")) === "07d316d73828d44727ec892747596a47f6b56ff719eb9bfc41fc0e125fdcb769");
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
  ["components/plan/pricing-config.ts", "bc0bec120515ef7fb6ef7146ea456c5e67fba7250da7aadee96201e4d4c59233"],
  ["components/plan/credit-coin-stack.tsx", "e3dd4c91b1917edd8872c3105633c30f170513a97034ea90f59e102caa00247b"],
  ["components/plan/checkout-notice.tsx", "2828b7bece18d56cdf46a38c771c4c699914da8c62d6dc0ccf5627f51f0be75d"],
];
for (const [file, digest] of PAY) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
check("the no-credits dialog only links to the existing checkout intent and /plan",
  /planCheckoutHref\(pro\.id, "monthly"\)/.test(code("components/seller-home/no-credits-modal.tsx"))
  && !/stripe|fetch\(|checkout\./i.test(code("components/seller-home/no-credits-modal.tsx").replace(/planCheckoutHref/g, "")));
const RETUSZ: readonly [string, string][] = [
  ["lib/server/retouch.ts", "fee74d0e4795110812d4019a3525ac2d9f83420ab3ad616515bb56b39e410d3e"],
  ["lib/server/retouch-delivery.ts", "52d62017201d4c62227c13dbcb84deb5834615ef78bbcf800eda1ad63ca01e54"],
  ["app/(app)/retusz/page.tsx", "3fd68105b04c8d818641de0cd6bc61464b0a0a8e0a4946a8cc63e7731a7e1748"],
];
for (const [file, digest] of RETUSZ) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
check("Retusz is reached only by its route — never prefilled, never imported", !/RetouchWorkspace|components\/retouch|runRetouch|retouchStepConfig/.test(SH + loader));
// The catalogue changed once since: the photo-tools task pointed four cards at
// their own screens (/tools/remove_bg, white_bg, ai_background, ai_shadow).
check("/tools' own page and layout are untouched; the catalogue only by the photo-tools task",
  !gitChanged("app/(app)/tools/page.tsx") && !gitChanged("lib/tool-layout.ts")
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

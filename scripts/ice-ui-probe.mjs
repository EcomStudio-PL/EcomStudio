/**
 * THE VISUAL EDITOR ("ICE"), DRIVEN IN A REAL BROWSER AGAINST A FAKE TRANSPORT.
 *
 * The editor talks to the server only through `IceTransport` (lib/ice/types),
 * so this probe mounts the REAL editor chunk (components/ice/editor/editor)
 * on a page-like harness and hands it an in-memory transport: text states
 * built from the real dictionary defaults, overrides with compare-and-set,
 * slot states with compare-and-set, a version list, a small media library of
 * files from /public, uploads that never leave the page (`putFile`), and a CMS
 * page whose blocks are marked by the real `markBlocks`. Every call lands in
 * `window.__iceCalls`, which is what the checks assert on. Nothing here talks
 * to Supabase, and nothing is ever written anywhere.
 *
 * THE HARNESS (written into the CURRENT directory's app/probe-tmp/ice):
 *   /probe-tmp/ice?mode=home      /home's registry, real Polish copy with the
 *                                 real invisible markers, the real media
 *                                 selectors (data-config-key, data-ba-card,
 *                                 data-promo, data-sample…), a plain link, a
 *                                 form, a carousel arrow and the phone dock
 *   /probe-tmp/ice?mode=cms       three CMS blocks (hero, 2-paragraph text,
 *                                 media) marked by lib/server/ice/cms.ts
 *   …&conflict=1                  the next save answers "conflict" — one
 *                                 shot (window.__iceConflictNext = true too)
 *   /probe-tmp/ice/launcher       the „Edytuj stronę” button over the dock
 *
 * Run it in a throwaway worktree so the repo's own .next stays untouched:
 *   git worktree add <dir> HEAD && ln -s "$PWD/node_modules" <dir>/node_modules
 *   (cd <dir> && node <repo>/scripts/ice-ui-probe.mjs --harness)
 *   (cd <dir> && npx next dev -p 3311) &
 *   ICE_PROBE_SHOTS=<dir> node scripts/ice-ui-probe.mjs http://127.0.0.1:3311
 *   (cd <dir> && node <repo>/scripts/ice-ui-probe.mjs --clean)
 *
 * Env: ICE_PROBE_SHOTS (screenshot dir), ICE_PROBE_CHROME (browser binary),
 * ICE_PROBE_ONLY (e.g. "390-dark" or "834-light,390-dark" — only those).
 */
import fs from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

const DIR = "app/probe-tmp/ice";

/* ── harness sources (no template literals inside: they live in one) ───── */

const PAGE_SRC = `import { getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { icePageFor, pageTextKeys } from "@/lib/ice/registry";
import { stegaMark } from "@/lib/ice/stega";
import { blockFields, markBlocks, type CmsBlockLike } from "@/lib/server/ice/cms";
import type { IceLocale, IcePageInfo } from "@/lib/ice/types";
import {
  BEFORE_AFTER, CAROUSEL, FEATURED, INTEREST_KEYS, PROMO_BANNERS, SESSIONS, SHOWCASE, THUMBNAILS, UPLOAD_TOOLS,
} from "@/lib/seller-home-config";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { ProbeEditor } from "./probe-editor";
import { Counter } from "./counter";

export const dynamic = "force-dynamic";

/** The edit session's nonce (8 × [a-z0-9], like a real one). */
const NONCE = "probe123";
const PAGE_ID = "9d0c1b2a-0000-4000-8000-0000000000aa";
const BASE_AT = "2026-01-01T00:00:00.000Z";

type Dict = Record<string, unknown>;
const T = { pl: makeT(pl as Dict), en: makeT(en as Dict), de: makeT(de as Dict) };

const CSS = [
  ".probe{max-width:1180px;margin:0 auto;padding:84px 16px var(--page-bottom);color:rgb(var(--ink));background:rgb(var(--bg));min-height:100dvh}",
  "@media (min-width:1024px){.probe{padding-bottom:64px}}",
  ".probe h1{font:700 30px/1.15 var(--font-display);margin:0 0 12px}",
  ".probe h2{font:700 22px/1.25 var(--font-display);margin:0 0 6px}",
  ".probe p{margin:0 0 8px}",
  ".p-sec{margin:28px 0}",
  ".p-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}",
  "@media (max-width:639px){.p-row{grid-template-columns:1fr}}",
  ".p-card{display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:14px;border:1px solid rgb(var(--line));background:rgb(var(--surface));color:inherit;text-decoration:none}",
  ".p-frame{position:relative;display:block;overflow:hidden;border-radius:10px;background:rgb(var(--sunken))}",
  ".p-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}",
  ".p-empty{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:rgb(var(--muted));text-align:center;padding:6px}",
  ".p-name{font-weight:650}",
  ".p-line{font-size:13px;color:rgb(var(--muted))}",
  ".p-pills{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
  ".p-pill{padding:7px 12px;border-radius:99px;border:1px solid rgb(var(--line-strong));background:rgb(var(--raised));color:inherit;font:inherit;font-size:14px}",
  ".p-cta{display:inline-flex;padding:8px 14px;border-radius:12px;background:rgb(var(--accent));color:#fff;font-weight:600;text-decoration:none;border:0;font-size:14px}",
  ".p-samples{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;max-width:520px}",
  ".p-sample{position:relative;aspect-ratio:1/1;border-radius:10px;overflow:hidden;border:1px solid rgb(var(--line));background:rgb(var(--sunken));padding:0}",
  ".p-sample img{width:100%;height:100%;object-fit:cover;display:block}",
  ".p-ba{max-width:360px}",
  ".p-promo{position:relative;padding:28px 20px;border-radius:18px;background:linear-gradient(120deg,rgb(var(--accent) / .35),rgb(var(--indigo) / .25));min-height:160px}",
  ".p-badge{display:inline-block;padding:2px 8px;border-radius:99px;background:rgb(var(--surface));font-size:12px;font-weight:600;margin-bottom:8px}",
  ".p-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0}",
  "@media (max-width:639px){.p-grid4{grid-template-columns:repeat(2,minmax(0,1fr))}}",
  ".p-counter{display:flex;gap:10px;align-items:center;margin-top:10px}",
  ".p-input{padding:8px 10px;border-radius:10px;border:1px solid rgb(var(--line-strong));background:rgb(var(--surface));color:inherit;font-size:16px}",
  ".p-hero{padding:24px 0}",
].join("\\n");

function Dock() {
  // The (app) shell's phone dock, as components/layout/customer-bottom-nav.tsx draws it.
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Dock (probe)">
      <div className="dock relative mx-[var(--page-x)] flex items-stretch rounded-2xl px-1"
        style={{ height: "var(--bottom-nav-h)", marginBottom: "var(--bottom-nav-gap)" }}>
        {["Start", "Narzędzia", "Biblioteka", "Konto"].map((label, i) => (
          <a key={label} href={"/dock-" + i} className="flex flex-1 items-center justify-center text-xs" style={{ color: "rgb(var(--ink))" }}>{label}</a>
        ))}
      </div>
    </nav>
  );
}

const lt = (v: unknown): string => {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  return typeof o.pl === "string" ? o.pl : typeof o.en === "string" ? o.en : "";
};
/** components/cms/blocks.tsx paragraphs() */
const paragraphs = (text: string) => text.split(/\\n\\s*\\n/).map((p) => p.trim()).filter(Boolean);

const BLOCKS: CmsBlockLike[] = [
  {
    id: "a1b2c3d4-1111-4111-8111-111111111111", type: "hero",
    content: {
      badge: { pl: "Nowość" },
      title: { pl: "Zdjęcia produktowe w minutę", en: "Product photos in a minute" },
      subtitle: { pl: "Wgraj jedno zdjęcie — resztę zrobi GrovBase." },
      ctaLabel: { pl: "Zacznij teraz" }, ctaHref: "/register",
    },
  },
  {
    id: "b2c3d4e5-2222-4222-8222-222222222222", type: "text",
    content: {
      title: { pl: "Dlaczego GrovBase" },
      description: { pl: "Pierwszy akapit: zdjęcia gotowe na marketplace.\\n\\nDrugi akapit: bez studia i bez fotografa." },
    },
  },
  {
    id: "c3d4e5f6-3333-4333-8333-333333333333", type: "media",
    content: { title: { pl: "Galeria" }, description: { pl: "Przykład z biblioteki." }, mediaUrl: "/showcase/moda-ghost.webp" },
  },
];

/** ?fixedcta=1: a "sticky_cta" block painted as a fixed bar over the page. */
const FIXED_CTA: CmsBlockLike = {
  id: "d4e5f6a7-4444-4444-8444-444444444444", type: "sticky_cta",
  content: { title: { pl: "Pierwsze 10 zdjęć gratis" }, ctaLabel: { pl: "Odbierz" }, ctaHref: "/register" },
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const conflict = q.conflict === "1";
  const { dict } = await getScopedDictionary("ice");

  if (q.mode === "cms") {
    const blocks = q.fixedcta === "1" ? [...BLOCKS, FIXED_CTA] : BLOCKS;
    const info: IcePageInfo = {
      kind: "cms",
      cms: { pageId: PAGE_ID, slug: "probe", path: "/probe", title: "Probe", launch: false, fields: blocks.flatMap((b) => blockFields(b, BASE_AT)) },
    };
    const [hero, text, media, fixed] = markBlocks(blocks, "pl", NONCE);
    const c = (b: CmsBlockLike) => (b.content ?? {}) as Record<string, unknown>;
    return (
      <main className="probe">
        <style>{CSS}</style>
        <section data-cms-section={hero.id} className="p-sec p-hero">
          <span className="p-badge" id="c-hero-badge">{lt(c(hero).badge)}</span>
          <h1 id="c-hero-title">{lt(c(hero).title)}</h1>
          <p id="c-hero-sub">{lt(c(hero).subtitle)}</p>
          <a href="/register" className="p-cta" id="c-hero-cta">{lt(c(hero).ctaLabel)}</a>
        </section>
        <section data-cms-section={text.id} className="p-sec">
          <h2 id="c-text-title">{lt(c(text).title)}</h2>
          {paragraphs(lt(c(text).description)).map((p, i) => <p key={i} id={"c-par-" + (i + 1)}>{p}</p>)}
        </section>
        <section data-cms-section={media.id} className="p-sec">
          <h2>{lt(c(media).title)}</h2>
          <p>{lt(c(media).description)}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img id="c-media-img" src={String(c(media).mediaUrl)} alt="" style={{ width: "100%", maxWidth: 420, borderRadius: 12, display: "block" }} />
        </section>
        {fixed && (
          <section data-cms-section={fixed.id} id="c-fixed" style={{
            position: "fixed", left: 16, right: 16, top: 220, zIndex: 30, display: "flex", alignItems: "center", gap: 12,
            padding: 12, borderRadius: 14, background: "rgb(var(--surface))", border: "1px solid rgb(var(--line-strong))",
          }}>
            <strong id="c-fixed-title">{lt(c(fixed).title)}</strong>
            <span id="c-fixed-gap" style={{ flex: 1, alignSelf: "stretch", minWidth: 40 }} />
            <a href="/register" className="p-cta">{lt(c(fixed).ctaLabel)}</a>
          </section>
        )}
        {/* Room to scroll any block under the fixed bar. */}
        <div aria-hidden="true" style={{ height: "100dvh" }} />
        <Dock />
        <I18nScope dict={dict}>
          <ProbeEditor mode="cms" path="/probe" info={info} defaults={{}} conflict={conflict} />
        </I18nScope>
      </main>
    );
  }

  const page = icePageFor("/home")!;
  const textKeys = pageTextKeys(page);
  const index = new Map(textKeys.map((k, i) => [k, i]));
  const tx = (key: string) => {
    const i = index.get(key);
    const v = T.pl(key);
    return i === undefined ? v : v + stegaMark(NONCE + ".t" + i);
  };
  const info: IcePageInfo = { kind: "registry", page, textKeys };
  const defaults: Record<string, Partial<Record<IceLocale, string>>> = Object.fromEntries(
    textKeys.map((k) => [k, { pl: T.pl(k), en: T.en(k), de: T.de(k) }]),
  );
  const thumbTool = UPLOAD_TOOLS.find((u) => u.key === "thumbnail")!;
  const ba = BEFORE_AFTER[0];
  const promo = PROMO_BANNERS.first;
  const photos = ["/showcase/ecommerce-thumbnail.webp", "/showcase/grovshot-studio.webp", "/showcase/moda-ghost.webp"];

  return (
    <main className="probe">
      <style>{CSS}</style>
      <h1>Start · probe</h1>

      <section className="p-sec" aria-label="Karuzela">
        <div className="p-row">
          {CAROUSEL.slice(0, 3).map((tile, i) => (
            <a key={tile.item} href={"/tool/" + tile.item} className="p-card">
              <span data-config-key={tile.media.configKey} className="p-frame" style={{ aspectRatio: "2336/1744" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photos[i]} alt="" />
              </span>
              <strong className="p-name" id={"p-tool-" + (i + 1)}>{tx(tile.nameKey)}</strong>
              <span className="p-line">{tx(tile.subKey)}</span>
            </a>
          ))}
        </div>
        <Counter />
      </section>

      <section className="p-sec" aria-label="Upload">
        <div className="p-pills">
          {UPLOAD_TOOLS.map((u) => <button key={u.key} type="button" className="p-pill" id={"p-pill-" + u.key}>{tx(u.pillKey)}</button>)}
        </div>
        {/* An outlined button with an icon: a press on the icon opens its text. */}
        <button type="button" className="p-cta" id="p-icon-btn" style={{ marginTop: 10, gap: 8, alignItems: "center" }}>
          <svg id="p-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {tx("sellerHome.upload.create")}
        </button>
        <p className="p-line" style={{ marginTop: 10 }}>{tx("sellerHome.samples")}</p>
        <div className="p-samples">
          {thumbTool.samples.map((s, i) => (i < 2
            ? (
              <button key={s.configKey} type="button" className="p-sample" data-sample={s.configKey}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i === 0 ? "/showcase/ecommerce-packshot.webp" : "/showcase/tool-shadow.webp"} alt="" />
              </button>
            )
            : <button key={s.configKey} type="button" className="p-sample" data-sample-empty={s.configKey}><span className="p-empty">{i + 1}</span></button>))}
        </div>
      </section>

      <section className="p-sec" aria-label="Przed / po">
        <h2 id="p-ba-title">{tx("sellerHome.ba.title")}</h2>
        <p id="p-ba-sub">{tx("sellerHome.ba.sub")}</p>
        <article data-ba-card={ba.key} className="p-ba">
          <div data-before-after="" className="p-frame" style={{ aspectRatio: "1/1" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/showcase/ecommerce-set.webp" alt="" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/showcase/ecommerce-thumbnail.webp" alt="" style={{ clipPath: "inset(0 0 0 50%)" }} />
          </div>
          <p className="p-line" id="p-ba-caption">{tx(ba.nameKey)}</p>
          <p className="p-line">{tx("sellerHome.industry." + ba.industry)}</p>
        </article>
      </section>

      <section className="p-sec p-promo" data-promo={promo.key} aria-label="Baner">
        <span className="p-badge">{tx(promo.badgeKey!)}</span>
        <h2 id="p-promo-title">{tx(promo.titleKey!)}</h2>
        <p>{tx(promo.subKey!)}</p>
        <a href="/generator" className="p-cta">{tx(promo.ctaKey!)}</a>
      </section>

      <section className="p-sec" aria-label="Galeria">
        <div className="p-grid4">
          {SHOWCASE.gallery.slice(0, 4).map((m, i) => (
            <span key={m.configKey} data-config-key={m.configKey} className="p-frame" style={{ aspectRatio: "4/3" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i === 0 ? <img src="/showcase/tool-relight.webp" alt="" /> : <span className="p-empty">{"Galeria " + (i + 1)}</span>}
            </span>
          ))}
        </div>
        <a href="/retusz" className="p-cta">{tx(SHOWCASE.ctaKey)}</a>
      </section>

      <section className="p-sec" aria-label="Miniaturki">
        <h2 id="p-thumbs-title">{tx(THUMBNAILS.titleKey)}</h2>
        <p id="p-thumbs-sub">{tx(THUMBNAILS.subKey)}</p>
        <div className="p-grid4">
          {THUMBNAILS.tiles.slice(0, 4).map((tile, i) => (
            <span key={tile.media.configKey} data-config-key={tile.media.configKey} className="p-frame" style={{ aspectRatio: "1/1" }}>
              <span className="p-empty">{"Miniaturka " + (i + 1)}</span>
            </span>
          ))}
        </div>
        <div className="p-pills">
          <a href="/k/ecommerce/thumbnail" className="p-cta">{tx(THUMBNAILS.tryKey)}</a>
          <a href="/k/ecommerce/thumbnail" className="p-cta">{tx(THUMBNAILS.ctaKey)}</a>
        </div>
      </section>

      <section className="p-sec" aria-label="Sesje">
        {/* Sticky below the admin bar: editable content inside a sticky box. */}
        <h2 id="p-sessions-title" style={{ position: "sticky", top: 150, zIndex: 1 }}>{tx(SESSIONS.titleKey)}</h2>
        <p>{tx(SESSIONS.subKey)}</p>
        <div className="p-grid4">
          {SESSIONS.tiles.slice(0, 2).map((tile) => (
            <span key={tile.media.configKey} data-config-key={tile.media.configKey} className="p-frame"
              style={{ aspectRatio: tile.media.width + "/" + tile.media.height }}>
              <span className="p-empty">{tile.media.configKey}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="p-sec" aria-label="Polecane">
        <h2>{tx("sellerHome.featured.title")}</h2>
        <p>{tx("sellerHome.featured.sub")}</p>
        {/* Cards whose whole surface is a transparent link stretched over them:
            1 — the link comes after the texts (on top by order); 2 — first, on
            top by z-index. */}
        <div className="p-row">
          {FEATURED.slice(0, 2).map((f, i) => (
            <div key={f.item} className="p-card" style={{ position: "relative" }} data-p-overlay-card={i + 1}>
              {i === 1 && <a href={"/tool/" + f.item} aria-label={"Otwórz " + f.item} style={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: 14 }} />}
              <strong className="p-name" id={"p-feat-" + (i + 1)}>{tx(f.nameKey)}</strong>
              <span className="p-line">{tx(f.subKey)}</span>
              <span style={{ display: "block", height: 44 }} />
              {i === 0 && <a href={"/tool/" + f.item} aria-label={"Otwórz " + f.item} style={{ position: "absolute", inset: 0, borderRadius: 14 }} />}
            </div>
          ))}
        </div>
      </section>

      <section className="p-sec" aria-label="Nadchodzi">
        <h2 id="p-soon-title">{tx("sellerHome.soon.title")}</h2>
        <p id="p-soon-sub">{tx("sellerHome.soon.sub")}</p>
        <div className="p-pills">
          {INTEREST_KEYS.map((k) => <button key={k} type="button" className="p-pill" data-chip={k}>{tx("sellerHome.soon." + k)}</button>)}
          <button type="button" className="p-cta">{tx("sellerHome.soon.notify")}</button>
        </div>
      </section>

      <section className="p-sec" aria-label="Inne">
        <p><a href="/elsewhere" id="p-plain-link">Zwykły link (nieedytowalny)</a></p>
        <form action="/elsewhere-form" id="p-form" className="p-pills">
          <input name="q" id="p-input" defaultValue="" aria-label="Szukaj" className="p-input" />
          <button type="submit" id="p-submit" className="p-pill">Wyślij formularz</button>
        </form>
      </section>

      <Dock />
      <I18nScope dict={dict}>
        <ProbeEditor mode="home" path="/home" info={info} defaults={defaults} conflict={conflict} />
      </I18nScope>
    </main>
  );
}
`;

const COUNTER_SRC = `"use client";
import { useState } from "react";

/**
 * Page controls under the edit-mode click policy: a plain button is held;
 * a carousel arrow (data-rail-next), tabs (role=tab) and a toggle
 * (aria-pressed) only move the page's own view and keep working.
 */
export function Counter() {
  const [n, setN] = useState(0);
  const [plain, setPlain] = useState(0);
  const [tab, setTab] = useState<"a" | "b">("a");
  const [on, setOn] = useState(false);
  return (
    <div className="p-counter" style={{ flexWrap: "wrap" }}>
      <button type="button" id="p-next" data-rail-next="" className="p-pill" aria-label="Następne narzędzia" onClick={() => setN((v) => v + 1)}>›</button>
      <span>Przewinięto: <output id="p-count">{n}</output></span>
      <button type="button" id="p-plain-btn" className="p-pill" onClick={() => setPlain((v) => v + 1)}>Zwykły przycisk</button>
      <output id="p-plain-count">{plain}</output>
      <span role="tablist" aria-label="Widok" className="p-pills">
        <button type="button" role="tab" id="p-tab-a" aria-selected={tab === "a"} className="p-pill" onClick={() => setTab("a")}>Siatka</button>
        <button type="button" role="tab" id="p-tab-b" aria-selected={tab === "b"} className="p-pill" onClick={() => setTab("b")}>Lista</button>
      </span>
      <button type="button" id="p-toggle" aria-pressed={on} className="p-pill" onClick={() => setOn((v) => !v)}>Tylko nowe</button>
    </div>
  );
}
`;

const EDITOR_SRC = `"use client";
import { useEffect, useState } from "react";
import Editor from "@/components/ice/editor/editor";
import type {
  IceAsset, IceCmsPage, IceLocale, IcePageInfo, IceSlotState, IceTextState, IceTransport, IceVersion,
} from "@/lib/ice/types";

/**
 * THE FAKE TRANSPORT — every IceTransport method, in memory, with the
 * server's compare-and-set rules, and every call recorded in
 * window.__iceCalls. window.__iceConflictNext = true (or ?conflict=1) makes
 * the next save answer "conflict" the way the server does: someone else wrote
 * first, and the answer carries what is there now.
 */

type Defaults = Record<string, Partial<Record<IceLocale, string>>>;
type Versioned = IceVersion & { target: string; key: string };
type Call = { method: string; args: unknown };
type ProbeWindow = Window & { __iceCalls?: Call[]; __iceConflictNext?: boolean; __iceProbe?: unknown };

const LOCALES: IceLocale[] = ["pl", "en", "de"];
const NONCE = "probe123";
const LATENCY = 40;
const AUTHOR = "probe@grovbase.com";

let seq = 0;
const uid = () => { seq += 1; return "00000000-0000-4000-8000-" + String(seq).padStart(12, "0"); };
let clock = Date.parse("2026-10-15T08:00:00.000Z");
const stamp = () => { clock += 1000; return new Date(clock).toISOString(); };
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY));
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x)) as X;

function rec(method: string, args: unknown) {
  if (typeof window === "undefined") return;
  const pw = window as ProbeWindow;
  (pw.__iceCalls ??= []).push({ method, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) });
}
function takeConflict(): boolean {
  const pw = window as ProbeWindow;
  if (pw.__iceConflictNext) { pw.__iceConflictNext = false; return true; }
  return false;
}

const asset = (id: string, title: string, url: string, width: number, height: number, mime: string, sizeBytes: number, createdAt: string): IceAsset => ({
  id, kind: "image", url, posterUrl: null, title, alt: null, mime, sizeBytes, width, height, variants: {}, createdAt, usage: 0,
});

export const SEED_ASSETS: IceAsset[] = [
  asset("a55e7000-0000-4000-8000-000000000001", "hero-dino.webp", "/launch/hero-dino.webp", 1808, 1152, "image/webp", 447760, "2026-09-06T10:00:00.000Z"),
  asset("a55e7000-0000-4000-8000-000000000002", "ecommerce-packshot.webp", "/showcase/ecommerce-packshot.webp", 340, 425, "image/webp", 1368, "2026-09-05T10:00:00.000Z"),
  asset("a55e7000-0000-4000-8000-000000000003", "moda-ghost.webp", "/showcase/moda-ghost.webp", 340, 425, "image/webp", 4160, "2026-09-04T10:00:00.000Z"),
  asset("a55e7000-0000-4000-8000-000000000004", "app-icon.png", "/brand/app-icon.png", 1024, 1024, "image/png", 575499, "2026-09-03T10:00:00.000Z"),
  asset("a55e7000-0000-4000-8000-000000000005", "grovshot-studio.webp", "/showcase/grovshot-studio.webp", 340, 425, "image/webp", 1658, "2026-09-02T10:00:00.000Z"),
  asset("a55e7000-0000-4000-8000-000000000006", "tool-shadow.webp", "/showcase/tool-shadow.webp", 340, 425, "image/webp", 3686, "2026-09-01T10:00:00.000Z"),
];

const emptySlot = (key: string): IceSlotState => ({
  key, exists: false, enabled: true, mediaType: "image", media: null, mobile: null, poster: null, alt: null, altI18n: {},
  fit: "cover", position: "center center", crop: null, updatedAt: null,
});

/** A media_slots row as content_versions stores it (0141 trigger). */
function snap(st: IceSlotState | undefined) {
  if (!st || !st.exists) return null;
  return {
    media_type: st.mediaType, media_id: st.media?.id ?? null, tablet_media_id: null, mobile_media_id: st.mobile?.id ?? null,
    poster_media_id: st.poster?.id ?? null, alt_text: st.alt, alt_i18n: st.altI18n, object_fit: st.fit,
    object_position: st.position, crop: st.crop, enabled: st.enabled, updated_at: st.updatedAt,
  };
}

const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm"]);

function makeTransport(initial: IcePageInfo, defaults: Defaults): IceTransport {
  const assets: IceAsset[] = clone(SEED_ASSETS);
  const files = new Map<string, { file: File; url: string; width: number | null; height: number | null }>();
  const overrides = new Map<string, { value: string; updatedAt: string }>();
  const slots = new Map<string, IceSlotState>();
  const versions: Versioned[] = [];
  const cms: IceCmsPage | null = initial.kind === "cms" ? clone(initial.cms) : null;

  const byId = (id: string | null | undefined) => (id ? assets.find((a) => a.id === id) ?? null : null);
  const slot = (key: string) => slots.get(key) ?? emptySlot(key);
  const maxLength = (key: string) => {
    if (initial.kind !== "registry") return 240;
    for (const s of initial.page.sections) for (const e of s.elements) if (e.text?.key === key) return e.text.maxLength;
    return 240;
  };
  const states = (key: string): IceTextState[] => LOCALES.map((l) => {
    const o = overrides.get(key + "|" + l);
    return { key, locale: l, defaultValue: defaults[key]?.[l] ?? "", override: o?.value ?? null, updatedAt: o?.updatedAt ?? null };
  });
  const usageOf = (id: string) => [...slots.values()]
    .filter((s) => s.media?.id === id || s.mobile?.id === id || s.poster?.id === id)
    .map((s) => ({ kind: "slot", key: s.key, label: s.key }));
  const withUsage = (a: IceAsset): IceAsset => ({ ...a, usage: usageOf(a.id).length });
  const newest = <V extends { createdAt: string }>(list: V[]) => [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  // Seeds: one filled thumbnail, one filled sample, a text saved and reset.
  const seedSlot = (key: string, a: IceAsset, at: string) => {
    slots.set(key, { ...emptySlot(key), exists: true, media: a, updatedAt: at });
    versions.push({ id: uid(), target: "slot", key, locale: null, action: "save", before: null, after: snap(slots.get(key)), createdAt: at, author: "seed@grovbase.com" });
  };
  if (initial.kind === "registry") {
    seedSlot("homeMedia.thumbnails.3", assets[3], "2026-09-01T10:00:00.000Z");
    seedSlot("homeMedia.upload.thumbnail.sample.1", assets[1], "2026-09-02T10:00:00.000Z");
    versions.push({ id: uid(), target: "text", key: "sellerHome.thumbs.title", locale: "pl", action: "save", before: null,
      after: { value: "Miniaturki ofert", updated_at: "2026-10-01T10:00:00.000Z" }, createdAt: "2026-10-01T10:00:00.000Z", author: "seed@grovbase.com" });
    versions.push({ id: uid(), target: "text", key: "sellerHome.thumbs.title", locale: "pl", action: "reset",
      before: { value: "Miniaturki ofert", updated_at: "2026-10-01T10:00:00.000Z" }, after: null, createdAt: "2026-10-02T10:00:00.000Z", author: "seed@grovbase.com" });
  } else if (cms) {
    const f = cms.fields.find((x) => x.path.join(".") === "subtitle");
    if (f) {
      versions.push({ id: uid(), target: "cms", key: cms.pageId + ":" + f.blockId + ":subtitle.pl", locale: "pl", action: "save",
        before: { path: f.path, value: "Stary podtytuł" }, after: { path: f.path, value: f.values.pl ?? null, action: "save" },
        createdAt: "2026-10-03T10:00:00.000Z", author: "seed@grovbase.com" });
    }
  }

  return {
    async setEdit(on, path) {
      rec("setEdit", [on, path]); await wait();
      return { ok: true, data: { nonce: on ? NONCE : null } };
    },
    async page(path) {
      rec("page", [path]); await wait();
      return cms ? { ok: true, data: { kind: "cms", cms: clone(cms) } } : { ok: true, data: clone(initial) };
    },
    async textState(key) {
      rec("textState", [key]); await wait();
      if (!defaults[key]) return { ok: false, error: "unknown_key" };
      return { ok: true, data: { states: states(key), pages: ["/home"], maxLength: maxLength(key) } };
    },
    async textSave(input) {
      rec("textSave", input); await wait();
      const k = input.key + "|" + input.locale;
      const cur = overrides.get(k);
      if (takeConflict()) {
        const at = stamp();
        overrides.set(k, { value: "Zmienione w międzyczasie", updatedAt: at });
        versions.push({ id: uid(), target: "text", key: input.key, locale: input.locale, action: "external",
          before: cur ? { value: cur.value, updated_at: cur.updatedAt } : null, after: { value: "Zmienione w międzyczasie", updated_at: at }, createdAt: at, author: "someone@grovbase.com" });
        return { ok: false, error: "conflict", current: states(input.key) };
      }
      if ((cur?.updatedAt ?? null) !== (input.base ?? null)) return { ok: false, error: "conflict", current: states(input.key) };
      const fallback = defaults[input.key]?.[input.locale];
      if (fallback === undefined) return { ok: false, error: "denied" };
      let value = input.value === null ? null : input.value.replace(/[\\t ]+/g, " ").trim();
      if (value !== null && /[<>]/.test(value)) return { ok: false, error: "text_markup" };
      if (value === fallback) value = null;
      if (value === null && !cur) return { ok: true, data: { updatedAt: null } };
      const at = stamp();
      if (value === null) overrides.delete(k); else overrides.set(k, { value, updatedAt: at });
      versions.push({ id: uid(), target: "text", key: input.key, locale: input.locale,
        action: value === null && (input.action ?? "save") === "save" ? "reset" : (input.action ?? "save"),
        before: cur ? { value: cur.value, updated_at: cur.updatedAt } : null,
        after: value === null ? null : { value, updated_at: at }, createdAt: at, author: AUTHOR });
      return { ok: true, data: { updatedAt: value === null ? null : at } };
    },
    async slotState(keys) {
      rec("slotState", [keys]); await wait();
      return { ok: true, data: keys.map((k) => clone(slot(k))) };
    },
    async slotSave(input) {
      rec("slotSave", input); await wait();
      const keys = input.writes.map((w) => w.key);
      if (takeConflict()) {
        const k = keys[0];
        slots.set(k, { ...slot(k), exists: true, updatedAt: stamp() });
        return { ok: false, error: "conflict", current: { key: k, states: keys.map((x) => clone(slot(x))) } };
      }
      for (const w of input.writes) {
        if ((slot(w.key).updatedAt ?? null) !== (w.base ?? null)) {
          return { ok: false, error: "conflict", current: { key: w.key, states: keys.map((x) => clone(slot(x))) } };
        }
        for (const id of [w.mediaId, w.mobileMediaId, w.posterMediaId]) if (id && !byId(id)) return { ok: false, error: "asset_missing" };
      }
      const out: Record<string, string> = {};
      for (const w of input.writes) {
        const before = slots.get(w.key);
        const at = stamp();
        const next: IceSlotState = {
          key: w.key, exists: true, enabled: before?.enabled ?? true, mediaType: w.mediaType, media: byId(w.mediaId),
          mobile: byId(w.mobileMediaId), poster: byId(w.posterMediaId), alt: w.alt, altI18n: w.altI18n, fit: w.fit,
          position: w.position, crop: w.crop, updatedAt: at,
        };
        slots.set(w.key, next);
        versions.push({ id: uid(), target: "slot", key: w.key, locale: null, action: input.action, before: snap(before), after: snap(next), createdAt: at, author: AUTHOR });
        out[w.key] = at;
      }
      return { ok: true, data: { updatedAt: out } };
    },
    async history(input) {
      rec("history", input); await wait();
      const list = versions.filter((v) => v.target === input.target && v.key === input.key
        && (input.target !== "text" || !input.locale || v.locale === input.locale));
      return { ok: true, data: newest(list).slice(0, input.limit ?? 20).map((v) => clone(v)) };
    },
    async pageHistory(path) {
      rec("pageHistory", [path]); await wait();
      return { ok: true, data: newest(versions).slice(0, 80).map((v) => clone(v)) };
    },
    async library(input) {
      rec("library", input); await wait();
      const q = (input.q ?? "").toLowerCase();
      const list = newest(assets).filter((a) => (!input.kind || a.kind === input.kind) && (!q || (a.title ?? "").toLowerCase().includes(q)));
      const from = input.offset ?? 0;
      return { ok: true, data: list.slice(from, from + 60).map(withUsage) };
    },
    async usage(mediaId) {
      rec("usage", [mediaId]); await wait();
      return { ok: true, data: usageOf(mediaId) };
    },
    async assets(ids) {
      rec("assets", [ids]); await wait();
      return { ok: true, data: assets.filter((a) => ids.includes(a.id)).map(withUsage) };
    },
    async uploadTicket(input) {
      rec("uploadTicket", input); await wait();
      if (!MIMES.has(input.type)) return { ok: false, error: "format" };
      return { ok: true, data: { path: "ice/probe/" + uid() + "-" + input.name } };
    },
    async putFile(path, file) {
      rec("putFile", [path, { name: file.name, size: file.size, type: file.type }]);
      let width: number | null = null;
      let height: number | null = null;
      try {
        const bmp = await createImageBitmap(file);
        width = bmp.width; height = bmp.height; bmp.close();
      } catch { /* not a picture the browser can read */ }
      files.set(path, { file, url: URL.createObjectURL(file), width, height });
      await wait();
      return true;
    },
    async registerUpload(input) {
      rec("registerUpload", input); await wait();
      const f = files.get(input.path);
      if (!f) return { ok: false, error: "upload_missing" };
      const a: IceAsset = {
        id: uid(), kind: f.file.type.startsWith("video/") ? "video" : "image", url: f.url, posterUrl: null, title: input.name,
        alt: null, mime: f.file.type, sizeBytes: f.file.size, width: f.width, height: f.height, variants: {}, createdAt: stamp(), usage: 0,
      };
      assets.push(a);
      rec("registerUpload:result", { id: a.id, title: a.title });
      return { ok: true, data: clone(a) };
    },
    async cmsMap(path) {
      rec("cmsMap", [path]); await wait();
      return cms ? { ok: true, data: clone(cms) } : { ok: false, error: "unsupported" };
    },
    async cmsSave(input) {
      rec("cmsSave", input); await wait();
      if (!cms) return { ok: false, error: "unsupported" };
      const f = cms.fields.find((x) => x.blockId === input.blockId && x.path.join("|") === input.path.join("|"));
      if (!f) return { ok: false, error: "bad_path" };
      const shown = f.kind === "media" ? (f.url || null) : (input.locale ? f.values[input.locale] ?? null : null);
      const touch = () => { const at = stamp(); for (const g of cms.fields) if (g.blockId === f.blockId) g.base = at; return at; };
      if (takeConflict()) {
        if (f.kind === "text" && input.locale) f.values[input.locale] = "Zmienione w międzyczasie";
        touch();
        return { ok: false, error: "conflict", current: { value: f.kind === "text" && input.locale ? f.values[input.locale] ?? null : f.url ?? null } };
      }
      if ((f.base ?? null) !== (input.base ?? null) || shown !== (input.expected ?? null)) {
        return { ok: false, error: "conflict", current: { value: shown } };
      }
      const at = touch();
      if (f.kind === "media") f.url = input.value; else if (input.locale) f.values[input.locale] = input.value;
      versions.push({ id: uid(), target: "cms", key: cms.pageId + ":" + f.blockId + ":" + [...f.path, ...(input.locale ? [input.locale] : [])].join("."),
        locale: input.locale, action: input.action ?? "save", before: { path: f.path, value: shown },
        after: { path: f.path, value: input.value, action: input.action ?? "save" }, createdAt: at, author: AUTHOR });
      return { ok: true, data: { updatedAt: at } };
    },
  };
}

export function ProbeEditor({ mode, path, info, defaults, conflict }: {
  mode: "home" | "cms"; path: string; info: IcePageInfo; defaults: Defaults; conflict: boolean;
}) {
  const [transport] = useState(() => makeTransport(info, defaults));
  // ?conflict=1 arms ONE conflict, once per page load: a later re-render with
  // new props (router.refresh) must not arm it again.
  useEffect(() => {
    (window as ProbeWindow).__iceConflictNext = conflict;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const pw = window as ProbeWindow;
    pw.__iceCalls ??= [];
    pw.__iceProbe = {
      mode, path, nonce: NONCE, textKeys: info.kind === "registry" ? info.textKeys : [],
      assets: SEED_ASSETS.map((a) => ({ id: a.id, title: a.title })),
    };
  }, [info, mode, path]);
  return <Editor session={{ nonce: NONCE, path }} path={path} transport={transport} />;
}
`;

const LAUNCHER_SRC = `import { getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { IceLauncher } from "@/components/ice/launcher";

export const dynamic = "force-dynamic";

/** The „Edytuj stronę” button on a page that also shows the phone dock. */
export default async function Page() {
  const { dict } = await getScopedDictionary("ice");
  return (
    <main style={{ minHeight: "160dvh", padding: "24px 16px", background: "rgb(var(--bg))", color: "rgb(var(--ink))" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Launcher · probe</h1>
      <p>Ta strona ma dock telefonu i przycisk edytora.</p>
      <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Dock (probe)">
        <div className="dock relative mx-[var(--page-x)] flex items-stretch rounded-2xl px-1"
          style={{ height: "var(--bottom-nav-h)", marginBottom: "var(--bottom-nav-gap)" }}>
          {["Start", "Narzędzia", "Biblioteka", "Konto"].map((label, i) => (
            <a key={label} href={"/dock-" + i} className="flex flex-1 items-center justify-center text-xs">{label}</a>
          ))}
        </div>
      </nav>
      <I18nScope dict={dict}>
        <IceLauncher sessions={[]} supported={["/probe-tmp/ice/launcher"]} />
      </I18nScope>
    </main>
  );
}
`;

if (process.argv.includes("--harness")) {
  fs.mkdirSync(`${DIR}/launcher`, { recursive: true });
  fs.writeFileSync(`${DIR}/page.tsx`, PAGE_SRC);
  fs.writeFileSync(`${DIR}/counter.tsx`, COUNTER_SRC);
  fs.writeFileSync(`${DIR}/probe-editor.tsx`, EDITOR_SRC);
  fs.writeFileSync(`${DIR}/launcher/page.tsx`, LAUNCHER_SRC);
  console.log(`harness written to ${process.cwd()}/${DIR}`);
  process.exit(0);
}
if (process.argv.includes("--clean")) {
  fs.rmSync(DIR, { recursive: true, force: true });
  if (fs.existsSync("app/probe-tmp") && fs.readdirSync("app/probe-tmp").length === 0) fs.rmSync("app/probe-tmp", { recursive: true });
  console.log("harness removed");
  process.exit(0);
}

/* ── the run ───────────────────────────────────────────────────────────── */

const BASE = (process.argv[2] ?? "http://127.0.0.1:3311").replace(/\/$/, "");
const SHOTS = process.env.ICE_PROBE_SHOTS ?? null;
const CHROME = process.env.ICE_PROBE_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ONLY = process.env.ICE_PROBE_ONLY ? process.env.ICE_PROBE_ONLY.split(",") : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900, touch: false },
  { name: "834", width: 834, height: 1112, touch: false },
  { name: "390", width: 390, height: 844, touch: true },
];
const THEMES = ["light", "dark"];
const CHECKS = [
  ["1", "edit-mode chrome"], ["2", "hover frame"], ["3", "text panel"], ["3b", "re-open in re-scan window"],
  ["4", "media panel"], ["5", "pair panel"], ["6", "samples panel"], ["7", "bulk upload"],
  ["8", "links / forms / buttons"], ["9", "Elementy / Historia / Esc"], ["10", "mobile sheet + tap"],
  ["11", "CMS mode"], ["12", "Zakończ edycję"], ["13", "console clean"], ["L", "launcher vs dock"],
];
/** Console lines that come from this sandbox (no Supabase, dev tooling), not the editor. */
const ENV_NOISE = [/content-overrides: read failed/, /fetch failed/, /redirects/i, /Download the React DevTools/, /\[Fast Refresh\]/, /\[HMR\]/];
const isNoise = (text) => ENV_NOISE.some((r) => r.test(text));

/** check id → combo → { ok, fails[] } */
const table = new Map();
const failures = [];
const consoleLog = [];
let failCount = 0;
function check(combo, id, name, cond, detail) {
  const row = table.get(String(id)) ?? new Map();
  const cell = row.get(combo) ?? { ok: true, fails: [] };
  if (cond) console.log(`  ✓ [${combo}] ${id}. ${name}`);
  else {
    failCount++;
    cell.ok = false;
    const d = detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail);
    cell.fails.push(`${name}${d ? ` — ${d}` : ""}`);
    failures.push({ combo, id, name, detail: d });
    console.error(`  ✗ [${combo}] ${id}. ${name}${d ? ` — ${d}` : ""}`);
  }
  row.set(combo, cell);
  table.set(String(id), row);
  return cond;
}
const note = (combo, id) => {
  const row = table.get(String(id)) ?? new Map();
  if (!row.has(combo)) row.set(combo, { ok: true, fails: [] });
  table.set(String(id), row);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

const ZW = /[\u200c\u200d\u2060]/g;
/** Longer than the editor's 200 ms re-scan debounce (editor.tsx MutationObserver). */
const SETTLE = 350;
const sheet = (page) => page.locator('[role="dialog"][data-ice-ui]');
const library = (page) => page.locator('[role="dialog"][aria-label="Biblioteka mediów"]');
const bar = (page) => page.locator('[role="toolbar"][data-ice-ui]');
const allCalls = (page) => page.evaluate(() => window.__iceCalls ?? []);
const callsSince = async (page, from, method) => (await allCalls(page)).slice(from).filter((c) => !method || c.method === method);
const mark = async (page) => (await allCalls(page)).length;

/** Is the toast carrying `text` visible — on top at its own centre? */
const toastOnTop = (page, text) => page.evaluate((text) => {
  const t = [...document.querySelectorAll("[data-sonner-toast]")].find((x) => x.textContent.includes(text));
  if (!t) return { toast: false, onTop: false };
  const r = t.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const by = top && !t.contains(top) ? (top.closest("[data-ice-ui]") ? "editor UI" : top.tagName) : null;
  return { toast: true, onTop: Boolean(top && t.contains(top)), rect: [r.left, r.top, r.width, r.height].map(Math.round), coveredBy: by };
}, text);

/** One finger: down at (x, y), moved by dy in steps, up — real touch events. */
async function swipe(ctx, page, x, y, dy) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / 8 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function shot(page, combo, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${combo}-${name}.png` }).catch(() => {});
}

/** In the page: scroll `el` so `rectOf()` sits in the part of the screen no
 *  editor layer or dock covers (below the admin bar, above an open bottom
 *  sheet and the phone dock). */
const PLACE = `(el, rectOf) => {
  el.scrollIntoView({ block: "center" });
  const band = (x) => {
    let top = 0, bottom = innerHeight;
    const bar = document.querySelector('[role="toolbar"][data-ice-ui]');
    if (bar) top = bar.getBoundingClientRect().bottom + 4;
    const sh = document.querySelector('[role="dialog"][data-ice-ui]');
    if (sh) { const r = sh.getBoundingClientRect(); if (x >= r.left && x <= r.right) bottom = Math.min(bottom, r.top - 4); }
    const dock = document.querySelector('nav[aria-label="Dock (probe)"] .dock');
    if (dock && dock.getBoundingClientRect().height > 0) bottom = Math.min(bottom, dock.getBoundingClientRect().top - 4);
    return { top, bottom };
  };
  let r = rectOf();
  if (!r) return;
  const b = band(r.left + Math.min(r.width / 2, 30));
  if (r.top < b.top || r.bottom > b.bottom) window.scrollBy(0, (r.top + r.bottom) / 2 - (b.top + b.bottom) / 2);
}`;

/** Until the page has stopped scrolling (the editor scrolls smoothly when a
 *  panel opens below 1024px). */
const settleScroll = (page) => page.evaluate(async () => {
  let last = -1;
  let same = 0;
  for (let i = 0; i < 120 && same < 5; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    if (scrollY === last) same++; else { same = 0; last = scrollY; }
  }
});

/** Where to press on an element's visible text (its first painted line). */
async function textPoint(page, selector, nth = 0) {
  await settleScroll(page);
  return page.evaluate(({ sel, nth, place }) => {
    const el = document.querySelectorAll(sel)[nth];
    if (!el) return null;
    const firstRect = () => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.data.replace(/[\u200c\u200d\u2060]/g, "").trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const x = [...rg.getClientRects()].find((q) => q.width > 2 && q.height > 2);
        if (x) return x;
      }
      return null;
    };
    (0, eval)(place)(el, firstRect);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.replace(/[\u200c\u200d\u2060]/g, "").trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const rect = [...r.getClientRects()].find((x) => x.width > 2 && x.height > 2);
      if (rect) {
        const box = el.getBoundingClientRect();
        return { x: rect.left + Math.min(rect.width / 2, 30), y: rect.top + rect.height / 2, text: rect.toJSON(), box: box.toJSON() };
      }
    }
    return null;
  }, { sel: selector, nth, place: PLACE });
}
async function boxPoint(page, selector) {
  await settleScroll(page);
  return page.evaluate(({ sel, place }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    (0, eval)(place)(el, () => {
      const r = el.getBoundingClientRect();
      // A box taller than the free band: aim at its middle 40px.
      return { left: r.left, width: r.width, top: r.top + r.height / 2 - 20, bottom: r.top + r.height / 2 + 20 };
    });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, box: r.toJSON() };
  }, { sel: selector, place: PLACE });
}
const rawText = (page, selector) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? null, selector);
const visText = async (page, selector) => (await rawText(page, selector))?.replace(ZW, "") ?? null;

async function press(page, vp, p) {
  if (vp.touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

async function closeAll(page) {
  for (let i = 0; i < 4; i++) {
    if ((await library(page).count()) === 0 && (await sheet(page).count()) === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
}

/** The sheet's geometry — what check 10 holds a phone's bottom sheet to. */
function sheetGeom(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[role="dialog"][data-ice-ui]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const body = el.children[1];
    const vw = document.documentElement.clientWidth;
    const outside = [...el.querySelectorAll("button, input, textarea, [role=tab]")]
      .filter((b) => b.offsetParent !== null && b.type !== "file")
      .map((b) => ({ t: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40), r: b.getBoundingClientRect() }))
      .filter(({ r: x }) => x.width > 0 && (x.left < -0.5 || x.right > vw + 0.5));
    return {
      top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, vh: innerHeight, vw,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
      bodyScrollsX: body ? body.scrollWidth > body.clientWidth + 1 : null,
      outside: outside.map((o) => o.t),
      docOverflow: document.documentElement.scrollWidth > vw,
    };
  });
}

async function phoneSheetCheck(page, vp, combo, what) {
  if (vp.width >= 1024) return;
  const g = await sheetGeom(page);
  if (!g) return check(combo, 10, `${what}: a sheet is open`, false);
  check(combo, 10, `${what}: bottom sheet sits on the viewport bottom`, Math.abs(g.bottom - g.vh) <= 1, g);
  check(combo, 10, `${what}: bottom sheet ≤ ~86dvh`, g.height <= g.vh * 0.86 + 1.5, `${Math.round(g.height)} of ${g.vh}`);
  check(combo, 10, `${what}: sheet body scrolls (overflow auto)`, g.bodyOverflowY === "auto", g.bodyOverflowY);
  check(combo, 10, `${what}: nothing in the sheet sticks out sideways`, !g.bodyScrollsX && g.outside.length === 0 && !g.docOverflow, g);
}

function wireConsole(page, combo) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleLog.push({ combo, type: m.type(), text: m.text().slice(0, 600) });
  });
  page.on("pageerror", (e) => consoleLog.push({ combo, type: "pageerror", text: String(e?.stack ?? e).slice(0, 600) }));
}

async function newPage(vp, theme) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, colorScheme: theme, bypassCSP: true,
    hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1,
  });
  await ctx.addCookies([{ name: "ecs_locale", value: "pl", url: BASE }]);
  await ctx.addInitScript((th) => { try { localStorage.setItem("theme", th); } catch { /* private mode */ } }, theme);
  // `next dev` paints its tools bubble bottom-left above everything, over the
  // phone sheet's first footer button; production has none.
  await ctx.addInitScript(() => {
    const hide = () => {
      const st = document.createElement("style");
      st.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(st);
    };
    if (document.head) hide(); else document.addEventListener("DOMContentLoaded", hide);
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function png(color, w = 1200, h = 1200) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

/* ── one viewport × theme on the /home harness ─────────────────────────── */

async function runHome(vp, theme) {
  const combo = `${vp.name}-${theme}`;
  const { ctx, page } = await newPage(vp, theme);
  wireConsole(page, combo);
  page.on("dialog", (d) => void d.accept());
  await page.goto(`${BASE}/probe-tmp/ice?mode=home`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-ice-target]").length > 10, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  check(combo, 1, "theme applied", await page.evaluate((th) => document.documentElement.classList.contains("dark") === (th === "dark"), theme));
  await shot(page, combo, "01-edit-mode");

  const step = async (id, fn) => {
    note(combo, id);
    try { await fn(); } catch (e) { check(combo, id, "step threw", false, String(e?.message ?? e).split("\n")[0]); await shot(page, combo, `err-${id}`); }
    await closeAll(page);
    await page.waitForTimeout(SETTLE);
  };

  /* 1 ─ chrome */
  await step(1, async () => {
    const m = await page.evaluate(() => {
      const barEl = document.querySelector('[role="toolbar"][data-ice-ui]');
      const vw = document.documentElement.clientWidth;
      const r = barEl.getBoundingClientRect();
      const btns = [...barEl.querySelectorAll("button")].map((b) => {
        const x = b.getBoundingClientRect();
        return { text: b.textContent.trim(), left: Math.round(x.left), right: Math.round(x.right) };
      });
      const START = "\u2060\u200d\u2060";
      // The RSC flight <script>s carry the marked copy too; scan.ts skips them.
      const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "TEXTAREA", "OPTION"]);
      const markedParents = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const p = n.parentElement;
        if (n.data.includes(START) && p && !SKIP.has(p.tagName) && !p.closest("[data-ice-ui]")) markedParents.add(p);
      }
      const mediaSel = "[data-config-key],[data-ba-card] [data-before-after],[data-promo],[data-sample],[data-sample-empty]";
      const media = [...document.querySelectorAll(mediaSel)];
      return {
        vw, sw: document.documentElement.scrollWidth, bar: { left: r.left, right: r.right, width: r.width, top: r.top },
        barText: barEl.textContent, btns, barClips: barEl.scrollWidth > barEl.clientWidth + 1,
        title: (() => { const t = barEl.querySelector("strong").getBoundingClientRect(); return { w: Math.round(t.width), left: Math.round(t.left), right: Math.round(t.right) }; })(),
        barH: Math.round(r.height),
        marked: markedParents.size, markedTagged: [...markedParents].filter((e) => e.getAttribute("data-ice-target") === "text").length,
        media: media.length, mediaTagged: media.filter((e) => e.getAttribute("data-ice-target") === "media").length,
      };
    });
    check(combo, 1, "admin bar shows the page name", m.barText.includes("Strona główna aplikacji (/home)"), m.barText);
    check(combo, 1, "admin bar has „Zakończ edycję”", m.btns.some((b) => b.text === "Zakończ edycję"), m.btns);
    check(combo, 1, "every marked text carries data-ice-target=text", m.marked > 20 && m.markedTagged === m.marked, `${m.markedTagged}/${m.marked}`);
    check(combo, 1, "every registry frame carries data-ice-target=media", m.media >= 12 && m.mediaTagged === m.media, `${m.mediaTagged}/${m.media}`);
    check(combo, 1, "no horizontal page overflow", m.sw <= m.vw, `${m.sw} > ${m.vw}`);
    check(combo, 1, "every bar button is on screen (reachable)", m.btns.every((b) => b.left >= 0 && b.right <= m.vw), m.btns);
    check(combo, 1, "the bar's content fits the bar (nothing clipped)", !m.barClips, m.bar);
    check(combo, 1, "the page name is visible in the bar", m.title.w > 40 && m.title.left >= 0 && m.title.right <= m.vw, { title: m.title, barH: m.barH });
    if (vp.width >= 1440) check(combo, 1, "the bar does not span the whole width", m.bar.width < m.vw - 200, m.bar);
  });

  /* 2 ─ hover */
  if (!vp.touch) await step(2, async () => {
    const p = await textPoint(page, "#p-thumbs-title");
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(250);
    const hv = await page.evaluate(() => {
      const h = document.querySelector('div[data-ice-ui][aria-hidden="true"]');
      return h ? { box: h.getBoundingClientRect().toJSON(), label: h.textContent } : null;
    });
    await shot(page, combo, "02-hover-text");
    check(combo, 2, "hovering a marked heading shows the frame", Boolean(hv));
    if (hv) {
      const t = p.text;
      check(combo, 2, "the frame wraps exactly that text (not the whole block)",
        hv.box.left <= t.left + 0.5 && hv.box.right >= t.right - 0.5 && hv.box.top <= t.top + 0.5 && hv.box.bottom >= t.bottom - 0.5
        && hv.box.width <= t.width + 8, { frame: hv.box, text: t, block: p.box });
      check(combo, 2, "the frame's label names section · role", hv.label === "Miniaturki · Tytuł", hv.label);
    }
    const f = await boxPoint(page, '[data-config-key="homeMedia.thumbnails.1"]');
    await page.mouse.move(f.x, f.y);
    await page.waitForTimeout(250);
    const hm = await page.evaluate(() => document.querySelector('div[data-ice-ui][aria-hidden="true"]')?.textContent ?? null);
    check(combo, 2, "hovering a frame labels it", hm === "Miniaturki · Miniaturka 1", hm);
    await page.mouse.move(5, vp.height - 5);
  });

  /* 3 ─ text panel */
  await step(3, async () => {
    const sel = "#p-thumbs-title";
    const original = await rawText(page, sel);
    let p = await textPoint(page, sel);
    await press(page, vp, p);
    const dlg = sheet(page);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    if (vp.touch) check(combo, 10, "a tap on a marked heading opens its panel", true);
    check(combo, 3, "the text panel is a dialog titled by the role", (await dlg.getAttribute("aria-label")) === "Tytuł", await dlg.getAttribute("aria-label"));
    const input = dlg.locator("input:not([type])").first();
    await input.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 3, "the input holds the current (default) text", (await input.inputValue()) === "Miniaturki", await input.inputValue());
    await page.waitForTimeout(200);
    const focusedOnOpen = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}${a.getAttribute("type") ? `[type=${a.getAttribute("type")}]` : ""} "${(a.textContent || "").trim().slice(0, 20)}"` : null;
    });
    check(combo, 3, "the text field has focus once the panel has loaded (type at once)", focusedOnOpen?.startsWith("input "), focusedOnOpen);
    const cur = await dlg.evaluate((d) => [...d.querySelectorAll("p")].map((x) => x.textContent));
    check(combo, 3, "„Aktualny tekst” shows the default", cur.includes("Miniaturki"), cur);
    await phoneSheetCheck(page, vp, combo, "text panel");
    if (vp.width < 1024) {
      await page.waitForTimeout(900); // the editor scrolls the element up (smooth)
      const cover = await page.evaluate(() => {
        const h = document.querySelector("#p-thumbs-title").getBoundingClientRect();
        const s = document.querySelector('[role="dialog"][data-ice-ui]').getBoundingClientRect();
        const b = document.querySelector('[role="toolbar"][data-ice-ui]').getBoundingClientRect();
        return { headingTop: Math.round(h.top), headingBottom: Math.round(h.bottom), barBottom: Math.round(b.bottom), sheetTop: Math.round(s.top) };
      });
      check(combo, 10, "the edited heading is in view between the admin bar and the sheet (live preview visible)",
        cover.headingTop >= cover.barBottom && cover.headingBottom <= cover.sheetTop, cover);
    }
    await shot(page, combo, "03-text-open");

    // Typing character by character, the way a person does.
    await input.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" PRO", { delay: 60 });
    await page.waitForTimeout(150);
    const typed = await input.inputValue();
    const focus = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}${a.getAttribute("role") ? `[role=${a.getAttribute("role")}]` : ""} "${(a.textContent || a.value || "").trim().slice(0, 30)}"` : null;
    });
    check(combo, 3, "typing keeps focus in the field (every key lands)", typed === "Miniaturki PRO", `value ${JSON.stringify(typed)}, focus on ${focus}`);
    await shot(page, combo, "03-text-typed");

    await input.fill("Miniaturki ofert TOP");
    await page.waitForTimeout(150);
    check(combo, 3, "typing previews the heading live", (await visText(page, sel)) === "Miniaturki ofert TOP", await visText(page, sel));
    await input.fill("Miniaturki <b>");
    await page.waitForTimeout(150);
    const err = await dlg.locator("p", { hasText: "Znaki < i > są niedozwolone" }).count();
    const save = dlg.getByRole("button", { name: "Zapisz", exact: true });
    check(combo, 3, "„<b>” shows the markup error", err > 0);
    check(combo, 3, "„<b>” disables Zapisz", await save.isDisabled());
    check(combo, 3, "the page never previews markup", !(await visText(page, sel)).includes("<b>"), await visText(page, sel));
    await shot(page, combo, "03-text-markup");
    await dlg.getByRole("button", { name: "Anuluj", exact: true }).click();
    await dlg.waitFor({ state: "detached", timeout: 3000 });
    await page.waitForTimeout(SETTLE);
    check(combo, 3, "Anuluj restores the heading exactly (markers included)", (await rawText(page, sel)) === original,
      JSON.stringify(await visText(page, sel)));

    // A key painted twice (carousel name + before/after caption) previews in both.
    const twiceA = await rawText(page, "#p-tool-1");
    const twiceB = await rawText(page, "#p-ba-caption");
    p = await textPoint(page, "#p-tool-1");
    const urlBefore = page.url();
    await press(page, vp, p);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 3, "a marked name inside a link opens its panel, no navigation", page.url() === urlBefore, page.url());
    await dlg.locator("input:not([type])").first().fill("Miniaturka XL");
    await page.waitForTimeout(150);
    check(combo, 3, "one key painted twice previews in both places",
      (await visText(page, "#p-tool-1")) === "Miniaturka XL" && (await visText(page, "#p-ba-caption")) === "Miniaturka XL",
      [await visText(page, "#p-tool-1"), await visText(page, "#p-ba-caption")]);
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached", timeout: 3000 });
    await page.waitForTimeout(SETTLE);
    check(combo, 3, "Escape restores both places exactly",
      (await rawText(page, "#p-tool-1")) === twiceA && (await rawText(page, "#p-ba-caption")) === twiceB);

    // Save.
    p = await textPoint(page, sel);
    await press(page, vp, p);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.locator("input:not([type])").first().fill("Miniaturki ofert TOP");
    let from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz", exact: true }).click();
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    let saves = await callsSince(page, from, "textSave");
    check(combo, 3, "Zapisz sends ONE textSave {key, pl, value, base:null, save}",
      saves.length === 1 && JSON.stringify(saves[0].args) === JSON.stringify({ key: "sellerHome.thumbs.title", locale: "pl", value: "Miniaturki ofert TOP", base: null, action: "save" }),
      saves.map((c) => c.args));
    check(combo, 3, "after Zapisz the page shows the saved text", (await visText(page, sel)) === "Miniaturki ofert TOP", await visText(page, sel));
    const toast = await page.locator("[data-sonner-toast]", { hasText: "Zapisano" }).count();
    check(combo, 3, "a „Zapisano” toast confirms", toast > 0);
    await shot(page, combo, "03-text-saved");
    await page.waitForTimeout(SETTLE);

    // Typing the default back stores "no override" (value null).
    p = await textPoint(page, sel);
    await press(page, vp, p);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.locator("input:not([type])").first().fill("Miniaturki");
    from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz", exact: true }).click();
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    saves = await callsSince(page, from, "textSave");
    check(combo, 3, "saving the default sends value null (with the override's base)",
      saves.length === 1 && saves[0].args.value === null && typeof saves[0].args.base === "string", saves.map((c) => c.args));
    await page.waitForTimeout(SETTLE);

    // Conflict.
    await page.evaluate(() => { window.__iceConflictNext = true; });
    p = await textPoint(page, sel);
    await press(page, vp, p);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.locator("input:not([type])").first().fill("Konflikt testowy");
    from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz", exact: true }).click();
    await page.waitForTimeout(400);
    const alert = await dlg.locator('[role="alert"]').allTextContents();
    check(combo, 3, "a conflict shows its message", alert.some((a) => a.startsWith("Ktoś zmienił ten element")), alert);
    check(combo, 3, "a conflict keeps the panel open", (await dlg.count()) === 1);
    const curNow = await dlg.evaluate((d) => [...d.querySelectorAll("p")].map((x) => x.textContent));
    check(combo, 3, "after a conflict the panel shows what is there now", curNow.includes("Zmienione w międzyczasie"), curNow);
    await shot(page, combo, "03-text-conflict");
    // Saving again (knowingly) must go through with the fresh base.
    await dlg.getByRole("button", { name: "Zapisz", exact: true }).click();
    await page.waitForTimeout(400);
    const retry = await callsSince(page, from, "textSave");
    check(combo, 3, "Zapisz after a conflict succeeds with the new base",
      retry.length === 2 && typeof retry[1].args.base === "string" && (await dlg.count()) === 0, retry.map((c) => c.args));
  });

  /* 4 ─ media panel */
  await step(4, async () => {
    const f = await boxPoint(page, '[data-config-key="homeMedia.thumbnails.1"]');
    await press(page, vp, f);
    const dlg = sheet(page);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 4, "a thumbnail opens the media panel", (await dlg.getAttribute("aria-label")) === "Miniaturka 1", await dlg.getAttribute("aria-label"));
    // An error raised while a panel is open must be readable: the toast above it.
    const gif = (name) => ({ name, mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await dlg.locator('input[type="file"]').first().setInputFiles(gif("animacja.gif"));
    await page.waitForTimeout(700);
    let tt = await toastOnTop(page, "animacja.gif");
    check(combo, 4, "an upload error toast shows ABOVE the open panel", tt.toast && tt.onTop, tt);
    await shot(page, combo, "04-toast-over-sheet");
    await dlg.getByRole("button", { name: "Wybierz z biblioteki" }).first().click();
    const lib = library(page);
    await lib.waitFor({ state: "visible", timeout: 5000 });
    await lib.locator('input[type="file"]').setInputFiles(gif("biblioteka.gif"));
    await page.waitForTimeout(700);
    tt = await toastOnTop(page, "biblioteka.gif");
    check(combo, 4, "an upload error toast shows ABOVE the library modal", tt.toast && tt.onTop, tt);
    await shot(page, combo, "04-toast-over-library");
    await lib.getByRole("button", { name: /hero-dino\.webp/ }).first().click();
    await page.waitForTimeout(200);
    await shot(page, combo, "04-library");
    await lib.getByRole("button", { name: "Wybierz", exact: true }).click();
    await lib.waitFor({ state: "detached", timeout: 3000 });
    const frame = dlg.locator('[role="group"][aria-label="Kadr zdjęcia"]');
    await frame.waitFor({ state: "visible", timeout: 3000 });
    const src = await frame.locator("img").getAttribute("src");
    check(combo, 4, "the preview shows the picked file", (src ?? "").includes("hero-dino"), src);
    await phoneSheetCheck(page, vp, combo, "media panel");
    const cross = () => frame.evaluate((fr) => { const c = fr.querySelector("span"); return { left: c.style.left, top: c.style.top }; });
    const bodyTop = () => dlg.evaluate((d) => d.children[1].scrollTop);
    if (vp.touch) {
      // One finger on the frame scrolls the sheet and leaves the frame alone.
      await dlg.evaluate((d) => { d.children[1].scrollTop = 0; });
      await page.waitForTimeout(100);
      const before = await cross();
      const s0 = await bodyTop();
      const fb = await frame.boundingBox();
      await swipe(ctx, page, fb.x + fb.width / 2, fb.y + fb.height * 0.8, -160);
      await page.waitForTimeout(500);
      const after = await cross();
      const s1 = await bodyTop();
      check(combo, 4, "touch: a swipe on the crop frame scrolls the sheet", s1 > s0 + 20, { s0, s1 });
      check(combo, 4, "touch: …and leaves the crop as it was", after.left === before.left && after.top === before.top, { before, after });
    } else {
      await frame.scrollIntoViewIfNeeded();
      const before = await cross();
      const fb = await frame.boundingBox();
      const cx = fb.x + fb.width / 2;
      const cy = fb.y + fb.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 70, cy, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const after = await cross();
      check(combo, 4, "mouse: dragging the frame moves the focal point", after.left !== before.left, { before, after });
    }
    // The focal-point sliders (the way to frame a picture on a touch screen).
    await dlg.getByLabel("Poziomo", { exact: true }).focus();
    await page.keyboard.press("Home");
    await dlg.getByLabel("Pionowo", { exact: true }).focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    const sl = await cross();
    check(combo, 4, "the Poziomo/Pionowo sliders move the focal point (0% / 100%)", sl.left === "0%" && sl.top === "100%", sl);
    const zoom = dlg.locator('input[type="range"]').first();
    await zoom.focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(100);
    const zv = await zoom.getAttribute("aria-valuetext");
    // cap = 1808 / 1200 = 1.5067; the slider's 0.01 steps from 1 stop at 1.50.
    check(combo, 4, "the zoom slider zooms (End → the file's cap, 1.50×)", zv === "1.50×", zv);
    await shot(page, combo, "04-media-cropped");
    const from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz", exact: true }).click();
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    const saves = await callsSince(page, from, "slotSave");
    const w = saves[0]?.args?.writes?.[0];
    check(combo, 4, "Zapisz sends ONE slotSave with one write: the asset, crop {x:0, y:100, zoom:1.5}, base null",
      saves.length === 1 && saves[0].args.action === "save" && saves[0].args.writes.length === 1
      && w.key === "homeMedia.thumbnails.1" && w.mediaId === "a55e7000-0000-4000-8000-000000000001"
      && w.crop && w.crop.x === 0 && w.crop.y === 100 && w.crop.zoom === 1.5 && w.base === null, saves.map((c) => c.args));

    // Clear it again.
    await press(page, vp, await boxPoint(page, '[data-config-key="homeMedia.thumbnails.1"]'));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    const clearBtn = dlg.getByRole("button", { name: "Usuń przypisanie" });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('[role="dialog"][data-ice-ui] button')].find((x) => x.textContent === "Usuń przypisanie");
      return b && !b.disabled;
    }, null, { timeout: 5000 });
    const from2 = await mark(page);
    await clearBtn.click();
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    const clears = await callsSince(page, from2, "slotSave");
    check(combo, 4, "„Usuń przypisanie” (confirmed) sends slotSave action clear, mediaId null, base = last save",
      clears.length === 1 && clears[0].args.action === "clear" && clears[0].args.writes[0].mediaId === null
      && typeof clears[0].args.writes[0].base === "string", clears.map((c) => c.args));
  });

  /* 5 ─ pair panel */
  await step(5, async () => {
    await press(page, vp, await boxPoint(page, '[data-ba-card="ba1"] [data-before-after]'));
    const dlg = sheet(page);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 5, "the before/after card opens the pair panel", (await dlg.getAttribute("aria-label")) === "Edytuj porównanie", await dlg.getAttribute("aria-label"));
    const pick = async (side, title) => {
      await dlg.locator(`section[aria-label="${side}"]`).getByRole("button", { name: "Wybierz z biblioteki" }).click();
      const lib = library(page);
      await lib.waitFor({ state: "visible", timeout: 5000 });
      await lib.getByRole("button", { name: new RegExp(title.replace(".", "\\.")) }).first().click();
      await lib.getByRole("button", { name: "Wybierz", exact: true }).click();
      await lib.waitFor({ state: "detached", timeout: 3000 });
    };
    await pick("Przed", "ecommerce-packshot.webp");
    await pick("Po", "grovshot-studio.webp");
    await page.waitForTimeout(150);
    await phoneSheetCheck(page, vp, combo, "pair panel");
    if (vp.touch) {
      const fr = dlg.locator('[role="group"][aria-label="Kadr: Przed"]');
      await fr.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const s0 = await dlg.evaluate((d) => d.children[1].scrollTop);
      const c0 = await fr.evaluate((f) => f.querySelector("span").style.top);
      const fb = await fr.boundingBox();
      await swipe(ctx, page, fb.x + fb.width / 2, fb.y + fb.height * 0.75, -160);
      await page.waitForTimeout(500);
      const s1 = await dlg.evaluate((d) => d.children[1].scrollTop);
      const c1 = await fr.evaluate((f) => f.querySelector("span").style.top);
      check(combo, 5, "touch: a swipe on a pair crop frame scrolls the sheet, the crop stays", s1 > s0 + 20 && c1 === c0, { s0, s1, c0, c1 });
    }
    await shot(page, combo, "05-pair");
    // First save: somebody else wrote "before" meanwhile → conflict, nothing saved.
    await page.evaluate(() => { window.__iceConflictNext = true; });
    const from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz parę" }).click();
    await page.waitForTimeout(500);
    const alert = await dlg.locator('[role="alert"]').allTextContents();
    check(combo, 5, "a pair conflict is shown and keeps the panel (and both picks) open",
      (await dlg.count()) === 1 && alert.some((a) => a.startsWith("Ktoś zmienił")), alert);
    await dlg.getByRole("button", { name: "Zapisz parę" }).click();
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    const saves = await callsSince(page, from, "slotSave");
    const ws = saves[1]?.args?.writes ?? [];
    check(combo, 5, "„Zapisz parę” sends ONE slotSave with both halves (retry after the conflict, fresh base)",
      saves.length === 2 && ws.length === 2 && ws[0].key === "homeMedia.beforeAfter.1.before" && ws[1].key === "homeMedia.beforeAfter.1.after"
      && ws[0].mediaId === "a55e7000-0000-4000-8000-000000000002" && ws[1].mediaId === "a55e7000-0000-4000-8000-000000000005"
      && typeof ws[0].base === "string" && ws[1].base === null,
      saves.map((c) => c.args));
  });

  /* 6 ─ samples */
  await step(6, async () => {
    await press(page, vp, await boxPoint(page, '[data-sample="homeMedia.upload.thumbnail.sample.1"]'));
    const dlg = sheet(page);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 6, "a sample opens the samples panel", (await dlg.getAttribute("aria-label")) === "Przykładowe zdjęcia", await dlg.getAttribute("aria-label"));
    // The tiles render before the states arrive; "Wypełnione: n z 5" says they did.
    await page.waitForFunction(() => /Wypełnione: \d+ z 5/.test(document.querySelector('[role="dialog"][data-ice-ui]')?.textContent ?? ""), null, { timeout: 5000 });
    const tiles = await dlg.locator('button[aria-label^="Przykład "]').evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
    check(combo, 6, "five sample slots (1 filled, 4 empty)", tiles.length === 5 && tiles[0] === "Przykład 1: Zmień" && tiles.slice(1).every((x) => x.endsWith(": Dodaj")), tiles);
    await phoneSheetCheck(page, vp, combo, "samples panel");
    await shot(page, combo, "06-samples");
    await dlg.getByRole("button", { name: "Przykład 2: Dodaj" }).click();
    await page.waitForTimeout(250);
    check(combo, 6, "opening one shows its media panel with a way back",
      (await sheet(page).getAttribute("aria-label")) === "Przykład 2" && (await sheet(page).getByRole("button", { name: "Wróć do przykładów" }).count()) === 1,
      await sheet(page).getAttribute("aria-label"));
    await sheet(page).getByRole("button", { name: "Wróć do przykładów" }).click();
    await page.waitForTimeout(250);
    check(combo, 6, "„Wróć do przykładów” returns to the grid", (await sheet(page).getAttribute("aria-label")) === "Przykładowe zdjęcia");
  });

  /* 7 ─ bulk */
  await step(7, async () => {
    const openGroup = async (label) => {
      await bar(page).getByRole("button", { name: "Wgraj wiele" }).click();
      const dlg = sheet(page);
      await dlg.waitFor({ state: "visible", timeout: 5000 });
      await dlg.getByRole("button", { name: new RegExp("^" + label) }).first().click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"][data-ice-ui]')?.getAttribute("aria-label") === "Wgraj wiele", null, { timeout: 5000 });
      await page.waitForFunction(() => !document.querySelector('[role="dialog"][data-ice-ui] [aria-busy="true"]'), null, { timeout: 5000 });
      return dlg;
    };
    let dlg = await openGroup("Miniaturki");
    const [a, b, c] = await Promise.all([png({ r: 220, g: 40, b: 90 }), png({ r: 40, g: 160, b: 90 }), png({ r: 40, g: 90, b: 220 })]);
    await dlg.locator('input[type="file"][multiple]').setInputFiles([
      { name: "img-10.png", mimeType: "image/png", buffer: a },
      { name: "img-2.png", mimeType: "image/png", buffer: b },
      { name: "img-1.png", mimeType: "image/png", buffer: c },
    ]);
    await page.waitForTimeout(500);
    const rows = await dlg.locator("ol > li").evaluateAll((lis) => lis.map((li) => ({
      name: li.querySelector("p")?.textContent ?? "",
      target: [...li.querySelectorAll("span")].map((s) => s.textContent).find((t) => t.startsWith("→")) ?? null,
    })));
    check(combo, 7, "3 files listed in natural order, assigned to the empty thumbnails (3 is taken)",
      JSON.stringify(rows) === JSON.stringify([
        { name: "1. img-1.png", target: "→ Miniaturka 1" }, { name: "2. img-2.png", target: "→ Miniaturka 2" }, { name: "3. img-10.png", target: "→ Miniaturka 4" },
      ]), rows);
    await phoneSheetCheck(page, vp, combo, "bulk panel");
    await shot(page, combo, "07-bulk-plan");
    let from = await mark(page);
    await dlg.getByRole("button", { name: "Wgraj i przypisz (3)" }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][data-ice-ui]'), null, { timeout: 15000 });
    let since = await callsSince(page, from);
    const puts = since.filter((x) => x.method === "putFile");
    const regs = since.filter((x) => x.method === "registerUpload:result");
    const bulk = since.filter((x) => x.method === "slotSave");
    const putIdx = since.findIndex((x) => x.method === "slotSave");
    const lastPut = since.map((x) => x.method).lastIndexOf("putFile");
    const id = (t) => regs.find((r) => r.args.title === t)?.args.id;
    check(combo, 7, "putFile ×3 and registerUpload ×3 (in natural order)",
      puts.length === 3 && regs.length === 3 && regs.map((r) => r.args.title).join() === "img-1.png,img-2.png,img-10.png", since.map((x) => x.method));
    check(combo, 7, "then ONE slotSave action bulk with 3 writes to thumbnails 1, 2, 4",
      bulk.length === 1 && putIdx > lastPut && bulk[0].args.action === "bulk" && bulk[0].args.writes.length === 3
      && bulk[0].args.writes.map((w) => w.key).join() === "homeMedia.thumbnails.1,homeMedia.thumbnails.2,homeMedia.thumbnails.4"
      && bulk[0].args.writes.map((w) => w.mediaId).join() === [id("img-1.png"), id("img-2.png"), id("img-10.png")].join(),
      bulk.map((x) => x.args));

    // Pairs.
    dlg = await openGroup("Przed / Po");
    await dlg.locator('input[type="file"][multiple]').setInputFiles([
      { name: "buty-przed.png", mimeType: "image/png", buffer: await png({ r: 120, g: 80, b: 40 }, 1080, 1080) },
      { name: "buty-po.png", mimeType: "image/png", buffer: await png({ r: 250, g: 250, b: 250 }, 1080, 1080) },
      { name: "torba-przed.png", mimeType: "image/png", buffer: await png({ r: 30, g: 30, b: 30 }, 1080, 1080) },
    ]);
    await page.waitForTimeout(500);
    const pairRows = await dlg.locator("ol > li").evaluateAll((lis) => lis.map((li) => ({
      name: li.querySelector("p")?.textContent ?? "",
      target: [...li.querySelectorAll("span")].map((s) => s.textContent).find((t) => t.startsWith("→")) ?? null,
    })));
    const problems = await dlg.locator("li", { hasText: "torba-przed.png" }).allTextContents();
    check(combo, 7, "one complete pair (buty) → the first EMPTY pair (Porównanie 2; 1 was saved in check 5)",
      pairRows.length === 1 && pairRows[0].name === "1. buty" && pairRows[0].target === "→ Porównanie 2", pairRows);
    check(combo, 7, "the incomplete one (torba) is flagged „brak pliku „po””",
      problems.some((t) => t.includes("brak pliku „po” do pary „torba”")), problems);
    await shot(page, combo, "07-bulk-pairs");
    from = await mark(page);
    await dlg.getByRole("button", { name: "Wgraj i przypisz (2)" }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][data-ice-ui]'), null, { timeout: 15000 });
    since = await callsSince(page, from);
    const pb = since.filter((x) => x.method === "slotSave");
    const pregs = since.filter((x) => x.method === "registerUpload:result");
    const pid = (t) => pregs.find((r) => r.args.title === t)?.args.id;
    check(combo, 7, "pairs: putFile ×2 (torba not uploaded), ONE slotSave bulk with before+after",
      since.filter((x) => x.method === "putFile").length === 2 && pb.length === 1 && pb[0].args.action === "bulk"
      && pb[0].args.writes.map((w) => w.key).join() === "homeMedia.beforeAfter.2.before,homeMedia.beforeAfter.2.after"
      && pb[0].args.writes.map((w) => w.mediaId).join() === [pid("buty-przed.png"), pid("buty-po.png")].join(),
      { methods: since.map((x) => x.method), writes: pb.map((x) => x.args) });
  });

  /* 8 ─ links, forms, plain buttons */
  await step(8, async () => {
    const url = page.url();
    await page.waitForTimeout(2700); // the link toast is rate-limited to one per 2.5 s
    await press(page, vp, await textPoint(page, "#p-plain-link"));
    await page.waitForTimeout(500);
    check(combo, 8, "a plain link does not navigate", page.url() === url, page.url());
    const toasts = await page.locator("[data-sonner-toast]", { hasText: "są wstrzymane" }).count();
    check(combo, 8, "…and says why (toast)", toasts > 0);
    await shot(page, combo, "08-link-toast");
    await press(page, vp, await boxPoint(page, "#p-submit"));
    await page.waitForTimeout(500);
    check(combo, 8, "a form submit is blocked", page.url() === url, page.url());
    await page.locator("#p-input").click();
    await page.keyboard.type("abc");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check(combo, 8, "Enter in a form field is blocked too", page.url() === url, page.url());
    // A plain page button is held, with the same toast (rate-limited to 2.5 s).
    await page.waitForTimeout(2700);
    const toastsBefore = await page.locator("[data-sonner-toast]", { hasText: "są wstrzymane" }).count();
    const p0 = await page.locator("#p-plain-count").textContent();
    await press(page, vp, await boxPoint(page, "#p-plain-btn"));
    await page.waitForTimeout(500);
    const toastsAfter = await page.locator("[data-sonner-toast]", { hasText: "są wstrzymane" }).count();
    check(combo, 8, "a plain page button is held (its handler does not run)", (await page.locator("#p-plain-count").textContent()) === p0 && page.url() === url);
    check(combo, 8, "…with the „są wstrzymane” toast", toastsAfter > toastsBefore || toastsAfter > 0, { toastsBefore, toastsAfter });
    // View controls keep working.
    const n0 = await page.locator("#p-count").textContent();
    await press(page, vp, await boxPoint(page, "#p-next"));
    await page.waitForTimeout(200);
    check(combo, 8, "a carousel arrow (data-rail-next) keeps working (counter +1)", Number(await page.locator("#p-count").textContent()) === Number(n0) + 1);
    await press(page, vp, await boxPoint(page, "#p-tab-b"));
    await page.waitForTimeout(200);
    check(combo, 8, "a role=tab button keeps working", (await page.locator("#p-tab-b").getAttribute("aria-selected")) === "true"
      && (await page.locator("#p-tab-a").getAttribute("aria-selected")) === "false");
    await press(page, vp, await boxPoint(page, "#p-toggle"));
    await page.waitForTimeout(200);
    check(combo, 8, "an aria-pressed toggle keeps working", (await page.locator("#p-toggle").getAttribute("aria-pressed")) === "true");
    // The icon inside an outlined button opens that button's text.
    await press(page, vp, await boxPoint(page, "#p-icon-svg"));
    await page.waitForTimeout(500);
    const iconOpened = (await sheet(page).count()) ? await sheet(page).getAttribute("aria-label") : null;
    const iconCrumbs = iconOpened ? await sheet(page).locator("p").first().textContent() : null;
    check(combo, 8, "a press on the icon inside an outlined button opens its text panel",
      iconOpened === "Przycisk" && (iconCrumbs ?? "").includes("Wgraj zdjęcie") && page.url() === url, { iconOpened, iconCrumbs });
    await closeAll(page);
    await page.waitForTimeout(SETTLE);
    // The dock's links are held as well — also with an editable element under the tab.
    if (vp.width < 1024) {
      for (const [sel, what] of [['[data-ba-card="ba1"] [data-before-after]', "the before/after card"], ["#p-thumbs-title", "a marked heading"]]) {
        const pos = await page.evaluate((s) => {
          const el = document.querySelector(s);
          const tab = document.querySelector('nav[aria-label="Dock (probe)"] a');
          const r = el.getBoundingClientRect();
          const t = tab.getBoundingClientRect();
          window.scrollBy(0, r.top + Math.min(r.height / 2, 14) - (t.top + t.height / 2));
          const t2 = tab.getBoundingClientRect();
          const x = t2.left + t2.width / 2;
          const y = t2.top + t2.height / 2;
          return { x, y, under: document.elementsFromPoint(x, y).some((e) => e === el || el.contains(e)) };
        }, sel);
        await press(page, vp, pos);
        await page.waitForTimeout(400);
        const opened = (await sheet(page).count()) ? await sheet(page).getAttribute("aria-label") : null;
        check(combo, 8, `a tap on a dock link over ${what} is held (no panel, no navigation)`, pos.under && opened === null && page.url() === url,
          { underTab: pos.under, opened, url: page.url() });
        await closeAll(page);
        await page.waitForTimeout(SETTLE);
      }
    }
    // Cards covered by a transparent full-size link: the marked text still opens.
    for (const i of [1, 2]) {
      await press(page, vp, await textPoint(page, `#p-feat-${i}`));
      await page.waitForTimeout(400);
      const opened = (await sheet(page).count()) ? await sheet(page).getAttribute("aria-label") : null;
      check(combo, 8, `card under a full-size link overlay (${i === 1 ? "later in the DOM" : "z-index"}): its marked name opens`,
        opened === `Nazwa narzędzia ${i}` && page.url() === url, { opened, url: page.url() });
      await closeAll(page);
      await page.waitForTimeout(SETTLE);
      const pad = await page.evaluate((s) => {
        const c = document.querySelector(s);
        c.scrollIntoView({ block: "center" });
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.bottom - 16 };
      }, `[data-p-overlay-card="${i}"]`);
      await press(page, vp, pad);
      await page.waitForTimeout(400);
      check(combo, 8, `…a press elsewhere on that card is held (no panel, no navigation)`, (await sheet(page).count()) === 0 && page.url() === url, page.url());
      await closeAll(page);
    }
    // A marked heading inside a position:sticky box (pinnedBox treats it as a
    // bar of its own). The fixed-bar case is the CMS run's ?fixedcta=1.
    for (const stuck of [false]) {
      const pt = await page.evaluate((stuck) => {
        const h = document.querySelector("#p-sessions-title");
        h.parentElement.scrollIntoView({ block: "center" });
        // Natural top 100px → stuck at 150px (below the admin bar on every width).
        if (stuck) window.scrollBy(0, h.getBoundingClientRect().top - 100);
        const r = document.createRange();
        r.selectNodeContents(h.firstChild);
        const t = r.getClientRects()[0];
        return { x: t.left + Math.min(20, t.width / 2), y: t.top + t.height / 2, top: Math.round(h.getBoundingClientRect().top) };
      }, stuck);
      await press(page, vp, pt);
      await page.waitForTimeout(400);
      const opened = (await sheet(page).count()) ? await sheet(page).getAttribute("aria-label") : null;
      const crumbs = opened ? await sheet(page).locator("p").first().textContent() : null;
      check(combo, 8, `a marked heading in a sticky box opens (${stuck ? "stuck at 150px" : "at rest"})`,
        opened === "Tytuł" && (crumbs ?? "").includes("Sesje zdjęciowe") && (!stuck || Math.abs(pt.top - 150) <= 2), { opened, crumbs, top: pt.top });
      await closeAll(page);
      await page.waitForTimeout(SETTLE);
    }
    // Pressing beside a heading, inside its dashed outline.
    const g = await textPoint(page, "#p-soon-title");
    const inOutline = { x: Math.min(g.box.right - 12, g.text.right + 60), y: g.text.top + g.text.height / 2 };
    if (inOutline.x > g.text.right + 4) {
      await press(page, vp, inOutline);
      await page.waitForTimeout(300);
      const opened = await sheet(page).count() ? await sheet(page).getAttribute("aria-label") : null;
      check(combo, 8, "a press inside a heading's dashed outline (beside the words) opens it", opened === "Tytuł",
        { opened, outline: g.box, text: g.text, pressedAt: inOutline });
      await closeAll(page);
    }
  });

  /* 9 ─ Elementy / Historia / Escape */
  await step(9, async () => {
    await bar(page).getByRole("button", { name: "Elementy" }).click();
    const dlg = sheet(page);
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 9, "„Elementy” opens the list", (await dlg.getAttribute("aria-label")) === "Elementy strony");
    const sections = await dlg.evaluate((d) => [...d.querySelectorAll(":scope > div:nth-child(2) > div > span:first-child")].map((s) => s.textContent));
    check(combo, 9, "the list is grouped by section", ["Karuzela narzędzi", "Przed / Po", "Miniaturki", "Nadchodzi"].every((x) => sections.includes(x)), sections);
    await phoneSheetCheck(page, vp, combo, "elements panel");
    await shot(page, combo, "09-elements");
    const group = dlg.locator("div", { has: page.locator("span", { hasText: /^Miniaturki$/ }) }).last();
    await group.getByRole("button", { name: /^Tytuł/ }).first().click();
    await page.waitForTimeout(300);
    check(combo, 9, "picking an element opens its panel",
      (await sheet(page).getAttribute("aria-label")) === "Tytuł" && (await sheet(page).locator("p", { hasText: "Miniaturki" }).count()) > 0,
      await sheet(page).getAttribute("aria-label"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check(combo, 9, "Escape closes the panel", (await sheet(page).count()) === 0);
    await bar(page).getByRole("button", { name: "Historia zmian" }).click();
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(300);
    const items = await dlg.locator("li").count();
    const labels = await dlg.locator("li strong").allTextContents();
    check(combo, 9, "„Historia zmian” lists the page's versions", (await dlg.getAttribute("aria-label")) === "Historia zmian strony" && items >= 8, { items, labels });
    await shot(page, combo, "09-history");
    await dlg.getByRole("button", { name: "Otwórz element" }).first().click();
    await page.waitForTimeout(300);
    check(combo, 9, "„Otwórz element” opens the newest version's element", (await sheet(page).count()) === 1, await sheet(page).getAttribute("aria-label"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check(combo, 9, "Escape closes it", (await sheet(page).count()) === 0);
  });

  /* 10 ─ the page's LAST section on a bottom sheet: the page cannot scroll it up */
  if (vp.width < 1024) await step(10, async () => {
    await press(page, vp, await textPoint(page, "#p-soon-title"));
    await sheet(page).waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(900);
    const g = await page.evaluate(() => {
      const h = document.querySelector("#p-soon-title").getBoundingClientRect();
      const sh = document.querySelector('[role="dialog"][data-ice-ui]').getBoundingClientRect();
      const b = document.querySelector('[role="toolbar"][data-ice-ui]').getBoundingClientRect();
      return { headingTop: Math.round(h.top), headingBottom: Math.round(h.bottom), barBottom: Math.round(b.bottom), sheetTop: Math.round(sh.top),
        atPageEnd: Math.abs(scrollY - (document.documentElement.scrollHeight - innerHeight)) < 2 };
    });
    await shot(page, combo, "10-last-section");
    check(combo, 10, "the LAST section's heading is in view above the sheet (live preview visible)", g.headingTop >= g.barBottom && g.headingBottom <= g.sheetTop, g);
  });

  /* 3b ─ a panel opened right after another closed (inside the editor's 200 ms
          re-scan debounce) must still preview on the right characters */
  await step("3b", async () => {
    const sel = "#p-promo-title";
    const dlg = sheet(page);
    const before = await rawText(page, sel);
    await press(page, vp, await textPoint(page, sel));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.locator("input:not([type])").first().fill("Krótko");
    await page.waitForTimeout(SETTLE);                 // the editor re-scans while the preview shows
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached", timeout: 3000 });
    await page.waitForTimeout(60);                     // re-open inside the debounce
    await press(page, vp, await textPoint(page, sel));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.locator("input:not([type])").first().fill("Nowy baner");
    await page.waitForTimeout(150);
    const shown = await visText(page, sel);
    check(combo, "3b", "the live preview shows exactly the typed text", shown === "Nowy baner", JSON.stringify(shown));
    await page.waitForTimeout(SETTLE);
    const tagged = await page.evaluate((s) => document.querySelector(s).getAttribute("data-ice-target"), sel);
    const markerOk = await page.evaluate((s) => {
      const t = document.querySelector(s).textContent;
      const at = t.indexOf("\u2060\u200d\u2060");
      const end = t.indexOf("\u2060\u200c\u2060", at + 3);
      return at >= 0 && end > at && (end - at - 3) % 7 === 0;
    }, sel);
    check(combo, "3b", "the element keeps its marker (stays editable) while previewing", markerOk && tagged === "text", { markerOk, tagged });
    await dlg.getByRole("button", { name: "Anuluj", exact: true }).click();
    await page.waitForTimeout(SETTLE);
    check(combo, "3b", "Anuluj puts the heading back exactly", (await rawText(page, sel)) === before, JSON.stringify(await visText(page, sel)));

    // Another element pressed while a preview shows: the first is put back,
    // the second opens and previews on the right characters.
    const baT = await rawText(page, "#p-ba-title");
    const baS = await rawText(page, "#p-ba-sub");
    await press(page, vp, await textPoint(page, "#p-ba-title"));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.locator("input:not([type])").first().fill("Przed / po XYZ");
    await page.waitForTimeout(SETTLE);
    const subPt = await textPoint(page, "#p-ba-sub");
    await press(page, vp, subPt);
    await page.waitForTimeout(500);
    const now = await dlg.getAttribute("aria-label").catch(() => null);
    check(combo, "3b", "pressing another element while previewing: the first is put back exactly, the second opens",
      (await rawText(page, "#p-ba-title")) === baT && now === "Podtytuł", { title: await visText(page, "#p-ba-title"), panel: now, pressedAt: subPt });
    await dlg.locator("input:not([type])").first().fill("Nowy podtytuł");
    await page.waitForTimeout(150);
    check(combo, "3b", "…and the second previews exactly", (await visText(page, "#p-ba-sub")) === "Nowy podtytuł", await visText(page, "#p-ba-sub"));
    // The same element pressed again while it previews.
    await page.waitForTimeout(SETTLE);
    await press(page, vp, await textPoint(page, "#p-ba-sub"));
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(SETTLE);
    check(combo, "3b", "pressing the same element again, then Esc, leaves it exactly as it was",
      (await rawText(page, "#p-ba-sub")) === baS && (await sheet(page).count()) === 0, JSON.stringify(await visText(page, "#p-ba-sub")));
  });

  /* 12 ─ leave */
  await step(12, async () => {
    const from = await mark(page);
    await bar(page).getByRole("button", { name: "Zakończ edycję" }).click();
    await page.waitForTimeout(600);
    const s = await callsSince(page, from, "setEdit");
    check(combo, 12, "„Zakończ edycję” calls setEdit(false, \"/home\")", s.length === 1 && JSON.stringify(s[0].args) === JSON.stringify([false, "/home"]), s);
  });

  await ctx.close();
}

/* ── the CMS harness ───────────────────────────────────────────────────── */

async function runCms(vp, theme) {
  const combo = `${vp.name}-${theme}`;
  const { ctx, page } = await newPage(vp, theme);
  wireConsole(page, combo);
  note(combo, 11);
  try {
    await page.goto(`${BASE}/probe-tmp/ice?mode=cms&conflict=1`, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-ice-target]").length >= 5, null, { timeout: 30000 });
    await shot(page, combo, "11-cms");
    const dlg = sheet(page);
    const HERO = "a1b2c3d4-1111-4111-8111-111111111111";

    // Hero title, first save → conflict (?conflict=1).
    await press(page, vp, await textPoint(page, "#c-hero-title"));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 11, "the hero title opens the CMS text panel", (await dlg.getAttribute("aria-label")) === "Sekcja główna · Tytuł", await dlg.getAttribute("aria-label"));
    const input = dlg.locator("input:not([type])").first();
    check(combo, 11, "it holds the published value", (await input.inputValue()) === "Zdjęcia produktowe w minutę", await input.inputValue());
    await input.click();
    await page.keyboard.press("End");
    await page.keyboard.type("!!", { delay: 60 });
    const typed = await input.inputValue();
    check(combo, 11, "typing keeps focus in the CMS field", typed === "Zdjęcia produktowe w minutę!!", JSON.stringify(typed));
    await input.fill("Zdjęcia produktowe w 60 sekund");
    await page.waitForTimeout(150);
    check(combo, 11, "the hero title previews live", (await visText(page, "#c-hero-title")) === "Zdjęcia produktowe w 60 sekund", await visText(page, "#c-hero-title"));
    let from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz i opublikuj" }).click();
    await page.waitForTimeout(500);
    let saves = await callsSince(page, from, "cmsSave");
    check(combo, 11, "cmsSave {blockId, path [title], pl, expected = old value, base}",
      saves.length >= 1 && JSON.stringify(saves[0].args) === JSON.stringify({
        blockId: HERO, path: ["title"], locale: "pl", value: "Zdjęcia produktowe w 60 sekund",
        expected: "Zdjęcia produktowe w minutę", base: "2026-01-01T00:00:00.000Z", action: "save",
      }), saves.map((c) => c.args));
    const alert = await dlg.locator('[role="alert"]').allTextContents();
    check(combo, 11, "?conflict=1: the first save answers conflict, the panel says so and stays",
      (await dlg.count()) === 1 && alert.some((a) => a.startsWith("Ktoś zmienił")), alert);
    await shot(page, combo, "11-cms-conflict");
    const shownAfterConflict = await dlg.evaluate((d) => [...d.querySelectorAll("p")].map((x) => x.textContent));
    check(combo, 11, "after the conflict the panel shows the value that is there now",
      shownAfterConflict.includes("Zmienione w międzyczasie"), shownAfterConflict);
    from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz i opublikuj" }).click();
    await page.waitForTimeout(600);
    saves = await callsSince(page, from, "cmsSave");
    check(combo, 11, "saving again after the conflict goes through (fresh expected + base)",
      (await dlg.count()) === 0 && saves.length === 1, { open: await dlg.count(), sent: saves.map((c) => c.args) });
    await closeAll(page);

    // A clean save of another field of the same block.
    await press(page, vp, await textPoint(page, "#c-hero-sub"));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.locator("input:not([type]), textarea").first().fill("Jedno zdjęcie wystarczy.");
    from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz i opublikuj" }).click();
    await page.waitForTimeout(500);
    saves = await callsSince(page, from, "cmsSave");
    check(combo, 11, "subtitle: cmsSave path [subtitle] closes the panel",
      saves.length === 1 && saves[0].args.path.join() === "subtitle" && saves[0].args.expected === "Wgraj jedno zdjęcie — resztę zrobi GrovBase." && (await dlg.count()) === 0,
      saves.map((c) => c.args));
    await closeAll(page);
    await page.waitForTimeout(SETTLE);
    // "Cofnij ostatnią zmianę" while that change is what the page shows.
    await press(page, vp, await textPoint(page, "#c-hero-sub"));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(400);
    const undo = dlg.getByRole("button", { name: "Cofnij ostatnią zmianę" });
    const hasUndo = (await undo.count()) === 1;
    check(combo, 11, "CMS undo is offered while the last change is live", hasUndo);
    if (hasUndo) {
      from = await mark(page);
      await undo.click();
      await page.waitForTimeout(500);
      saves = await callsSince(page, from, "cmsSave");
      check(combo, 11, "CMS undo restores the previous value (action restore, expected = live)",
        saves.length === 1 && saves[0].args.action === "restore" && saves[0].args.value === "Wgraj jedno zdjęcie — resztę zrobi GrovBase."
        && saves[0].args.expected === "Jedno zdjęcie wystarczy.", saves.map((c) => c.args));
    }
    await closeAll(page);

    // Two paragraphs, one field.
    await press(page, vp, await textPoint(page, "#c-par-1"));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    const t1 = await dlg.getAttribute("aria-label");
    const v1 = await dlg.locator("textarea").inputValue().catch(() => null);
    await phoneSheetCheck(page, vp, combo, "CMS text panel");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await press(page, vp, await textPoint(page, "#c-par-2"));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    const t2 = await dlg.getAttribute("aria-label");
    check(combo, 11, "both paragraphs of the description open the same field",
      t1 === "Tekst · Opis" && t2 === t1 && v1 === "Pierwszy akapit: zdjęcia gotowe na marketplace.\n\nDrugi akapit: bez studia i bez fotografa.", { t1, t2, v1 });
    const parTagged = await page.evaluate(() => ["#c-par-1", "#c-par-2"].map((s) => document.querySelector(s)?.getAttribute("data-ice-target")));
    check(combo, 11, "both paragraphs are outlined", parTagged.every((x) => x === "text"), parTagged);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // The media block's picture.
    await press(page, vp, await boxPoint(page, "#c-media-img"));
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    check(combo, 11, "the media block's image opens the CMS media panel", (await dlg.getAttribute("aria-label")) === "Obraz · Obraz", await dlg.getAttribute("aria-label"));
    check(combo, 11, "…showing the published file", ((await dlg.locator("img").first().getAttribute("src")) ?? "").includes("moda-ghost"));
    await dlg.getByRole("button", { name: "Wybierz z biblioteki" }).click();
    const lib = library(page);
    await lib.waitFor({ state: "visible", timeout: 5000 });
    await lib.getByRole("button", { name: /app-icon\.png/ }).first().click();
    await lib.getByRole("button", { name: "Wybierz", exact: true }).click();
    await lib.waitFor({ state: "detached", timeout: 3000 });
    await shot(page, combo, "11-cms-media");
    await phoneSheetCheck(page, vp, combo, "CMS media panel");
    from = await mark(page);
    await dlg.getByRole("button", { name: "Zapisz i opublikuj" }).click();
    await page.waitForTimeout(500);
    saves = await callsSince(page, from, "cmsSave");
    check(combo, 11, "media: cmsSave path [mediaUrl], locale null, expected = the published URL",
      saves.length === 1 && saves[0].args.path.join() === "mediaUrl" && saves[0].args.locale === null
      && saves[0].args.expected === "/showcase/moda-ghost.webp" && saves[0].args.value === "/brand/app-icon.png", saves.map((c) => c.args));
    await closeAll(page);

    // Elementy lists the CMS fields by block.
    await bar(page).getByRole("button", { name: "Elementy" }).click();
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    const labels = await dlg.locator("li button > span:first-child").allTextContents();
    check(combo, 11, "Elementy lists the CMS fields", labels.includes("Sekcja główna · Tytuł") && labels.includes("Tekst · Opis") && labels.includes("Obraz · Obraz"), labels);
    await closeAll(page);
    await bar(page).getByRole("button", { name: "Historia zmian" }).click();
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(300);
    const hist = await dlg.locator("li strong").allTextContents();
    check(combo, 11, "Historia zmian names the CMS fields it lists", hist.length >= 3 && hist.every((h) => !h.includes(":")), hist);
    await closeAll(page);
  } catch (e) {
    check(combo, 11, "CMS run threw", false, String(e?.message ?? e).split("\n")[0]);
    await shot(page, combo, "err-11");
  }
  await ctx.close();

  // A fixed bar with editable copy (a sticky_cta block) over the page.
  const second = await newPage(vp, theme);
  wireConsole(second.page, combo);
  try {
    const pg = second.page;
    const dlg = sheet(pg);
    await pg.goto(`${BASE}/probe-tmp/ice?mode=cms&fixedcta=1`, { waitUntil: "networkidle", timeout: 120000 });
    await pg.waitForFunction(() => document.querySelectorAll("[data-ice-target]").length >= 6, null, { timeout: 30000 });
    const tp = await pg.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector("#c-fixed-title").firstChild);
      const q = r.getClientRects()[0];
      return { x: q.left + Math.min(20, q.width / 2), y: q.top + q.height / 2 };
    });
    await press(pg, vp, tp);
    await pg.waitForTimeout(500);
    check(combo, 11, "fixed bar: its marked title opens", (await dlg.count() ? await dlg.getAttribute("aria-label") : null) === "Przypięte wezwanie · Tytuł",
      await dlg.getAttribute("aria-label").catch(() => null));
    await closeAll(pg);
    await pg.waitForTimeout(SETTLE);
    // Scroll a marked heading under the bar's empty middle, then press there.
    const gp = await pg.evaluate(() => {
      const gap = document.querySelector("#c-fixed-gap").getBoundingClientRect();
      const h = document.querySelector("#c-text-title");
      const r = document.createRange();
      r.selectNodeContents(h.firstChild);
      const q = r.getClientRects()[0];
      window.scrollBy(0, q.top + q.height / 2 - (gap.top + gap.height / 2));
      const q2 = r.getClientRects()[0];
      const x = Math.max(gap.left + 4, Math.min(q2.left + q2.width / 2, gap.right - 4));
      const y = gap.top + gap.height / 2;
      return { x, y, under: document.elementsFromPoint(x, y).some((e) => e === h) };
    });
    await press(pg, vp, gp);
    await pg.waitForTimeout(500);
    check(combo, 11, "fixed bar: a press on its empty part does not open the heading underneath",
      gp.under && (await dlg.count()) === 0, { headingUnderBar: gp.under, opened: await dlg.getAttribute("aria-label").catch(() => null) });
    await shot(pg, combo, "11-cms-fixed-bar");
  } catch (e) {
    check(combo, 11, "CMS fixed-bar run threw", false, String(e?.message ?? e).split("\n")[0]);
  }
  await second.ctx.close();
}

/* ── the launcher ──────────────────────────────────────────────────────── */

async function runLauncher(vp, theme) {
  const combo = `${vp.name}-${theme}`;
  const { ctx, page } = await newPage(vp, theme);
  wireConsole(page, combo);
  note(combo, "L");
  try {
    await page.goto(`${BASE}/probe-tmp/ice/launcher`, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const b = document.querySelector("[data-ice-launch]");
      const dock = document.querySelector(".dock");
      const r = b?.getBoundingClientRect();
      const d = dock?.getBoundingClientRect();
      return {
        text: b?.textContent ?? null, vw: document.documentElement.clientWidth, vh: innerHeight,
        btn: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null,
        dock: d && d.height > 0 ? { top: d.top, bottom: d.bottom, left: d.left, right: d.right } : null,
      };
    });
    await shot(page, combo, "L-launcher");
    check(combo, "L", "„Edytuj stronę” is visible", m.text === "Edytuj stronę" && m.btn !== null, m);
    if (m.btn) {
      check(combo, "L", "bottom-right, 16px from the right", Math.abs(m.vw - m.btn.right - 16) <= 1, m);
      if (m.dock) {
        check(combo, "L", "does not overlap the dock", m.btn.bottom <= m.dock.top - 4, m);
      } else {
        check(combo, "L", "~16px from the bottom when there is no dock", Math.abs(m.vh - m.btn.bottom - 16) <= 1, m);
      }
    }
  } catch (e) {
    check(combo, "L", "launcher run threw", false, String(e?.message ?? e).split("\n")[0]);
  }
  await ctx.close();
}

/* ── go ───────────────────────────────────────────────────────────────── */

// Warm the routes (dev compiles on first hit).
{
  const { ctx, page } = await newPage(VIEWPORTS[0], "dark");
  for (const u of ["/probe-tmp/ice?mode=home", "/probe-tmp/ice?mode=cms", "/probe-tmp/ice/launcher"]) {
    await page.goto(`${BASE}${u}`, { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
  }
  await ctx.close();
  consoleLog.length = 0;
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const combo = `${vp.name}-${theme}`;
    if (ONLY && !ONLY.includes(combo)) continue;
    console.log(`\n── ${combo} ──`);
    await runHome(vp, theme);
    await runCms(vp, theme);
    await runLauncher(vp, theme);
    const mine = consoleLog.filter((c) => c.combo === combo && !isNoise(c.text));
    check(combo, 13, "no console errors / React warnings", mine.length === 0, mine.map((c) => `${c.type}: ${c.text.split("\n")[0]}`).join(" | "));
  }
}

await browser.close();

/* ── report ───────────────────────────────────────────────────────────── */

const combos = VIEWPORTS.flatMap((vp) => THEMES.map((th) => `${vp.name}-${th}`)).filter((c) => !ONLY || ONLY.includes(c));
console.log("\nRESULTS (✓ pass · ✗ fail · – not run)");
console.log(["check".padEnd(30), ...combos.map((c) => c.padEnd(11))].join(""));
for (const [id, label] of CHECKS) {
  const row = table.get(id);
  console.log([`${id}. ${label}`.padEnd(30), ...combos.map((c) => {
    const cell = row?.get(c);
    return (cell ? (cell.ok ? "✓" : `✗ (${cell.fails.length})`) : "–").padEnd(11);
  })].join(""));
}
if (consoleLog.length) {
  console.log("\nCONSOLE (deduplicated)");
  const seen = new Map();
  for (const c of consoleLog) {
    const k = `${c.type}: ${c.text.split("\n")[0]}`;
    seen.set(k, [...(seen.get(k) ?? []), c.combo]);
  }
  for (const [k, where] of seen) console.log(`  ${isNoise(k) ? "(env) " : ""}${k}  [${[...new Set(where)].join(", ")}]`);
}
console.log(failCount === 0 ? "\nALL ICE UI CHECKS PASS" : `\n${failCount} ICE UI CHECK(S) FAILED`);
process.exit(failCount === 0 ? 0 : 1);

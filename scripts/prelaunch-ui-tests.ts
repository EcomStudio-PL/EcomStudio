/**
 * THE PRE-LAUNCH LANDING (V2), WITHOUT A BROWSER.
 *
 * What this guards is the brief's hardest rule: no unapproved value is ever
 * visible — not the launch date, not X or Y credits, not early-access hours,
 * not a locked price, not a cost figure — and never a raw "{token}" in its
 * place. A rule like that is only as good as the combinations it was tried
 * with, so the view model (lib/server/prelaunch/landing.ts) is driven through
 * EVERY approval combination, and the page itself (components/launch) is
 * rendered to static markup from that output and searched for the leak.
 *
 * Sections:
 *   A  the offer line picks the right variant for every approval combination
 *   B  the benefit cards and their gates (credits / price lock / early access)
 *   C  the gallery view model: complete pairs only, max, captions, alt, admin
 *   D  section switches, their defaults and the two media URLs
 *   E  the rendered page: no {token}, no "zł" unless the cost strip is on,
 *      no early access, the markup contract (anchors, data attributes)
 *   F  the countdown: deterministic first render, plural forms, rounding
 *   G  the referral parameter: shape, storage, expiry, a throwing storage
 *   H  the consents: links, unchecked, versions travel, no token left
 *   I  traffic source, analytics muting
 *   J  wiring: dialog perks, robots, viewport, AVIF, og.jpg, scopes
 *
 * Run (until an npm script exists):
 *   esbuild scripts/prelaunch-ui-tests.ts --bundle --platform=node --format=cjs --jsx=automatic \
 *     --alias:@=. --alias:server-only=./scripts/server-only-stub.js \
 *     --alias:next/image=./scripts/stubs/next-image.tsx --alias:next/link=./scripts/stubs/next-link.tsx \
 *     --external:sharp --outfile=.next/prelaunch-ui-tests.cjs --log-level=error \
 *   && node .next/prelaunch-ui-tests.cjs
 *
 * Before the dictionaries carry the V2 keys (the i18n fragment is merged by the
 * integrator), point PRELAUNCH_I18N_FRAGMENT at the fragment JSON and it is
 * laid over the shipped dictionaries for this run only.
 */
import { existsSync, readFileSync } from "fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/config";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import {
  EMPTY_PRELAUNCH_CONFIG, EARLY_ACCESS_SUPPORTED, tokenValues, type PrelaunchPublicConfig,
} from "@/lib/launch/campaign";
import { resolveLine } from "@/lib/launch/tokens";
import { LAUNCH_SECTIONS, SECTION_DEFAULT_SHOWN, consentPlainText } from "@/lib/launch/fields";
import { GALLERY_MAX_ITEMS, mediaPublicPrefix, type GalleryItem } from "@/lib/launch/gallery";
import { LAUNCH_FIELDS, launchDefaultsFrom, resolveLaunchContent, type LaunchField } from "@/lib/server/launch-page";
import { resolveConsent } from "@/lib/server/prelaunch/consent";
import {
  OFFER_VARIANTS, galleryBlocks, galleryMediaUrls, halfAlt, launchCampaign, launchGalleries,
  launchOptionsFrom, launchPageOptions, launchPerks, liveConfig, mediaUrlOrNull, safeLaunchCopy, srcSetFrom,
  trafficSourceFrom, type LaunchGalleryView,
} from "@/lib/server/prelaunch/landing";
import type { MediaIndex } from "@/lib/server/cms-media";
import { stegaMark } from "@/lib/ice/stega";
import { LaunchPage } from "@/components/launch/launch-page";
import { SiteFooter } from "@/components/cms/site-shell";
import { makeT } from "@/lib/i18n/t";
import { LaunchCountdown } from "@/components/launch/countdown";
import { WaitlistForm } from "@/components/launch/waitlist-form";
import { pluralCategory, remainingParts, unitKey } from "@/components/launch/countdown-math";
import { REF_STORAGE_KEY, REF_TTL_MS, refCodeFromSearch, rememberRef, storedRef, withoutRefParam, notePageRef, pageRef } from "@/components/launch/referral";
import { launchAnalyticsMuted } from "@/components/launch/launch-analytics";
import { SCOPES } from "@/lib/i18n/scopes";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (title: string) => console.log(`\n${title}`);

/* ── dictionaries (optionally with the V2 fragment laid over) ─────────────── */

type Dict = Record<string, unknown>;
function overlay(base: Dict, extra: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const prev = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object"
      ? overlay(prev as Dict, v as Dict) : v;
  }
  return out;
}
const fragmentPath = process.env.PRELAUNCH_I18N_FRAGMENT;
const fragment = fragmentPath && existsSync(fragmentPath)
  ? JSON.parse(readFileSync(fragmentPath, "utf8")) as Record<string, Dict>
  : null;
if (fragmentPath && !fragment) { console.error(`PRELAUNCH_I18N_FRAGMENT not found: ${fragmentPath}`); process.exit(2); }
const DICTS: Record<Locale, Dict> = {
  pl: fragment ? overlay(pl as Dict, fragment.pl) : (pl as Dict),
  en: fragment ? overlay(en as Dict, fragment.en) : (en as Dict),
  de: fragment ? overlay(de as Dict, fragment.de) : (de as Dict),
};
const LOCALES: Locale[] = ["pl", "en", "de"];

/** Static markup of a component under the i18n provider, as a page has it. */
/** The site footer the route hands the page (app/page.tsx), with nothing
 *  configured — the documents and the language switch are always in it. */
const footerFor = (locale: Locale) => createElement(SiteFooter, {
  global: {}, nav: [], locale, t: makeT(DICTS[locale]), forceDark: true,
  site: { instagramUrl: "", facebookUrl: "", linkedinUrl: "", xUrl: "" },
});
const markup = (locale: Locale, child: ReactElement) =>
  renderToStaticMarkup(createElement(I18nProvider, { locale, dict: DICTS[locale], children: child }));

/** The copy as the page resolves it with NOTHING stored in the CMS — the
 *  shipped defaults, which is what a fresh launch block shows. */
function shipped(locale: Locale, stored: Partial<Record<LaunchField, string>> = {}): Record<LaunchField, string> {
  return resolveLaunchContent(
    { published: {}, draft: {} }, locale, launchDefaultsFrom(DICTS[locale]), "published",
    { fields: stored, managed: true },
  );
}

const NOW = Date.parse("2026-10-19T12:00:00Z");
const FUTURE = "2026-11-20T10:00:00+01:00";
const PAST = "2026-10-01T10:00:00+02:00";
const cfg = (over: Partial<PrelaunchPublicConfig>): PrelaunchPublicConfig => ({ ...EMPTY_PRELAUNCH_CONFIG, ...over });
const premiereOn = () => true;
const premiereOff = () => false;
const TOKEN = /\{[a-z_]+\}/i;

async function main() {
  section("0. THE V2 COPY IS PRESENT IN EVERY LOCALE");
  {
    const missing: string[] = [];
    for (const locale of LOCALES) {
      const defaults = launchDefaultsFrom(DICTS[locale]);
      for (const f of LAUNCH_FIELDS) {
        if (f === "hero.image") continue;
        if (typeof defaults[f] !== "string") missing.push(`${locale}:${f}`);
      }
    }
    check("every LAUNCH_FIELDS key has a shipped string in pl/en/de",
      missing.length === 0,
      missing.length ? `${missing.length} missing, e.g. ${missing.slice(0, 6).join(", ")} — merge the i18n fragment or set PRELAUNCH_I18N_FRAGMENT` : undefined);
    for (const locale of LOCALES) {
      const launch = Object.keys((DICTS[locale].launch ?? {}) as Dict);
      const v2 = Object.keys((DICTS[locale].prelaunch ?? {}) as Dict);
      check(`${locale}: launch.* and prelaunch.* share no key (changed copy is edited in place)`,
        v2.every((k) => !launch.includes(k)), v2.filter((k) => launch.includes(k)).join(", "));
    }
    const ui = (DICTS.pl.prelaunchUi ?? {}) as Dict;
    let leaves = 0;
    (function walk(n: Dict) { for (const v of Object.values(n)) { if (v && typeof v === "object") walk(v as Dict); else leaves++; } })(ui);
    check("prelaunchUi (shipped to every public page) stays small: ≤ 60 keys", leaves > 0 && leaves <= 60, `${leaves}`);
    for (const locale of LOCALES) {
      const c = shipped(locale);
      check(`${locale}: no video promise in the shipped launch copy`,
        !Object.values(c).some((v) => /wideo|filmy|filmów|\bvideos?\b|-?videos?\b/i.test(v)),
        Object.entries(c).filter(([, v]) => /wideo|filmy|video/i.test(v)).map(([k]) => k).join(", "));
      check(`${locale}: the price-lock line never says "forever"`,
        !/na zawsze|forever|für immer/i.test(c["benefit.2sub"]), c["benefit.2sub"]);
    }
  }

  section("A. THE OFFER LINE — FIRST VARIANT WHOSE VALUES ARE ALL APPROVED");
  {
    const combos: { name: string; c: PrelaunchPublicConfig; want: (typeof OFFER_VARIANTS)[number] }[] = [
      { name: "date + credits", c: cfg({ launchAt: FUTURE, signupCredits: 150 }), want: "hero.offer" },
      { name: "date only", c: cfg({ launchAt: FUTURE }), want: "hero.offerDate" },
      { name: "credits only", c: cfg({ signupCredits: 150 }), want: "hero.offerCredits" },
      { name: "nothing approved", c: cfg({}), want: "hero.offerNone" },
      { name: "a PAST date counts as no date", c: cfg({ launchAt: PAST, signupCredits: 150 }), want: "hero.offerCredits" },
      { name: "referral/hours/standard do not change the offer", c: cfg({ referralCredits: 20, earlyAccessHours: 24, standardCredits: 25 }), want: "hero.offerNone" },
    ];
    for (const locale of LOCALES) {
      const copy = shipped(locale);
      for (const { name, c, want } of combos) {
        const view = launchCampaign(copy, c, locale, NOW, premiereOff);
        const expected = resolveLine(copy[want], tokenValues(liveConfig(c, NOW), locale, NOW), locale);
        check(`${locale} · ${name} → ${want}`,
          expected !== null && view.offer === expected && !TOKEN.test(view.offer),
          `got ${JSON.stringify(view.offer)}, want ${JSON.stringify(expected)}`);
      }
      const dated = launchCampaign(copy, cfg({ launchAt: FUTURE, signupCredits: 150 }), locale, NOW, premiereOff);
      check(`${locale} · the date is written out (Europe/Warsaw) and the number formatted`,
        Boolean(dated.offer && /20/.test(dated.offer) && /150/.test(dated.offer)), String(dated.offer));
    }
    const copy = shipped("pl");
    const none = launchCampaign({ ...copy, "hero.offer": "", "hero.offerDate": "", "hero.offerCredits": "", "hero.offerNone": "" },
      cfg({ launchAt: FUTURE, signupCredits: 150 }), "pl", NOW, premiereOff);
    check("all four variants emptied → no offer line at all (never a blank or a token)", none.offer === null);
    const typo = launchCampaign({ ...copy, "hero.offer": "Startujemy {date} i dajemy {credit}." },
      cfg({ launchAt: FUTURE, signupCredits: 150 }), "pl", NOW, premiereOff);
    check("a variant with a token the resolver does not know falls through to the next, never prints it",
      typo.offer === resolveLine(copy["hero.offerDate"], tokenValues(cfg({ launchAt: FUTURE }), "pl", NOW), "pl"),
      String(typo.offer));
    const tampered = safeLaunchCopy({ ...copy, "hero.h1": "GrovBase {credits}", "seo.title": "{date}" }, launchDefaultsFrom(DICTS.pl));
    check("a plain line stored with a token falls back to the shipped copy",
      tampered["hero.h1"] === copy["hero.h1"] && !TOKEN.test(tampered["seo.title"]));
    check("…while lines built for tokens keep their template for the resolver",
      safeLaunchCopy(copy, launchDefaultsFrom(DICTS.pl))["benefit.1"] === copy["benefit.1"]);
  }

  section("B. THE BENEFIT CARDS AND THEIR GATES");
  {
    const copy = shipped("pl");
    const keys = (c: PrelaunchPublicConfig, premiere = premiereOff) => launchPerks(copy, c, "pl", NOW, premiere).map((p) => p.key).join(",");
    check("nothing approved → no card (the island is not rendered)", keys(cfg({})) === "");
    const credits = launchPerks(copy, cfg({ signupCredits: 150 }), "pl", NOW, premiereOff);
    check("credits approved → card 1 with its title", credits.length === 1 && credits[0]!.key === "credits" && /150/.test(credits[0]!.t));
    check("…and WITHOUT the comparison line while {standard} is not approved", credits[0]!.b === "");
    const both = launchPerks(copy, cfg({ signupCredits: 150, standardCredits: 25 }), "pl", NOW, premiereOff);
    check("credits + standard → the comparison line appears", /25/.test(both[0]!.b) && !TOKEN.test(both[0]!.b), both[0]?.b);
    check("standard alone → still nothing (the card needs credits)", keys(cfg({ standardCredits: 25 })) === "");
    check("price lock approved but the premiere offer is not running → no card 2", keys(cfg({ priceLock: true }), premiereOff) === "");
    check("premiere running but the lock not approved → no card 2", keys(cfg({}), premiereOn) === "");
    check("price lock approved AND premiere running → card 2", keys(cfg({ priceLock: true }), premiereOn) === "priceLock");
    check("EARLY_ACCESS_SUPPORTED is false in this build", EARLY_ACCESS_SUPPORTED === false);
    check("early access approved → still no card 3", keys(cfg({ earlyAccessHours: 24 }), premiereOn) === "");
    const rewritten = { ...copy, "benefit.3sub": "Przed wszystkimi." };
    check("…even with copy rewritten without {hours}",
      launchPerks(rewritten, cfg({ earlyAccessHours: 24 }), "pl", NOW, premiereOn).every((p) => p.key !== "earlyAccess"));
    const all = launchCampaign(copy, cfg({ signupCredits: 150, standardCredits: 25, priceLock: true, earlyAccessHours: 48, referralCredits: 20, launchAt: FUTURE }), "pl", NOW, premiereOn);
    check("everything approved → cards 1 and 2, never 3", all.perks.map((p) => p.key).join(",") === "credits,priceLock");
    check("the reward note shows when a credits value is shown", Boolean(all.rewardNote));
    check("…and not otherwise", launchCampaign(copy, cfg({ priceLock: true }), "pl", NOW, premiereOn).rewardNote === null);
    {
      // The offer line names the credits too: the condition must be on the page
      // even when the benefits island (and its credits card) is switched off.
      const offerOnly = launchCampaign(copy, cfg({ signupCredits: 150 }), "pl", NOW, premiereOff);
      check("an offer line with {credits} → offerShowsCredits and the reward note (benefits island or not)",
        offerOnly.offerShowsCredits && Boolean(offerOnly.rewardNote) && /150/.test(offerOnly.offer ?? ""));
      const dateOnly = launchCampaign(copy, cfg({ launchAt: FUTURE }), "pl", NOW, premiereOff);
      check("…an offer line without credits → no note from the offer", !dateOnly.offerShowsCredits && dateOnly.rewardNote === null);
    }
    check("referral line: {referral} approved → the credits sentence + the note",
      /20/.test(all.referral.body) && Boolean(all.referral.rewardNote));
    const noRef = launchCampaign(copy, cfg({}), "pl", NOW, premiereOff);
    check("referral line: not approved → ref.bodyNone, no note",
      noRef.referral.body === copy["ref.bodyNone"] && noRef.referral.rewardNote === null);
    check("no card, line or note anywhere carries a token, in any combination", (() => {
      for (const locale of LOCALES) for (const launchAt of [null, FUTURE]) for (const signupCredits of [null, 150])
        for (const referralCredits of [null, 20]) for (const standardCredits of [null, 25]) for (const priceLock of [false, true]) {
          const v = launchCampaign(shipped(locale), cfg({ launchAt, signupCredits, referralCredits, standardCredits, priceLock, earlyAccessHours: 24 }), locale, NOW, premiereOn);
          const texts = [v.offer ?? "", v.rewardNote ?? "", v.referral.body, v.referral.rewardNote ?? "", ...v.perks.flatMap((p) => [p.t, p.b])];
          if (texts.some((s) => TOKEN.test(s))) return false;
        }
      return true;
    })());
    check("countdown only for an approved FUTURE date",
      launchCampaign(copy, cfg({ launchAt: FUTURE }), "pl", NOW).countdown?.launchAtMs === Date.parse(FUTURE)
      && launchCampaign(copy, cfg({ launchAt: PAST }), "pl", NOW).countdown === null
      && launchCampaign(copy, cfg({}), "pl", NOW).countdown === null);
  }

  section("C. GALLERIES — WHAT A VISITOR SEES AND WHAT AN ADMIN SEES");
  const SUPA = "https://proj.supabase.co";
  const prefix = mediaPublicPrefix(SUPA);
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const half = (name: string, crop?: { x: number; y: number; zoom: number }) => ({ url: `${prefix}launch/${name}.webp`, ...(crop ? { crop } : {}) });
  const item = (n: number, complete = true, caption?: GalleryItem["caption"]): GalleryItem => ({
    id: uuid(n), before: half(`b${n}`, n === 1 ? { x: 30, y: 60, zoom: 1.5 } : undefined),
    after: complete ? half(`a${n}`) : null, ...(caption ? { caption } : {}),
  });
  const media: MediaIndex = new Map([
    ["launch/b1.webp", { width: 1080, height: 1080, variants: { "1024": `${prefix}launch/b1-1024.webp`, "640": `${prefix}launch/b1-640.webp` }, alt: "Plik" }],
  ]);
  {
    // The side labels come from the launch block, which the visual editor
    // marks in an admin's edit render; captions live in the gallery block,
    // which it never marks (and whose validation refuses invisible text).
    const copy = { ...shipped("pl"), "gallery.before": `PRZED${stegaMark("cms:label")}` };
    const blocks = [
      { id: "z", type: "launch", sort_order: 0, visible: true, content: { fields: {} } },
      { id: "g1", type: "launch_gallery", sort_order: 10, visible: true, content: { gallery: "thumbs", items: [item(1, true, { pl: "Etui na telefon", en: "Phone case" }), item(2, false), item(3)] } },
      { id: "g0", type: "launch_gallery", sort_order: 15, visible: true, content: { gallery: "thumbs", items: [item(9)] } },
      { id: "g2", type: "launch_gallery", sort_order: 20, visible: false, content: { gallery: "retouch", items: [item(4)] } },
    ];
    const visitor = launchGalleries({ blocks, copy, locale: "pl", media, isAdmin: false });
    const admin = launchGalleries({ blocks, copy, locale: "pl", media, isAdmin: true });
    check("a visitor gets only the live gallery", visitor.map((g) => g.key).join(",") === "thumbs");
    const thumbs = visitor[0]!;
    check("…with complete pairs only, in order, indexed for GA", thumbs.tiles.map((t) => t.index).join(",") === "1,2"
      && thumbs.tiles[1]!.id === uuid(3));
    check("two blocks for one key → the lowest sort_order wins", !thumbs.tiles.some((t) => t.id === uuid(9)));
    check("the caption is the viewer's language", thumbs.tiles[0]!.caption === "Etui na telefon");
    check("a caption carrying invisible characters is refused by the gallery reader",
      galleryBlocks([{ type: "launch_gallery", content: { gallery: "thumbs", items: [item(7, true, { pl: `X${stegaMark("p")}` })] } }])
        .get("thumbs")?.items[0]?.caption === undefined);
    check("…and English falls back the way the copy does",
      launchGalleries({ blocks, copy: shipped("en"), locale: "en", media, isAdmin: false })[0]!.tiles[0]!.caption === "Phone case");
    check("alt = caption + side label, with editor markers stripped",
      thumbs.tiles[0]!.before.alt === "Etui na telefon – PRZED" && thumbs.tiles[0]!.after.alt === "Etui na telefon – PO",
      `${thumbs.tiles[0]!.before.alt} / ${thumbs.tiles[0]!.after.alt}`);
    check("no caption → the library's alt for that file, then the label alone",
      halfAlt("", "PRZED", "Plik") === "Plik – PRZED" && halfAlt("", "PO", undefined) === "PO");
    check("srcset from the recorded derivatives, narrowest first",
      thumbs.tiles[0]!.before.srcSet === `${prefix}launch/b1-640.webp 640w, ${prefix}launch/b1-1024.webp 1024w`);
    check("width/height from the media index (no layout shift)", thumbs.tiles[0]!.before.width === 1080 && thumbs.tiles[0]!.before.height === 1080);
    check("the crop becomes the frame", thumbs.tiles[0]!.before.frame.position === "30% 60%" && thumbs.tiles[0]!.before.frame.zoom === 1.5);
    check("…and no crop is the centre at zoom 1", thumbs.tiles[0]!.after.frame.position === "50% 50%" && thumbs.tiles[0]!.after.frame.zoom === 1);
    check("cover, never stretched", thumbs.tiles.every((t) => t.before.fit === "cover" && t.after.fit === "cover"));
    const reasons = Object.fromEntries(admin.map((g) => [g.key, g.placeholder]));
    check("an admin gets placeholders: hidden / missing", reasons.thumbs === null && reasons.retouch === "hidden" && reasons.fashion === "missing",
      JSON.stringify(reasons));
    const empty = launchGalleries({ blocks: [{ type: "launch_gallery", sort_order: 10, visible: true, content: { gallery: "fashion", items: [item(5, false)] } }], copy, locale: "pl", media, isAdmin: true });
    check("only incomplete pairs → 'empty' for an admin, nothing for a visitor",
      empty.find((g) => g.key === "fashion")?.placeholder === "empty"
      && launchGalleries({ blocks: [{ type: "launch_gallery", content: { gallery: "fashion", items: [item(5, false)] } }], copy, locale: "pl", media, isAdmin: false }).length === 0);
    check("placeholders carry no tiles", admin.filter((g) => g.placeholder).every((g) => g.tiles.length === 0));
    const many = Array.from({ length: 45 }, (_, i) => item(100 + i));
    const capped = launchGalleries({ blocks: [{ type: "launch_gallery", content: { gallery: "thumbs", items: many } }], copy, locale: "pl", media, isAdmin: false });
    check(`at most ${GALLERY_MAX_ITEMS} tiles per gallery`, capped[0]!.tiles.length === GALLERY_MAX_ITEMS);
    const urls = galleryMediaUrls(blocks);
    check("the media lookup asks only for complete, visible, chosen pairs", urls.length === 4 && !urls.some((u) => u.includes("b2") || u.includes("b4") || u.includes("b9")),
      urls.join(" "));
    check("three full galleries stay inside one cms_media_meta call (≤ 200 paths)", GALLERY_MAX_ITEMS * 3 * 2 + 1 <= 200);
    check("galleryBlocks ignores non-gallery and malformed blocks",
      galleryBlocks([{ type: "launch", content: {} }, { type: "launch_gallery", content: { gallery: "nope" } }]).size === 0);
    check("srcSetFrom ignores junk and encodes commas", srcSetFrom({ x: "a", "640": "u,1" }) === "u%2C1 640w" && srcSetFrom(undefined) === undefined);
  }

  section("D. SECTION SWITCHES AND THE TWO PICTURES");
  {
    const def = launchOptionsFrom({}, SUPA);
    check("cost strip and creators tile ship HIDDEN", def.shown.cost === false && def.shown.creators === false);
    check("every other section ships shown",
      LAUNCH_SECTIONS.filter((s) => s !== "cost" && s !== "creators").every((s) => def.shown[s] === true));
    check("defaults are exactly SECTION_DEFAULT_SHOWN", LAUNCH_SECTIONS.every((s) => def.shown[s] === SECTION_DEFAULT_SHOWN[s]));
    const flipped = launchOptionsFrom({ showCost: "1", showCountdown: "0", showSticky: "0" }, SUPA);
    check("'1' shows, '0' hides", flipped.shown.cost && !flipped.shown.countdown && !flipped.shown.sticky);
    check("a media-bucket https URL is accepted", mediaUrlOrNull(`${prefix}team/me.jpg`, SUPA) === `${prefix}team/me.jpg`);
    check("http, another host, a bare prefix, '..' and quotes are refused",
      [`${prefix.replace("https", "http")}a.jpg`, "https://evil.example/a.jpg", prefix, `${prefix}../x.jpg`, `${prefix}a".jpg`]
        .every((u) => mediaUrlOrNull(u, SUPA) === null));
    const page = launchPageOptions(launchOptionsFrom({ showCreators: "1", creatorsImage: `${prefix}launch/b1.webp` }, SUPA), media);
    check("the creators photo becomes an <img> with its size and srcset", page.creatorsImage?.width === 1080 && Boolean(page.creatorsImage?.srcSet));
  }

  section("E. THE RENDERED PAGE");
  const consentsFor = (locale: Locale) => {
    const c = shipped(locale);
    const labels = { terms: c["consent.termsLabel"], privacy: c["consent.privacyLabel"] };
    return {
      terms: resolveConsent("terms_privacy", c["hero.consent"], locale, labels),
      marketing: resolveConsent("marketing_email", c["hero.consentMarketing"], locale, labels),
    };
  };
  const render = (locale: Locale, config: PrelaunchPublicConfig, opts: {
    plain?: Record<string, string>; galleries?: LaunchGalleryView[]; isAdmin?: boolean; premiere?: () => boolean;
  } = {}) => {
    const copy = shipped(locale);
    const options = launchPageOptions(launchOptionsFrom(opts.plain ?? {}, SUPA), media);
    const campaign = launchCampaign(copy, config, locale, NOW, opts.premiere ?? premiereOff);
    return markup(locale,
      createElement(LaunchPage, {
        content: copy, signedIn: false, showAuthEntry: false, waitlistFields: { firstName: "optional", lastName: "required" },
        loginLabel: "Zaloguj się", footer: footerFor(locale),
        social: { instagramUrl: "", facebookUrl: "", linkedinUrl: "", xUrl: "" },
        options, campaign, galleries: opts.galleries ?? [], isAdmin: opts.isAdmin ?? false,
        consents: consentsFor(locale), serverNow: NOW, analytics: { trafficSource: "direct" },
      }));
  };
  {
    let leaks = 0; let renders = 0;
    for (const locale of LOCALES) for (const launchAt of [null, FUTURE]) for (const signupCredits of [null, 150])
      for (const referralCredits of [null, 20]) for (const standardCredits of [null, 25]) for (const priceLock of [false, true]) {
        const html = render(locale, cfg({ launchAt, signupCredits, referralCredits, standardCredits, priceLock, earlyAccessHours: 24 }), { premiere: premiereOn });
        renders++;
        // Attribute values included: a token in an aria-label is a token too.
        if (TOKEN.test(html.replace(/<style[\s\S]*?<\/style>/g, ""))) leaks++;
      }
    check(`no {token} in any of ${renders} renders (3 locales × every approval combination)`, leaks === 0, `${leaks} leaked`);
    const pl0 = render("pl", cfg({}));
    check("nothing approved: no number promised, no countdown, no benefits island",
      !/data-launch-perks/.test(pl0) && !/data-launch-countdown/.test(pl0) && !/kredytów na start/.test(pl0));
    check("no 'zł' while the cost strip is off (its default)", !/zł/.test(pl0));
    check("…and the strip renders once switched on", /data-launch-cost/.test(render("pl", cfg({}), { plain: { showCost: "1" } }))
      && /zł/.test(render("pl", cfg({}), { plain: { showCost: "1" } })));
    const allOn = render("pl", cfg({ launchAt: FUTURE, signupCredits: 150, standardCredits: 25, priceLock: true, earlyAccessHours: 48 }), { premiere: premiereOn });
    check("early access never renders, whatever is approved", !/Wcześniejszy dostęp/.test(allOn) && !/data-launch-perk="earlyAccess"/.test(allOn));
    check("everything approved: countdown in the hero card and the final call to action",
      (allOn.match(/data-launch-countdown="true"/g) ?? []).length === 2);
    check("markup contract: [data-launch-page], #zapis, #zapis-koniec",
      /data-launch-page/.test(pl0) && /id="zapis"/.test(pl0) && /id="zapis-koniec"/.test(pl0));
    check("the final form is the short one (no first name)", (pl0.match(/data-waitlist-first-name/g) ?? []).length === 1);
    check("the first name is never required", !/data-waitlist-first-name[^>]*required/.test(pl0) && !/autoComplete="family-name"|autocomplete="family-name"/.test(pl0));
    check("…and hidden when the registration settings hide it", (() => {
      const copy = shipped("pl");
      const html = markup("pl",
        createElement(LaunchPage, {
          content: copy, signedIn: false, showAuthEntry: false, waitlistFields: { firstName: "hidden", lastName: "hidden" },
          loginLabel: "", footer: footerFor("pl"),
          social: { instagramUrl: "", facebookUrl: "", linkedinUrl: "", xUrl: "" },
          options: launchPageOptions(launchOptionsFrom({}, SUPA), media),
          campaign: launchCampaign(copy, cfg({}), "pl", NOW), galleries: [], isAdmin: false,
          consents: consentsFor("pl"), serverNow: NOW, analytics: { trafficSource: "direct" },
        }));
      return !/data-waitlist-first-name/.test(html);
    })());
    check("one priority hero image, not two", (pl0.match(/data-next-image/g) ?? []).length === 1 && /loading="eager"/.test(pl0));
    check("the language switch is on the page (in the site footer)",
      /data-launch-footer[\s\S]*data-footer-locale/.test(pl0));
    check("the footer links the three documents",
      /href="\/regulamin"/.test(pl0) && /href="\/polityka-prywatnosci"/.test(pl0) && /href="\/polityka-cookies"/.test(pl0));
    check("the final call to action and sticky bar obey their switches",
      !/data-launch-final/.test(render("pl", cfg({}), { plain: { showFinal: "0" } }))
      && !/data-launch-sticky/.test(render("pl", cfg({}), { plain: { showSticky: "0" } })));
    check("the creators tile ships hidden and shows once switched on",
      !/data-launch-creators/.test(pl0) && /data-launch-creators/.test(render("pl", cfg({}), { plain: { showCreators: "1" } })));
    const copy = shipped("pl");
    const blocks = [{ type: "launch_gallery", sort_order: 10, visible: true, content: { gallery: "thumbs", items: [item(1), item(3)] } }];
    const withGallery = render("pl", cfg({}), { galleries: launchGalleries({ blocks, copy, locale: "pl", media, isAdmin: false }) });
    check("a live gallery renders [data-launch-gallery=thumbs] with its tiles and CTA",
      /data-launch-gallery="thumbs"/.test(withGallery) && (withGallery.match(/data-launch-tile=/g) ?? []).length === 2
      && /href="#zapis"/.test(withGallery));
    check("tile pictures are lazy and sized for 4 across", /loading="lazy"/.test(withGallery) && /25vw/.test(withGallery));
    const adminView = render("pl", cfg({}), { isAdmin: true, galleries: launchGalleries({ blocks, copy, locale: "pl", media, isAdmin: true }) });
    check("admin placeholders are decided in the browser (unframed, no ?preview): none in the server markup",
      !/data-launch-gallery-empty/.test(adminView));
    for (const locale of ["en", "de"] as Locale[]) {
      const html = render(locale, cfg({ signupCredits: 150 }));
      check(`${locale}: renders in its own language`, html.includes(shipped(locale)["hero.cta"]) && !/kredytów/.test(html));
    }
  }

  section("F. THE COUNTDOWN");
  {
    const at = NOW + (2 * 86_400 + 3 * 3_600 + 4 * 60) * 1000 + 15_000;
    const draw = (clock: number) => {
      const real = Date.now;
      Date.now = () => clock;
      try {
        return markup("pl",
          createElement(LaunchCountdown, { launchAtMs: at, serverNow: NOW, iso: new Date(at).toISOString(), label: "Do premiery zostało", dateLabel: "21 października o 15:04" }));
      } finally { Date.now = real; }
    };
    const a = draw(NOW);
    const b = draw(NOW + 7 * 86_400_000);
    check("first render is the server's arithmetic, whatever the visitor's clock says", a === b);
    check("days / hours / minutes, minutes rounded UP", /02<\/span>/.test(a) && /03<\/span>/.test(a) && /05<\/span>/.test(a), a.slice(0, 400));
    check("Polish plural labels", /dni/.test(a) && /godziny/.test(a) && /minut</.test(a));
    check("a screen reader gets the date once", /sr-only[^>]*>Premiera: 21 października o 15:04/.test(a));
    check("the ticking digits are hidden from assistive tech", /<time[^>]*aria-hidden="true"/.test(a));
    const gone = markup("pl",
      createElement(LaunchCountdown, { launchAtMs: NOW - 1, serverNow: NOW, iso: "", label: "", dateLabel: "" }));
    check("at zero it removes itself", gone === "");
    check("plural categories: pl 1/2/5/22/0", ["one", "few", "many", "few", "many"].join() === [1, 2, 5, 22, 0].map((n) => pluralCategory("pl", n)).join());
    check("plural categories: en and de 1/2", pluralCategory("en", 1) === "one" && pluralCategory("en", 2) === "other" && pluralCategory("de", 1) === "one" && pluralCategory("de", 5) === "other");
    check("every unit label exists in pl/en/de", LOCALES.every((l) => ["days", "hours", "minutes"].every((u) =>
      ["one", "few", "many", "other"].every((c) => {
        const node = (((DICTS[l].prelaunchUi as Dict | undefined)?.cd as Dict | undefined)?.[u] as Dict | undefined)?.[c];
        return typeof node === "string" && node.length > 0;
      }))));
    check("unitKey names the dictionary path", unitKey("hours", "pl", 5) === "prelaunchUi.cd.hours.many");
    check("remainingParts: 40 s left still shows 1 minute", JSON.stringify(remainingParts(40_000)) === JSON.stringify({ days: 0, hours: 0, minutes: 1 }));
    check("remainingParts: never negative", JSON.stringify(remainingParts(-5)) === JSON.stringify({ days: 0, hours: 0, minutes: 0 }));
  }

  section("G. THE REFERRAL PARAMETER");
  {
    check("a valid code is read (case-insensitive)", refCodeFromSearch("?ref_code=abcd2345") === "ABCD2345");
    check("the code leaves the address bar, every other parameter and the hash stay (review S9)",
      withoutRefParam("https://grovbase.com/?utm_source=fb&ref_code=ABCD2345&utm_medium=cpc#zapis") === "/?utm_source=fb&utm_medium=cpc#zapis"
      && withoutRefParam("https://grovbase.com/?ref_code=ABCD2345") === "/"
      && withoutRefParam("https://grovbase.com/?utm_source=fb") === null);
    notePageRef("ABCD2345"); notePageRef("nonsense");
    check("…and is still sent with the form from memory when storage is unavailable", pageRef() === "ABCD2345");
    check("ambiguous letters, wrong length and junk are ignored",
      ["?ref_code=ABCD1234", "?ref_code=ABCDO234", "?ref_code=ABC", "?ref_code=ABCD23456", "?ref=ABCD2345", "?ref_code=%3Cscript%3E"].every((s) => refCodeFromSearch(s) === null));
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
    rememberRef(store, "ABCD2345", NOW);
    check(`stored under '${REF_STORAGE_KEY}'`, mem.has(REF_STORAGE_KEY) && storedRef(store, NOW + 1000) === "ABCD2345");
    check("…for 30 days, then forgotten", storedRef(store, NOW + REF_TTL_MS - 1) === "ABCD2345" && storedRef(store, NOW + REF_TTL_MS + 1) === null && !mem.has(REF_STORAGE_KEY));
    rememberRef(store, "not-a-code", NOW);
    check("an invalid code is never stored", !mem.has(REF_STORAGE_KEY));
    mem.set(REF_STORAGE_KEY, "{broken");
    check("a corrupted entry reads as no referral", storedRef(store, NOW) === null);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    let threw = false;
    try { rememberRef(throwing, "ABCD2345", NOW); storedRef(throwing, NOW); } catch { threw = true; }
    check("blocked storage never throws", !threw && storedRef(null) === null);
  }

  section("H. THE CONSENTS");
  {
    for (const locale of LOCALES) {
      const consents = consentsFor(locale);
      const html = markup(locale,
        createElement(WaitlistForm, {
          variant: "hero", id: "t", placeholder: "E-mail", cta: "Go", firstNameLabel: "Imię",
          consents: { terms: { parts: consents.terms.parts, version: consents.terms.version }, marketing: { parts: consents.marketing.parts, version: consents.marketing.version } },
          success: { title: "", body: "", resend: "", resendHint: "", channel: null, referral: null },
        }));
      check(`${locale}: two separate checkboxes, both required, neither ticked`,
        (html.match(/type="checkbox"/g) ?? []).length === 2 && (html.match(/type="checkbox"[^>]*required/g) ?? []).length === 2 && !/checked=""/.test(html));
      check(`${locale}: the documents are links that open in a new tab`,
        /href="\/regulamin"[^>]*target="_blank"/.test(html) && /href="\/polityka-prywatnosci"[^>]*target="_blank"/.test(html));
      check(`${locale}: the sentence on screen IS the recorded text`,
        html.replace(/<[^>]+>/g, "").includes(consents.terms.text)
        && consents.terms.text === consentPlainText(shipped(locale)["hero.consent"], { terms: shipped(locale)["consent.termsLabel"], privacy: shipped(locale)["consent.privacyLabel"] }));
      check(`${locale}: versions are derived from the words`, /^terms_privacy@[0-9a-f]{12}$/.test(consents.terms.version) && /^marketing_email@[0-9a-f]{12}$/.test(consents.marketing.version));
      check(`${locale}: no surname field, a honeypot named company`, !/family-name/.test(html) && /name="company"/.test(html));
      check(`${locale}: no token left in the consent markup`, !TOKEN.test(html));
    }
    const form = readFileSync("components/launch/waitlist-form.tsx", "utf8");
    check("the form posts to the V2 endpoint with both versions and the referral code",
      /\/api\/public\/prelaunch\/signup/.test(form) && /consent_versions:\s*\{\s*terms_privacy:/.test(form) && /ref_code: refCode/.test(form));
    check("field errors are wired with aria-invalid and aria-describedby", /aria-invalid=\{invalid\.has\("email"\)\}/.test(form) && /aria-describedby=\{invalid\.has\("email"\)/.test(form));
    check("409 / 429 have their own messages", /res\.status === 409/.test(form) && /res\.status === 429/.test(form));
    check("a double submit cannot post twice", /if \(inFlight\.current\) return;/.test(form));
    check("no enumeration: nothing in the form says an address is already listed", !/launch\.dup/.test(form));
  }

  section("I. TRAFFIC SOURCE AND ANALYTICS MUTING");
  {
    check("first-touch utm wins", trafficSourceFrom({ firstTouchUtm: "Newsletter", firstTouchHost: "google.com", utmSource: "x" }) === "newsletter");
    check("then the referring host", trafficSourceFrom({ firstTouchHost: "www.google.com" }) === "www.google.com");
    check("then this request's utm, then a referral link, then direct",
      trafficSourceFrom({ utmSource: "fb ads" }) === "fb_ads" && trafficSourceFrom({ refCode: "ABCD2345" }) === "referral" && trafficSourceFrom({}) === "direct");
    check("anything with an @ is dropped", trafficSourceFrom({ firstTouchUtm: "me@x.pl" }) === "direct");
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    const fake = (framed: boolean, search: string) => {
      const w: Record<string, unknown> = { location: { search } };
      w.self = w; w.top = framed ? {} : w;
      return w;
    };
    g.window = fake(false, ""); const live = launchAnalyticsMuted();
    g.window = fake(true, ""); const framed = launchAnalyticsMuted();
    g.window = fake(false, "?preview=waitlist&draft=1"); const preview = launchAnalyticsMuted();
    g.window = prev;
    check("events go out for a visitor, not inside a frame, not with ?preview", !live && framed && preview);
    check("server render: muted", launchAnalyticsMuted() === true);
  }

  section("J. WIRING");
  {
    const access = readFileSync("app/actions/platform-access.ts", "utf8");
    check("the auth dialog's perks come from the same resolver", /launchPerks\(/.test(access) && !/c\["benefit\.1"\]/.test(access));
    check("…from the launch page that IS the homepage, not a hardcoded slug", !/["']premiera["']/.test(access.replace(/\/\*[\s\S]*?\*\//g, "")));
    const robots = readFileSync("app/robots.ts", "utf8");
    check("robots.txt keeps crawlers out of /potwierdz-zapis", /"\/potwierdz-zapis"/.test(robots));
    check("the sitemap does not list it", !/potwierdz-zapis/.test(readFileSync("app/sitemap.ts", "utf8")));
    const confirmPage = readFileSync("app/potwierdz-zapis/page.tsx", "utf8");
    check("the confirmation page is dynamic and noindex",
      /dynamic = "force-dynamic"/.test(confirmPage) && /index: false, follow: false/.test(confirmPage));
    const island = readFileSync("app/potwierdz-zapis/confirm.tsx", "utf8");
    check("it reads the #t= fragment and clears it", /location\.hash/.test(island) && /history\.replaceState/.test(island));
    check("it confirms only on a real press", /e\.isTrusted/.test(island)
      && !/useEffect\([^]*?fetch\(/.test(island.slice(0, island.indexOf("async function confirm"))));
    const config = readFileSync("next.config.mjs", "utf8");
    check("next/image serves AVIF first", /formats:\s*\['image\/avif',\s*'image\/webp'\]/.test(config));
    const route = readFileSync("app/page.tsx", "utf8");
    check("'/' allows pinch zoom while it is the launch page", /export async function generateViewport/.test(route) && /maximumScale: 5, userScalable: true/.test(route));
    check("og:image falls back to the 1200×630 JPEG", /\/launch\/og\.jpg/.test(route) && /width: 1200, height: 630/.test(route));
    check("the root client scope carries prelaunchUi", (SCOPES.root as readonly string[]).includes("prelaunchUi"));
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp("public/launch/og.jpg").metadata();
      check("public/launch/og.jpg is a 1200×630 JPEG", meta.format === "jpeg" && meta.width === 1200 && meta.height === 630);
    } catch (e) {
      check("public/launch/og.jpg is readable", false, String(e));
    }
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * THE HOME / START — ONE PAGE, EVERY ADDRESS, NOTHING INVENTED.
 *
 *   npm run test:home
 *
 * What this proves, in the order the brief asked for it:
 *
 *   A. Every card on the Home is a real tool, workflow or category: it
 *      resolves through the registries, links where /tools links, and is
 *      dressed by a media slot lib/media-slots.ts declares.
 *   B. The availability switchboard is obeyed exactly as the menus obey it —
 *      DISABLED disappears, "Wkrótce" is drawn inert, nothing is bypassed.
 *   C. The galleries are media slots with the counts and shapes the page
 *      paints, and every picture production already holds keeps its slot.
 *   D. ONE implementation: /start, /home and "/" render the same component
 *      through the same loader; the old dashboard is gone.
 *   E. The homepage is still decided by cms_pages.is_homepage alone, and once
 *      the `app` page holds it, /start forwards to "/" instead of competing.
 *   F. A visitor explores and is asked to sign in — the Gate — while the
 *      server keeps every tool route and every spending endpoint closed.
 *   G. The Start tab of the bottom navigation is this page, once.
 *   H. Every word on the page is in the dictionary, in all three languages.
 */
import fs from "node:fs";
import {
  CHIPS, EFFECTS, RAIL, VIDEO_ROW, chipCards, effectCards, homeModel, openHref, railCards,
  startHref, videoCards, isRegisteredDestination, type HomeCard,
} from "@/lib/home-sections";
import { HUB_CARDS } from "@/lib/tool-cards";
import { CATEGORIES, categoryPath } from "@/lib/categories";
import {
  allDefaults, featureForHref, type AvailabilityMap, type FeatureKey, type FeatureStatus,
} from "@/lib/features";
import {
  HOME_GALLERY, HOME_SLOT, MEDIA_SLOTS, isKnownSlot, slotDef,
} from "@/lib/media-slots";
import { DOCK_SLOTS, dockSlotActive } from "@/lib/bottom-nav";
import { isProtectedPath } from "@/lib/supabase/middleware";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
function section(title: string) { console.log(`\n${title}`); }

const read = (f: string) => fs.readFileSync(f, "utf8");
/** Comments explain history and quote removed code; they are not code. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const withStatus = (over: Partial<Record<FeatureKey, FeatureStatus | "HIDDEN">>): AvailabilityMap => {
  const map = allDefaults();
  for (const k of Object.keys(map) as FeatureKey[]) map[k] = { ...map[k], status: "ACTIVE" };
  for (const [k, v] of Object.entries(over) as [FeatureKey, FeatureStatus | "HIDDEN"][]) {
    map[k] = v === "HIDDEN" ? { ...map[k], status: "ACTIVE", hiddenFromMenu: true } : { ...map[k], status: v };
  }
  return map;
};
const DEFAULTS = allDefaults();
const ALL_ACTIVE = withStatus({});
const keys = (cards: readonly HomeCard[]) => cards.map((c) => c.key);

/* ── A ─────────────────────────────────────────────────────────────────── */
section("A. EVERY CARD IS A REAL THING, LINKED WHERE /tools LINKS IT");

const everyPick = [...RAIL, ...CHIPS, ...EFFECTS, ...VIDEO_ROW];
check("every key on the Home names a tool, a workflow or a category that exists",
  everyPick.every((p) => p.startsWith("cat:")
    ? CATEGORIES.some((c) => c.key === p.slice(4))
    : HUB_CARDS.some((c) => c.key === p)),
  everyPick.filter((p) => !(p.startsWith("cat:") ? CATEGORIES.some((c) => c.key === p.slice(4)) : HUB_CARDS.some((c) => c.key === p))).join(", "));

const allCards = [...railCards(ALL_ACTIVE), ...chipCards(ALL_ACTIVE), ...effectCards(ALL_ACTIVE), ...videoCards(ALL_ACTIVE)];
check("with everything switched on, no key is dropped",
  allCards.length === everyPick.length, `${allCards.length} of ${everyPick.length}`);
check("the reference layout's counts: 6 rail tiles, 8 chips, 8 effects",
  RAIL.length === 6 && CHIPS.length === 8 && EFFECTS.length === 8);
check("every card links to a registered destination",
  allCards.every((c) => isRegisteredDestination(c.href)), allCards.filter((c) => !isRegisteredDestination(c.href)).map((c) => c.href).join(", "));
check("a hub card links exactly where /tools links it",
  allCards.filter((c) => !c.key.startsWith("cat:")).every((c) => HUB_CARDS.find((h) => h.key === c.key)?.href === c.href));
check("a category links through /k/<slug>, the forward that asks the switchboard",
  allCards.filter((c) => c.key.startsWith("cat:")).every((c) => CATEGORIES.some((k) => categoryPath(k) === c.href)));
check("no card links to a query string a page ignores (the old /k/<cat>?wf=)",
  allCards.every((c) => !/\?wf=/.test(c.href)));
check("a workflow opens its own screen, /k/<category>/<workflow>",
  allCards.find((c) => c.key === "ecommerce.thumbnail")?.href === "/k/ecommerce/thumbnail"
  && allCards.find((c) => c.key === "ecommerce.context")?.href === "/k/ecommerce/context");
check("Niewidzialny manekin is the running edit tool, not the Wkrótce Moda preset",
  railCards(DEFAULTS).find((c) => c.titleKey === "tools.ghost_mannequin.name")?.href === "/tools/ghost_mannequin");
check("every card is dressed by a DECLARED media slot",
  allCards.every((c) => isKnownSlot(c.slot)), allCards.filter((c) => !isKnownSlot(c.slot)).map((c) => c.slot).join(", "));
check("a tool card wears its /tools slot, a workflow its workflow slot, a category its card slot",
  allCards.find((c) => c.key === "ai_shadow")?.slot === "tools.ai_shadow.card"
  && allCards.find((c) => c.key === "ecommerce.packshot")?.slot === "category.ecommerce.workflow.packshot.card"
  && allCards.find((c) => c.key === "cat:moda")?.slot === "dashboard.category.moda.card");
check("only video tools carry the play mark", allCards.every((c) => c.video === c.key.startsWith("video_")));
check("the rail's Wideo UGC tile is the video module's UGC workflow",
  RAIL[0] === "video_ugc" && railCards(DEFAULTS)[0]?.href === "/wideo");

/* ── B ─────────────────────────────────────────────────────────────────── */
section("B. THE SWITCHBOARD IS OBEYED, AS IN THE MENUS");

check("on the shipped defaults, video is drawn and badged, never open",
  videoCards(DEFAULTS).length > 0 && videoCards(DEFAULTS).every((c) => c.badge === "soon"));
check("an inert card never carries a shipped photograph (a claim about output)",
  [...railCards(DEFAULTS), ...effectCards(DEFAULTS), ...videoCards(DEFAULTS)]
    .every((c) => c.badge === null || c.art.kind === "motif"));
check("a DISABLED tool leaves the Home",
  !keys(railCards(withStatus({ [featureForHref("/tools/ai_shadow") as FeatureKey]: "DISABLED" }))).includes("ai_shadow"));
check("a DISABLED category leaves the Home, with its workflows",
  !keys(chipCards(withStatus({ image_ecommerce: "DISABLED" }))).some((k) => k.startsWith("ecommerce."))
  && !keys(railCards(withStatus({ image_ecommerce: "DISABLED" }))).includes("ecommerce.thumbnail"));
check("a category merely hidden from the menu is not advertised",
  !keys(chipCards(withStatus({ image_moda: "HIDDEN" }))).includes("cat:moda"));
check("a category in maintenance is drawn, badged, inert",
  chipCards(withStatus({ image_ecommerce: "MAINTENANCE" })).filter((c) => c.key.startsWith("ecommerce."))
    .every((c) => c.badge === "maintenance"));
check("the hub switched off hides the categories that open through it",
  !keys(railCards(withStatus({ tools: "DISABLED" }))).includes("cat:moda"));
check("an admin sees every card, as in the menus",
  railCards(withStatus({ image_moda: "DISABLED" }), true).some((c) => c.key === "cat:moda"));
check("the Packshoty button opens the packshot workflow when it runs…",
  openHref("ecommerce.packshot", ALL_ACTIVE) === "/k/ecommerce/packshot");
check("…and the page's primary action, never a Wkrótce screen, when it does not",
  openHref("ecommerce.packshot", withStatus({ image_ecommerce: "COMING_SOON" })) === "/prompts"
  && openHref("ecommerce.packshot", withStatus({ image_ecommerce: "DISABLED" })) === "/prompts");
const promptsKey = featureForHref("/prompts") as FeatureKey;
check("the primary action is Generator Grovshot while it is open",
  startHref(ALL_ACTIVE) === "/prompts" && startHref(DEFAULTS) === "/prompts");
check("…the tool hub when the generator is closed (the old Start's own fallback)",
  startHref(withStatus({ [promptsKey]: "DISABLED" })) === "/tools"
  && startHref(withStatus({ [promptsKey]: "MAINTENANCE" })) === "/tools"
  && startHref(withStatus({ [promptsKey]: "COMING_SOON" })) === "/tools");
check("…and nothing — inert, never a 404 — when neither is open",
  startHref(withStatus({ [promptsKey]: "DISABLED", tools: "DISABLED" })) === null
  && openHref("ecommerce.packshot", withStatus({ [promptsKey]: "DISABLED", tools: "DISABLED", image_ecommerce: "DISABLED" })) === null);
check("the Wideo UGC band exists only while video is on the menu, with the module's own badge",
  homeModel(DEFAULTS).ugc?.badge === "soon"
  && homeModel(withStatus({ [featureForHref("/wideo") as FeatureKey]: "DISABLED" })).ugc === null);

/* ── C ─────────────────────────────────────────────────────────────────── */
section("C. THE GALLERIES ARE MEDIA SLOTS — AND NO PICTURE LOSES ITS SLOT");

const homeSlots = MEDIA_SLOTS.filter((s) => s.entityType === "section" && s.entityId === "home");
const g = HOME_GALLERY;
check("the Home declares exactly its banner art and every gallery tile",
  homeSlots.length === 2 + g.packshotSquares + g.packshotWide + g.ugcClips + g.adsTall + g.adsWide, `${homeSlots.length}`);
check("every gallery tile's admin frame is 5:4 (only the two banner backgrounds are wide)",
  homeSlots.filter((s) => s.key !== HOME_SLOT.grovshotArt && s.key !== HOME_SLOT.ugcArt).every((s) => s.ratio === "5/4")
  && slotDef(HOME_SLOT.grovshotArt)?.ratio === "3/1" && slotDef(HOME_SLOT.ugcArt)?.ratio === "3/1");
check("every gallery tile takes a clip as well as a picture", homeSlots.every((s) => s.video));
check("each numbered tile is named with its number in the admin",
  homeSlots.filter((s) => /\.\d+\.media$/.test(s.key)).every((s) => typeof s.labelVars?.n === "number"));
check("the slot keys are unique", new Set(MEDIA_SLOTS.map((s) => s.key)).size === MEDIA_SLOTS.length);
// The rows production holds today (read-only SELECT on media_slots, PROD).
// Every one of them must still be a declared slot, or its picture would
// vanish from the page and from the admin.
const PROD_ROWS = [
  "category.moda.workflow.flatlay.card", "category.moda.workflow.iron.card", "tools.compress.card",
  "tools.expand.card", "tools.ghost_mannequin.card", "tools.remove_bg.card", "tools.resize.card",
  "tools.retouch.card",
];
check("every picture production already holds keeps a declared slot", PROD_ROWS.every(isKnownSlot),
  PROD_ROWS.filter((k) => !isKnownSlot(k)).join(", "));
check("the retired dashboard hero is gone (no row was ever written under it)", !isKnownSlot("dashboard.hero.art"));
const model = homeModel(DEFAULTS);
check("the loader asks for exactly the page's slots, all declared",
  model.slotKeys.every(isKnownSlot) && homeSlots.every((s) => model.slotKeys.includes(s.key))
  && model.slotKeys.length < MEDIA_SLOTS.length, `${model.slotKeys.length} of ${MEDIA_SLOTS.length}`);
const gallery = code("components/home/home-gallery.tsx");
check("an empty tile draws the neutral motif — never a borrowed photograph",
  /GalleryArt/.test(gallery) && !/showcase/.test(gallery)
  && /fallback=\{floor\}/.test(code("components/home/card-art.tsx")));
check("no duration is invented for a clip (a slot has none)", !/duration|0:1\d|\d+ ?s\b/.test(gallery));
const banner = code("components/home/grovshot-banner.tsx");
check("the GrovShot banner keeps its own shipped frames only while its art slot is empty",
  /\{!art && <Frame/.test(banner) && /GROVSHOT_SHOTS/.test(banner) && /HOME_SLOT\.grovshotArt/.test(banner));
check("a video tool keeps its play mark once an operator dresses it (clip or still poster)",
  /const isVideo = video \? Boolean\(slotted\) \|\| art\.kind === "photo" : slotted\?\.mediaType === "video";/.test(code("components/home/card-art.tsx")));

/* ── D ─────────────────────────────────────────────────────────────────── */
section("D. ONE IMPLEMENTATION: /start, /home AND \"/\"");

const homePage = code("app/(app)/home/page.tsx");
check("the signed-in Start renders the shared Home in the app shell",
  /<ProductSurface scope="shell" \/>/.test(homePage));
check("…and nothing of the old dashboard (stats, greeting, tip, recent work)",
  !/getWallet|listAssets|Greeting|TipBanner|HeroArt|generations|createSignedUrls/.test(homePage));
check("the old dashboard's components are deleted",
  !fs.existsSync("components/home/greeting.tsx") && !fs.existsSync("components/dashboard/tip-banner.tsx")
  && !fs.existsSync("components/dashboard/hero-art.tsx"));
check("the Start keeps its availability gate", /FeatureGate feature="home"/.test(code("app/(app)/home/layout.tsx")));
const slugPage = code("app/[slug]/page.tsx");
const rootPage = code("app/page.tsx");
check("/start (a CMS page of kind app) renders the same surface",
  /page\?\.kind === "app"/.test(slugPage) && /<ProductSurface \/>/.test(slugPage));
check("\"/\" renders the same surface when the app page is the homepage",
  /target\?\.kind === "app"\) return <ProductSurface \/>/.test(rootPage));
const surface = code("components/home/product-surface.tsx");
check("one loader, one body: both scopes render ProductHome from homeModel",
  (surface.match(/<ProductHome /g) ?? []).length === 1 && /homeModel\(availability, isAdmin, layout\)/.test(surface));
check("the shell scope draws no second bar, drawer or <main>",
  surface.indexOf('if (!chrome) return body;') < surface.indexOf("<MegaTopbar"));
check("the loader resolves every slot in one read", (surface.match(/loadSlots\(/g) ?? []).length === 1);
check("a visitor costs no private read: member data, admin check and campaigns only with a user",
  /user \? memberChrome\(/.test(surface) && /user \? viewerIsAdmin\(/.test(surface) && /user \? loadBanners\(/.test(surface));
const productHome = code("components/home/product-home.tsx");
const order = ["rail-x-sm", "<StartBox", 'id="home-effects"', "<GrovshotBanner", 'id="packshoty"', "<UgcBanner", 'id="home-ads"', 'id="home-video"'];
check("the sections follow the reference order",
  order.every((s, i) => productHome.indexOf(s) > (i === 0 ? -1 : productHome.indexOf(order[i - 1]))),
  order.map((s) => `${s}@${productHome.indexOf(s)}`).join(" "));

/* ── E ─────────────────────────────────────────────────────────────────── */
section("E. cms_pages.is_homepage STAYS THE ONE SOURCE OF TRUTH");

check("\"/\" is still decided by getActiveHomepage() alone", /getActiveHomepage\(\)/.test(rootPage)
  && !/\/start/.test(rootPage) && !/redirect\("\/start"\)/.test(rootPage));
check("the launch page still renders at \"/\" when it is the homepage",
  /target\?\.kind === "launch"/.test(rootPage) && /<LaunchPage/.test(rootPage));
check("/start forwards to \"/\" only when getActiveHomepage() says it IS the homepage",
  /if \(\(await getActiveHomepage\(\)\)\?\.slug === slug\) redirect\(withQuery\("\/", await searchParams\)\);/.test(slugPage));
check("…with a temporary redirect, since the flag can move back", !/permanentRedirect/.test(slugPage));
check("…with the query string carried over (campaign tags, the dialog's ?auth=&next=)",
  /redirect\(withQuery\("\/", await searchParams\)\)/.test(slugPage) && /qs\.append\(key, v\)/.test(slugPage));
check("…and names \"/\" as its canonical address meanwhile",
  /canonical: "\/"/.test(slugPage));
const sitemap = code("app/sitemap.ts");
check("the sitemap leaves out only the forwarding app page, asked through the same resolver",
  /getActiveHomepage\(\)/.test(sitemap) && /home\?\.kind === "app" \? home\.slug : null/.test(sitemap)
  && /p\.slug !== forwarded/.test(sitemap) && !/is_homepage/.test(sitemap));
check("the CMS preview of the app page shows the Home as \"/\" (admin-only), not an empty block list",
  /if \(page\.kind === "app"\) redirect\(`\/\?preview=\$\{encodeURIComponent\(slug\)\}`\);/.test(code("app/podglad/[slug]/page.tsx")));
check("Admin → Strony WWW names the app kind in every language",
  ["pl", "en", "de"].every((l) => typeof (JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).cms as Record<string, unknown>)["kind.app"] === "string"));
check("no second homepage switch was added (no app_settings.homepage, no new resolver)",
  !/app_settings[\s\S]{0,80}homepage/.test(surface + slugPage + rootPage)
  && fs.readdirSync("lib/server").filter((f) => /homepage/.test(f)).length === 1);

/* ── F ─────────────────────────────────────────────────────────────────── */
section("F. A VISITOR EXPLORES; THE SERVER KEEPS THE DOORS");

check("/start is public", !isProtectedPath("/start"));
for (const p of ["/home", "/prompts", "/tools", "/tools/ai_shadow", "/k/moda", "/k/ecommerce/packshot", "/retusz", "/wideo", "/library", "/credits", "/settings"]) {
  check(`${p} is still refused to a visitor by the middleware`, isProtectedPath(p));
}
check("the (app) layout still sends a visitor to sign in", /if \(!user\) redirect\("\/login"\)/.test(code("app/(app)/layout.tsx")));
check("the (app) layout still runs the login-security gate", /enforceLoginSecurity\(supabase\)/.test(code("app/(app)/layout.tsx")));
for (const route of ["app/api/generate/route.ts", "app/api/tools/run/route.ts", "app/api/tools/save/route.ts", "app/api/retouch/route.ts", "app/api/fashion/route.ts", "app/api/prompts/generate/route.ts"]) {
  const src = code(route);
  check(`${route} answers 401 without a session`, /auth\.getUser\(\)/.test(src) && /status: 401/.test(src));
}
const cards = code("components/home/product-cards.tsx");
check("every open card, chip and pill is a Gate (the existing auth dialog for a visitor)",
  /<Gate href=\{card\.href\}/.test(cards) && /: <Gate key=\{card\.key\}|<Gate href=\{card\.href\} signedIn=\{signedIn\} className=\{cls\}>/.test(cards)
  && /<Gate href=\{href\} signedIn=\{signedIn\} mode=\{mode\}/.test(cards));
check("an inert card is a span, never a link", /if \(inert\) \{\s*return <span className=\{cls\} aria-disabled/.test(cards));
check("\"Wypróbuj za darmo\" opens the dialog on registration", /mode = "register"/.test(cards));
const gate = code("components/home/gate.tsx");
check("the Gate opens the EXISTING dialog, no second sign-in system", /useAuthDialog\(\)/.test(gate) && /auth\.open\(mode, href\)/.test(gate));
const drop = code("components/home/drop-door.tsx");
check("a dropped file is never read, stored or sent — the drop opens the same door as the button",
  !/FileReader|fetch\(|upload|storage|arrayBuffer|\.files\[|getAsFile/.test(drop)
  && /onDrop=\{\(e\) => \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?go\(\);/.test(drop));
check("with no open door, a held file is refused rather than accepted", /dropEffect = href \? "copy" : "none"/.test(drop));
check("a press on the box opens the same door as its button", /auth\.open\("login", href\)/.test(drop) && /router\.push\(href\)/.test(drop));
check("the highlight counts enters and leaves (no relatedTarget: WebKit reports it null)",
  /depth\.current/.test(drop) && !/relatedTarget/.test(drop));
check("a clip plays only while it is on screen", /else el\.pause\(\)/.test(code("components/media/slot-video.tsx")));
check("decorative banner art cannot take focus (inert)",
  /aria-hidden inert/.test(code("components/home/grovshot-banner.tsx")) && /aria-hidden inert/.test(code("components/home/home-gallery.tsx")));
check("\"Za darmo\" is said only to a visitor; a customer's button just says try it",
  /signedIn \? t\("home2\.tryIt"\) : t\("home2\.tryFree"\)/.test(productHome));
check("\"Zobacz przykłady\" appears only once Packshoty holds an example",
  /examplesHref=\{hasExamples \? HOME_ROUTES\.examples : null\}/.test(productHome) && /\{examplesHref && \(/.test(banner));
check("the Start's campaigns are the LIVE ones for every viewer, admins included",
  /\.eq\("active", true\)/.test(code("lib/server/media-slots.ts"))
  && /Date\.parse\(b\.starts_at\) <= now/.test(code("lib/server/media-slots.ts"))
  && /Date\.parse\(b\.ends_at\) > now/.test(code("lib/server/media-slots.ts")));

/* ── G ─────────────────────────────────────────────────────────────────── */
section("G. THE BOTTOM NAVIGATION'S START IS THIS PAGE, ONCE");

const starts = DOCK_SLOTS.filter((s) => s.href === "/home");
check("exactly one dock slot opens /home", starts.length === 1 && starts[0]?.key === "home");
check("the dock keeps Start / Biblioteka / Generuj / Narzędzia / Profil", DOCK_SLOTS.length === 5);
check("on /home exactly one tab is lit, and it is Start",
  DOCK_SLOTS.filter((s) => dockSlotActive(s, "/home")).map((s) => s.key).join() === "home");
check("on /start (the public Home) no dock tab claims to be active",
  DOCK_SLOTS.every((s) => !dockSlotActive(s, "/start")));

/* ── H ─────────────────────────────────────────────────────────────────── */
section("H. EVERY WORD IS IN THE DICTIONARY, IN PL, EN AND DE");

type Dict = Record<string, unknown>;
const dicts = Object.fromEntries(["pl", "en", "de"].map((l) => [l, JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as Dict]));
const lookup = (d: Dict, key: string): unknown => {
  const [ns, ...rest] = key.split(".");
  const bag = d[ns] as Dict | undefined;
  if (!bag) return undefined;
  const flat = bag[rest.join(".")];
  if (flat !== undefined) return flat;
  return rest.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Dict)[k] : undefined), bag);
};
const homeSources = ["components/home/product-home.tsx", "components/home/product-cards.tsx", "components/home/start-box.tsx",
  "components/home/grovshot-banner.tsx", "components/home/home-gallery.tsx"].map(code).join("\n");
const usedKeys = [...new Set([...homeSources.matchAll(/t\("([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]))];
const cardKeys = [...new Set(allCards.flatMap((c) => [c.titleKey, c.subKey].filter((k): k is string => Boolean(k))))];
const slotLabels = [...new Set(homeSlots.flatMap((s) => [s.labelKey, s.fallbackKey]).concat("media.section.home"))];
for (const lang of ["pl", "en", "de"]) {
  const missing = [...usedKeys, ...cardKeys, ...slotLabels].filter((k) => typeof lookup(dicts[lang], k) !== "string");
  check(`${lang}: every key the Home, its cards and its slots use exists`, missing.length === 0, missing.join(", "));
}
check("no user-facing Polish is typed into the Home's markup",
  !/>[^<{]*[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ][^<{]*</.test(homeSources));
check("the old dashboard's words went with it (no orphaned home.* namespace)",
  ["pl", "en", "de"].every((l) => dicts[l].home === undefined));

console.log(failed === 0 ? "\nALL HOME TESTS PASS" : `\n${failed} HOME TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);

/**
 * ULUBIONE V2 — the heart's rules, checked without a browser (the browser
 * side: the Playwright run and the ON/OFF screenshots in the report).
 *
 *   A. saving: optimistic, serialised per generation, the last click wins,
 *      a refusal puts back the confirmed state
 *   B. one button everywhere; a click is only a like
 *   C. the colour and the ring (token, ring switch, reduced motion)
 *   D. the image view: the labelled button and F
 *   E. selection mode and the counter
 *   F. the copy in PL, EN and DE
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFavoriteSaver, type FavoriteHandlers } from "../lib/favorites/use-favorite-toggle";
import pl from "../lib/i18n/dictionaries/pl.json";
import en from "../lib/i18n/dictionaries/en.json";
import de from "../lib/i18n/dictionaries/de.json";

let failed = 0;
let passed = 0;
function section(title: string) { console.log(`\n${title}`); }
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/** A fake RPC whose answers the test releases one by one. */
function rig(fail = false) {
  const calls: boolean[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const pending: (() => void)[] = [];
  const shown = new Map<string, boolean>();
  const log = { errors: 0, saved: [] as boolean[] };
  const handlers: FavoriteHandlers = {
    apply: (id, v) => { shown.set(id, v); },
    onError: () => { log.errors += 1; },
    onSaved: (_id, v) => { log.saved.push(v); },
  };
  const save = (_id: string, value: boolean) => new Promise<{ error: unknown }>((resolve) => {
    calls.push(value);
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    pending.push(() => { inFlight -= 1; resolve({ error: fail ? new Error("refused") : null }); });
  });
  const toggle = createFavoriteSaver(save, () => handlers);
  const flush = async () => { for (let i = 0; i < 20; i++) { const next = pending.shift(); if (next) next(); await new Promise((r) => setTimeout(r, 0)); } };
  return { calls, shown, log, toggle, flush, max: () => maxInFlight };
}

async function main() {
  /* ── A ─────────────────────────────────────────────────────────────────── */
  section("A. saving");
  {
    const r = rig();
    void r.toggle("g", false);
    check("the heart changes before the server answers", r.shown.get("g") === true && r.calls.length === 1);
    await r.flush();
    check("one click → one save, confirmed", r.calls.join() === "true" && r.log.saved.join() === "true");
  }
  {
    const r = rig();
    // Five fast clicks starting from "not liked": like, unlike, like, unlike, like.
    let state = false;
    for (let i = 0; i < 5; i++) { void r.toggle("g", state); state = !state; }
    check("fast clicks: the screen follows every click", r.shown.get("g") === true);
    await r.flush();
    check("fast clicks: never two saves in the air", r.max() === 1, `max=${r.max()}`);
    check("fast clicks: the last click is what the server ends with", r.calls[r.calls.length - 1] === true, r.calls.join());
    check("fast clicks: no more saves than needed (≤ 2)", r.calls.length <= 2, r.calls.join());
  }
  {
    const r = rig();
    // Like then unlike before the first save returns → back where it started.
    void r.toggle("g", false); void r.toggle("g", true);
    await r.flush();
    check("like + unlike in flight ends unliked on the server", r.calls[r.calls.length - 1] === false && r.shown.get("g") === false, r.calls.join());
  }
  {
    const r = rig(true);
    void r.toggle("g", false);
    check("optimistic before a refusal", r.shown.get("g") === true);
    await r.flush();
    check("a refusal puts the confirmed state back", r.shown.get("g") === false);
    check("…and says so once", r.log.errors === 1);
  }
  {
    const r = rig();
    void r.toggle("a", false); void r.toggle("b", false);
    await r.flush();
    check("two generations save independently", r.calls.length === 2 && r.shown.get("a") === true && r.shown.get("b") === true);
    // A bulk like elsewhere set "a" true; the tile shows true; un-liking it must still be sent.
    void r.toggle("a", true);
    await r.flush();
    check("a state changed elsewhere is still saved", r.calls[r.calls.length - 1] === false, r.calls.join());
  }
  const hook = read("lib/favorites/use-favorite-toggle.ts");
  check("the save is the existing RPC (no new API, no new table)", /rpc\("set_generation_favorite", \{ gen_id: id, value \}\)/.test(hook));

  /* ── B ─────────────────────────────────────────────────────────────────── */
  section("B. one button everywhere");
  const button = read("components/media/favorite-button.tsx");
  const library = read("components/library/library-browser.tsx");
  const gallery = read("components/genv3/gallery.tsx");
  const details = read("components/genv3/image-details.tsx");
  check("Library tiles use the shared heart", /<FavoriteButton active=\{item\.favorite\} onToggle=\{onFavorite\}/.test(library));
  check("tool / generator galleries use the shared heart", /<FavoriteButton active=\{item\.favorite\} onToggle=\{onFavorite\}/.test(gallery));
  check("the image view uses the shared heart (labelled)", /<FavoriteButton variant="wide" active=\{item\.favorite\}/.test(details));
  check("both galleries save through the shared saver", /useFavoriteToggle\(/.test(library) && /useFavoriteToggle\(/.test(gallery));
  check("a click is only a like (no open, no tick, no tile handler)",
    /e\.preventDefault\(\);\s*e\.stopPropagation\(\);/.test(button) && /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/.test(button));
  check("aria-pressed + the two labels", /aria-pressed=\{active\}/.test(button) && /library\.favRemove/.test(button) && /library\.favAdd/.test(button));
  check("the pop plays on a like only", /if \(!active\) setPop/.test(button));
  check("no old heart is left in the gallery rail", !/key: "fav"/.test(gallery));
  check("no bottom-left mini heart left on generator cards", !/absolute bottom-2 left-2 text-accent"><Heart/.test(gallery));

  /* ── C ─────────────────────────────────────────────────────────────────── */
  section("C. the colour and the ring");
  const css = read("app/globals.css");
  check("--color-favorite: #EF4444 and its RGB triplet", /--color-favorite: #EF4444;/.test(css) && /--favorite: 239 68 68;/.test(css));
  check("one value for light and dark (no .dark override)", !/\.dark[^{]*\{[^}]*--favorite/.test(css));
  check("Tailwind `favorite` maps to the token", /favorite: "rgb\(var\(--favorite\) \/ <alpha-value>\)"/.test(read("tailwind.config.ts")));
  check("hit area 40px, pill 32px, heart 18px", /width: 40px; height: 40px/.test(css) && /width: 32px; height: 32px/.test(css) && /width: 18px; height: 18px/.test(css));
  check("pill: rgba(17,17,17,0.6), blur, 1px white 25% border",
    /background: rgba\(17, 17, 17, 0\.6\)/.test(css) && /backdrop-filter: blur\(8px\)/.test(css) && /border: 1px solid rgba\(255, 255, 255, 0\.25\)/.test(css));
  check("not liked: hidden until hover/focus with a pointer, quieter on touch",
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.fav-tile\[aria-pressed="false"\] \{ opacity: 0; \}/.test(css)
    && /\.group:hover \.fav-tile, \.group:focus-within \.fav-tile, \.fav-tile:focus-visible \{ opacity: 1; \}/.test(css));
  check("the ring: 2px inset at 70% (no size change)", /\.fav-ring \{ box-shadow: inset 0 0 0 2px rgb\(var\(--favorite\) \/ 0\.7\); \}/.test(css));
  check("the ring follows the admin switch", /\[data-favorite-ring="off"\] \.fav-ring \{ display: none; \}/.test(css)
    && /data-favorite-ring=\{favoriteRing \? "on" : "off"\}/.test(read("app/(app)/layout.tsx")));
  check("the switch defaults ON and is never overwritten",
    /'\{"favorite_ring": true\}'/.test(read("supabase/migrations/0160_notifications_v2.sql"))
    && /where not \(public\.app_settings\.value \? 'favorite_ring'\)/.test(read("supabase/migrations/0160_notifications_v2.sql"))
    && /value\.favorite_ring !== false/.test(read("lib/server/appearance.ts")));
  check("the pop: 1 → 1.25 → 1, and none with reduced motion",
    /transform: scale\(1\.25\)/.test(css) && /prefers-reduced-motion: reduce\) \{\s*\.fav-pop svg \{ animation: none; \}/.test(css));
  check("the active filter is red, not magenta", /border-favorite\/45 bg-favorite\/12 text-favorite/.test(library) && /border-favorite\/50 bg-favorite\/10 text-favorite/.test(gallery));

  /* ── D ─────────────────────────────────────────────────────────────────── */
  section("D. the image view");
  const onKey = details.slice(details.indexOf("const onKey = (e: KeyboardEvent)"), details.indexOf("window.addEventListener(\"keydown\", onKey);"));
  check("F toggles the picture on screen", /e\.key === "f" \|\| e\.key === "F"/.test(onKey) && /onFavorite\(current\)/.test(onKey));
  check("…never while typing (the editing guard comes first)", onKey.indexOf("if (editing) return;") > 0 && onKey.indexOf("if (editing) return;") < onKey.indexOf('e.key === "f"'));
  check("…never with a modifier or a held key", /!e\.metaKey && !e\.ctrlKey && !e\.altKey && !e\.repeat/.test(onKey));
  check("Escape and the arrows are unchanged", /if \(e\.key === "Escape"\)/.test(onKey) && /e\.key === "ArrowLeft" && index > 0/.test(onKey) && /e\.key === "ArrowRight" && index < items\.length - 1/.test(onKey));
  check("the view and the grid share one state (Library passes its own toggle)", /onFavorite=\{\(g\) => \{ const full = items\.find/.test(library));

  /* ── E ─────────────────────────────────────────────────────────────────── */
  section("E. selection mode and the counter");
  check("Library checkbox: hover/focus with a pointer, always while selecting or ticked, always on touch",
    /!picked && !selecting && "\[@media\(hover:hover\)\]:opacity-0/.test(library) && /selecting=\{picked\.size > 0\}/.test(library));
  check("the checkbox stops its click (it never opens the picture)", /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onPick\(\); \}\}/.test(library));
  check("checkbox (left) and heart (right) are in opposite corners",
    /absolute left-2 top-2 z-\[2\]/.test(library) && /className="absolute right-1 top-1 z-\[2\]"/.test(library));
  const galleryServer = read("lib/server/gallery.ts");
  check("the counter is counted by the database over the whole shelf",
    /export async function countFavoriteAssets/.test(galleryServer) && /count: "exact", head: true/.test(galleryServer)
    && /countFavoriteAssets\(supabase, workspace\.id, "image"\)/.test(read("app/(app)/library/page.tsx")));
  check("the counter moves with a like, without a reload", /setFavCount\(\(n\) =>/.test(library));
  check("the filter itself is unchanged (still the server's fav=1 query)", /if \(favOnly\) p\.set\("fav", "1"\);/.test(library));

  /* ── F ─────────────────────────────────────────────────────────────────── */
  section("F. the copy");
  for (const [name, dict] of [["PL", pl], ["EN", en], ["DE", de]] as const) {
    const lib = (dict as { library: Record<string, string> }).library;
    check(`${name}: add / remove / in favourites / failed`, ["favAdd", "favRemove", "favIn", "favFailed"].every((k) => typeof lib[k] === "string" && lib[k].length > 0));
  }
  const plLib = (pl as { library: Record<string, string> }).library;
  check("PL labels as specified", plLib.favAdd === "Dodaj do ulubionych" && plLib.favRemove === "Usuń z ulubionych" && plLib.favIn === "W ulubionych");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();

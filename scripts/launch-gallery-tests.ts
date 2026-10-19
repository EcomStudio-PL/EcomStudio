/**
 * THE LAUNCH PAGE'S GALLERIES — the pure rules the panel and the server share.
 *
 *   A  pairing files by name: "produkt-01-przed.JPG" + "produkt-01-po.webp"
 *      is one pair; extra hyphens, case, missing halves, two of a half, files
 *      without a suffix — the same rule the /home bulk upload uses (one
 *      implementation, re-exported by bulk-panel.tsx)
 *   B  a gallery drop: which formats are taken, what does not fit
 *   C  moving a pair: drag-and-drop and ↑ / ↓ never lose or duplicate one
 *   D  the history: each distinct gallery state once, the newest kept, key
 *      order irrelevant (jsonb hands objects back in its own order)
 *
 * Pure — no DOM, no database. Run:
 *   esbuild scripts/launch-gallery-tests.ts --bundle --platform=node --format=cjs --alias:@=. \
 *     --alias:server-only=./scripts/server-only-stub.js --external:sharp \
 *     --outfile=.next/launch-gallery-tests.cjs --log-level=error && node .next/launch-gallery-tests.cjs
 */
import { canonicalJson } from "@/lib/cms";
import { GALLERY_MAX_ITEMS, type GalleryItem } from "@/lib/launch/gallery";
import { groupPairs, naturalCompare, pairSuffix } from "@/lib/ice/pairs";
import {
  GALLERY_BULK_ACCEPT, GALLERY_BULK_MIMES, dedupeVersions, galleryIdentity, moveBy, moveItem, planGalleryBulk,
} from "@/lib/ice/gallery";
import * as bulkPanel from "@/components/ice/editor/bulk-panel";

let failures = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let seq = 0;
const file = (name: string, type = "image/jpeg") => ({ id: `f${(seq += 1)}`, name, type });

/* ══ A. PAIRING BY NAME ═════════════════════════════════════════════════ */

console.log("A. PAIRING BY NAME");

check("A1 'produkt-01-przed.JPG' → base 'produkt-01', before (upper-case extension)",
  same(pairSuffix("produkt-01-przed.JPG"), { base: "produkt-01", side: "before" }));
check("A2 'produkt-01-po.webp' → base 'produkt-01', after",
  same(pairSuffix("produkt-01-po.webp"), { base: "produkt-01", side: "after" }));
check("A3 extra hyphens stay in the base: 'buty-zimowe-czarne-przed.png'",
  same(pairSuffix("buty-zimowe-czarne-przed.png"), { base: "buty-zimowe-czarne", side: "before" }));
check("A4 the suffix in any case, and -before / -after too",
  same(pairSuffix("Torba-PRZED.jpeg"), { base: "Torba", side: "before" })
  && same(pairSuffix("bag-After.png"), { base: "bag", side: "after" }) && same(pairSuffix("bag-before.jpg"), { base: "bag", side: "before" }));
check("A5 the LAST suffix wins: 'a-przed-po.jpg' is the after of 'a-przed'",
  same(pairSuffix("a-przed-po.jpg"), { base: "a-przed", side: "after" }));
check("A6 no hyphen, no suffix, a suffix in the middle or a bare suffix → null",
  pairSuffix("buty_przed.jpg") === null && pairSuffix("buty.jpg") === null
  && pairSuffix("przed-buty.jpg") === null && pairSuffix("-przed.jpg") === null && pairSuffix("przed.jpg") === null);

{
  const files = [
    file("produkt-01-przed.JPG"), file("produkt-01-po.webp", "image/webp"),
    file("produkt-10-przed.jpg"), file("produkt-10-po.jpg"),
    file("produkt-2-before.png", "image/png"), file("PRODUKT-2-AFTER.png", "image/png"),
  ];
  const { pairs, problems } = groupPairs(files);
  check("A7 three complete pairs, matched regardless of case, in natural order (2 before 10)",
    same(pairs.map((p) => p.name), ["produkt-01", "produkt-2", "produkt-10"]) && problems.length === 0, JSON.stringify(pairs.map((p) => p.name)));
  check("A7b each pair is [before, after], whatever order the files came in",
    pairs.every((p) => pairSuffix(p.files[0].name)?.side === "before" && pairSuffix(p.files[1].name)?.side === "after"));
}
{
  const lonely = [file("a-przed.jpg"), file("b-po.jpg"), file("c.jpg"), file("d-przed.jpg"), file("d-przed.png", "image/png"), file("d-po.jpg")];
  const { pairs, problems } = groupPairs(lonely);
  const why = Object.fromEntries(problems.map((p) => [p.file.name, p.reason]));
  check("A8 a lone before / a lone after / no suffix / two befores → no pair, every file reported with its reason",
    pairs.length === 0 && canonicalJson(why) === canonicalJson({ "a-przed.jpg": "missingAfter", "b-po.jpg": "missingBefore", "c.jpg": "noSuffix",
      "d-przed.jpg": "duplicate", "d-przed.png": "duplicate", "d-po.jpg": "duplicate" }), JSON.stringify(why));
  check("A8b nothing is guessed: no file appears in a pair AND in the problems",
    problems.length === lonely.length);
}
check("A9 bulk-panel.tsx re-exports the SAME functions (one implementation for /home and the galleries)",
  bulkPanel.pairSuffix === pairSuffix && bulkPanel.groupPairs === groupPairs);
check("A10 natural order: '2' before '10', case-insensitive", ["x10", "X2", "x1"].sort(naturalCompare).join() === "x1,X2,x10");

/* ══ B. A GALLERY DROP ══════════════════════════════════════════════════ */

console.log("\nB. A GALLERY DROP");

check("B1 a gallery takes JPEG, PNG and WebP — not AVIF, GIF or video",
  same([...GALLERY_BULK_MIMES], ["image/jpeg", "image/png", "image/webp"]) && /\.jpg/.test(GALLERY_BULK_ACCEPT)
  && /\.jpeg/.test(GALLERY_BULK_ACCEPT) && /\.png/.test(GALLERY_BULK_ACCEPT) && /\.webp/.test(GALLERY_BULK_ACCEPT) && !/avif|gif/.test(GALLERY_BULK_ACCEPT));
{
  const drop = [
    file("a-przed.jpg"), file("a-po.jpg"),
    file("b-przed.avif", "image/avif"), file("b-po.avif", "image/avif"),
    file("c-przed.gif", "image/gif"), file("c-po.png", "image/png"),
    file("clip-przed.mp4", "video/mp4"),
  ];
  const plan = planGalleryBulk(drop, 10);
  check("B2 other formats are rejected (and never paired), JPEG pairs pass",
    same(plan.pairs.map((p) => p.name), ["a"]) && same(plan.rejected.map((f) => f.name).sort(), ["b-po.avif", "b-przed.avif", "c-przed.gif", "clip-przed.mp4"]),
    JSON.stringify({ pairs: plan.pairs.map((p) => p.name), rejected: plan.rejected.map((f) => f.name) }));
  check("B2b a half whose partner was rejected is reported as missing its partner, not added",
    plan.problems.some((p) => p.file.name === "c-po.png" && p.reason === "missingBefore"));
}
{
  const many = Array.from({ length: 5 }, (_, i) => [file(`p${i + 1}-przed.jpg`), file(`p${i + 1}-po.jpg`)]).flat();
  const plan = planGalleryBulk(many, 3);
  check("B3 only as many pairs as fit; the rest are reported as overflow, never added",
    same(plan.pairs.map((p) => p.name), ["p1", "p2", "p3"]) && same(plan.overflow.map((p) => p.name), ["p4", "p5"]));
  check("B3b a full gallery takes none", planGalleryBulk(many, 0).pairs.length === 0 && planGalleryBulk(many, -4).overflow.length === 5);
  check(`B3c the room is capped at GALLERY_MAX_ITEMS (${GALLERY_MAX_ITEMS})`, planGalleryBulk(many, 10_000).pairs.length === 5);
}

/* ══ C. MOVING A PAIR ═══════════════════════════════════════════════════ */

console.log("\nC. MOVING A PAIR");

const L = ["a", "b", "c", "d"];
check("C1 drag the first onto the third: it takes that place", same(moveItem(L, 0, 2), ["b", "c", "a", "d"]));
check("C2 drag the last onto the first", same(moveItem(L, 3, 0), ["d", "a", "b", "c"]));
check("C3 drop on itself → unchanged (a copy, not the same array)", same(moveItem(L, 1, 1), L) && moveItem(L, 1, 1) !== L);
check("C4 out of range / not an integer → unchanged; never loses or duplicates",
  [moveItem(L, -1, 2), moveItem(L, 0, 4), moveItem(L, 5, 0), moveItem(L, 0.5, 2), moveItem(L, Number.NaN, 1)].every((x) => same(x, L)));
check("C5 ↑ / ↓ move one place; at the ends they do nothing",
  same(moveBy(L, 2, -1), ["a", "c", "b", "d"]) && same(moveBy(L, 2, 1), ["a", "b", "d", "c"])
  && same(moveBy(L, 0, -1), L) && same(moveBy(L, 3, 1), L));
{
  let list = [...L];
  const ops: [number, number][] = [[0, 3], [2, 1], [3, 0], [1, 2], [0, 0]];
  for (const [a, b] of ops) list = moveItem(list, a, b);
  check("C6 any sequence of moves is a permutation (nothing lost, nothing doubled)", same([...list].sort(), L), list.join());
  check("C7 the input is never mutated", same(L, ["a", "b", "c", "d"]));
}

/* ══ D. THE HISTORY ═════════════════════════════════════════════════════ */

console.log("\nD. THE HISTORY");

const U = (n: number) => `https://x.supabase.co/storage/v1/object/public/media/ice/${n}.jpg`;
const item = (id: string, a: number, b: number): GalleryItem => ({ id, before: { url: U(a) }, after: { url: U(b) } });
const A = [item("aaaaaaaa-0000-4000-8000-000000000001", 1, 2)];
const B = [item("aaaaaaaa-0000-4000-8000-000000000001", 1, 3)];
const reordered = [{ after: { url: U(2) }, id: "aaaaaaaa-0000-4000-8000-000000000001", before: { url: U(1) } }] as GalleryItem[];

check("D1 the identity does not depend on key order (jsonb reorders keys)", galleryIdentity(true, A) === galleryIdentity(true, reordered));
check("D2 … but does depend on the pairs, their order and the switch",
  galleryIdentity(true, A) !== galleryIdentity(true, B) && galleryIdentity(true, A) !== galleryIdentity(false, A)
  && galleryIdentity(true, [...A, ...B.map((x) => ({ ...x, id: "bbbbbbbb-0000-4000-8000-000000000002" }))])
    !== galleryIdentity(true, [...B.map((x) => ({ ...x, id: "bbbbbbbb-0000-4000-8000-000000000002" })), ...A]));
check("D3 canonicalJson sorts keys at every depth and drops undefined members",
  canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } }) === "{\"a\":{\"d\":[3,{\"x\":2,\"y\":1}]},\"b\":1}");
{
  const rows = [
    { v: 9, fingerprint: "B" }, { v: 8, fingerprint: "A" }, { v: 7, fingerprint: "A" },
    { v: 6, fingerprint: "B" }, { v: 5, fingerprint: "C" }, { v: 4, fingerprint: "A" },
  ];
  const out = dedupeVersions(rows);
  check("D4 each distinct state once, the NEWEST occurrence kept, newest first",
    same(out.map((r) => r.v), [9, 8, 5]), JSON.stringify(out));
  check("D5 at most `max` states", same(dedupeVersions(rows, 2).map((r) => r.v), [9, 8]) && dedupeVersions([], 20).length === 0);
  const twenty = Array.from({ length: 50 }, (_, i) => ({ v: 50 - i, fingerprint: `f${i % 25}` }));
  check("D6 the default cap is 20", dedupeVersions(twenty).length === 20 && dedupeVersions(twenty)[0].v === 50);
}

console.log(`\n${failures === 0 ? `All launch-gallery tests passed (${passed} checks).` : `${failures} LAUNCH-GALLERY TEST(S) FAILED (${passed} passed).`}`);
process.exit(failures === 0 ? 0 : 1);

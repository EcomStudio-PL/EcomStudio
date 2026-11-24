/**
 * GROVBASE SHOT — THE KNOWLEDGE BASE FILE (Markdown), read for the engine.
 *
 * The engine's knowledge is ONE Markdown file per version. Importing it is
 * NOT a format check: any readable .md file is saved byte for byte as a new,
 * inactive version. This reader takes from it what code inserts into the
 * image prompt VERBATIM — each recipe's KIERUNEK, the special rules' prompt
 * blocks, the footers, the negative base — and hands EVERYTHING ELSE to the
 * models of steps 2–4 as their instructions. No part of the file is dropped:
 * an unknown section reaches every step, a footer row code cannot check
 * reaches the scene step as an instruction, a special rule without a flag is
 * an always-on rule.
 *
 * Two ways of writing the same thing are read:
 *   · headings with prefixes (the files of 07–08.11): "### Przepis: …" with
 *     "- id:", "#### KIERUNEK", "### Flaga: x – …" with "#### Blok do
 *     promptu", "### Stopka: key" with "- typ: / - ludzie: / - domyslna:";
 *   · the plain style (15.11): "### dom_ikea", KIERUNEK in a code block,
 *     "Kategorie: / Negative:" lines, "(flaga: x)" / "(zawsze)" in a special
 *     rule's heading, the footers as a table "Typ ujęcia | Stopka".
 * A file the engine cannot run on (no recipe with a KIERUNEK, no footer) is
 * still saved — as a draft that cannot be activated (kbBlockers, readKb).
 * Pure: no I/O, no model call.
 *
 * Section names and the words read from the file live in KB_FORMAT below —
 * never in a component.
 */

import { imageBlockIssues } from "@/lib/grovshot-shot/image-rules";

export const KB_STAGES = ["karta", "plan", "produkt", "sceny"] as const;
export type KbStage = (typeof KB_STAGES)[number];

export const SHOT_TYPES = ["hero", "uzycie", "detal"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];
export const PEOPLE = ["brak", "dlonie", "postacie"] as const;
export type People = (typeof PEOPLE)[number];

/** What the reader recognises in a file (names compared without case, diacritics or a leading "3."). */
export const KB_FORMAT = {
  maxChars: 300_000,
  /** The sections code reads specially (a heading equal to a name, or starting with it). None is required to SAVE a file. */
  sections: {
    recipes: ["Przepisy stylu", "Przepisy"],
    planRules: ["Reguły planu"],
    special: ["Reguły specjalne"],
    footers: ["Stopki", "Stopka"],
    negative: ["Negative bazowy", "Negative"],
    directions: ["Kierunki kreatywne"],
    binding: ["Blok wiązania zdjęć"],
  },
  /** The keys of the binding section ("- klucz: szablon"); {lista}, {n}, {opis} are filled by code. A missing key = the engine's own text for it. */
  bindingKeys: ["calosc_1", "calosc_n", "detal", "pomocnicze", "logo", "detal_glowny", "kontekst"] as readonly string[],
  recipePrefix: "Przepis:",
  specialPrefix: "Flaga:",
  footerPrefix: "Stopka:",
  blocks: { direction: "KIERUNEK", promptBlock: "Blok do promptu", rules: "Zasady", negative: "Negative" },
  /** "Kategorie: …" lines (with or without "- " or bold) read as a recipe's data; the rest of a recipe is its rules. */
  recipeLabels: ["id", "Kategorie", "Hasło", "Sprawdzony na", "Pochodny", "Negative", "KIERUNEK"] as readonly string[],
  specialLabels: ["Flaga", "Pochodny"] as readonly string[],
  footerLabels: ["typ", "ludzie", "przepis", "flaga", "domyślna"] as readonly string[],
  /** A special rule marked so in its heading ("Postacie (zawsze)") applies to every product. */
  alwaysWords: ["zawsze", "always"] as readonly string[],
  /**
   * The words of a footer row's label ("makro, detal", "hero produktu bez
   * ludzi") that name a condition code can check per shot. "," "/" ";" "lub"
   * separate alternatives; any other word is compared with the recipe ids
   * ("zwierzęta" → zwierzeta, "wnętrze" → wnetrza_premium). A row with no
   * checkable condition, or with a placeholder like "[element w ruchu]",
   * goes to the scene step as an instruction.
   */
  footerWords: {
    detal: ["detal", "detale", "detalu", "makro", "zbliżenie", "zbliżenia"],
    hero: ["hero", "packshot"],
    uzycie: ["akcja", "akcji", "użycie", "użycia", "w użyciu"],
    brak: ["bez ludzi", "bez postaci", "bez osób", "sam produkt"],
    dlonie: ["dłonie", "dłoń", "w dłoni", "dłoni"],
    postacie: ["postać", "postacie", "postaci", "osoba", "osoby"],
    /** People of any kind: hands or figures. */
    ludzie: ["ludzie", "ludzi", "człowiek"],
    isDefault: ["domyślna", "domyślnie", "pozostałe", "pozostałych", "inne", "default"],
    ignore: ["produkt", "produktu", "produkty", "we", "w", "z", "ze", "na", "i", "oraz", "typ", "ujęcie", "ujęcia", "ujęć"],
  },
  /** Written before the footer rows code cannot check, in the scene step's instructions. */
  footerInstructions: "Stopkę każdego ujęcia dopisuje kod. Poniższe wiersze nie mają warunku, który kod umie sprawdzić – uwzględnij je w opisie sceny, jeśli pasują do ujęcia (nie dopisuj samej stopki):",
  peopleTable: "Ludzie i zwierzęta",
  /** The only placeholder code fills: the Product Lock, where it stands. */
  placeholders: ["fidelity_rules"] as readonly string[],
  /** "<!-- etapy: plan, sceny -->" under a ## heading; "prompty" = produkt + sceny. No comment = every step. */
  stageWords: { karta: ["karta"], plan: ["plan"], produkt: ["produkt", "prompty"], sceny: ["sceny", "prompty"] } as Record<KbStage, string[]>,
  /** Lengths noted (never refused) — the blocks go into the image prompt verbatim. */
  limits: { direction: 1_500, promptBlock: 1_500, footer: 600, negative: 3_000, binding: 600 },
} as const;

export type KbRecipe = {
  id: string; name: string; categories: string[]; slogan: string | null; testedOn: string | null;
  derived: boolean; derivedNote: string | null;
  /** VERBATIM into every shot's prompt. */
  direction: string;
  /** For the plan and the scene writer. */
  rules: string;
  /** Recipe additions to the negative. */
  negative: string[];
};
export type KbSpecial = {
  flag: string; title: string; derived: boolean; derivedNote: string | null;
  /** VERBATIM into the prompt of every non-detail shot of a product with the flag (null: rules only). */
  block: string | null;
  rules: string;
};
export type KbFooter = {
  key: string;
  when: { types: ShotType[] | null; recipe: string | null; flag: string | null; people: People[] | null; isDefault: boolean };
  text: string;
};
export type KbSection = { title: string; stages: KbStage[]; text: string };
export type KbPlanRule = { group: string; text: string };
export type PeopleRow = { from: number; to: number; persons: [number, number]; hands: [number, number] };

export type KbParsed = {
  format: 1;
  title: string;
  recipes: KbRecipe[];
  special: KbSpecial[];
  footers: KbFooter[];
  negativeBase: string;
  negativeItems: string[];
  /** The plan rules one by one (preview and comparison). */
  planRules: KbPlanRule[];
  /** Names of the creative directions (the plan must use one of them), [] = free text. */
  directions: string[];
  peopleTable: PeopleRow[] | null;
  /** Everything that is not a verbatim block, with the steps that read it (always-on special rules included). */
  sections: KbSection[];
  /** The image-binding templates (optional section; absent = the engine's own default, recorded as such). */
  binding?: Record<string, string> | null;
};

/** A note on how the file was read — information for the admin, never a refusal. */
export type KbIssue = { code: string; detail?: string };
/**
 * ok:false only when there is nothing to read (empty, too large). Otherwise
 * the file is read whatever its shape; `ready` says whether the engine can
 * run on it (activation needs it), `blockers` why not, `warnings` are notes.
 */
export type KbParseResult =
  | { ok: true; kb: KbParsed; warnings: KbIssue[]; ready: boolean; blockers: KbIssue[]; always: string[] }
  | { ok: false; errors: KbIssue[]; warnings: KbIssue[]; kb: null; ready: false; blockers: KbIssue[]; always: string[] };

/* ── text helpers ─────────────────────────────────────────────────────────*/

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "l")
  .toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const ID = /^[a-z][a-z0-9_]{1,39}$/;
const tidy = (s: string) => s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** "Dom IKEA" → "dom_ikea" (an id code can use), "" when nothing is left. */
function slug(s: string): string {
  const x = norm(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const y = /^[a-z]/.test(x) ? x : x ? `x_${x}` : "";
  return y.slice(0, 40).replace(/_+$/, "");
}
const FENCE = /^\s*```/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

type Block = { level: number; title: string; lines: string[]; children: Block[] };

/** Headings → a tree (fenced code is never a heading; a horizontal rule is no content; HTML comments stay in lines). */
function tree(md: string): Block {
  const root: Block = { level: 0, title: "", lines: [], children: [] };
  const stack: Block[] = [root];
  let fence = false;
  for (const raw of md.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(raw)) fence = !fence;
    else if (!fence && HR.test(raw)) continue;
    const h = fence ? null : /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) {
      const level = h[1].length;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const b: Block = { level, title: h[2].trim(), lines: [], children: [] };
      stack[stack.length - 1].children.push(b);
      stack.push(b);
      continue;
    }
    stack[stack.length - 1].lines.push(raw);
  }
  return root;
}

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");
/** A block's own text and its children's, as Markdown (headings kept). */
function render(b: Block, withTitle: boolean): string {
  const own = stripComments(b.lines.join("\n"));
  const parts = [withTitle ? `${"#".repeat(b.level)} ${b.title}\n${own}` : own, ...b.children.map((c) => render(c, true))];
  return tidy(parts.join("\n"));
}
const ownText = (b: Block) => tidy(stripComments(b.lines.join("\n")));
const ownLines = (b: Block) => stripComments(b.lines.join("\n")).split("\n");

/**
 * "Kategorie: …" / "- kategorie: …" / "**Kategorie:** …" lines for the given
 * labels (outside code blocks, the first of each), and every other line in
 * its order.
 */
function takeLabels(lines: string[], names: readonly string[]): { found: Record<string, string>; rest: string[] } {
  const want = new Set(names.map(norm));
  const found: Record<string, string> = {};
  const rest: string[] = [];
  let fence = false;
  for (const line of lines) {
    if (FENCE.test(line)) { fence = !fence; rest.push(line); continue; }
    const m = fence ? null : /^\s*(?:[-*]\s+)?(?:\*\*|__)?([^:*_`|\n]{1,40}?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/.exec(line);
    const k = m ? norm(m[1]) : "";
    if (m && want.has(k) && !(k in found)) { found[k] = m[2].trim(); continue; }
    rest.push(line);
  }
  return { found, rest };
}

/** The first code block of some lines (the one starting with `prefer:` if any) and the lines without it. */
function takeFence(lines: string[], prefer: string): { text: string | null; rest: string[] } {
  const blocks: { from: number; to: number }[] = [];
  let open = -1;
  lines.forEach((l, i) => {
    if (!FENCE.test(l)) return;
    if (open < 0) open = i; else { blocks.push({ from: open, to: i }); open = -1; }
  });
  if (blocks.length === 0) return { text: null, rest: lines };
  const inner = (b: { from: number; to: number }) => lines.slice(b.from + 1, b.to).join("\n");
  const pick = blocks.find((b) => norm(inner(b)).startsWith(norm(prefer))) ?? blocks[0];
  return { text: inner(pick), rest: [...lines.slice(0, pick.from), ...lines.slice(pick.to + 1)] };
}

function stagesOf(b: Block, issues: KbIssue[]): KbStage[] {
  const c = /<!--\s*etapy\s*:\s*([^>]*?)-->/i.exec(b.lines.join("\n"));
  if (!c) return [...KB_STAGES];
  const words = c[1].split(",").map((w) => norm(w)).filter(Boolean);
  const out = KB_STAGES.filter((s) => words.some((w) => KB_FORMAT.stageWords[s].includes(w)));
  const unknown = words.filter((w) => !Object.values(KB_FORMAT.stageWords).some((l) => l.includes(w)));
  if (unknown.length) issues.push({ code: "unknown_stage", detail: `${b.title}: ${unknown.join(", ")}` });
  return out.length ? out : [...KB_STAGES];
}

const child = (b: Block, title: string) => b.children.find((c) => norm(c.title) === norm(title));

/** „Blok do promptu”: its first paragraph is the image block; whatever follows (paragraphs, lists, sub-headings) is rules. */
function splitPromptBlock(b: Block): { block: string; tail: string } {
  const lines = ownLines(b);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const first: string[] = [];
  while (i < lines.length && lines[i].trim()) first.push(lines[i++]);
  const tail = tidy([lines.slice(i).join("\n"), ...b.children.map((c) => render(c, true))].filter((x) => x.trim()).join("\n\n"));
  return { block: first.join("\n"), tail };
}
const yes = (v: string | undefined) => Boolean(v && /^(tak|yes|true)/i.test(v.trim()));
const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
/** A list written in a sentence: "a, b, c." → [a, b, c]. */
const items = (v: string | undefined) => list(v).map((x) => x.replace(/\.+$/, "").trim()).filter(Boolean);
const derivedNote = (v: string | undefined) => {
  if (!yes(v)) return null;
  const note = v!.replace(/^\s*(tak|yes|true)\s*[–—-]?\s*/i, "").trim();
  return note || null;
};
/** A heading's name without a leading "3." and a trailing ":". */
const headingName = (s: string) => norm(s).replace(/^\d+[.)]\s*/, "").replace(/:$/, "").trim();
function sectionKind(title: string): keyof typeof KB_FORMAT.sections | null {
  const t = headingName(title);
  for (const [kind, names] of Object.entries(KB_FORMAT.sections) as [keyof typeof KB_FORMAT.sections, readonly string[]][]) {
    for (const n of names) {
      const m = norm(n);
      if (t === m || (t.startsWith(m) && /^[\s:(\-]/.test(t.slice(m.length)))) return kind;
    }
  }
  return null;
}

/** "1–2" / "0" / "2–3" → [min, max]. */
function range(s: string): [number, number] | null {
  const m = /^\s*(\d+)\s*(?:[–—-]\s*(\d+))?\s*$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return a <= b ? [a, b] : null;
}

function tableRows(text: string): string[][] {
  return text.split("\n").filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
}

/** Plan rules one by one: numbered/bulleted items, else paragraphs. */
function rulesOf(group: string, text: string): KbPlanRule[] {
  const out: KbPlanRule[] = [];
  let cur: string[] = [];
  const flush = () => { const t = oneLine(cur.join(" ")); if (t) out.push({ group, text: t }); cur = []; };
  for (const line of text.split("\n")) {
    if (/^\s*\|/.test(line)) { flush(); continue; }
    if (/^\s*(\d+\.|[-*])\s+/.test(line)) { flush(); cur.push(line.replace(/^\s*(\d+\.|[-*])\s+/, "")); continue; }
    if (line.trim() === "") { flush(); continue; }
    cur.push(line);
  }
  flush();
  return out;
}

/** Two words of one stem ("wnętrze" / "wnetrza", "zwierzęta" / "zwierzat"). */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(5, Math.min(a.length, b.length) - 2);
}
const hasPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${norm(phrase)} `);
const dropPhrase = (text: string, phrase: string) => ` ${text} `.split(` ${norm(phrase)} `).join(" ").replace(/\s+/g, " ").trim();

type When = KbFooter["when"];
/**
 * A footer row's label → the conditions of each alternative it names
 * ("makro, detal" = two alternatives, one condition; "hero produktu bez
 * ludzi" = one alternative, two conditions). [] = nothing code can check.
 */
function footerConditions(label: string, recipes: KbRecipe[], notes: KbIssue[]): { alts: When[]; isDefault: boolean } {
  const W = KB_FORMAT.footerWords;
  const whole = norm(label);
  if (W.isDefault.some((w) => hasPhrase(whole, w))) return { alts: [], isDefault: true };
  const alts: When[] = [];
  for (const part of whole.split(/\s*(?:,|\/|;|\+|\blub\b|\balbo\b)\s*/).map((x) => x.trim()).filter(Boolean)) {
    let p = part.replace(/[^a-z0-9_ ]+/g, " ").replace(/\s+/g, " ").trim();
    const types = new Set<ShotType>();
    const people = new Set<People>();
    const take = (words: readonly string[], on: () => void) => {
      for (const w of [...words].sort((a, b) => b.length - a.length)) if (hasPhrase(p, w)) { on(); p = dropPhrase(p, w); }
    };
    take(W.brak, () => people.add("brak"));
    take(W.dlonie, () => people.add("dlonie"));
    take(W.postacie, () => people.add("postacie"));
    take(W.ludzie, () => { people.add("dlonie"); people.add("postacie"); });
    take(W.detal, () => types.add("detal"));
    take(W.hero, () => types.add("hero"));
    take(W.uzycie, () => types.add("uzycie"));
    const ignore = new Set(W.ignore.map(norm));
    const words = p.split(" ").filter((w) => w.length >= 3 && !ignore.has(w));
    const matched = new Set<string>();
    const asId = slug(part);
    for (const r of recipes) {
      if (r.id === asId || words.some((w) => r.id === w || r.id.split("_").some((t) => sameStem(w, t)))) matched.add(r.id);
    }
    if (matched.size > 1) notes.push({ code: "footer_recipe_ambiguous", detail: `${label}: ${[...matched].join(", ")}` });
    const recipe = matched.size === 1 ? [...matched][0] : null;
    if (types.size === 0 && people.size === 0 && !recipe) continue;
    const when: When = {
      types: types.size ? SHOT_TYPES.filter((x) => types.has(x)) : null,
      people: people.size ? PEOPLE.filter((x) => people.has(x)) : null,
      recipe, flag: null, isDefault: false,
    };
    if (!alts.some((a) => JSON.stringify(a) === JSON.stringify(when))) alts.push(when);
  }
  return { alts, isDefault: false };
}

/** A footer text code can paste: no "[placeholder]", no "stopka X + …" reference to another row. */
const pasteable = (text: string) => !/\[[^\]]+\]/.test(text) && !/^stopka\b/i.test(text.trim());

/* ── the reader ───────────────────────────────────────────────────────────*/

export function parseKb(source: string): KbParseResult {
  const notes: KbIssue[] = [];
  if (typeof source !== "string" || source.trim().length === 0) return { ok: false, errors: [{ code: "empty_file" }], warnings: notes, kb: null, ready: false, blockers: [], always: [] };
  if (source.length > KB_FORMAT.maxChars) return { ok: false, errors: [{ code: "file_too_large", detail: String(source.length) }], warnings: notes, kb: null, ready: false, blockers: [], always: [] };
  const root = tree(source);
  const h1 = root.children.find((c) => c.level === 1);
  const top = h1 ? [...h1.children, ...root.children.filter((c) => c !== h1)] : root.children;
  const kinds = new Map<Block, keyof typeof KB_FORMAT.sections>();
  for (const b of top) {
    const k = sectionKind(b.title);
    // The first section of a kind is read specially; a second one is an instruction section like any other.
    if (k && ![...kinds.values()].includes(k)) kinds.set(b, k);
  }
  const find = (k: keyof typeof KB_FORMAT.sections) => [...kinds.entries()].find(([, v]) => v === k)?.[0];

  for (const m of source.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
    if (!KB_FORMAT.placeholders.includes(m[1])) notes.push({ code: "unknown_placeholder", detail: m[1] });
  }

  // ── recipes: every heading with a KIERUNEK; the rest stays for the models ──
  const recipes: KbRecipe[] = [];
  const recipeExtra: string[] = [];
  const recipeSec = find("recipes");
  for (const b of recipeSec?.children ?? []) {
    const name = norm(b.title).startsWith(norm(KB_FORMAT.recipePrefix)) ? b.title.slice(b.title.indexOf(":") + 1).trim() : b.title.trim();
    const { found, rest: afterLabels } = takeLabels(ownLines(b), KB_FORMAT.recipeLabels);
    const dirB = child(b, KB_FORMAT.blocks.direction);
    let rest = afterLabels;
    let direction = "";
    if (dirB) direction = oneLine(render(dirB, false));
    else if (found.kierunek) direction = oneLine(found.kierunek);
    else {
      const f = takeFence(afterLabels, KB_FORMAT.blocks.direction);
      if (f.text !== null) { direction = oneLine(f.text).replace(/^kierunek\s*:\s*/i, ""); rest = f.rest; }
    }
    if (!direction) {
      recipeExtra.push(render(b, true));
      notes.push({ code: "recipe_missing_direction", detail: b.title });
      continue;
    }
    if (direction.length > KB_FORMAT.limits.direction) notes.push({ code: "block_too_long", detail: `${b.title}: KIERUNEK` });
    const idRaw = (found.id ?? "").trim();
    let id = ID.test(idRaw) ? idRaw : ID.test(name) ? name : slug(idRaw || name) || `przepis_${recipes.length + 1}`;
    if (idRaw && !ID.test(idRaw)) notes.push({ code: "recipe_id_changed", detail: `${idRaw} → ${id}` });
    if (recipes.some((r) => r.id === id)) {
      let n = 2;
      while (recipes.some((r) => r.id === `${id.slice(0, 36)}_${n}`)) n++;
      notes.push({ code: "recipe_duplicate", detail: `${id} → ${id.slice(0, 36)}_${n}` });
      id = `${id.slice(0, 36)}_${n}`;
    }
    const rulesB = child(b, KB_FORMAT.blocks.rules);
    const negB = child(b, KB_FORMAT.blocks.negative);
    const others = b.children.filter((c) => c !== dirB && c !== rulesB && c !== negB).map((c) => render(c, true));
    recipes.push({
      id, name, categories: items(found.kategorie), slogan: found.haslo || null, testedOn: found["sprawdzony na"] || null,
      derived: yes(found.pochodny), derivedNote: derivedNote(found.pochodny), direction,
      rules: tidy([tidy(rest.join("\n")), rulesB ? render(rulesB, false) : "", ...others].filter(Boolean).join("\n\n")),
      negative: negB ? list(oneLine(render(negB, false))) : items(found.negative),
    });
  }

  // ── special rules: a flag switches them per product; "(zawsze)" or no flag = always on ──
  const special: KbSpecial[] = [];
  const specialExtra: string[] = [];
  const always: string[] = [];
  const specialSec = find("special");
  for (const b of specialSec?.children ?? []) {
    const title = b.title.trim();
    let flag: string | null = null;
    let name = title;
    let derivedTitle = false;
    if (norm(title).startsWith(norm(KB_FORMAT.specialPrefix))) {
      const after = title.slice(title.indexOf(":") + 1).trim();
      const fm = /^([a-z][a-z0-9_]{1,39})\s*(?:[–—-]\s*(.*))?$/.exec(after);
      flag = fm ? fm[1] : after.split(/\s+[–—-]\s+/)[0];
      name = (fm ? fm[2] ?? fm[1] : after.split(/\s+[–—-]\s+/).slice(1).join(" – ") || after).trim();
      derivedTitle = !fm;
    }
    const paren = /\(\s*flag[ai]\s*:\s*([^)]+?)\s*\)/i.exec(title);
    if (!flag && paren) { flag = paren[1]; name = title.replace(paren[0], " ").replace(/\s+/g, " ").trim(); }
    const isAlways = KB_FORMAT.alwaysWords.some((w) => new RegExp(`\\(\\s*${w}\\s*\\)`, "i").test(title));
    if (isAlways) name = name.replace(/\(\s*(zawsze|always)\s*\)/gi, " ").replace(/\s+/g, " ").trim();
    const { found, rest } = takeLabels(ownLines(b), KB_FORMAT.specialLabels);
    if (!flag && found.flaga) flag = found.flaga;
    if (isAlways || !flag) {
      // Applies to every product: the models of every step read it with the section.
      specialExtra.push(render(b, true));
      always.push(name || title);
      if (!isAlways) notes.push({ code: "special_always", detail: title });
      continue;
    }
    let id = flag.trim();
    if (!ID.test(id)) {
      const s = slug(id) || `flaga_${special.length + 1}`;
      notes.push({ code: "flag_changed", detail: `${id} → ${s}` });
      id = s;
    } else if (derivedTitle) notes.push({ code: "flag_changed", detail: title });
    const blockB = child(b, KB_FORMAT.blocks.promptBlock);
    const rulesB = child(b, KB_FORMAT.blocks.rules);
    // The image block is the FIRST paragraph under „Blok do promptu”. A file
    // that writes the flag's rules straight under it (no „Zasady” heading —
    // the 23.11.2026 candidate) keeps them as rules, never in the image prompt.
    // Files whose block is one paragraph (07–08.11) read exactly as before.
    const split = blockB ? splitPromptBlock(blockB) : { block: "", tail: "" };
    const block = oneLine(split.block);
    if (block.length > KB_FORMAT.limits.promptBlock) notes.push({ code: "block_too_long", detail: `${id}: blok` });
    if (split.tail) notes.push({ code: "block_rules_split", detail: id });
    const others = b.children.filter((c) => c !== blockB && c !== rulesB).map((c) => render(c, true));
    const rules = tidy([tidy(rest.join("\n")), split.tail, rulesB ? render(rulesB, false) : "", ...others].filter(Boolean).join("\n\n"));
    if (special.some((s) => s.flag === id) || (!block && !rules)) {
      specialExtra.push(render(b, true));
      notes.push({ code: !block && !rules ? "flag_empty" : "flag_duplicate", detail: id });
      continue;
    }
    special.push({ flag: id, title: name || id, derived: yes(found.pochodny), derivedNote: derivedNote(found.pochodny), block: block || null, rules });
  }

  // ── footers: headings ("### Stopka: key" + "- typ:"), a table "Typ ujęcia | Stopka", "- typ: tekst" lines ──
  const footers: KbFooter[] = [];
  const fromRows: KbFooter[] = [];
  const footerInstr: string[] = [];
  let footerIntro = "";
  const usedKeys = new Set<string>();
  const keyFor = (label: string) => {
    const base = ID.test(label) ? label : slug(label) || "stopka";
    let k = base;
    let n = 2;
    while (usedKeys.has(k)) k = `${base.slice(0, 36)}_${n++}`;
    usedKeys.add(k);
    return k;
  };
  const addRow = (label: string, raw: string, out: KbFooter[]) => {
    const text = oneLine(raw);
    if (!text) return;
    if (!pasteable(text)) { footerInstr.push(`- ${label}: ${text}`); notes.push({ code: "footer_as_instruction", detail: label }); return; }
    const c = footerConditions(label, recipes, notes);
    if (!c.isDefault && c.alts.length === 0) { footerInstr.push(`- ${label}: ${text}`); notes.push({ code: "footer_unmapped", detail: label }); return; }
    if (text.length > KB_FORMAT.limits.footer) notes.push({ code: "block_too_long", detail: `stopka ${label}` });
    if (c.isDefault) { out.push({ key: keyFor(label), text, when: { types: null, recipe: null, flag: null, people: null, isDefault: true } }); return; }
    const parts = norm(label).split(/\s*(?:,|\/|;|\+|\blub\b|\balbo\b)\s*/).filter(Boolean);
    c.alts.forEach((when, i) => out.push({ key: keyFor(c.alts.length > 1 && parts.length === c.alts.length ? parts[i] : label), text, when }));
  };
  const footerSec = find("footers");
  if (footerSec) {
    for (const b of footerSec.children) {
      const prefixed = norm(b.title).startsWith(norm(KB_FORMAT.footerPrefix));
      const label = prefixed ? b.title.slice(b.title.indexOf(":") + 1).trim() : b.title.trim();
      const { found, rest } = takeLabels(ownLines(b), KB_FORMAT.footerLabels);
      const text = oneLine([tidy(rest.join("\n")), ...b.children.map((c) => render(c, false))].join(" "));
      if (!text) { notes.push({ code: "footer_empty", detail: label }); continue; }
      const explicit = KB_FORMAT.footerLabels.some((k) => norm(k) in found);
      if (!explicit) { addRow(label, text, footers); continue; }
      if (text.length > KB_FORMAT.limits.footer) notes.push({ code: "block_too_long", detail: `stopka ${label}` });
      const types = found.typ ? list(found.typ).map(norm) : null;
      const people = found.ludzie ? list(found.ludzie).map(norm) : null;
      const okTypes = types?.filter((x): x is ShotType => (SHOT_TYPES as readonly string[]).includes(x)) ?? null;
      const okPeople = people?.filter((x): x is People => (PEOPLE as readonly string[]).includes(x)) ?? null;
      if ((types && okTypes!.length !== types.length) || (people && okPeople!.length !== people.length)) notes.push({ code: "footer_condition_invalid", detail: label });
      const recipe = found.przepis?.trim() || null;
      const flag = found.flaga?.trim() || null;
      if (recipe && !recipes.some((r) => r.id === recipe)) notes.push({ code: "footer_condition_invalid", detail: `${label}: przepis ${recipe}` });
      if (flag && !special.some((s) => s.flag === flag)) notes.push({ code: "footer_condition_invalid", detail: `${label}: flaga ${flag}` });
      footers.push({
        key: keyFor(label), text,
        when: { types: okTypes?.length ? okTypes : null, people: okPeople?.length ? okPeople : null, recipe, flag, isDefault: yes(found.domyslna) },
      });
    }
    // The section's own text: a table, "- label: text" lines, and an intro the scene step reads.
    const lines = ownLines(footerSec);
    const rows = tableRows(lines.join("\n"));
    if (rows.length >= 2) {
      const head = rows[0].map(norm);
      let textCol = head.findIndex((h) => /stopk|tekst|footer|prompt/.test(h));
      if (textCol < 0) textCol = head.length - 1;
      const labelCol = textCol === 0 ? 1 : 0;
      for (const r of rows.slice(1)) if (r[labelCol] !== undefined && r[textCol] !== undefined) addRow(r[labelCol], r[textCol], fromRows);
    }
    const intro: string[] = [];
    for (const l of lines) {
      if (/^\s*\|/.test(l)) continue;
      const m = /^\s*[-*]\s+(.{1,80}?)\s*:\s+(.{20,})$/.exec(l);
      if (m) { addRow(m[1].replace(/\*\*|__/g, "").trim(), m[2], fromRows); continue; }
      intro.push(l);
    }
    footerIntro = tidy(intro.join("\n"));
  }
  // Rows tied to a recipe first: on an equal match the recipe's own footer wins (file order inside each group).
  footers.push(...fromRows.filter((f) => f.when.recipe || f.when.flag), ...fromRows.filter((f) => !f.when.recipe && !f.when.flag));
  const defaults = footers.filter((f) => f.when.isDefault);
  if (defaults.length > 1) {
    notes.push({ code: "footer_many_defaults", detail: defaults.map((f) => f.key).join(", ") });
    for (const f of defaults.slice(1)) f.when = { ...f.when, isDefault: false };
  }
  if (defaults.length === 0 && footers.length > 0) {
    // None marked: the plainest footer (no recipe or flag, the shortest text) also serves every shot nothing else fits.
    const pool = footers.filter((f) => !f.when.recipe && !f.when.flag);
    const pick = (pool.length ? pool : footers).reduce((a, b) => (b.text.length < a.text.length ? b : a));
    footers.push({ key: keyFor("domyslna"), text: pick.text, when: { types: null, recipe: null, flag: null, people: null, isDefault: true } });
    notes.push({ code: "footer_default_chosen", detail: pick.key });
  }

  // ── negative base: a code block, or the section's text ──
  let negativeBase = "";
  let negIntro = "";
  const negSec = find("negative");
  if (negSec) {
    const own = negSec.lines.join("\n");
    const fence = /```[^\n]*\n([\s\S]*?)```/.exec(own);
    negativeBase = oneLine(fence ? fence[1] : stripComments(own));
    negIntro = tidy([fence ? tidy(stripComments(own.replace(fence[0], ""))) : "", ...negSec.children.map((c) => render(c, true))].filter(Boolean).join("\n\n"));
    if (!negativeBase) notes.push({ code: "negative_empty" });
    if (negativeBase.length > KB_FORMAT.limits.negative) notes.push({ code: "block_too_long", detail: "negative" });
  } else notes.push({ code: "negative_missing" });
  const negativeItems = list(negativeBase);

  // ── plan rules, the people table ──
  const planSec = find("planRules");
  const planRules: KbPlanRule[] = [];
  if (planSec) {
    planRules.push(...rulesOf("", ownText(planSec)));
    for (const c of planSec.children) planRules.push(...rulesOf(c.title, render(c, false)));
  }
  const isPeople = (b: Block) => norm(b.title).startsWith(norm(KB_FORMAT.peopleTable));
  const anywhere = (bs: Block[]): Block | undefined => {
    for (const b of bs) { if (isPeople(b)) return b; const x = anywhere(b.children); if (x) return x; }
    return undefined;
  };
  let peopleTable: PeopleRow[] | null = null;
  const peopleB = planSec?.children.find(isPeople) ?? anywhere(top);
  if (peopleB) {
    const rows = tableRows(peopleB.lines.join("\n")).slice(1);
    const parsed = rows.map((r) => {
      const n = range(r[0] ?? ""); const p = range(r[1] ?? ""); const h = range(r[2] ?? "");
      return n && p && h ? { from: n[0], to: n[1], persons: p, hands: h } : null;
    });
    if (parsed.length > 0 && parsed.every(Boolean)) peopleTable = parsed as PeopleRow[];
    else notes.push({ code: "people_table_unreadable" });
  } else notes.push({ code: "people_table_missing" });

  // ── creative directions (optional) ──
  const dirSec = find("directions");
  const directions = dirSec ? tableRows(dirSec.lines.join("\n")).slice(1).map((r) => r[0]).filter(Boolean) : [];
  if (!dirSec) notes.push({ code: "directions_missing" });

  // ── the image-binding templates (optional; a missing key = the engine's own text) ──
  let binding: Record<string, string> | null = null;
  const bindSec = find("binding");
  if (bindSec) {
    binding = {};
    for (const line of stripComments(bindSec.lines.join("\n")).split("\n")) {
      const m = /^\s*[-*]\s*([a-z_0-9]+)\s*:\s*(.+)$/.exec(line);
      if (!m) continue;
      if (!KB_FORMAT.bindingKeys.includes(m[1])) { notes.push({ code: "binding_key_unknown", detail: m[1] }); continue; }
      const text = oneLine(m[2]);
      if (text.length > KB_FORMAT.limits.binding) notes.push({ code: "block_too_long", detail: `binding.${m[1]}` });
      binding[m[1]] = text;
    }
    for (const k of ["calosc_1", "calosc_n", "detal"]) if (!binding[k]) notes.push({ code: "binding_key_missing", detail: k });
  }

  // ── instruction sections: everything but the verbatim blocks, nothing dropped ──
  const sections: KbSection[] = [];
  const titleOf = h1?.title ?? "";
  const preamble = tidy([ownText(root), h1 ? ownText(h1) : ""].filter(Boolean).join("\n\n"));
  if (preamble) sections.push({ title: titleOf || "Wstęp", stages: [...KB_STAGES], text: preamble });
  for (const b of top) {
    const stages = stagesOf(b, notes);
    const kind = kinds.get(b);
    if (kind === "footers") {
      const t = tidy([footerIntro, footerInstr.length ? `${KB_FORMAT.footerInstructions}\n${footerInstr.join("\n")}` : ""].filter(Boolean).join("\n\n"));
      if (t) sections.push({ title: b.title, stages: ["sceny"], text: t });
      continue;
    }
    if (kind === "negative") {
      if (negIntro) sections.push({ title: b.title, stages: ["sceny"], text: negIntro });
      continue;
    }
    // Code fills these templates into the image prompt; no step reads them as instructions.
    if (kind === "binding") continue;
    if (kind === "recipes" || kind === "special") {
      // Their entries are served per order (the chosen recipe, the set flags); the intro and the always-on rules to every reader.
      const t = tidy([ownText(b), ...(kind === "recipes" ? recipeExtra : specialExtra)].filter(Boolean).join("\n\n"));
      if (t) sections.push({ title: b.title, stages, text: t });
      continue;
    }
    const text = render(b, false);
    if (text) sections.push({ title: b.title, stages, text });
  }

  const kb: KbParsed = {
    format: 1, title: titleOf, recipes, special, footers, negativeBase, negativeItems, planRules, directions, peopleTable, sections,
    ...(binding ? { binding } : {}),
  };
  // Notes, never blockers: a version written before image blocks existed
  // (v4.2, active 23.11.2026) stays activatable and keeps running.
  notes.push(...imageBlockIssues(special));
  const blockers = kbBlockers(kb);
  return { ok: true, kb, warnings: notes, ready: blockers.length === 0, blockers, always };
}

/** What the engine read from a file, in numbers (the admin's confirmation after an upload). */
export type KbReadSummary = {
  recipes: number; flags: number; always: number; footers: number; planRules: number; negative: number; sections: number;
  defaultFooter: string | null;
};

/** Why the engine cannot run on a parse ([] = it can; activation needs that). */
export function kbBlockers(kb: Pick<KbParsed, "recipes" | "footers">): KbIssue[] {
  const out: KbIssue[] = [];
  if (kb.recipes.length === 0) out.push({ code: "no_recipes" });
  if (!kb.footers.some((f) => f?.when?.isDefault)) out.push({ code: kb.footers.length ? "no_default_footer" : "no_footers" });
  return out;
}


/* ── what each step reads ─────────────────────────────────────────────────*/

export const recipeById = (kb: KbParsed, id: string | null | undefined) => kb.recipes.find((r) => r.id === id) ?? null;

/** The instruction text of one step: its sections (the Product Lock placed
 *  where the file puts {{fidelity_rules}}), and — for an order — the chosen
 *  recipe and the special rules of its flags. */
export function kbInstructions(kb: KbParsed, stageOrStages: KbStage | KbStage[], o: { recipeId?: string | null; flags?: string[]; fidelityRules: string }): string {
  const stages = Array.isArray(stageOrStages) ? stageOrStages : [stageOrStages];
  const stage = stages.includes("karta") ? "karta" : stages.includes("sceny") ? "sceny" : stages[0];
  const parts: string[] = [];
  for (const s of kb.sections.filter((x) => x.stages.some((st) => stages.includes(st)))) {
    parts.push(`## ${s.title}\n\n${s.text.replace(/\{\{\s*fidelity_rules\s*\}\}/g, o.fidelityRules)}`);
  }
  if (stage === "karta") {
    parts.push(`## Przepisy stylu – katalog (wybierz jeden id)\n\n${kb.recipes.map((r) => `- ${r.id}: ${r.name} – kategorie: ${r.categories.join(", ") || "—"}${r.slogan ? ` – hasło: ${r.slogan}` : ""}`).join("\n")}`);
    parts.push(`## Flagi kategorii (reguły specjalne) – zaznacz wszystkie pasujące\n\n${kb.special.map((s) => `- ${s.flag}: ${s.title}`).join("\n")}`);
  } else {
    const r = recipeById(kb, o.recipeId);
    if (r) {
      parts.push(`## Wybrany przepis stylu: ${r.name} (${r.id})\n\nKIERUNEK (wstawiany do promptu przez kod, nie przepisuj go): ${r.direction}${r.rules ? `\n\n${r.rules}` : ""}${r.negative.length ? `\n\nDopiski negative przepisu: ${r.negative.join(", ")}` : ""}`);
    }
    const flags = new Set(o.flags ?? []);
    const active = kb.special.filter((s) => flags.has(s.flag));
    if (active.length > 0) {
      parts.push(`## Reguły specjalne tego produktu\n\n${active.map((s) => `### ${s.flag} – ${s.title}${s.block ? `\nBlok wstawiany do promptu przez kod (nie powtarzaj go): ${s.block}` : ""}${s.rules ? `\n${s.rules}` : ""}`).join("\n\n")}`);
    }
    if (stage === "sceny") parts.push(`## Negative bazowy (dopisywany przez kod, nie powtarzaj go)\n\n${kb.negativeBase}`);
  }
  return parts.join("\n\n");
}

/** The footer of one shot: the most specific match, file order on a tie; else the default. */
export function pickFooter(kb: KbParsed, shot: { type: ShotType; people: People }, order: { recipeId: string; flags: string[] }): KbFooter {
  let best: KbFooter | null = null;
  let bestScore = -1;
  for (const f of kb.footers) {
    if (f.when.isDefault) continue;
    const conds: boolean[] = [];
    if (f.when.types) conds.push(f.when.types.includes(shot.type));
    if (f.when.people) conds.push(f.when.people.includes(shot.people));
    if (f.when.recipe) conds.push(f.when.recipe === order.recipeId);
    if (f.when.flag) conds.push(order.flags.includes(f.when.flag));
    if (conds.length === 0 || !conds.every(Boolean)) continue;
    // A detail shot always takes a footer that names the detail type.
    const score = conds.length + (shot.type === "detal" && f.when.types?.includes("detal") ? 10 : 0);
    if (score > bestScore) { best = f; bestScore = score; }
  }
  return best ?? kb.footers.find((f) => f.when.isDefault)!;
}

/* ── comparing two versions ───────────────────────────────────────────────*/

export type FieldChange = { field: string; before: string; after: string };
export type KbDiff = {
  recipes: { added: KbRecipe[]; removed: KbRecipe[]; modified: { id: string; name: string; changes: FieldChange[] }[] };
  special: { added: KbSpecial[]; removed: KbSpecial[]; modified: { flag: string; changes: FieldChange[] }[] };
  footers: { added: KbFooter[]; removed: KbFooter[]; modified: { key: string; changes: FieldChange[] }[] };
  planRules: { added: KbPlanRule[]; removed: KbPlanRule[]; modified: { group: string; before: string; after: string }[] };
  negative: { added: string[]; removed: string[]; before: string; after: string } | null;
  sections: { added: string[]; removed: string[]; modified: { title: string; before: string; after: string }[] };
  directions: { added: string[]; removed: string[] };
  total: number;
};

const words = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
function similarity(a: string, b: string): number {
  const A = words(a); const B = words(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

function fieldsDiff<T extends Record<string, unknown>>(a: T, b: T, fields: (keyof T & string)[]): FieldChange[] {
  const s = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return fields.filter((f) => s(a[f]) !== s(b[f])).map((f) => ({ field: f, before: s(a[f]), after: s(b[f]) }));
}

export function diffKb(before: KbParsed | null, after: KbParsed): KbDiff {
  const prev: KbParsed = before ?? { format: 1, title: "", recipes: [], special: [], footers: [], negativeBase: "", negativeItems: [], planRules: [], directions: [], peopleTable: null, sections: [] };
  const byKey = <T>(xs: T[], k: (x: T) => string) => new Map(xs.map((x) => [k(x), x]));

  const rA = byKey(prev.recipes, (r) => r.id); const rB = byKey(after.recipes, (r) => r.id);
  const recipes: KbDiff["recipes"] = {
    added: after.recipes.filter((r) => !rA.has(r.id)), removed: prev.recipes.filter((r) => !rB.has(r.id)),
    modified: after.recipes.filter((r) => rA.has(r.id)).map((r) => ({
      id: r.id, name: r.name,
      changes: fieldsDiff(rA.get(r.id)! as unknown as Record<string, unknown>, r as unknown as Record<string, unknown>, ["name", "categories", "slogan", "testedOn", "derived", "direction", "rules", "negative"]),
    })).filter((m) => m.changes.length > 0),
  };
  const sA = byKey(prev.special, (s) => s.flag); const sB = byKey(after.special, (s) => s.flag);
  const special: KbDiff["special"] = {
    added: after.special.filter((s) => !sA.has(s.flag)), removed: prev.special.filter((s) => !sB.has(s.flag)),
    modified: after.special.filter((s) => sA.has(s.flag)).map((s) => ({
      flag: s.flag, changes: fieldsDiff(sA.get(s.flag)! as unknown as Record<string, unknown>, s as unknown as Record<string, unknown>, ["title", "derived", "block", "rules"]),
    })).filter((m) => m.changes.length > 0),
  };
  const fA = byKey(prev.footers, (f) => f.key); const fB = byKey(after.footers, (f) => f.key);
  const footers: KbDiff["footers"] = {
    added: after.footers.filter((f) => !fA.has(f.key)), removed: prev.footers.filter((f) => !fB.has(f.key)),
    modified: after.footers.filter((f) => fA.has(f.key)).map((f) => ({
      key: f.key, changes: fieldsDiff(fA.get(f.key)! as unknown as Record<string, unknown>, f as unknown as Record<string, unknown>, ["text", "when"]),
    })).filter((m) => m.changes.length > 0),
  };

  // Rules: identical text = unchanged; else paired with the most similar left-over rule of the same group (≥ 0.5) = modified.
  const key = (r: KbPlanRule) => `${norm(r.group)}|${norm(r.text)}`;
  const same = new Set(prev.planRules.map(key));
  const kept = new Set(after.planRules.map(key));
  const oldLeft = prev.planRules.filter((r) => !kept.has(key(r)));
  const newLeft = after.planRules.filter((r) => !same.has(key(r)));
  const modified: KbDiff["planRules"]["modified"] = [];
  const added: KbPlanRule[] = [];
  const used = new Set<number>();
  for (const r of newLeft) {
    let bi = -1; let bs = 0.5;
    oldLeft.forEach((o, i) => { if (!used.has(i) && norm(o.group) === norm(r.group)) { const s = similarity(o.text, r.text); if (s >= bs) { bs = s; bi = i; } } });
    if (bi >= 0) { used.add(bi); modified.push({ group: r.group, before: oldLeft[bi].text, after: r.text }); } else added.push(r);
  }
  const planRules = { added, removed: oldLeft.filter((_, i) => !used.has(i)), modified };

  const negative = prev.negativeBase === after.negativeBase ? null : {
    added: after.negativeItems.filter((x) => !prev.negativeItems.includes(x)),
    removed: prev.negativeItems.filter((x) => !after.negativeItems.includes(x)),
    before: prev.negativeBase, after: after.negativeBase,
  };
  const cA = byKey(prev.sections, (s) => norm(s.title)); const cB = byKey(after.sections, (s) => norm(s.title));
  const sections: KbDiff["sections"] = {
    added: after.sections.filter((s) => !cA.has(norm(s.title))).map((s) => s.title),
    removed: prev.sections.filter((s) => !cB.has(norm(s.title))).map((s) => s.title),
    modified: after.sections.filter((s) => cA.has(norm(s.title)) && (cA.get(norm(s.title))!.text !== s.text || cA.get(norm(s.title))!.stages.join() !== s.stages.join()))
      .map((s) => ({ title: s.title, before: cA.get(norm(s.title))!.text, after: s.text })),
  };
  const directions = {
    added: after.directions.filter((d) => !prev.directions.includes(d)),
    removed: prev.directions.filter((d) => !after.directions.includes(d)),
  };
  const total = recipes.added.length + recipes.removed.length + recipes.modified.length
    + special.added.length + special.removed.length + special.modified.length
    + footers.added.length + footers.removed.length + footers.modified.length
    + planRules.added.length + planRules.removed.length + planRules.modified.length
    + (negative ? 1 : 0) + sections.added.length + sections.removed.length + sections.modified.length
    + directions.added.length + directions.removed.length;
  return { recipes, special, footers, planRules, negative, sections, directions, total };
}

/** Deterministic JSON (sorted keys) — what the parsed version's hash is taken of. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** A stored parse, read back (the engine never runs on a shape it does not know). */
export function readKb(raw: unknown): KbParsed | null {
  const k = readKbShape(raw);
  return k && kbBlockers(k).length === 0 ? k : null;
}

/** A stored parse of the known shape, whether or not the engine can run on it (a draft's preview). */
export function readKbShape(raw: unknown): KbParsed | null {
  const k = raw as Partial<KbParsed> | null;
  if (!k || k.format !== 1 || !Array.isArray(k.recipes) || !Array.isArray(k.special) || !Array.isArray(k.footers)
    || typeof k.negativeBase !== "string" || !Array.isArray(k.sections) || !Array.isArray(k.planRules) || !Array.isArray(k.directions)) return null;
  return k as KbParsed;
}

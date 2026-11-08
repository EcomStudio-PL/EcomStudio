/**
 * GROVBASE SHOT — THE KNOWLEDGE BASE FILE (Markdown), parsed and checked.
 *
 * The engine's knowledge is ONE Markdown file per version (Kuba's spec in the
 * import format, docs/grovshot-shot/baza-wiedzy-v1.md). Code cuts out by
 * heading the texts that go into the image prompt VERBATIM — each recipe's
 * KIERUNEK, the special rules' prompt blocks, the footers, the negative base
 * — and hands the rest of the file to the models of steps 2–4 as their
 * instructions ("jak działa automatyzacja", Baza wiedzy). Pure: no I/O.
 *
 * Section names, their required status and the sub-heading words live in
 * KB_FORMAT below — never in a component.
 */

export const KB_STAGES = ["karta", "plan", "produkt", "sceny"] as const;
export type KbStage = (typeof KB_STAGES)[number];

export const SHOT_TYPES = ["hero", "uzycie", "detal"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];
export const PEOPLE = ["brak", "dlonie", "postacie"] as const;
export type People = (typeof PEOPLE)[number];

/** The import contract: what a file must contain, by heading. */
export const KB_FORMAT = {
  maxChars: 300_000,
  required: {
    recipes: "Przepisy stylu",
    planRules: "Reguły planu",
    special: "Reguły specjalne",
    footers: "Stopki",
    negative: "Negative bazowy",
  },
  optional: { directions: "Kierunki kreatywne", binding: "Blok wiązania zdjęć" },
  /** The keys of the binding section ("- klucz: szablon"); {lista}, {n}, {opis} are filled by code. */
  bindingKeys: ["calosc_1", "calosc_n", "detal", "pomocnicze", "logo", "detal_glowny", "kontekst"] as readonly string[],
  recipePrefix: "Przepis:",
  specialPrefix: "Flaga:",
  footerPrefix: "Stopka:",
  blocks: { direction: "KIERUNEK", promptBlock: "Blok do promptu", rules: "Zasady", negative: "Negative" },
  peopleTable: "Ludzie i zwierzęta",
  /** The only placeholder a file may use: the Product Lock, where it stands. */
  placeholders: ["fidelity_rules"] as readonly string[],
  /** "<!-- etapy: plan, sceny -->" under a ## heading; "prompty" = produkt + sceny. */
  stageWords: { karta: ["karta"], plan: ["plan"], produkt: ["produkt", "prompty"], sceny: ["sceny", "prompty"] } as Record<KbStage, string[]>,
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
  /** Everything that is not a verbatim block, with the steps that read it. */
  sections: KbSection[];
  /** The image-binding templates (optional section; absent = the engine's own default, recorded as such). */
  binding?: Record<string, string> | null;
};

export type KbIssue = { code: string; detail?: string };
export type KbParseResult =
  | { ok: true; kb: KbParsed; warnings: KbIssue[] }
  | { ok: false; errors: KbIssue[]; warnings: KbIssue[]; kb: KbParsed | null };

/* ── text helpers ─────────────────────────────────────────────────────────*/

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "l")
  .toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const ID = /^[a-z][a-z0-9_]{1,39}$/;
const tidy = (s: string) => s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

type Block = { level: number; title: string; lines: string[]; children: Block[] };

/** Headings → a tree (fenced code is never a heading; HTML comments stay in lines). */
function tree(md: string): Block {
  const root: Block = { level: 0, title: "", lines: [], children: [] };
  const stack: Block[] = [root];
  let fence = false;
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) fence = !fence;
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

/** `- key: value` lines at the top of a block, and the rest. */
function meta(b: Block): { meta: Record<string, string>; rest: string } {
  const m: Record<string, string> = {};
  const rest: string[] = [];
  let inMeta = true;
  for (const line of stripComments(b.lines.join("\n")).split("\n")) {
    const kv = /^\s*-\s*([^:]{1,40}):\s*(.*)$/.exec(line);
    if (inMeta && kv) { m[norm(kv[1])] = kv[2].trim(); continue; }
    if (inMeta && line.trim() === "") continue;
    inMeta = false;
    rest.push(line);
  }
  return { meta: m, rest: tidy(rest.join("\n")) };
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
const yes = (v: string | undefined) => Boolean(v && /^(tak|yes|true)/i.test(v.trim()));
const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const derivedNote = (v: string | undefined) => {
  if (!yes(v)) return null;
  const note = v!.replace(/^\s*(tak|yes|true)\s*[–—-]?\s*/i, "").trim();
  return note || null;
};

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

/* ── the parser ───────────────────────────────────────────────────────────*/

export function parseKb(source: string): KbParseResult {
  const errors: KbIssue[] = [];
  const warnings: KbIssue[] = [];
  if (typeof source !== "string" || source.trim().length === 0) return { ok: false, errors: [{ code: "empty_file" }], warnings, kb: null };
  if (source.length > KB_FORMAT.maxChars) return { ok: false, errors: [{ code: "file_too_large", detail: String(source.length) }], warnings, kb: null };
  const root = tree(source);
  const h1 = root.children.find((c) => c.level === 1);
  const top = h1 ? [...h1.children, ...root.children.filter((c) => c !== h1 && c.level === 2)] : root.children;
  const sectionsByName = new Map(top.map((b) => [norm(b.title), b]));
  const find = (name: string) => sectionsByName.get(norm(name));

  for (const [, name] of Object.entries(KB_FORMAT.required)) if (!find(name)) errors.push({ code: "missing_section", detail: name });

  // Placeholders: only the Product Lock.
  for (const m of source.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
    if (!KB_FORMAT.placeholders.includes(m[1])) errors.push({ code: "unknown_placeholder", detail: m[1] });
  }

  // ── recipes ──
  const recipes: KbRecipe[] = [];
  const recipeSec = find(KB_FORMAT.required.recipes);
  for (const b of recipeSec?.children ?? []) {
    if (!norm(b.title).startsWith(norm(KB_FORMAT.recipePrefix))) {
      warnings.push({ code: "recipe_heading_ignored", detail: b.title });
      continue;
    }
    const name = b.title.slice(b.title.indexOf(":") + 1).trim();
    const { meta: m } = meta(b);
    const id = (m.id ?? "").trim();
    const dir = child(b, KB_FORMAT.blocks.direction);
    if (!ID.test(id)) { errors.push({ code: "recipe_id_invalid", detail: name || b.title }); continue; }
    if (recipes.some((r) => r.id === id)) { errors.push({ code: "recipe_duplicate", detail: id }); continue; }
    const direction = dir ? oneLine(render(dir, false)) : "";
    if (!direction) { errors.push({ code: "recipe_missing_direction", detail: `${name} (${id})` }); continue; }
    if (direction.length > KB_FORMAT.limits.direction) errors.push({ code: "block_too_long", detail: `${id}: KIERUNEK` });
    const rulesB = child(b, KB_FORMAT.blocks.rules);
    const negB = child(b, KB_FORMAT.blocks.negative);
    recipes.push({
      id, name, categories: list(m.kategorie), slogan: m.haslo || null, testedOn: m["sprawdzony na"] || null,
      derived: yes(m.pochodny), derivedNote: derivedNote(m.pochodny), direction,
      rules: rulesB ? render(rulesB, false) : "",
      negative: negB ? list(oneLine(render(negB, false))) : [],
    });
  }
  if (recipeSec && recipes.length === 0) errors.push({ code: "no_recipes" });

  // ── special rules (flags) ──
  const special: KbSpecial[] = [];
  const specialSec = find(KB_FORMAT.required.special);
  for (const b of specialSec?.children ?? []) {
    if (!norm(b.title).startsWith(norm(KB_FORMAT.specialPrefix))) { warnings.push({ code: "special_heading_ignored", detail: b.title }); continue; }
    const after = b.title.slice(b.title.indexOf(":") + 1).trim();
    const fm = /^([a-z][a-z0-9_]{1,39})\s*(?:[–—-]\s*(.*))?$/.exec(after);
    if (!fm) { errors.push({ code: "flag_invalid", detail: b.title }); continue; }
    if (special.some((s) => s.flag === fm[1])) { errors.push({ code: "flag_duplicate", detail: fm[1] }); continue; }
    const { meta: m } = meta(b);
    const blockB = child(b, KB_FORMAT.blocks.promptBlock);
    const rulesB = child(b, KB_FORMAT.blocks.rules);
    const block = blockB ? oneLine(render(blockB, false)) : "";
    if (block.length > KB_FORMAT.limits.promptBlock) errors.push({ code: "block_too_long", detail: `${fm[1]}: blok` });
    const rules = rulesB ? render(rulesB, false) : "";
    if (!block && !rules) { errors.push({ code: "flag_empty", detail: fm[1] }); continue; }
    special.push({ flag: fm[1], title: (fm[2] ?? fm[1]).trim(), derived: yes(m.pochodny), derivedNote: derivedNote(m.pochodny), block: block || null, rules });
  }

  // ── footers ──
  const footers: KbFooter[] = [];
  const footerSec = find(KB_FORMAT.required.footers);
  for (const b of footerSec?.children ?? []) {
    if (!norm(b.title).startsWith(norm(KB_FORMAT.footerPrefix))) { warnings.push({ code: "footer_heading_ignored", detail: b.title }); continue; }
    const key = b.title.slice(b.title.indexOf(":") + 1).trim();
    if (!ID.test(key)) { errors.push({ code: "footer_key_invalid", detail: key }); continue; }
    if (footers.some((f) => f.key === key)) { errors.push({ code: "footer_duplicate", detail: key }); continue; }
    const { meta: m, rest } = meta(b);
    const text = oneLine(rest);
    if (!text) { errors.push({ code: "footer_empty", detail: key }); continue; }
    if (text.length > KB_FORMAT.limits.footer) errors.push({ code: "block_too_long", detail: `stopka ${key}` });
    const types = m.typ ? list(m.typ).map(norm) : null;
    const people = m.ludzie ? list(m.ludzie).map(norm) : null;
    if (types && types.some((t) => !(SHOT_TYPES as readonly string[]).includes(t))) errors.push({ code: "footer_condition_invalid", detail: `${key}: typ` });
    if (people && people.some((p) => !(PEOPLE as readonly string[]).includes(p))) errors.push({ code: "footer_condition_invalid", detail: `${key}: ludzie` });
    footers.push({
      key, text,
      when: {
        types: types as ShotType[] | null, people: people as People[] | null,
        recipe: m.przepis?.trim() || null, flag: m.flaga?.trim() || null, isDefault: yes(m.domyslna),
      },
    });
  }
  if (footerSec) {
    const defaults = footers.filter((f) => f.when.isDefault);
    if (defaults.length !== 1) errors.push({ code: defaults.length === 0 ? "footer_no_default" : "footer_many_defaults" });
  }
  for (const f of footers) {
    if (f.when.recipe && !recipes.some((r) => r.id === f.when.recipe)) errors.push({ code: "footer_condition_invalid", detail: `${f.key}: przepis ${f.when.recipe}` });
    if (f.when.flag && !special.some((s) => s.flag === f.when.flag)) errors.push({ code: "footer_condition_invalid", detail: `${f.key}: flaga ${f.when.flag}` });
  }

  // ── negative base ──
  let negativeBase = "";
  const negSec = find(KB_FORMAT.required.negative);
  let negIntro = "";
  if (negSec) {
    const own = negSec.lines.join("\n");
    const fence = /```[^\n]*\n([\s\S]*?)```/.exec(own);
    negativeBase = oneLine(fence ? fence[1] : stripComments(own));
    negIntro = fence ? tidy(stripComments(own.replace(fence[0], ""))) : "";
    if (!negativeBase) errors.push({ code: "negative_empty" });
    if (negativeBase.length > KB_FORMAT.limits.negative) errors.push({ code: "block_too_long", detail: "negative" });
  }
  const negativeItems = list(negativeBase);

  // ── plan rules, the people table ──
  const planSec = find(KB_FORMAT.required.planRules);
  const planRules: KbPlanRule[] = [];
  if (planSec) {
    planRules.push(...rulesOf("", ownText(planSec)));
    for (const c of planSec.children) planRules.push(...rulesOf(c.title, render(c, false)));
    if (planRules.length === 0) errors.push({ code: "plan_rules_empty" });
  }
  let peopleTable: PeopleRow[] | null = null;
  const peopleB = planSec?.children.find((c) => norm(c.title) === norm(KB_FORMAT.peopleTable));
  if (peopleB) {
    const rows = tableRows(peopleB.lines.join("\n")).slice(1);
    const parsed = rows.map((r) => {
      const n = range(r[0] ?? ""); const p = range(r[1] ?? ""); const h = range(r[2] ?? "");
      return n && p && h ? { from: n[0], to: n[1], persons: p, hands: h } : null;
    });
    if (parsed.length > 0 && parsed.every(Boolean)) peopleTable = parsed as PeopleRow[];
    else warnings.push({ code: "people_table_unreadable" });
  } else warnings.push({ code: "people_table_missing" });

  // ── creative directions (optional) ──
  const dirSec = find(KB_FORMAT.optional.directions);
  const directions = dirSec ? tableRows(dirSec.lines.join("\n")).slice(1).map((r) => r[0]).filter(Boolean) : [];
  if (!dirSec) warnings.push({ code: "directions_missing" });

  // ── the image-binding templates (optional) ──
  let binding: Record<string, string> | null = null;
  const bindSec = find(KB_FORMAT.optional.binding);
  if (bindSec) {
    binding = {};
    for (const line of stripComments(bindSec.lines.join("\n")).split("\n")) {
      const m = /^\s*[-*]\s*([a-z_0-9]+)\s*:\s*(.+)$/.exec(line);
      if (!m) continue;
      if (!KB_FORMAT.bindingKeys.includes(m[1])) { warnings.push({ code: "binding_key_unknown", detail: m[1] }); continue; }
      const text = oneLine(m[2]);
      if (text.length > KB_FORMAT.limits.binding) errors.push({ code: "block_too_long", detail: `binding.${m[1]}` });
      binding[m[1]] = text;
    }
    for (const k of ["calosc_1", "calosc_n", "detal"]) if (!binding[k]) errors.push({ code: "binding_key_missing", detail: k });
  }

  // ── instruction sections: everything but the verbatim blocks ──
  const sections: KbSection[] = [];
  const titleOf = h1?.title ?? "";
  for (const b of top) {
    const stages = stagesOf(b, warnings);
    const n = norm(b.title);
    if (n === norm(KB_FORMAT.required.footers)) {
      const t = ownText(b);
      if (t) sections.push({ title: b.title, stages: ["sceny"], text: t });
      continue;
    }
    if (n === norm(KB_FORMAT.required.negative)) {
      if (negIntro) sections.push({ title: b.title, stages: ["sceny"], text: negIntro });
      continue;
    }
    // Code fills these templates into the image prompt; no step reads them as instructions.
    if (n === norm(KB_FORMAT.optional.binding)) continue;
    if (n === norm(KB_FORMAT.required.recipes) || n === norm(KB_FORMAT.required.special)) {
      // Their entries are served per order (the chosen recipe, the set flags); the intro to every reader.
      const t = ownText(b);
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
  if (errors.length > 0) return { ok: false, errors, warnings, kb };
  return { ok: true, kb, warnings };
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
  const k = raw as Partial<KbParsed> | null;
  if (!k || k.format !== 1 || !Array.isArray(k.recipes) || !Array.isArray(k.special) || !Array.isArray(k.footers)
    || typeof k.negativeBase !== "string" || !Array.isArray(k.sections) || !Array.isArray(k.planRules) || !Array.isArray(k.directions)) return null;
  if (k.recipes.length === 0 || !k.footers.some((f) => f?.when?.isDefault)) return null;
  return k as KbParsed;
}

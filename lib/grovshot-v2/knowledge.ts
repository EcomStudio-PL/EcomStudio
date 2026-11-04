/**
 * GROVBASE SHOT V2 — EXPERT KNOWLEDGE (client-safe, pure).
 *
 * What an expert (Kuba) writes — the spec, later corrections, test notes —
 * becomes RULES: one paragraph, list item or table row each, with its source
 * (document, section, date), what it is about (topic), which stages read it,
 * where it applies (every product, a style recipe, a product category, a
 * product type, a kind of shot) and HOW it reaches the engine:
 *
 *   knowledge  sent to the stage's model through {{knowledge_rules}} (the
 *              stage template's USER section — data, never system authority);
 *   config     already in the engine config (recipes, footers, negative base,
 *              QC table, people table, candidates) — kept for traceability,
 *              never sent twice;
 *   template   already in a stage template's contract (output fields, codes);
 *   code       enforced by the engine's code (plan checks, colour check…);
 *   reference  background (architecture, test results, open questions).
 *
 * Nothing here publishes anything: the parser only PROPOSES rules (pending);
 * an admin approves them and publishes a knowledge VERSION; an order seals the
 * version that was active when it started and keeps it to the end.
 *
 * Continuous learning = new material → proposals → review → approval → a new
 * version → used by NEW orders. No model weights are trained.
 */
import { STAGE_ROLES, type StageRole } from "@/lib/grovshot-v2/config";

export const KNOWLEDGE_TOOL = "grovshot_v2";

export const KNOWLEDGE_TOPICS = [
  "fidelity", "card_scale", "planning", "recipes", "creative", "anti_stock", "references",
  "people", "light_color", "prompt_build", "qc", "errors", "cost", "context",
] as const;
export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];

export const KNOWLEDGE_SCOPES = ["global", "category", "recipe", "shot_type", "product_type"] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

export const KNOWLEDGE_DELIVERIES = ["knowledge", "config", "template", "code", "reference"] as const;
export type KnowledgeDelivery = (typeof KNOWLEDGE_DELIVERIES)[number];

export const RULE_STATUSES = ["pending", "approved", "rejected", "superseded", "retired"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const SOURCE_FORMATS = ["md", "txt", "pdf"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const RULE_BODY_MAX = 4000;
export const RULE_TITLE_MAX = 200;
/** A document's extracted text kept whole up to this length (and refused
 *  above it — never cut silently). */
export const SOURCE_TEXT_MAX = 600_000;

/** One proposed rule, as the parser reads it from a document. */
export type RuleDraft = {
  rule_key: string;
  section: string;
  position: number;
  page: number | null;
  source_date: string | null;
  topic: KnowledgeTopic;
  stages: StageRole[];
  scope_kind: KnowledgeScope;
  scope_values: string[];
  delivery: KnowledgeDelivery;
  is_correction: boolean;
  title: string;
  body: string;
};

export type ParsedDocument = {
  title: string | null;
  author: string | null;
  date: string | null;
  rules: RuleDraft[];
  warnings: string[];
};

/* ── text helpers ─────────────────────────────────────────────────────────*/

const PL: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };

/** Lower-case ASCII fold (Polish letters to their base letter) — for keys and matching. */
export function fold(s: string): string {
  return s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => PL[c] ?? c).normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function slug(s: string, max: number): string {
  const out = fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (out.slice(0, max).replace(/-+$/g, "") || "x");
}

/** The text compared for duplicates: folded, punctuation and spacing ignored. */
export function normalizedBody(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Word-set similarity of two bodies (0–1) — duplicates and possible conflicts. */
export function similarity(a: string, b: string): number {
  const wa = new Set(normalizedBody(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(normalizedBody(b).split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both);
}

const decodeEntities = (s: string) => s
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\\([[\]()*_#|-])/g, "$1");

/** Markdown emphasis and template markers out of a rule's text (a rule is
 *  data; it can never carry a stage-template marker or a placeholder). */
export function cleanRuleText(s: string): string {
  return decodeEntities(s)
    .replace(/\*\*|__/g, "")
    .replace(/`/g, "")
    .replace(/\{\{|\}\}/g, "")
    .split("\n").filter((l) => !/^\s*###\s*(USER|PROMPT)\s*###\s*$/i.test(l)).join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PL_MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paz", "lis", "gru"];
const pad = (n: number) => String(n).padStart(2, "0");
const validDay = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;

/** "Oct 27, 2026" / "27 października 2026" / "27.10.2026" → ISO date. */
export function parseDocDate(line: string): string | null {
  const f = fold(line);
  const en = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(f);
  if (en && EN_MONTHS.includes(en[1])) {
    const m = EN_MONTHS.indexOf(en[1]) + 1; const d = Number(en[2]); const y = Number(en[3]);
    if (validDay(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  const pl = /\b(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})\b/.exec(f);
  if (pl && PL_MONTHS.includes(pl[2])) {
    const m = PL_MONTHS.indexOf(pl[2]) + 1; const d = Number(pl[1]); const y = Number(pl[3]);
    if (validDay(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  const num = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(f);
  if (num) { const d = Number(num[1]); const m = Number(num[2]); const y = Number(num[3]); if (validDay(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`; }
  return null;
}

/** A dated note inside a rule: "(29.10)", "(maska lakiernicza, 29.10)",
 *  "Decyzje (02.11)", "(…, 28.10.2026)" — the year from the document. */
export function parseRuleDate(text: string, docDate: string | null): string | null {
  const head = text.slice(0, 160);
  const m = /\((?:[^()]{0,80}?[,\s])?(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\)/.exec(head);
  if (!m) return null;
  const y = m[3] ? Number(m[3]) : docDate ? Number(docDate.slice(0, 4)) : null;
  const d = Number(m[1]); const mo = Number(m[2]);
  if (y === null || !validDay(y, mo, d)) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/* ── classification (proposals — an admin reviews every one) ──────────────*/

type SectionRule = { re: RegExp; topic: KnowledgeTopic; stages: StageRole[]; delivery: KnowledgeDelivery };

/** Section heading → topic, stages, delivery. Matched on the deepest heading
 *  first, then its parents. Unknown sections: planning + prompt, sent. */
export const SECTION_RULES: readonly SectionRule[] = [
  { re: /architektur|schemat/, topic: "context", stages: [], delivery: "reference" },
  { re: /ograniczenia modelu/, topic: "fidelity", stages: ["card", "plan", "prompt"], delivery: "knowledge" },
  { re: /cel i zalozeni/, topic: "context", stages: [], delivery: "reference" },
  { re: /etap 0|sprawdzenie wejscia/, topic: "fidelity", stages: ["validate"], delivery: "knowledge" },
  { re: /etap 1|karta produktu|karty produktu/, topic: "card_scale", stages: ["card"], delivery: "knowledge" },
  { re: /ludzie i zwierzeta/, topic: "people", stages: ["plan", "prompt"], delivery: "knowledge" },
  { re: /wiernosc/, topic: "fidelity", stages: ["plan", "prompt"], delivery: "knowledge" },
  { re: /pora roku/, topic: "planning", stages: ["plan", "prompt"], delivery: "knowledge" },
  { re: /zasady wspolne/, topic: "recipes", stages: ["plan", "prompt"], delivery: "knowledge" },
  { re: /kierunki kreatywne/, topic: "creative", stages: ["plan", "prompt"], delivery: "knowledge" },
  { re: /przepis/, topic: "recipes", stages: ["plan", "prompt"], delivery: "knowledge" },
  { re: /procedura/, topic: "planning", stages: ["plan"], delivery: "knowledge" },
  { re: /referencj/, topic: "references", stages: ["plan", "prompt"], delivery: "knowledge" },
  { re: /stopk/, topic: "prompt_build", stages: ["prompt"], delivery: "knowledge" },
  { re: /negative/, topic: "prompt_build", stages: ["prompt"], delivery: "knowledge" },
  { re: /etap 3|wzorzec promptu|prompt/, topic: "prompt_build", stages: ["prompt"], delivery: "knowledge" },
  { re: /kontrola koloru/, topic: "qc", stages: ["qc"], delivery: "knowledge" },
  { re: /reakcja na blad|ponowne generacj/, topic: "errors", stages: ["qc"], delivery: "knowledge" },
  { re: /etap 4|kontrola jakosci/, topic: "qc", stages: ["qc"], delivery: "knowledge" },
  { re: /informacja zwrotna/, topic: "context", stages: [], delivery: "reference" },
  { re: /koszt|limit/, topic: "cost", stages: [], delivery: "reference" },
  { re: /wyniki testow/, topic: "errors", stages: [], delivery: "reference" },
  { re: /otwarte kwestie|nastepne kroki/, topic: "context", stages: [], delivery: "reference" },
  { re: /etap 2|plan ujec|kadr|tresc/, topic: "planning", stages: ["plan"], delivery: "knowledge" },
];

/** Style recipes named in a rule's title → recipe scope. */
export const RECIPE_NAMES: readonly { id: string; re: RegExp }[] = [
  { id: "christmas_aura", re: /swiateczn|bozonarodzeniow/ },
  { id: "industrial_cinematic", re: /kinowy przemyslowy/ },
  { id: "garden_outdoor", re: /ogrod i plener/ },
  { id: "seasonal_ad", re: /reklama sezonowa/ },
  { id: "appliance_food", re: /agd i jedzenie/ },
  { id: "premium_interiors", re: /wnetrza premium/ },
  { id: "home_care", re: /home care/ },
  { id: "outdoor_action", re: /outdoor i akcja/ },
  { id: "pet_lifestyle", re: /lifestyle zwierzat/ },
  { id: "beauty_editorial", re: /edytorski lifestyle beauty/ },
];

/** Product categories / types named in a rule's title → their match words
 *  (stems compared with the product card's name, variant and category). */
export const CATEGORY_LEXICON: readonly { kind: "category" | "product_type"; re: RegExp; values: string[] }[] = [
  { kind: "category", re: /czujnik|czad|gasnic|bezpieczenstw|alarm/, values: ["czujnik", "czad", "gasnic", "alarm", "bezpieczen", "detektor"] },
  { kind: "category", re: /elektronik|zdrowotn/, values: ["elektronik", "zdrowot", "inhalator", "nawilzacz", "oczyszczacz", "cisnieniomierz", "termometr"] },
  { kind: "category", re: /narzedzi|warsztat|ochronn/, values: ["narzedzi", "warsztat", "ochronn", "maska", "lakiern", "pila", "siekier", "wiertark", "szlifier"] },
  { kind: "product_type", re: /miekkich|miekkie|worki|torby|plandeki/, values: ["worek", "worki", "torba", "torby", "kosz", "plandek", "miekk"] },
];

const WITH_PEOPLE = /ujeci\w* z ludzmi|z ludzmi lub zwierzetami/;

function classifySection(path: string[]): Pick<RuleDraft, "topic" | "stages" | "delivery"> {
  for (let i = path.length - 1; i >= 0; i--) {
    const h = fold(path[i]);
    const hit = SECTION_RULES.find((r) => r.re.test(h));
    if (hit) return { topic: hit.topic, stages: [...hit.stages], delivery: hit.delivery };
  }
  return { topic: "planning", stages: ["plan", "prompt"], delivery: "knowledge" };
}

/** Item-level refinements inside broad sections (proposals only). */
function refineTopic(base: KnowledgeTopic, text: string): KnowledgeTopic {
  const f = fold(text);
  if (!["creative", "recipes", "planning", "fidelity"].includes(base)) return base;
  if (/anty-stock|wyglad stockowy|stockow/.test(f) && base !== "recipes") return "anti_stock";
  if (/referencj/.test(f) && base !== "recipes") return "references";
  if (/swiatl|zlot\w* godzin|niebieska godzin|polmrok|kolor/.test(f) && base === "creative") return "light_color";
  if (/kotwic|skal[aie]\b|skali\b/.test(f) && base !== "recipes") return "card_scale";
  return base;
}

function scopeOf(title: string, body: string): Pick<RuleDraft, "scope_kind" | "scope_values"> {
  const t = fold(title);
  const recipe = RECIPE_NAMES.find((r) => r.re.test(t));
  if (recipe) return { scope_kind: "recipe", scope_values: [recipe.id] };
  const cat = CATEGORY_LEXICON.find((c) => c.re.test(t));
  if (cat) return { scope_kind: cat.kind, scope_values: [...cat.values] };
  if (WITH_PEOPLE.test(fold(`${title} ${body.slice(0, 120)}`))) return { scope_kind: "shot_type", scope_values: ["person", "hands", "animal"] };
  return { scope_kind: "global", scope_values: [] };
}

/* ── the parser ───────────────────────────────────────────────────────────*/

type Block = { kind: "para" | "item" | "row" | "code"; text: string; path: string[]; page: number | null; header?: string[] };

/** A paragraph's bold lead ("**Tytuł:** treść") → [title, rest]. */
function boldLead(text: string): [string, string] | null {
  const m = /^\*\*(.+?)\*\*\s*[:.]?\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  return [m[1].replace(/[:.]\s*$/, "").trim(), m[2].trim()];
}

function firstWords(s: string, n = 9): string {
  const w = cleanRuleText(s).replace(/\s+/g, " ").split(" ");
  return w.slice(0, n).join(" ").replace(/[,:;.]+$/, "") + (w.length > n ? "…" : "");
}

/** Markdown (and plain text with `#` headings) → blocks. */
function blocksOfMarkdown(text: string, warnings: string[], plain = false): { blocks: Block[]; title: string | null; meta: string | null } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const path: string[] = [];
  let title: string | null = null;
  let meta: string | null = null;
  let para: string[] = [];
  let item: string[] | null = null;
  let table: string[] = [];
  let code: string[] | null = null;
  // A bold label alone ("**Ograniczenia modelu:**") heads the list right after it.
  let label: string | null = null;
  const flushPara = () => {
    if (para.length) {
      const t = para.join("\n").trim();
      if (/^\*\*[^*]+\*\*\s*:?\s*$/.test(t)) label = cleanRuleText(t).replace(/:\s*$/, "");
      else { label = null; if (t) blocks.push({ kind: "para", text: t, path: [...path], page: null }); }
    }
    para = [];
  };
  const flushItem = () => {
    if (item?.length) blocks.push({ kind: "item", text: item.join("\n").trim(), path: label ? [...path, label] : [...path], page: null });
    item = null;
  };
  const flushTable = () => {
    if (table.length >= 2) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(table[0]);
      for (const row of table.slice(1)) {
        if (/^\s*\|?\s*:?-{2,}/.test(row)) continue;
        const c = cells(row);
        if (c.every((x) => !x)) continue;
        blocks.push({ kind: "row", text: c.join(" | "), path: [...path], page: null, header });
      }
    } else if (table.length === 1) para.push(table[0]);
    table = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (code) {
      if (/^```/.test(line.trim())) { blocks.push({ kind: "code", text: code.join("\n").trim(), path: [...path], page: null }); code = null; }
      else code.push(line);
      continue;
    }
    if (/^```/.test(line.trim())) { flushPara(); flushItem(); flushTable(); code = []; continue; }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      flushPara(); flushItem(); flushTable();
      label = null;
      const level = h[1].length;
      const name = cleanRuleText(h[2]);
      if (level === 1 && title === null) { title = name; path.length = 0; continue; }
      path.length = Math.max(0, level - 2);
      path.push(name);
      continue;
    }
    // Plain text: a short line in capitals is a heading (NOTATKI Z TESTU 06.11).
    if (plain && line.trim().length <= 80 && /\p{Lu}{3}/u.test(line) && !/\p{Ll}/u.test(line) && !/^\s*(?:[-*•]|\d{1,2}[.)])\s/.test(line)) {
      flushPara(); flushItem(); flushTable(); label = null;
      path.length = 0; path.push(cleanRuleText(line.trim()));
      continue;
    }
    if (/^\s*\|/.test(line)) { flushPara(); flushItem(); table.push(line); continue; }
    if (table.length) flushTable();
    const li = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(\[[ x]\]\s+)?(.+)$/.exec(line);
    if (li) { flushPara(); flushItem(); item = [li[2]]; continue; }
    if (!line.trim()) { flushPara(); flushItem(); continue; }
    if (item) { item.push(line.trim()); continue; }
    // The author/date line right under the title is metadata, not a rule.
    if (title !== null && meta === null && path.length === 0 && blocks.length === 0 && para.length === 0 && parseDocDate(line)) { meta = line.trim(); continue; }
    para.push(line.trim());
  }
  if (code) blocks.push({ kind: "code", text: (code as string[]).join("\n").trim(), path: [...path], page: null });
  flushPara(); flushItem(); flushTable();
  if (blocks.some((b) => /embedded content/i.test(b.text))) warnings.push("embedded_diagram");
  return { blocks, title, meta };
}

/** PDF text (pages joined with "=== N ===" markers): no reliable headings —
 *  paragraphs and bullet lines per page, the page as the section. */
function blocksOfPdf(text: string, warnings: string[]): { blocks: Block[]; title: string | null } {
  warnings.push("pdf_structure_heuristic");
  const blocks: Block[] = [];
  const pages = text.split(/^=== (\d+) ===$/m);
  let title: string | null = null;
  for (let i = 1; i < pages.length; i += 2) {
    const page = Number(pages[i]);
    const lines = pages[i + 1].split("\n").map((l) => l.trim()).filter((l) => l && !/^page\s+\d+\s+of\s+\d+$/i.test(l));
    if (title === null && lines[0]) title = lines.find((l) => l.length > 8) ?? null;
    let para: string[] = [];
    const flush = () => { if (para.join(" ").trim().length > 30) blocks.push({ kind: "para", text: para.join(" "), path: [`Strona ${page}`], page }); para = []; };
    for (const l of lines) {
      if (title && l === title) continue;
      if (/^(?:[-•●▪]|\d{1,2}[.)])\s+/.test(l)) { flush(); para = [l.replace(/^(?:[-•●▪]|\d{1,2}[.)])\s+/, "")]; continue; }
      para.push(l);
      if (/[.!?:]$/.test(l)) flush();
    }
    flush();
  }
  return { blocks, title };
}

/**
 * Parse a document into rule PROPOSALS. Deterministic: the same text gives the
 * same rules and the same keys (so re-importing a document finds every
 * unchanged rule as a duplicate, and a changed paragraph as a new revision).
 */
export function parseKnowledgeText(text: string, opts: { docKey: string; format: SourceFormat; defaultDate?: string | null }): ParsedDocument {
  const warnings: string[] = [];
  const md = opts.format !== "pdf" ? blocksOfMarkdown(text, warnings, opts.format === "txt") : null;
  const pdf = opts.format === "pdf" ? blocksOfPdf(text, warnings) : null;
  const blocks = md?.blocks ?? pdf?.blocks ?? [];
  const title = md?.title ?? pdf?.title ?? null;
  const meta = md?.meta ?? null;
  const docDate = (meta ? parseDocDate(meta) : null) ?? opts.defaultDate ?? null;
  const author = meta ? (/@([\p{L}][\p{L}\d_.-]{0,40})/u.exec(meta)?.[1] ?? null) : null;
  const docKey = slug(opts.docKey, 40);
  const keys = new Map<string, number>();
  const rules: RuleDraft[] = [];
  let position = 0;
  for (const b of blocks) {
    const sectionPath = b.path.length ? b.path : ["Dokument"];
    let titleText: string;
    let body: string;
    if (b.kind === "row") {
      const cells = b.text.split(" | ");
      titleText = cleanRuleText(cells[0] ?? "");
      body = (b.header ?? []).map((h, i) => (cells[i] ? `${cleanRuleText(h)}: ${cleanRuleText(cells[i])}` : "")).filter(Boolean).join("; ");
    } else if (b.kind === "code") {
      titleText = sectionPath[sectionPath.length - 1];
      body = cleanRuleText(b.text);
    } else {
      const lead = boldLead(b.text);
      if (lead && !lead[1]) continue; // a bare label (it heads the list after it)
      titleText = lead ? cleanRuleText(lead[0]) : firstWords(b.text);
      body = cleanRuleText(b.text);
    }
    if (/embedded content/i.test(body)) {
      body = `[schemat osadzony w dokumencie: ${body.replace(/^\[?embedded content:\s*/i, "").replace(/\]$/, "")} — treść schematu w wersji PDF]`;
      titleText = "Schemat (osadzony)";
    }
    if (!body || body.length < 3) continue;
    if (body.length > RULE_BODY_MAX) { warnings.push(`rule_too_long:${position + 1}`); body = body.slice(0, RULE_BODY_MAX); }
    const base = classifySection(sectionPath);
    const topic = refineTopic(base.topic, `${titleText} ${body}`);
    const scope = scopeOf(titleText, body);
    const keyBase = `${docKey}:${slug(sectionPath[sectionPath.length - 1], 28)}:${slug(titleText, 44)}`.slice(0, 116);
    const n = (keys.get(keyBase) ?? 0) + 1;
    keys.set(keyBase, n);
    position += 1;
    rules.push({
      rule_key: n === 1 ? keyBase : `${keyBase}-${n}`,
      section: sectionPath.join(" › ").slice(0, 300),
      position, page: b.page,
      source_date: parseRuleDate(`${titleText} ${body}`, docDate) ?? docDate,
      topic, stages: base.stages, scope_kind: scope.scope_kind, scope_values: scope.scope_values,
      delivery: base.delivery,
      is_correction: /^korekt|\bkorekta\b|\bpoprawka\b/.test(fold(titleText)),
      title: titleText.slice(0, RULE_TITLE_MAX) || "—",
      body,
    });
  }
  if (rules.length === 0) warnings.push("no_rules");
  return { title, author, date: docDate, rules, warnings };
}

/* ── review helpers ───────────────────────────────────────────────────────*/

export type ExistingRule = { id: string; rule_key: string; revision: number; status: RuleStatus; scope_kind: KnowledgeScope; scope_values: string[]; topic: KnowledgeTopic; body: string; is_correction: boolean };

export type ReviewHint =
  | { kind: "duplicate"; of: string }
  | { kind: "revision"; of: string; revision: number }
  | { kind: "conflict"; with: string[] }
  | { kind: "new" };

const OPEN: ReadonlySet<RuleStatus> = new Set(["pending", "approved"]);
const sameScope = (a: Pick<RuleDraft, "scope_kind" | "scope_values">, b: Pick<RuleDraft, "scope_kind" | "scope_values">) =>
  a.scope_kind === b.scope_kind && (a.scope_kind === "global" || a.scope_values.some((v) => b.scope_values.includes(v)));

/**
 * What a proposal is against the live rules: a duplicate (the same text is
 * already pending or approved — not inserted again), a new revision of a rule
 * with its key (changed text), a possible conflict (a correction, or a rule in
 * the same scope and topic that reads alike) — or simply new.
 */
export function reviewHint(draft: RuleDraft, existing: readonly ExistingRule[]): ReviewHint {
  const norm = normalizedBody(draft.body);
  const dup = existing.find((e) => OPEN.has(e.status) && normalizedBody(e.body) === norm);
  if (dup) return { kind: "duplicate", of: dup.id };
  const sameKey = existing.filter((e) => e.rule_key === draft.rule_key).sort((a, b) => b.revision - a.revision)[0];
  if (sameKey) return { kind: "revision", of: sameKey.id, revision: sameKey.revision + 1 };
  const near = existing.filter((e) => OPEN.has(e.status) && e.topic === draft.topic && sameScope(e, draft)
    && similarity(e.body, draft.body) >= (draft.is_correction || e.is_correction ? 0.12 : 0.45));
  if (near.length > 0) return { kind: "conflict", with: near.slice(0, 5).map((e) => e.id) };
  return { kind: "new" };
}

/* ── the runtime: which approved rules a stage reads ──────────────────────*/

export type SnapshotRule = {
  id: string; rule_key: string; revision: number; topic: KnowledgeTopic; stages: StageRole[];
  scope_kind: KnowledgeScope; scope_values: string[]; is_correction: boolean;
  title: string; body: string; source_date: string | null; supersedes: string[];
};
export type SnapshotExample = { id: string; category: string | null; rating: number; what_worked: string | null; prompt_excerpt: string | null };
/** What an order seals at its start: the active version's sent rules (or,
 *  for an admin preview test, the approved rules not yet published). */
export type KnowledgeSnapshot = {
  version_id: string | null; version: number; preview: boolean;
  rules: SnapshotRule[]; examples: SnapshotExample[];
};

export type SelectContext = {
  stage: StageRole;
  recipeId?: string | null;
  /** The product card's name, variant and category (scope words are matched here). */
  productText?: string | null;
  frameType?: string | null;
  people?: string | null;
};

export function parseSnapshot(raw: unknown): KnowledgeSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.rules) || typeof r.version !== "number") return null;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
  const rules: SnapshotRule[] = r.rules.flatMap((x): SnapshotRule[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const topic = KNOWLEDGE_TOPICS.find((t) => t === o.topic);
    const scope = KNOWLEDGE_SCOPES.find((t) => t === o.scope_kind);
    if (!topic || !scope || !str(o.id) || !str(o.body)) return [];
    return [{
      id: str(o.id), rule_key: str(o.rule_key), revision: typeof o.revision === "number" ? o.revision : 1, topic,
      stages: strs(o.stages).filter((s): s is StageRole => (STAGE_ROLES as readonly string[]).includes(s)),
      scope_kind: scope, scope_values: strs(o.scope_values), is_correction: o.is_correction === true,
      title: str(o.title), body: str(o.body), source_date: str(o.source_date) || null, supersedes: strs(o.supersedes),
    }];
  });
  const examples: SnapshotExample[] = (Array.isArray(r.examples) ? r.examples : []).flatMap((x): SnapshotExample[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const rating = typeof o.rating === "number" ? o.rating : 0;
    if (!str(o.id) || rating < 4) return []; // never a weak or negative example as a pattern
    return [{ id: str(o.id), category: str(o.category) || null, rating, what_worked: str(o.what_worked) || null, prompt_excerpt: str(o.prompt_excerpt) || null }];
  });
  return {
    version_id: str(r.version_id) || null, version: r.version as number, preview: r.preview === true, rules, examples,
  };
}

export function ruleApplies(rule: Pick<SnapshotRule, "stages" | "scope_kind" | "scope_values">, ctx: SelectContext): boolean {
  if (!rule.stages.includes(ctx.stage)) return false;
  switch (rule.scope_kind) {
    case "global": return true;
    case "recipe": return Boolean(ctx.recipeId) && rule.scope_values.includes(ctx.recipeId!);
    case "category":
    case "product_type": {
      const text = ctx.productText ? fold(ctx.productText) : "";
      return text.length > 0 && rule.scope_values.some((v) => v.trim().length >= 3 && text.includes(fold(v.trim())));
    }
    case "shot_type":
      // The plan sees the whole set (every kind of shot it may plan).
      if (ctx.stage === "plan") return true;
      return rule.scope_values.includes(ctx.frameType ?? "") || rule.scope_values.includes(ctx.people ?? "");
  }
}

const TOPIC_ORDER = new Map(KNOWLEDGE_TOPICS.map((t, i) => [t, i]));
const SCOPE_ORDER: Record<KnowledgeScope, number> = { global: 0, shot_type: 1, product_type: 2, category: 3, recipe: 4 };

function groupLabel(r: SnapshotRule): string {
  return r.scope_kind === "global" ? `global · ${r.topic}` : `${r.scope_kind}:${r.scope_values.slice(0, 4).join(",")} · ${r.topic}`;
}

function line(r: SnapshotRule): string {
  const mark = r.is_correction ? `[correction${r.source_date ? ` · ${r.source_date}` : ""}] ` : "";
  const body = r.body.replace(/\s*\n\s*/g, " ");
  const head = body.toLowerCase().startsWith(r.title.toLowerCase().replace(/…$/, "")) ? "" : `${r.title}: `;
  return `- ${mark}${head}${body}`;
}

export type Selection = { text: string; used: string[]; dropped: number; chars: number; examples: string[] };

/**
 * The rules of one stage call, as the text {{knowledge_rules}} carries.
 * Global rules first (by topic), then the specific ones (a kind of shot, a
 * product type, a category, the recipe) — "najpierw przepis kategorii, potem
 * korekty zapisane dla tej kategorii": a correction stands right after the
 * rules of its own scope. A rule another selected rule supersedes is never
 * sent. When the stage's limit is reached the specific rules and corrections
 * are kept first; what did not fit is counted (and shown to the admin).
 */
export function selectKnowledge(snapshot: KnowledgeSnapshot | null, ctx: SelectContext, maxChars: number): Selection {
  if (!snapshot) return { text: "", used: [], dropped: 0, chars: 0, examples: [] };
  const applicable = snapshot.rules.filter((r) => ruleApplies(r, ctx));
  const superseded = new Set(applicable.flatMap((r) => r.supersedes));
  const live = applicable.filter((r) => !superseded.has(r.id));
  // Priority for the budget: corrections, then the specific scopes, then the rest in topic order.
  const priority = [...live].sort((a, b) => Number(b.is_correction) - Number(a.is_correction)
    || SCOPE_ORDER[b.scope_kind] - SCOPE_ORDER[a.scope_kind]
    || (TOPIC_ORDER.get(a.topic) ?? 99) - (TOPIC_ORDER.get(b.topic) ?? 99));
  const kept = new Set<string>();
  let used = 0;
  let dropped = 0;
  const headerCost = 40;
  for (const r of priority) {
    const cost = line(r).length + 1 + headerCost;
    if (used + cost > maxChars) { dropped++; continue; }
    kept.add(r.id); used += cost;
  }
  // Display order: global → specific; within a group by topic, base rules
  // before corrections, then the document's own order (stable).
  const shown = live.filter((r) => kept.has(r.id)).sort((a, b) => SCOPE_ORDER[a.scope_kind] - SCOPE_ORDER[b.scope_kind]
    || groupLabel(a).localeCompare(groupLabel(b))
    || Number(a.is_correction) - Number(b.is_correction)
    || (a.source_date ?? "").localeCompare(b.source_date ?? ""));
  const out: string[] = [];
  let group = "";
  for (const r of shown) {
    const g = groupLabel(r);
    if (g !== group) { out.push(`### ${g}`); group = g; }
    out.push(line(r));
  }
  // Approved test cases (rating ≥ 4) for the prompt writer, same category only.
  const exampleIds: string[] = [];
  if (ctx.stage === "prompt" && snapshot.examples.length > 0 && ctx.productText) {
    const text = fold(ctx.productText);
    for (const e of snapshot.examples) {
      if (exampleIds.length >= 2 || !e.category) continue;
      const words = fold(e.category).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
      if (!words.some((w) => text.includes(w))) continue;
      const block = [`### approved example · ${e.category} · ${e.rating}/5`, e.what_worked ? `worked: ${e.what_worked}` : "", e.prompt_excerpt ? `prompt excerpt: ${e.prompt_excerpt}` : ""]
        .filter(Boolean).join("\n");
      if (out.join("\n").length + block.length + 2 > maxChars) break;
      out.push(block); exampleIds.push(e.id);
    }
  }
  const text = out.join("\n");
  return { text, used: shown.map((r) => r.id), dropped, chars: text.length, examples: exampleIds };
}

/** The per-stage limits of {{knowledge_rules}} (chars) — the registry's max. */
export const KNOWLEDGE_LIMITS: Record<StageRole, number> = { validate: 4_000, card: 6_000, plan: 20_000, prompt: 14_000, qc: 6_000 };

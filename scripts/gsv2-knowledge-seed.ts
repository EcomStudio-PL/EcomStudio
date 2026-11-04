/**
 * GROVBASE SHOT V2 — THE SEED OF KUBA'S SPEC INTO THE KNOWLEDGE BASE.
 *
 *   npx esbuild scripts/gsv2-knowledge-seed.ts --bundle --platform=node --format=cjs --alias:@=. --outfile=.next/gsv2-seed.cjs \
 *     && node .next/gsv2-seed.cjs <spec.md>      (writes supabase/migrations/0165_grovshot_v2_knowledge_seed_<n>.sql)
 *
 * The rules come from the SAME parser every upload uses
 * (lib/grovshot-v2/knowledge.ts — one rule per paragraph, list item or table
 * row, with its section and date). Its classification is a proposal; for this
 * first document the proposals were reviewed against the engine and the
 * overrides below fix what the heuristics cannot know: which rules the engine
 * ALREADY carries (config / template / code — never sent twice), the scope of
 * a category correction, and what supersedes what (the 03.11 Christmas
 * correction). No rule text is written here: titles and bodies are Kuba's.
 *
 * Everything lands as `pending`: an admin reviews, approves and publishes.
 * The MD is the primary source; the PDF (the same document) is recorded as
 * its confirmation, and only its page-2 diagram — absent from the MD — adds a
 * rule (transcribed, delivery `reference`).
 *
 * scripts/grovshot-v2-tests.ts re-runs this generator on the MD embedded in
 * part 1 and requires every part to be exactly its output.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseKnowledgeText, type KnowledgeDelivery, type KnowledgeScope, type KnowledgeTopic, type RuleDraft } from "@/lib/grovshot-v2/knowledge";
import type { StageRole } from "@/lib/grovshot-v2/config";

export const SPEC_SET_NAME = "GrovBase Shot – specyfikacja silnika lifestyle";
export const SPEC_DOC_KEY = "grovbase-shot-spec";
export const SPEC_MD_SHA256 = "42347b65326e6f6fab76fd8c91cc77861759d4ed3ed7f2127646286db2527cd8";
export const SPEC_PDF_SHA256 = "110bace8f56e1a37957e6c1204d605b64bef07a27cee84f24179e857390743e6";
export const SPEC_PDF_BYTES = 665372;

type Override = Partial<{ topic: KnowledgeTopic; stages: StageRole[]; delivery: KnowledgeDelivery; scope_kind: KnowledgeScope; scope_values: string[]; is_correction: boolean; supersedes: number[] }>;

const SAFETY = ["czujnik", "czad", "gasnic", "alarm", "bezpieczen", "detektor"];
const ELECTRONICS_HEALTH = ["elektronik", "zdrowot", "inhalator", "nawilzacz", "oczyszczacz", "cisnieniomierz", "termometr", "czujnik", "czad", "detektor"];
const PP: StageRole[] = ["plan", "prompt"];

/** position → [title prefix it must have, override]. */
export const OVERRIDES: Record<number, [string, Override]> = {
  6: ["Składa produkt z fragmentów", { topic: "fidelity", stages: PP }],
  7: ["Edycja gotowego zdjęcia", { topic: "errors", stages: [], delivery: "code" }],
  8: ["Nie istnieje „perfekcyjna”", { topic: "qc", stages: [], delivery: "reference" }],
  13: ["Karta produktu to najważniejszy", { topic: "card_scale", stages: [], delivery: "reference" }],
  // Etap 0: the validate template's issue codes and decideValidation carry them.
  14: ["Ostrość, ten sam produkt", { delivery: "template" }],
  15: ["Spójność zdjęć", { topic: "fidelity", delivery: "template" }],
  16: ["Elementy do wycięcia", { delivery: "template" }],
  17: ["Dodatki z referencji", { topic: "fidelity", stages: ["validate", "card", "prompt"], delivery: "template" }],
  18: ["Wymiary", { stages: ["validate", "card"], delivery: "template" }],
  19: ["Zgodność opisu ze zdjęciami", { stages: ["card"], delivery: "template" }],
  // Etap 1: the card template's field guide and the card schema.
  ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [20 + i, ["", { delivery: "template" as const }]])),
  35: ["Plan ujęć to etap", { topic: "planning", delivery: "template" }],
  42: ["Produkty składane", { topic: "planning" }],
  43: ["Uczciwość", { stages: PP }],
  49: ["Hero", { stages: PP }],
  50: ["Pierwszy plan tylko", { stages: PP }],
  // The auction order is applied by checkPlan.
  51: ["Kolejność na aukcji", { delivery: "code" }],
  65: ["Montaż z życiem", { topic: "anti_stock" }],
  // The people table is the config's people_table; 2 candidates is config.candidates.
  66: ["1–2", { stages: [], delivery: "config" }],
  67: ["3–5", { stages: [], delivery: "config" }],
  68: ["6–10", { stages: [], delivery: "config" }],
  73: ["Ujęcia z ludźmi lub zwierzętami: 2", { stages: [], delivery: "config", scope_kind: "global", scope_values: [] }],
  // The recipe table → config.recipes; the shared rules and clichés → config.
  ...Object.fromEntries([76, 77, 78, 79, 80, 81, 82].map((p) => [p, ["", { stages: [], delivery: "config" as const }]])),
  ...Object.fromEntries([83, 84, 85, 86, 87, 88, 89].map((p) => [p, ["", { stages: [], delivery: "config" as const }]])),
  // The directions table is the director's menu (Etap 2 picks one per shot;
  // the writer gets the chosen direction in the shot's plan).
  ...Object.fromEntries([91, 92, 93, 94, 95, 96, 97, 98, 99, 100].map((p) => [p, ["", { topic: "creative" as const, stages: ["plan"] as StageRole[] }]])),
  101: ["Składniki obowiązkowe", { topic: "people" }],
  // The anti-stock questions are the plan template's anti_stock fields and a
  // code check; the light distribution is a code check (checkPlan).
  103: ["Kontrola anty-stock", { stages: ["plan"], delivery: "template" }],
  104: ["Zróżnicowanie światła", { topic: "light_color", stages: ["plan"], delivery: "code" }],
  105: ["Elektronika i sprzęt zdrowotny", { scope_kind: "category", scope_values: ELECTRONICS_HEALTH }],
  106: ["Korekta (czujnik czadu", { scope_kind: "category", scope_values: ELECTRONICS_HEALTH }],
  107: ["Produkty pasywne i bezpieczeństwa", { scope_values: SAFETY }],
  108: ["Wzorzec, który działa", { topic: "creative", scope_values: SAFETY }],
  109: ["Czego unikać", { topic: "creative", scope_kind: "category", scope_values: SAFETY }],
  // "Najpierw przepis kategorii, potem korekty zapisane dla tej kategorii" is
  // how the selection itself works (scoped rules, corrections after their base).
  111: ["Korekty dotyczą swojej kategorii", { topic: "recipes", stages: [], delivery: "code", is_correction: false }],
  112: ["Przepis „kinowy przemysłowy”", { topic: "recipes", stages: [], delivery: "config" }],
  113: ["Z referencji narzędziowych", { topic: "creative", scope_kind: "recipe", scope_values: ["industrial_cinematic"] }],
  114: ["Obowiązkowe: detale od sprzedawcy", { topic: "references" }],
  115: ["Skala miękkich produktów", { stages: ["card", "plan", "prompt"] }],
  116: ["Przepis „ogród i plener”", { topic: "recipes", stages: [], delivery: "config" }],
  117: ["Blok stylu nie może", { topic: "prompt_build" }],
  118: ["Decyzje (02.11)", { topic: "planning", stages: ["plan", "prompt", "qc"] }],
  // The 03.11 recipe is in the config (reconciled with its correction) and is
  // superseded by the correction, which is sent.
  119: ["Przepis „świąteczna aura”", { topic: "recipes", stages: [], delivery: "config" }],
  120: ["Korekta przepisu świątecznego", { topic: "recipes", supersedes: [119] }],
  122: ["Spójność kotwic skali", { topic: "card_scale" }],
  123: ["Sezon użycia", { topic: "planning", stages: ["card", "plan", "prompt"] }],
  124: ["Kadr z wnętrza pojemnika", { topic: "planning" }],
  125: ["Mgiełka, para, dym", { topic: "creative" }],
  129: ["Rozkład światła w zestawie", { topic: "light_color", delivery: "code" }],
  130: ["Rozkład typów kadru", { delivery: "code" }],
  131: ["Każde ujęcie ma kierunek", { delivery: "template" }],
  132: ["Referencja wybrana według", { stages: PP }],
  134: ["Uczciwość: zawartość zestawu", { topic: "planning", scope_kind: "global", scope_values: [] }],
  // Etap 3: the shot template's ten blocks (with the emotional lead) carry the modules.
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [135 + i, ["", { delivery: "template" as const }]])),
  146: ["Dołączane tylko zdjęcia", { delivery: "code" }],
  147: ["Zwykle 2 referencje", { stages: ["plan"] }],
  148: ["Referencje tylko z tym samym", { delivery: "code" }],
  149: ["Przy zbliżeniu zawsze", { delivery: "code" }],
  150: ["Stopka zawsze jest", { delivery: "template" }],
  ...Object.fromEntries([151, 152, 153, 154, 155, 156, 157].map((p) => [p, ["", { stages: [], delivery: "config" as const }]])),
  158: ["Do bazy silnik dopisuje", { delivery: "code" }],
  159: ["Model oceniający (wizyjny)", { topic: "qc", delivery: "template" }],
  160: ["Odrzuć zawsze", { topic: "qc", stages: [], delivery: "config" }],
  161: ["Odrzuć tylko w hero", { topic: "qc", stages: [], delivery: "config" }],
  162: ["Przepuść (tolerancja)", { topic: "qc", stages: [], delivery: "config" }],
  163: ["Dodatkowo „odrzuć zawsze”", { topic: "qc", stages: [], delivery: "config" }],
  164: ["Uwaga", { topic: "qc" }],
  165: ["Porównanie próbki koloru", { stages: [], delivery: "code" }],
  168: ["Bez edycji gotowych zdjęć", { stages: [], delivery: "code" }],
  169: ["Limit", { stages: [], delivery: "config" }],
  172: ["Kandydaci", { delivery: "config" }],
  173: ["Ponowne generacje", { delivery: "config" }],
  175: ["Brak udanego wyniku", { delivery: "code" }],
  // Test lessons that are not already rules elsewhere are sent.
  188: ["Pierwszy test z kierunkami", { topic: "prompt_build", stages: PP, delivery: "knowledge" }],
  189: ["Maska lakiernicza (29.10)", { topic: "creative", stages: PP, delivery: "knowledge", scope_kind: "recipe", scope_values: ["industrial_cinematic"] }],
  195: ["Przepisy stylu dla kolejnych", { scope_kind: "global", scope_values: [] }],
  201: ["Decyzja do podjęcia", { topic: "fidelity", delivery: "config" }],
};

/** Page 2 of the PDF: the diagram the MD only embeds — transcribed, nothing added. */
export const PDF_DIAGRAM = {
  rule_key: `${SPEC_DOC_KEY}:pdf-s2:schemat-etapow-silnika`,
  title: "Schemat etapów silnika (PDF, s. 2)",
  body: "Schemat „etapy silnika GrovBase Shot · 6 etapów, 2 pętle” — nagłówek: „Każdy etap czyta z karty produktu, a błędy wracają do generacji lub promptu”. "
    + "Panel klienta (zdjęcia, opis z Allegro, scenariusz, format, liczba) → Etap 0 · sprawdzenie wejścia (ostrość, spójność, wymiary; komunikat przed opłatą) "
    + "→ Etap 1 · karta produktu (budowa, skala, stany, argumenty, ograniczenia) → Etap 2 · plan ujęć (argument, kadr, tryb, ludzie, kandydaci, referencje) "
    + "→ Etap 3 · prompty (bloki: kierunek, produkt, skala, chwyt, kadr, stopka) → Generacja · Nano Banana Pro (1–2 kandydatów na ujęcie, zawsze od zera) "
    + "→ Etap 4 · kontrola jakości (wierność, skala, kolor, fizyka; wybór lepszego) → przechodzi → Dostarczenie (kadr do formatu, biblioteka, ocena klienta). "
    + "Przepisy stylu (7 kategorii: sezon, AGD, wnętrza, home care, outdoor, zwierzęta, beauty) zasilają Etap 2 i Etap 3. "
    + "Pętle: błąd systematyczny z Etapu 4 → nowy prompt (Etap 3); błąd losowy → ten sam prompt (ponowna generacja).",
};

export type SeedRule = RuleDraft & { supersedesKeys: string[]; body_sha256: string };

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function seedRules(md: string): SeedRule[] {
  const parsed = parseKnowledgeText(md, { docKey: SPEC_DOC_KEY, format: "md" });
  const byPos = new Map(parsed.rules.map((r) => [r.position, r]));
  for (const [pos, [prefix]] of Object.entries(OVERRIDES)) {
    const r = byPos.get(Number(pos));
    if (!r) throw new Error(`override for missing position ${pos}`);
    if (prefix && !r.title.startsWith(prefix)) throw new Error(`override ${pos}: title "${r.title}" does not start with "${prefix}"`);
  }
  return parsed.rules.map((r) => {
    const o = OVERRIDES[r.position]?.[1] ?? {};
    const out: RuleDraft = {
      ...r,
      ...(o.topic ? { topic: o.topic } : {}),
      ...(o.stages ? { stages: o.stages } : {}),
      ...(o.delivery ? { delivery: o.delivery } : {}),
      ...(o.scope_kind ? { scope_kind: o.scope_kind } : {}),
      ...(o.scope_values ? { scope_values: o.scope_values } : {}),
      ...(o.is_correction !== undefined ? { is_correction: o.is_correction } : {}),
    };
    // A rule that is not sent has no stage to be sent to only when it is background.
    if (out.delivery === "knowledge" && out.stages.length === 0) throw new Error(`rule ${r.position} is sent but has no stage`);
    if (out.scope_kind === "global") out.scope_values = [];
    const supersedesKeys = (o.supersedes ?? []).map((p) => byPos.get(p)!.rule_key);
    return { ...out, supersedesKeys, body_sha256: sha(out.body) };
  });
}

const q = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);
const arr = (a: readonly string[]) => (a.length ? `array[${a.map(q).join(", ")}]::text[]` : "'{}'::text[]");
const date = (d: string | null) => (d ? `date '${d}'` : "null::date");

export type SeedFile = { name: string; sql: string };
const RULES_PER_PART = 50;

/** The seed as migration files: part 1 = the set, the sources (the MD in full)
 *  and the PDF's diagram; then the rules in parts of 50 (the last one also
 *  links what supersedes what). The rule texts' sha256 is computed by the
 *  database from the text itself — no hash is typed into the files. */
export function seedFiles(md: string): SeedFile[] {
  if (sha(md) !== SPEC_MD_SHA256) throw new Error("the spec MD is not the reviewed document (sha256 differs)");
  if (md.includes("$kuba_md$")) throw new Error("the MD contains the dollar-quote tag");
  const rules = seedRules(md);
  const delivered = rules.filter((r) => r.delivery === "knowledge").length;
  const set = q(SPEC_SET_NAME);
  const setRow = `(select id from public.knowledge_sets where name = ${set} order by created_at limit 1)`;
  const mdSource = `(select ks.id from public.knowledge_sources ks where ks.set_id = ${setRow} and ks.doc_key = '${SPEC_DOC_KEY}' and ks.version = 1 and ks.format = 'md')`;
  const pdfSource = `(select ks.id from public.knowledge_sources ks where ks.set_id = ${setRow} and ks.doc_key = '${SPEC_DOC_KEY}' and ks.version = 1 and ks.format = 'pdf')`;
  const parts = Math.ceil(rules.length / RULES_PER_PART);
  const total = parts + 1;
  const name = (n: number) => `0165_grovshot_v2_knowledge_seed_${n}`;
  const head = (n: number, what: string) => `-- 0165 · GROVBASE SHOT V2 — KUBA'S SPEC AS KNOWLEDGE RULES · part ${n}/${total}: ${what}
-- GENERATED by scripts/gsv2-knowledge-seed.ts from the reviewed MD (sha256
-- ${SPEC_MD_SHA256}); do not edit by hand —
-- npm run test:grovshot2 requires these files to be exactly the generator's output.
-- Idempotent: every insert is guarded; re-running changes nothing.

set local lock_timeout = '10s';
`;
  const files: SeedFile[] = [];
  files.push({ name: name(1), sql: `${head(1, "the set, its sources, the PDF diagram")}
-- ════════════════════════════════════════════════════════════════════════════
--   · the set "${SPEC_SET_NAME}" (imported from the PDF on 03.11) becomes
--     GrovShot V2's (scope) — created only where it does not exist (a fresh DB);
--   · source v1 · MD (PRIMARY, full text, sha256) and, where the PDF was
--     imported, source v1 · PDF (CONFIRMATION: the same document; its stored
--     object is the reviewed file only if its size matches — then its sha256
--     is recorded; its text is the set's existing doc_text);
--   · parts 2–${total}: ${rules.length} rules from the MD (${delivered} sent through {{knowledge_rules}},
--     the rest already carried by the engine's config / templates / code, or
--     background) + here the PDF's page-2 diagram (background) — ALL PENDING:
--     nothing is approved or published by this seed;
--   · the PDF importer's one guessed example (page 2) is the workflow diagram,
--     not an input/output pair: rejected, so it can never be approved as a
--     quality example.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.knowledge_sets (name, status, notes, scope)
select ${set}, 'ready', 'Zestaw utworzony przez migrację 0165 (źródło MD specyfikacji).', 'grovshot_v2'
where not exists (select 1 from public.knowledge_sets where name = ${set});
update public.knowledge_sets set scope = 'grovshot_v2' where id = ${setRow} and scope is null;

insert into public.knowledge_sources (set_id, doc_key, version, title, format, role, content, content_chars, sha256, bytes, source_date, author, status, rules_found, parse_note)
select ${setRow}, '${SPEC_DOC_KEY}', 1, ${set}, 'md', 'primary', $kuba_md$${md}$kuba_md$,
  ${Array.from(md).length}, '${SPEC_MD_SHA256}', ${Buffer.byteLength(md, "utf8")}, date '2026-10-27', 'Kuba', 'parsed', ${rules.length},
  'Źródło główne reguł (MD). Ostatnie decyzje: 02.11 i 03.11.2026.'
on conflict (set_id, doc_key, version, format) do nothing;

insert into public.knowledge_sources (set_id, doc_key, version, title, format, role, storage_path, content, content_chars, sha256, bytes, source_date, author, status, rules_found, parse_note)
select s.id, '${SPEC_DOC_KEY}', 1, ${set}, 'pdf', 'confirmation', s.zip_path, s.doc_text, coalesce(char_length(s.doc_text), 0),
  case when o.size = ${SPEC_PDF_BYTES} then '${SPEC_PDF_SHA256}' end, o.size, date '2026-10-27', 'Kuba', 'skipped', 1,
  'Ten sam dokument co MD (źródło główne): reguły pochodzą z MD; z PDF dodany tylko schemat ze strony 2 (brak go w MD).'
from public.knowledge_sets s
left join lateral (select (ob.metadata->>'size')::integer as size from storage.objects ob where ob.bucket_id = 'knowledge' and ob.name = s.zip_path) o on true
where s.id = ${setRow} and s.zip_path like '%/source.pdf'
on conflict (set_id, doc_key, version, format) do nothing;

insert into public.knowledge_rules (rule_key, revision, source_id, origin, section, page, position, source_date, topic, stages, scope_kind, scope_values, delivery, is_correction, title, body, body_sha256, status)
select ${q(PDF_DIAGRAM.rule_key)}, 1, ${pdfSource}, 'document', 'Architektura (PDF)', 2, 1000, date '2026-10-27', 'context', '{}'::text[], 'global', '{}'::text[], 'reference', false,
  ${q(PDF_DIAGRAM.title)}, ${q(PDF_DIAGRAM.body)}, encode(extensions.digest(${q(PDF_DIAGRAM.body)}, 'sha256'), 'hex'), 'pending'
where ${pdfSource} is not null
on conflict (rule_key, revision) do nothing;

update public.knowledge_examples e set review_status = 'rejected', reviewed_at = now(), tags = array['schemat_workflow']::text[]
from public.knowledge_sets s
where s.id = e.set_id and s.name = ${set} and e.review_status = 'pending' and e.source_kind = 'pdf'
  and e.source_ref = 'pdf page 2' and e.prompt_used is null and e.generated_path is null;
` });
  for (let p = 0; p < parts; p++) {
    const chunk = rules.slice(p * RULES_PER_PART, (p + 1) * RULES_PER_PART);
    const values = chunk.map((r) => `  (${[
      q(r.rule_key), q(r.section), String(r.position), date(r.source_date), q(r.topic), arr(r.stages), q(r.scope_kind), arr(r.scope_values),
      q(r.delivery), String(r.is_correction), q(r.title), q(r.body),
    ].join(", ")})`).join(",\n");
    const last = p === parts - 1;
    const supersedes = last ? rules.filter((r) => r.supersedesKeys.length > 0).map((r) =>
      `\nupdate public.knowledge_rules set supersedes = array(select id from public.knowledge_rules where rule_key in (${r.supersedesKeys.map(q).join(", ")}) and revision = 1)\n`
      + ` where rule_key = ${q(r.rule_key)} and revision = 1 and status = 'pending' and supersedes = '{}';`).join("\n") : "";
    files.push({ name: name(p + 2), sql: `${head(p + 2, `rules ${chunk[0].position}–${chunk[chunk.length - 1].position} of ${rules.length} (pending)`)}
insert into public.knowledge_rules (rule_key, revision, source_id, origin, section, position, source_date, topic, stages, scope_kind, scope_values, delivery, is_correction, title, body, body_sha256, status)
select v.rule_key, 1, ${mdSource}, 'document', v.section, v.position, v.source_date, v.topic, v.stages, v.scope_kind, v.scope_values, v.delivery, v.is_correction, v.title, v.body,
  encode(extensions.digest(v.body, 'sha256'), 'hex'), 'pending'
from (values
${values}
) as v(rule_key, section, position, source_date, topic, stages, scope_kind, scope_values, delivery, is_correction, title, body)
where ${mdSource} is not null
on conflict (rule_key, revision) do nothing;
${supersedes}` });
  }
  return files;
}

// Run as the CLI only (the test suite bundles this module too).
if (/gsv2-seed\.cjs$/.test(process.argv[1] ?? "")) {
  const [path, outDir] = [process.argv[2], process.argv[3] ?? "supabase/migrations"];
  if (!path) { console.error("usage: node gsv2-seed.cjs <spec.md> [migrations dir]"); process.exit(2); }
  for (const f of seedFiles(readFileSync(path, "utf8"))) writeFileSync(join(outDir, `${f.name}.sql`), f.sql);
}

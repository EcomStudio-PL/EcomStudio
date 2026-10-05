/**
 * SEARCH TEXT RULES — shared by the global tool search (lib/tool-search.ts)
 * and the admin search-tag editor. No registry imports on purpose: the admin
 * surface needs the tag rules, not the tool catalogue and its copy.
 */

/** Accent-insensitive, case-insensitive. "tlo" has to find "tło". */
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // Combining marks. Polish ł has no decomposition, so it is mapped by hand
    // below — without it "tlo" misses "tło", which is the brief's own example.
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    // "obróbka  zdjęć" and "obróbka zdjęć" are the same query.
    .replace(/\s+/g, " ");
}

/** Admin-editable search tags (ai_tools.search_tags) — METADATA ONLY: they
 *  widen what finds a tool and never reach a prompt, a model or a request.
 *  Trimmed, whitespace collapsed, no empties, ≤ 60 characters each, no
 *  case/diacritic duplicates, at most 30. The single rule the editor, the
 *  save action and the tests share. */
export const SEARCH_TAGS_MAX = 30;
export const SEARCH_TAG_MAX_CHARS = 60;
export function normaliseSearchTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_TAG_MAX_CHARS).trim();
    if (!tag) continue;
    const id = normalise(tag);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(tag);
    if (out.length >= SEARCH_TAGS_MAX) break;
  }
  return out;
}

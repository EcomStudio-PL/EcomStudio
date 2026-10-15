/**
 * DICTIONARY OVERRIDES — the inline editor's text layer, on top of the shipped
 * dictionaries and without changing how a key is looked up.
 *
 * The JSON in ./dictionaries stays the default and the only file of copy. An
 * operator's edit is stored per key and per locale (`content_overrides`) and
 * laid over a COPY of the dictionary here, before anything translates with
 * it — so the server `t`, the metadata, the JSON-LD and every client
 * `useI18n()` see the same edited string, and a key edited once reads the same
 * everywhere it renders.
 *
 * Three rules make it safe to run on every request:
 *   · the shared module JSON is never mutated: only the objects on an edited
 *     key's path are copied, so one request's edit cannot leak into another
 *     request, another locale or the defaults;
 *   · a key is resolved exactly like `lookup()` resolves it (a flat dotted key
 *     first, then the next segment), so an edit lands where the reader looks;
 *   · an edit only replaces an existing string whose `{placeholders}` it keeps
 *     to the letter — `{name}` gone or `{price}` added and the default stands.
 *
 * Nothing to apply → the original object comes back, untouched and uncopied.
 */

type Dict = Record<string, unknown>;

/** The `{name}` tokens of a template, sorted — the shape an edit must keep. */
export function placeholdersOf(s: string): string[] {
  return [...new Set(s.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort();
}

export function samePlaceholders(a: string, b: string): boolean {
  const x = placeholdersOf(a);
  const y = placeholdersOf(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Rewrite the strings at `keys` in a copy of `dict`. `next(key, current)`
 * returns the new string, or undefined to leave that key as it is.
 */
export function rewriteKeys(
  dict: Dict,
  keys: Iterable<string>,
  next: (key: string, current: string) => string | undefined,
): Dict {
  let root: Dict | null = null;
  const copies = new Set<object>();
  const own = (obj: Dict): Dict => {
    if (copies.has(obj)) return obj;
    const c = { ...obj };
    copies.add(c);
    return c;
  };
  for (const key of keys) {
    const parts = key.split(".");
    // Find where lookup() would read it, without copying anything yet.
    let probe: unknown = dict;
    let found = false;
    for (let i = 0; i < parts.length; i++) {
      if (!probe || typeof probe !== "object") break;
      const rest = parts.slice(i).join(".");
      if (typeof (probe as Dict)[rest] === "string") { found = true; break; }
      probe = (probe as Dict)[parts[i]];
      if (i === parts.length - 1 && typeof probe === "string") found = true;
    }
    if (!found) continue;
    // Walk again on the copy, copying each container on the way down.
    if (!root) root = own(dict);
    let node: Dict = root;
    for (let i = 0; i < parts.length; i++) {
      const rest = parts.slice(i).join(".");
      if (typeof node[rest] === "string") {
        const value = next(key, node[rest] as string);
        if (value !== undefined) node[rest] = value;
        break;
      }
      const child = node[parts[i]];
      if (i === parts.length - 1) {
        if (typeof child === "string") {
          const value = next(key, child);
          if (value !== undefined) node[parts[i]] = value;
        }
        break;
      }
      if (!child || typeof child !== "object") break;
      const copy = own(child as Dict);
      node[parts[i]] = copy;
      node = copy;
    }
  }
  return root ?? dict;
}

/** Lay one locale's published overrides over its dictionary. */
export function applyOverrides(dict: Dict, overrides: Record<string, string> | undefined): Dict {
  if (!overrides) return dict;
  const keys = Object.keys(overrides);
  if (keys.length === 0) return dict;
  return rewriteKeys(dict, keys, (key, current) => {
    const value = overrides[key];
    if (typeof value !== "string" || value.length === 0) return undefined;
    return samePlaceholders(current, value) ? value : undefined;
  });
}

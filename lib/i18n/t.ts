type Dict = Record<string, unknown>;

/**
 * TRANSLATION LOOKUP.
 *
 * Keys are dotted paths, but a dictionary is allowed to store a FLAT key that
 * itself contains dots — the launch-page field labels do exactly that
 * (`launchAdmin.f` holds `"hero.badge"`, `"value.t1"`, …). A plain
 * split-and-walk misses those and used to render `launchAdmin.f.hero.badge`
 * straight into the admin UI.
 *
 * So at every level the remaining path is first tried as a literal key, then
 * as the next segment. Both shapes resolve, and nothing that worked before
 * changes.
 */
export function lookup(dict: Dict, key: string): string | undefined {
  const parts = key.split(".");
  let node: unknown = dict;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return undefined;
    const obj = node as Dict;
    // "the rest of the path, stored flat" — e.g. f["hero.badge"]
    const rest = parts.slice(i).join(".");
    if (typeof obj[rest] === "string") return obj[rest] as string;
    node = obj[parts[i]];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * What to show when a key is genuinely missing. Never the key: a raw
 * `admin.engine.status.importing` in the interface is a bug the user can see,
 * and a readable "Importing" is wrong in tone at worst. The last segment is
 * the meaningful part; camelCase and snake_case both become words.
 */
export function humanizeKey(key: string): string {
  const last = key.split(".").filter(Boolean).pop() ?? key;
  const words = last
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Kept for callers that want the raw string or nothing. */
export function resolveKey(dict: Dict, key: string): string {
  return lookup(dict, key) ?? humanizeKey(key);
}

export function makeT(dict: Dict) {
  return (key: string, vars?: Record<string, string | number>) => {
    let s = lookup(dict, key) ?? humanizeKey(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

type Dict = Record<string, unknown>;

export function resolveKey(dict: Dict, key: string): string {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Dict)) return (acc as Dict)[part];
    return undefined;
  }, dict);
  return typeof value === "string" ? value : key;
}

export function makeT(dict: Dict) {
  return (key: string, vars?: Record<string, string | number>) => {
    let s = resolveKey(dict, key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

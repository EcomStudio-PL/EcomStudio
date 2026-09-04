#!/usr/bin/env node
/**
 * NO RAW KEYS IN THE INTERFACE.
 *
 * t() now falls back to a humanized label when a key is missing, which is the
 * right thing to show a user — and exactly the wrong thing for us, because a
 * typo stops being visible. This walks every literal t("…") call in the app and
 * fails if the key is absent from any of the three dictionaries.
 *
 * Interpolated calls — t(`insp.cat.${c}`) — cannot be checked statically and
 * are listed as a reminder, not a failure.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LOCALES = ["pl", "en", "de"];
const dicts = Object.fromEntries(LOCALES.map((l) => [
  l, JSON.parse(fs.readFileSync(path.join(ROOT, `lib/i18n/dictionaries/${l}.json`), "utf8")),
]));

/** Mirrors lookup() in lib/i18n/t.ts, including flat dotted keys. */
function has(dict, key) {
  const parts = key.split(".");
  let node = dict;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== "object") return false;
    if (typeof node[parts.slice(i).join(".")] === "string") return true;
    node = node[parts[i]];
  }
  return typeof node === "string";
}

const SKIP = new Set(["node_modules", ".next", ".git", "GrovBase-Vault", "supabase"]);
function* sources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

const missing = [];
let interpolated = 0;
for (const file of sources(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([A-Za-z][\w.]*)"/g)) {
    for (const locale of LOCALES) {
      if (!has(dicts[locale], m[1])) missing.push({ key: m[1], locale, file: path.relative(ROOT, file) });
    }
  }
  interpolated += [...src.matchAll(/\bt\(\s*`[^`]*\$\{/g)].length;
}

// Every locale must carry the same keys, or one language silently degrades.
const flatten = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const keysets = Object.fromEntries(LOCALES.map((l) => [l, new Set(flatten(dicts[l]))]));
const drift = [];
for (const locale of LOCALES.slice(1)) {
  for (const key of keysets.pl) if (!keysets[locale].has(key)) drift.push(`${locale} is missing ${key}`);
  for (const key of keysets[locale]) if (!keysets.pl.has(key)) drift.push(`pl is missing ${key} (present in ${locale})`);
}

for (const m of missing) console.error(`missing  ${m.locale}  ${m.key}  (${m.file})`);
for (const d of drift.slice(0, 40)) console.error(`drift    ${d}`);
console.log(`${missing.length} missing literal keys, ${drift.length} locale drifts, ${interpolated} interpolated calls unchecked`);
process.exit(missing.length + drift.length > 0 ? 1 : 0);

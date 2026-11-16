/**
 * GROVBASE SHOT — the knowledge-file uploads the SQL test sends
 * (scripts/grovshot-kb-sql-tests.sh), built by the SAME function the admin
 * panel's action uses (buildKbImport). Writes one SQL file that fills
 * t_payload(name, body) with each upload's p_file.
 *
 *   node .next/grovshot-kb-payloads.cjs <out.sql>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildKbImport } from "@/lib/grovshot-shot/kb-import";

const out = process.argv[2];
if (!out) { console.error("usage: grovshot-kb-payloads <out.sql>"); process.exit(2); }

const v1 = readFileSync("docs/grovshot-shot/baza-wiedzy-v1.md", "utf8");
const v2old = readFileSync("docs/grovshot-shot/baza-wiedzy-v2.md", "utf8");
const v2new = readFileSync("docs/grovshot-shot/grovbase-shot-wiedza-v2.md", "utf8");
const uploads: Record<string, { fileName: string; content: string; note: string }> = {
  v1: { fileName: "baza-wiedzy-v1.md", content: v1, note: "Wersja 1 (format z prefiksami)" },
  v2old: { fileName: "baza-wiedzy-v2.md", content: v2old, note: "Wersja 2 z 08.11 (format z prefiksami)" },
  v2new: { fileName: "grovbase-shot-wiedza-v2.md", content: v2new, note: "Wiedza 2.0 z 15.11 – pełna przebudowa" },
  // Saved as written, but nothing in it the engine can run on: a draft.
  draft: { fileName: "notatki.md", content: "# Notatki do bazy wiedzy\n\nPomysły na kolejną wersję – jeszcze bez przepisów i stopek.\n", note: "Szkic notatek" },
  // Windows line ends and a BOM: kept byte for byte, read like the plain file.
  crlf: { fileName: "wiedza-windows.md", content: `﻿${v2new.replace(/\n/g, "\r\n")}`, note: "Ten sam plik zapisany w Windows" },
};
const rows: string[] = [];
for (const [name, u] of Object.entries(uploads)) {
  const b = buildKbImport(u);
  if (!b.ok) { console.error(`${name}: ${b.error}`); process.exit(1); }
  const json = JSON.stringify(b.file);
  if (json.includes("$gskb$")) { console.error("dollar tag in content"); process.exit(1); }
  rows.push(`insert into t_payload values ('${name}', $gskb$${json}$gskb$::jsonb, ${b.ready});`);
}
// The technical refusals never reach the database.
const refused = [
  buildKbImport({ fileName: "a.md", content: "   \n", note: "pusty plik" }),
  buildKbImport({ fileName: "a.txt", content: "# x", note: "zły format" }),
  buildKbImport({ fileName: "a.md", content: "# x", note: "" }),
  buildKbImport({ fileName: "a.md", content: "# x\u0000", note: "binarny" }),
  buildKbImport({ fileName: "a.md", content: "x".repeat(300_001), note: "za duży" }),
].map((r) => (r.ok ? "ok" : r.error)).join(",");
rows.push(`insert into t_payload values ('refused', to_jsonb('${refused}'::text), false);`);
writeFileSync(out, `${rows.join("\n")}\n`);
console.log(`grovshot-kb-payloads: ${Object.keys(uploads).length} uploads → ${out}`);

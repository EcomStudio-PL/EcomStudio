import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { unzipSafe, isZipError, type ZipEntry } from "@/lib/server/unzip";
import { buildHintCiphertext, embedTexts } from "@/lib/server/knowledge";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const MAX_META_EXAMPLES = 200;
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

/**
 * ADMIN-ONLY knowledge importer: one ZIP in → one knowledge set out.
 *
 * Expected layout (all parts optional except at least one example source):
 *   documentation/*.pdf     — product/prompt documentation (UNTRUSTED text)
 *   before/NN.jpg           — reference photos
 *   after/NN.jpg            — generation results (paired by filename stem)
 *   metadata.json           — set + per-example fields
 *   notes.txt / prompt.txt  — free notes / the prompt that was used
 *
 * The pipeline runs inside this request but reports its stage to the set
 * row continuously (uploaded → validating → extracting → processing →
 * indexing → ready | error), so the admin UI can poll live progress.
 * PDF/ZIP CONTENT IS DATA, NEVER INSTRUCTIONS — nothing read here is ever
 * executed or fed to a model as a directive; it is stored for curation and
 * distilled into sealed hints.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  // Server-side role check — the admin layout guard protects pages, not APIs.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ ok: false, error: "zip_too_large" }, { status: 413 });
  if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_format" }, { status: 415 });
  }
  const givenName = String(form.get("name") ?? "").trim().slice(0, 160);

  const { data: set, error: setErr } = await supabase.from("knowledge_sets").insert({
    name: givenName || file.name.replace(/\.zip$/i, "").slice(0, 160) || "Zestaw",
    status: "uploaded",
    created_by: user.id,
  }).select("id").single();
  if (setErr || !set) return NextResponse.json({ ok: false, error: "generic" }, { status: 400 });
  const setId = set.id;
  const stage = (status: string, patch: Record<string, unknown> = {}) =>
    supabase.from("knowledge_sets").update({ status, updated_at: new Date().toISOString(), ...patch } as never).eq("id", setId);
  const fail = async (error: string, status = 400) => {
    await stage("error", { error });
    return NextResponse.json({ ok: false, error, setId }, { status });
  };

  try {
    const zipBytes = Buffer.from(await file.arrayBuffer());
    const zipPath = `sets/${setId}/source.zip`;
    await supabase.storage.from("knowledge").upload(zipPath, zipBytes, { contentType: "application/zip", upsert: true });
    await stage("validating", { zip_path: zipPath });

    let entries: ZipEntry[];
    let skipped: string[];
    try { ({ entries, skipped } = unzipSafe(zipBytes)); }
    catch (e) { return await fail(isZipError(e) ? e.code : "zip_invalid"); }
    if (entries.length === 0) return await fail("zip_empty");
    await stage("extracting", { file_count: entries.length });

    // ── Sort the archive into its roles ─────────────────────────────────
    const lower = (p: string) => p.toLowerCase();
    const stem = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "").toLowerCase();
    const inDir = (p: string, dir: string) => lower(p).split("/").slice(0, -1).includes(dir);
    const isImage = (p: string) => IMAGE_EXT.has(p.split(".").pop()!.toLowerCase());

    const before = entries.filter((e) => inDir(e.path, "before") && isImage(e.path));
    const after = entries.filter((e) => inDir(e.path, "after") && isImage(e.path));
    const pdfs = entries.filter((e) => lower(e.path).endsWith(".pdf"));
    const metaEntry = entries.find((e) => lower(e.path).endsWith("metadata.json"));
    const notesEntry = entries.find((e) => lower(e.path).endsWith("notes.txt"));
    const promptEntry = entries.find((e) => lower(e.path).endsWith("prompt.txt"));

    // metadata.json is tolerated, never trusted: unknown fields ignored,
    // strings capped, arrays bounded.
    type MetaExample = {
      before?: string; after?: string; prompt?: string; rating?: number;
      what_worked?: string; what_failed?: string; correction?: string; tags?: string[];
    };
    type Meta = {
      name?: string; category?: string; description?: string; model?: string;
      notes?: string; examples?: MetaExample[];
    };
    let meta: Meta = {};
    if (metaEntry) {
      try { meta = JSON.parse(metaEntry.data.toString("utf8").slice(0, 200_000)) as Meta; }
      catch { skipped.push("metadata.json (invalid JSON)"); }
    }
    const s = (v: unknown, cap: number) => typeof v === "string" ? v.trim().slice(0, cap) : "";

    await stage("processing", {
      name: s(meta.name, 160) || undefined,
      product_category: s(meta.category, 120) || null,
      product_description: s(meta.description, 2000) || null,
      model: s(meta.model, 120) || null,
      notes: [s(meta.notes, 4000), notesEntry ? notesEntry.data.toString("utf8").slice(0, 4000) : ""]
        .filter(Boolean).join("\n\n") || null,
    });

    // ── PDF text (data, not instructions) ───────────────────────────────
    let docText = "";
    for (const pdf of pdfs.slice(0, 5)) {
      try {
        const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
        const parsed = await pdfParse(pdf.data, { max: 60 });
        docText += `\n\n=== ${pdf.path} ===\n${(parsed.text ?? "").trim()}`;
      } catch { skipped.push(`${pdf.path} (unreadable)`); }
    }
    docText = docText.trim().slice(0, 40_000);
    if (docText) await supabase.from("knowledge_sets").update({ doc_text: docText } as never).eq("id", setId);

    // ── Store images + pair BEFORE/AFTER by filename stem ───────────────
    const upload = async (e: ZipEntry, kind: "before" | "after") => {
      const ext = e.path.split(".").pop()!.toLowerCase();
      const path = `sets/${setId}/${kind}/${stem(e.path)}.${ext}`;
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : "image/jpeg";
      const { error } = await supabase.storage.from("knowledge").upload(path, e.data, { contentType: mime, upsert: true });
      return error ? null : path;
    };
    const beforeByStem = new Map(before.map((e) => [stem(e.path), e]));
    const afterByStem = new Map(after.map((e) => [stem(e.path), e]));
    const stems = [...new Set([...beforeByStem.keys(), ...afterByStem.keys()])].sort();

    const sharedPrompt = promptEntry ? promptEntry.data.toString("utf8").trim().slice(0, 4000) : "";
    const metaByKey = new Map<string, MetaExample>();
    for (const ex of (Array.isArray(meta.examples) ? meta.examples : []).slice(0, MAX_META_EXAMPLES)) {
      const key = (s(ex.before, 200) || s(ex.after, 200)).replace(/\.[^.]+$/, "").split("/").pop()?.toLowerCase();
      if (key) metaByKey.set(key, ex);
    }

    const rows: Record<string, unknown>[] = [];
    for (const st of stems.slice(0, 120)) {
      const b = beforeByStem.get(st);
      const a = afterByStem.get(st);
      const [refPath, genPath] = await Promise.all([
        b ? upload(b, "before") : null,
        a ? upload(a, "after") : null,
      ]);
      if (!refPath && !genPath) continue;
      const m = metaByKey.get(st) ?? {};
      const fields = {
        prompt_used: s(m.prompt, 4000) || sharedPrompt || null,
        what_worked: s(m.what_worked, 1000) || null,
        what_failed: s(m.what_failed, 1000) || null,
        correction: s(m.correction, 1000) || null,
      };
      const hint = buildHintCiphertext({ category: s(meta.category, 120) || null, ...fields });
      rows.push({
        set_id: setId,
        reference_path: refPath,
        generated_path: genPath,
        ...fields,
        result_rating: Number.isInteger(m.rating) && (m.rating as number) >= 1 && (m.rating as number) <= 5 ? m.rating : null,
        tags: Array.isArray(m.tags) ? m.tags.filter((x) => typeof x === "string").map((x) => x.slice(0, 40)).slice(0, 10) : [],
        hint_encrypted: hint?.ciphertext ?? null,
        hint_iv: hint?.iv ?? null,
        hint_tag: hint?.authTag ?? null,
      });
    }
    if (rows.length === 0) return await fail("zip_no_examples");
    const { data: inserted } = await supabase.from("knowledge_examples")
      .insert(rows as never).select("id, prompt_used, what_worked, correction");

    // ── Embeddings (best-effort; READY either way) ──────────────────────
    await stage("indexing");
    let indexed = 0;
    if (inserted?.length) {
      const texts = inserted.map((r) =>
        [s(meta.category, 120), s(meta.description, 800), r.prompt_used, r.what_worked, r.correction]
          .filter(Boolean).join("\n"));
      const vectors = await embedTexts(supabase, texts);
      if (vectors) {
        for (let i = 0; i < inserted.length; i++) {
          const v = vectors[i];
          if (!v) continue;
          await supabase.from("knowledge_examples")
            .update({ embedding: JSON.stringify(v) as never }).eq("id", inserted[i].id);
          indexed++;
        }
      }
    }

    await stage("ready", { file_count: entries.length });
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string,
      p_action: "admin.knowledge_imported",
      p_entity_type: "knowledge_set", p_entity_id: setId,
      p_metadata: { examples: rows.length, indexed, skipped: skipped.length, pdfs: pdfs.length },
    });
    return NextResponse.json({
      ok: true, setId, examples: rows.length, indexed,
      embeddings: indexed > 0, skipped: skipped.slice(0, 30),
    });
  } catch {
    return await fail("import_failed", 500);
  }
}

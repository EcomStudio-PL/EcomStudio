import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { unzipSafe, isZipError, type ZipEntry } from "@/lib/server/unzip";
import { buildHintCiphertext, embedTexts } from "@/lib/server/knowledge";
import { extractCandidates, readPdf, type PdfCandidate } from "@/lib/server/knowledge-pdf";
import type { Client } from "@/lib/services/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_CANDIDATES = 120;
const MAX_META_EXAMPLES = 200;
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

/**
 * ADMIN-ONLY knowledge importer: one ZIP or one PDF in → one knowledge set out.
 *
 * UPLOAD → PARSE → PREVIEW → EXTRACT → ADMIN REVIEW → SAVE. Explicit ZIP
 * before/after pairs are saved as before (approved). Everything the importer
 * had to GUESS — every PDF candidate, and any ZIP photo without its pair — is
 * saved as `pending`: invisible to retrieval, without a hint, until an admin
 * reviews it in the tool's Wiedza tab and approves it.
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
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (isPdf ? file.size > MAX_PDF_BYTES : file.size > MAX_ZIP_BYTES) {
    return NextResponse.json({ ok: false, error: isPdf ? "pdf_too_large" : "zip_too_large" }, { status: 413 });
  }
  if (!isPdf && !/\.zip$/i.test(file.name) && !/zip/.test(file.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_format" }, { status: 415 });
  }
  const givenName = String(form.get("name") ?? "").trim().slice(0, 160);

  const { data: set, error: setErr } = await supabase.from("knowledge_sets").insert({
    name: givenName || file.name.replace(/\.(zip|pdf)$/i, "").slice(0, 160) || "Zestaw",
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

  if (isPdf) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const pdfPath = `sets/${setId}/source.pdf`;
      const { error: upErr } = await supabase.storage.from("knowledge")
        .upload(pdfPath, bytes, { contentType: "application/pdf", upsert: true });
      await stage("validating", upErr ? {} : { zip_path: pdfPath });
      let parsed: Awaited<ReturnType<typeof readPdf>>;
      // A time budget well inside maxDuration, so a hostile or huge PDF ends
      // as a set in `error`, never one stuck in `validating`.
      try {
        parsed = await Promise.race([
          readPdf(bytes),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pdf_timeout")), 120_000)),
        ]);
      } catch { return await fail("pdf_unreadable"); }
      await stage("extracting", { file_count: parsed.pages.length });
      const docText = parsed.pages.map((p) => `=== ${p.page} ===\n${p.text}`).join("\n\n").slice(0, 40_000);
      await stage("processing", docText ? { doc_text: docText } : {});
      const candidates = extractCandidates(parsed.pages).slice(0, MAX_PDF_CANDIDATES);
      const saved = await savePdfCandidates(supabase, setId, candidates, "pdf");
      if (saved === 0) return await fail("pdf_no_examples");
      await stage("ready");
      await supabase.rpc("log_activity", {
        p_workspace_id: null as unknown as string,
        p_action: "admin.knowledge_imported",
        p_entity_type: "knowledge_set", p_entity_id: setId,
        p_metadata: { source: "pdf", pages: parsed.pages.length, candidates: saved, pending: saved },
      });
      return NextResponse.json({ ok: true, setId, examples: saved, pending: saved, indexed: 0, embeddings: false, skipped: [] });
    } catch {
      return await fail("import_failed", 500);
    }
  }

  try {
    const zipBytes = Buffer.from(await file.arrayBuffer());
    const zipPath = `sets/${setId}/source.zip`;
    const { error: zipUploadError } = await supabase.storage.from("knowledge")
      .upload(zipPath, zipBytes, { contentType: "application/zip", upsert: true });
    // Record the path only if the object really landed — a stale zip_path
    // would 404 later with nothing explaining why.
    await stage("validating", zipUploadError ? {} : { zip_path: zipPath });

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
    const pdfCandidates: PdfCandidate[] = [];
    for (const pdf of pdfs.slice(0, 5)) {
      try {
        const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
        const parsed = await pdfParse(pdf.data, { max: 60 });
        docText += `\n\n=== ${pdf.path} ===\n${(parsed.text ?? "").trim()}`;
        // The same PDF may also carry before/after examples: extracted as
        // PENDING candidates for admin review, never auto-approved.
        try { pdfCandidates.push(...extractCandidates((await readPdf(pdf.data)).pages)); }
        catch { /* text was readable; images were not — the text is kept */ }
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
      // A photo without its pair is a guess about what it shows: pending, no
      // hint, not retrievable until an admin approves it.
      const paired = Boolean(refPath && genPath);
      const hint = paired ? buildHintCiphertext({ category: s(meta.category, 120) || null, ...fields }) : null;
      rows.push({
        set_id: setId,
        reference_path: refPath,
        generated_path: genPath,
        review_status: paired ? "approved" : "pending",
        source_kind: "zip",
        source_ref: st.slice(0, 200),
        product_category: s(meta.category, 120) || null,
        ...fields,
        result_rating: Number.isInteger(m.rating) && (m.rating as number) >= 1 && (m.rating as number) <= 5 ? m.rating : null,
        tags: Array.isArray(m.tags) ? m.tags.filter((x) => typeof x === "string").map((x) => x.slice(0, 40)).slice(0, 10) : [],
        hint_encrypted: hint?.ciphertext ?? null,
        hint_iv: hint?.iv ?? null,
        hint_tag: hint?.authTag ?? null,
      });
    }
    const pendingFromPdf = pdfCandidates.length
      ? await savePdfCandidates(supabase, setId, pdfCandidates.slice(0, MAX_PDF_CANDIDATES), "zip")
      : 0;
    if (rows.length === 0 && pendingFromPdf === 0) return await fail("zip_no_examples");
    const { data: insertedAll, error: insertError } = rows.length
      ? await supabase.from("knowledge_examples")
          .insert(rows as never).select("id, prompt_used, what_worked, correction, review_status")
      : { data: [] as { id: string; prompt_used: string | null; what_worked: string | null; correction: string | null; review_status: string }[], error: null };
    // Only approved rows are indexed now; a pending row is indexed on approval.
    const inserted = (insertedAll ?? []).filter((r) => r.review_status === "approved");
    // Without this the set would reach "ready" reporting examples it does not
    // have, and the engine would silently retrieve nothing from it forever.
    if (insertError || (rows.length > 0 && !insertedAll?.length)) return await fail("import_failed", 500);

    // ── Embeddings (best-effort; READY either way) ──────────────────────
    await stage("indexing");
    let indexed = 0;
    {
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
      p_metadata: {
        examples: rows.length + pendingFromPdf, indexed, skipped: skipped.length, pdfs: pdfs.length,
        pending: rows.length - inserted.length + pendingFromPdf,
      },
    });
    return NextResponse.json({
      ok: true, setId, examples: rows.length + pendingFromPdf, indexed,
      pending: rows.length - inserted.length + pendingFromPdf,
      embeddings: indexed > 0, skipped: skipped.slice(0, 30),
    });
  } catch {
    return await fail("import_failed", 500);
  }
}

/**
 * Save extracted candidates as PENDING examples: images to the private
 * `knowledge` bucket, text fields capped, no hint and no embedding — both are
 * built when an admin approves the example.
 */
async function savePdfCandidates(
  supabase: Client, setId: string, candidates: PdfCandidate[], origin: "pdf" | "zip",
): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const up = async (img: PdfCandidate["before"], kind: "before" | "after") => {
      if (!img) return null;
      const path = `sets/${setId}/pdf/${String(i + 1).padStart(3, "0")}-${kind}.jpg`;
      const { error } = await supabase.storage.from("knowledge").upload(path, img.jpeg, { contentType: "image/jpeg", upsert: true });
      return error ? null : path;
    };
    const [refPath, genPath] = await Promise.all([up(c.before, "before"), up(c.after, "after")]);
    if (!refPath && !genPath && !c.prompt && !c.scene) continue;
    rows.push({
      set_id: setId,
      reference_path: refPath,
      generated_path: genPath,
      prompt_used: c.prompt,
      scene: c.scene,
      product_category: c.category,
      tags: c.tags,
      confidence: c.confidence,
      review_status: "pending",
      source_kind: origin === "pdf" ? "pdf" : "zip",
      source_ref: `pdf page ${c.page}`,
    });
  }
  if (rows.length === 0) return 0;
  const { data, error } = await supabase.from("knowledge_examples").insert(rows as never).select("id");
  return error ? 0 : data?.length ?? 0;
}

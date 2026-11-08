import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { intParam, noStore, UUID } from "@/lib/server/grovshot-shot/guard";
import { createClient } from "@/lib/supabase/server";
import { readRunRow, readStepDetail, sentImage } from "@/lib/server/grovshot-shot/process";
import { geminiParts } from "@/lib/grovshot-shot/diagnostics";
import { prepareReferenceImage } from "@/lib/server/reference-image";
import { buildZip } from "@/lib/server/zip";
import { P } from "@/lib/grovshot-v2/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The role re-checked IN this route (no layout runs for an API call). */
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401, headers: noStore }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: noStore }) } as const;
  return { supabase, adminId: user.id } as const;
}

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const ext = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");

/**
 * GROVBASE SHOT → "Pobierz paczkę testową" for one Nano Banana Pro call
 * (admins only): prompt.txt (the exact text of the request), the reference
 * images in the order they were sent (their bytes proven by the observed
 * SHA-256), manifest.json (ids, order, sizes, MIME, hashes, the model's
 * parameters — no key, no secret). Only this order's data. A historical call
 * without an observed payload gets a pack marked as such, never as sent.
 */
export async function GET(request: Request) {
  const a = await requireAdmin();
  if ("error" in a) return a.error;
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  const item = intParam(url.searchParams.get("item"), 0, 99);
  if (!UUID.test(run) || item === null) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: noStore });
  const [runRow, step] = await Promise.all([readRunRow(a.supabase, run), readStepDetail(a.supabase, run, P.round, item)]);
  if (!runRow || !step) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: noStore });
  const out = obj(step.output);
  const requests = arr(obj(out.boundary).requests).map(obj);
  const reqIndex = requests.map((r) => r.provider).lastIndexOf("google");
  const observed = reqIndex >= 0 ? requests[reqIndex] : null;
  const prepared = arr(out.references_prepared).map(obj);
  const legacy = arr(out.references_sent).map(obj);
  const input = obj(runRow.input);
  const photoPaths = arr(input.photos).map((x) => (typeof x === "string" ? x : ""));

  const files: { name: string; data: Uint8Array }[] = [];
  const images: Record<string, unknown>[] = [];
  let prompt: string | null = null;
  let source: "network_boundary" | "historical_engine_record";
  if (observed) {
    source = "network_boundary";
    const parts = geminiParts(observed.body);
    prompt = parts.texts.length === 1 ? parts.texts[0] : parts.texts.join("\n");
    const sent = arr(observed.images).map(obj).sort((x, y) => Number(x.n) - Number(y.n));
    for (const img of sent) {
      const n = Number(img.n);
      const r = await sentImage(a.supabase, run, P.round, item, reqIndex, n);
      const name = `${String(n).padStart(2, "0")}_Z${r.ok ? r.photo : (r.photo ?? "x")}.${ext(String(img.mime ?? "image/jpeg"))}`;
      if (r.ok) files.push({ name, data: new Uint8Array(r.bytes) });
      images.push({
        position: n, photo: r.ok ? r.photo : r.photo ?? null, file: r.ok ? name : null, mime: img.mime, bytes: img.bytes,
        width: img.width, height: img.height, sha256: img.sha256, attached_as: "inline_base64 (generateContent parts[].inlineData)",
        verified: r.ok, ...(r.ok ? {} : { problem: r.error }),
      });
    }
  } else {
    // No observed payload: the engine's own record, labelled as such.
    source = "historical_engine_record";
    const { data: asm } = await a.supabase.from("ai_engine_step_runs").select("output").eq("run_id", run).eq("position", P.write).eq("item_index", 30).maybeSingle();
    const shotIdx = Math.floor(item / 5);
    const shots = arr(obj((asm as { output?: unknown } | null)?.output).shots).map(obj);
    prompt = typeof shots[shotIdx]?.text === "string" ? String(shots[shotIdx].text) : null;
    const list = prepared.length ? prepared : legacy;
    for (const r of list) {
      const n = Number(r.n);
      const photo = Number(r.photo);
      const path = photoPaths[photo - 1];
      const { data: blob } = path ? await a.supabase.storage.from("product-images").download(path) : { data: null };
      if (!blob || !path) { images.push({ position: n, photo, file: null, problem: "photo_unavailable" }); continue; }
      const p = await prepareReferenceImage(Buffer.from(await blob.arrayBuffer()), path);
      const bytes = Buffer.from(p.base64, "base64");
      const name = `${String(n).padStart(2, "0")}_Z${photo}.${ext(p.mime)}`;
      files.push({ name, data: new Uint8Array(bytes) });
      images.push({
        position: n, photo, file: name, mime: p.mime, bytes: bytes.length, width: p.width, height: p.height, sha256: sha(bytes),
        recorded_sha256: r.sha256 ?? r.source_sha256 ?? null, verified: false, note: "rebuilt with the engine's transform; no network capture for this call",
      });
    }
  }
  if (prompt !== null) files.unshift({ name: "prompt.txt", data: new TextEncoder().encode(prompt) });
  const body = obj(observed?.body);
  const manifest = {
    run_id: run, round_item: item, shot: Math.floor(item / 5) + 1, attempt: (item % 5) + 1,
    source, captured_at: observed ? new Date(Number(observed.at) || 0).toISOString() : null,
    model: (step.model ?? obj(input.model).identifier) ?? null, provider: step.provider ?? "google",
    endpoint: observed ? String(observed.url ?? "") : null, method: observed ? observed.method : null,
    generation_config: body.generationConfig ?? { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: input.aspect_ratio, imageSize: input.resolution } },
    part_order: observed ? geminiParts(observed.body).partOrder : null,
    prompt_sha256: prompt !== null ? sha(prompt) : null, prompt_chars: prompt?.length ?? null,
    request_body_sha256: observed?.body_sha256 ?? null,
    images,
    note: "No API key, header value or credential is included. Upload the images in this order with prompt.txt to reproduce the call.",
  };
  files.push({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  const zip = buildZip(files);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      ...noStore, "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="grovshot-${run.slice(0, 8)}-ujecie${Math.floor(item / 5) + 1}-proba${(item % 5) + 1}.zip"`,
    },
  });
}

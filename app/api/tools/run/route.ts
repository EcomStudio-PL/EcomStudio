import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { runTool } from "@/lib/server/image-tools";
import { toolBySlug, MAX_UPLOAD_BYTES, ACCEPTED_MIME } from "@/lib/images/tools";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Run one image tool on one file.
 *
 * The processed image comes back as raw bytes with a small JSON header, so a
 * batch of eighty photos never pays the 33% tax of base64 in a JSON body. One
 * request per image is deliberate: the browser drives the queue, shows a live
 * "17 / 82", and a single failure never takes the batch down.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const slug = String(form.get("tool") ?? "");
  const tool = toolBySlug(slug);
  if (!tool) return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "image_too_large" }, { status: 413 });
  if (file.type && !ACCEPTED_MIME.includes(file.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_format" }, { status: 415 });
  }

  const logo = form.get("logo");
  let settings: unknown = {};
  try { settings = JSON.parse(String(form.get("settings") ?? "{}")); }
  catch { settings = {}; }

  const result = await runTool(supabase, user.id, workspace.id, {
    tool: tool.slug,
    settings,
    file: Buffer.from(await file.arrayBuffer()),
    mime: file.type || "image/jpeg",
    logo: logo instanceof File ? Buffer.from(await logo.arrayBuffer()) : null,
    // Scopes the key to this workspace so one seller can never replay
    // another's charge, while a refreshed page repeating the same run is
    // recognised instead of billed twice.
    idempotencyKey: idempotency(form.get("idempotencyKey"), workspace.id),
  });

  if (!result.ok) {
    const status = result.error === "insufficient_credits" ? 402
      : result.error === "no_provider" || result.error === "tool_unavailable" ? 503 : 400;
    return NextResponse.json(result, { status });
  }

  const meta = {
    credits: result.credits,
    before: result.before,
    after: result.after,
    provider: result.providerLabel,
  };
  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.mime,
      "Content-Length": String(result.bytes.length),
      "Cache-Control": "no-store",
      // Base64 keeps non-ASCII provider names legal in a header value.
      "X-Tool-Meta": Buffer.from(JSON.stringify(meta), "utf8").toString("base64"),
    },
  });
}

function idempotency(raw: FormDataEntryValue | null, workspaceId: string): string | undefined {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.length > 120) return undefined;
  return `tools:${workspaceId}:${value}`;
}

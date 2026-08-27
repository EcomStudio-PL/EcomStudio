import { createHash } from "node:crypto";
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
  // An empty declared type used to skip validation entirely; now anything
  // that is not on the allowlist — including "no type" — is refused.
  if (!ACCEPTED_MIME.includes(file.type)) {
    return NextResponse.json({ ok: false, error: "unsupported_format" }, { status: 415 });
  }

  const logo = form.get("logo");
  let settings: unknown = {};
  try { settings = JSON.parse(String(form.get("settings") ?? "{}")); }
  catch { settings = {}; }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const result = await runTool(supabase, user.id, workspace.id, {
    tool: tool.slug,
    settings,
    file: fileBytes,
    mime: file.type || "image/jpeg",
    logo: logo instanceof File ? Buffer.from(await logo.arrayBuffer()) : null,
    // The key is DERIVED, never accepted from the client: a hash of the
    // tool, its settings and the exact file bytes. An identical retry (a
    // refreshed page re-sending the same run) still dedupes to one charge,
    // but a different tool or settings can no longer ride an earlier cheap
    // charge for a free run — the old client-supplied key allowed exactly
    // that billing bypass.
    idempotencyKey: idempotency(workspace.id, tool.slug, settings, fileBytes),
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

function idempotency(workspaceId: string, tool: string, settings: unknown, file: Buffer): string {
  const digest = createHash("sha256")
    .update(tool)
    .update(JSON.stringify(settings ?? {}))
    .update(file)
    .digest("hex")
    .slice(0, 40);
  return `tools:${workspaceId}:${digest}`;
}

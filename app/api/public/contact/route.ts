import { NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { dispatchToken } from "@/lib/server/integrations";
import {
  accountSnapshot, deliverTicket, ipHash, readClaimedFiles, verifyAttachments,
} from "@/lib/server/contact-tickets";
import {
  LEGACY_TOPIC, isTicketTopic, validateContact, type ContactField, type TicketTopic,
} from "@/lib/contact-page";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * THE CONTACT FORM → A TICKET (Kontakt V2).
 *
 * An endpoint an anonymous visitor may post to, so the layers, outermost
 * first:
 *
 *   1. an in-memory per-IP brake (blunts a burst on one instance);
 *   2. a honeypot and a time trap — answered with a refusal, never with a
 *      fake "ok": a person whose browser filled the hidden field must not be
 *      told a message arrived that did not;
 *   3. schema validation (lib/contact-page.ts validateContact), the same the
 *      form runs, so a refusal names the field;
 *   4. every attached picture read back and judged by its BYTES, real size
 *      and a safe name (lib/server/contact-tickets.ts verifyAttachments);
 *   5. contact_submit (0152) — the boundary: behind the server token, it
 *      revalidates everything, applies the limits that survive restarts and
 *      instances (per address, per IP hash), binds only the files this
 *      submission reserved, and answers a retried submission with the ticket
 *      it already created. user_id is auth.uid() of THIS request's session;
 *      the plan and credits are read here, with that session — nothing the
 *      browser sends about an account is used.
 *
 * The mails go out after the response (`after`): the customer's confirmation
 * and the admin's notification, through the existing mailbox and outbox. A
 * failed mail never undoes the ticket; its outcome is recorded and retried.
 *
 * The older contact sections (contact_hub, contact_form) post here too —
 * without a submission id and with their own topic names; they still get a
 * ticket, under the mapped topic.
 */

/** Faster than this from opening the form to sending it is a script. */
const MIN_FILL_MS = 2000;
const MAX_BODY = 64 * 1024;

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`contact:${ip}`, 12, 60 * 60_000)) return refuse("rate_limited", 429);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return refuse("invalid", 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse("invalid", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return refuse("invalid", 400);
  }

  const legacy = typeof body.submissionId !== "string";
  const submissionId = legacy ? randomUUID() : String(body.submissionId);
  if (!UUID.test(submissionId)) return refuse("invalid", 400, { field: "submission" });

  const wantedTopic = str(body.topic, 40);
  const topic: TicketTopic | null = legacy
    ? LEGACY_TOPIC[wantedTopic] ?? "other"
    : isTicketTopic(wantedTopic) ? wantedTopic : null;
  if (!topic) return refuse("invalid", 400, { field: "topic" });

  // The field no human sees, and a send faster than anyone types.
  if (str(body.company, 200).trim()) return refuse("invalid", 400);
  const elapsed = typeof body.elapsed === "number" && Number.isFinite(body.elapsed) ? body.elapsed : null;
  if (elapsed !== null && elapsed < MIN_FILL_MS) return refuse("too_fast", 400);

  const input = {
    topic,
    name: str(body.name, 400),
    email: str(body.email, 400).trim().toLowerCase(),
    message: str(body.message, 6000),
    nip: topic === "payments" ? str(body.nip, 60) : "",
    generation: topic === "technical" ? str(body.generation, 400) : "",
  };
  const problems = validateContact(input);
  const first = (["email", "message", "name", "nip", "generation"] as ContactField[]).find((k) => problems[k]);
  if (first) return refuse("invalid", 400, { field: first, code: problems[first] });

  const claimed = readClaimedFiles(body.attachments);
  if (claimed === null || (claimed.length > 0 && topic !== "technical")) return refuse("invalid", 400, { field: "attachments" });

  const token = dispatchToken();
  const hash = ipHash(ip);
  // Without the server's identity nothing can be stored — say so, never "ok".
  if (!token || !hash) return refuse("unavailable", 503);

  const supabase = await createClient();
  // A retry of a submission that already made its ticket (a lost response,
  // a second click): that ticket, before anything else — its files are bound
  // by now and nobody but an admin can read them again.
  if (!legacy) {
    const { data: prior, error: priorError } = await supabase.rpc("contact_submission_ticket", {
      p_token: token, p_submission: submissionId, p_email: input.email,
    });
    if (priorError) {
      console.error("contact.prior", priorError.code ?? "-");
      return refuse(priorError.code === "PGRST202" || priorError.code === "42883" || priorError.code === "42501" ? "unavailable" : "generic", 503);
    }
    const p = (prior ?? {}) as { status?: string; ticket?: number };
    if (p.status === "found" && typeof p.ticket === "number") return NextResponse.json({ ok: true, ticket: p.ticket, duplicate: true });
    if (p.status === "mismatch") return refuse("invalid", 400, { field: "submission" });
  }

  const verified = await verifyAttachments(supabase, token, submissionId, claimed);
  if (!verified.ok) return refuse(verified.error, 400);

  const { data: { user } } = await supabase.auth.getUser();
  const account = user ? await accountSnapshot(supabase, user.id) : null;
  const clientRaw = body.client && typeof body.client === "object" ? body.client as Record<string, unknown> : {};
  const viewport = str(clientRaw.viewport, 20);
  const client = {
    ua: (request.headers.get("user-agent") ?? "").slice(0, 200),
    lang: str(clientRaw.lang, 20).replace(/[^A-Za-z0-9-]/g, ""),
    tz: str(clientRaw.tz, 60).replace(/[^A-Za-z0-9_/+-]/g, ""),
    viewport: /^[0-9]{2,5}x[0-9]{2,5}$/.test(viewport) ? viewport : "",
    page: (() => {
      try { return new URL(request.headers.get("referer") ?? "").pathname.slice(0, 120); } catch { return ""; }
    })(),
    form: legacy ? "legacy" : "kontakt",
  };
  const locale = ["pl", "en", "de"].includes(str(body.locale, 2)) ? str(body.locale, 2) : "pl";

  const { data, error } = await supabase.rpc("contact_submit", {
    p_token: token,
    p_submission: submissionId,
    p_topic: topic,
    p_name: input.name.trim(),
    p_email: input.email,
    p_message: input.message,
    p_locale: locale,
    p_nip: input.nip.trim() || undefined,
    p_generation: input.generation.trim() || undefined,
    p_account: (account ?? {}) as never,
    p_client: client as never,
    p_ip_hash: hash,
    p_attachments: verified.files as never,
    p_source: legacy ? "kontakt-legacy" : "kontakt",
  });
  if (error) {
    console.error("contact.submit", error.code ?? "-");
    // A missing function or grant is a deployment problem, not the visitor's.
    return refuse(error.code === "PGRST202" || error.code === "42883" || error.code === "42501" ? "unavailable" : "generic", 503);
  }
  const result = (data ?? {}) as { status?: string; id?: string; ticket?: number; duplicate?: boolean; field?: string };
  if (result.status === "rate_limited") return refuse("rate_limited", 429);
  if (result.status !== "created" || typeof result.ticket !== "number" || !result.id) {
    return refuse("invalid", 400, result.field ? { field: result.field } : {});
  }

  if (!result.duplicate) {
    const ticket = {
      id: result.id, ticket_no: result.ticket, email: input.email, topic, message: input.message.trim(), locale,
      name: input.name.trim(), nip: input.nip.trim() || null, generation: input.generation.trim() || null,
      files: verified.files.length, account, userId: user?.id ?? null,
      // The same rule the database applied (0152 sender_verified): the
      // signed-in author writing from their own address.
      sender_verified: Boolean(user?.email && user.email.toLowerCase() === input.email),
    };
    after(() => deliverTicket(supabase, ticket));
  }
  return NextResponse.json({ ok: true, ticket: result.ticket, duplicate: Boolean(result.duplicate) });
}

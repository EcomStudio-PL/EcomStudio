import "server-only";
import { createHash } from "crypto";
import { absoluteUrl } from "@/lib/site";
import type { Client } from "@/lib/services/workspace";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { dispatchToken, safeError } from "@/lib/server/integrations";
import { serverSecret } from "@/lib/server/server-token";
import { sendAuthMail } from "@/lib/server/auth-mail";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { renderEmailTemplate } from "@/lib/server/email-template";
import { defaultTemplate, lookupPublishedTemplate, renderPlaceholders, type EmailTemplateDef } from "@/lib/server/message-templates";
import { getPublishedPage } from "@/lib/server/public-site";
import { getDictionaryFor } from "@/lib/i18n/server";
import { lookup } from "@/lib/i18n/t";
import { stegaStrip } from "@/lib/ice/stega";
import { sniff } from "@/lib/ice/sniff";
import {
  CONTACT_BUCKET, CONTACT_LIMITS, contactText, isContactMime, isContactPageType, safeFileName,
  type ContactMime, type TicketTopic,
} from "@/lib/contact-page";

/**
 * KONTAKT V2 — WHAT HAPPENS TO A TICKET ON THE SERVER.
 *
 * The route (app/api/public/contact) validates and calls contact_submit (0152);
 * everything around that call lives here so the route, the cron and the admin
 * panel share it:
 *
 *   · ipHash — the IP becomes a salted SHA-256 (the server secret is the
 *     salt), which is all the database ever stores of it;
 *   · accountSnapshot — plan and credits of the SIGNED-IN author, read with
 *     their own session through the readers the app already uses (RLS: their
 *     workspace only). Nothing the browser says about an account is used;
 *   · verifyAttachments — every uploaded picture read back and judged by its
 *     BYTES (JPG/PNG/WebP), its real size and a safe name; a refused one is
 *     removed from the bucket at once;
 *   · deliverTicket — the customer's confirmation (the template studio's
 *     contact.confirmation*, sent through the one mailbox, sendAuthMail) and
 *     the admin's notification (notify → the outbox → admin e-mail /
 *     Telegram, deduplicated per ticket). A failed mail never touches the
 *     ticket; its outcome is recorded (contact_confirmation_mark) and the
 *     daily cron retries it (retryConfirmations), claimed so it is never sent
 *     twice at once;
 *   · sweepAttachments — slots nobody used, removed from the bucket.
 */

export const CONFIRMATION_EVENT: Readonly<Record<"pl" | "en" | "de", string>> = {
  pl: "contact.confirmation", en: "contact.confirmation_en", de: "contact.confirmation_de",
};

const cleanLocale = (v: unknown): "pl" | "en" | "de" => (v === "en" || v === "de" ? v : "pl");

/** The IP as the database keeps it — or null when the server has no secret
 *  (then nothing here can run: the writers need the token anyway). */
export function ipHash(ip: string): string | null {
  const secret = serverSecret();
  if (!secret) return null;
  return createHash("sha256").update(`grovbase-contact:${secret}:${ip}`).digest("hex");
}

export type AccountSnapshot = {
  workspace_id: string;
  plan: string | null;
  plan_name: string | null;
  plan_status: string | null;
  credits: number | null;
};

/** The author's plan and credits, as THEIR session reads them. */
export async function accountSnapshot(supabase: Client, userId: string): Promise<AccountSnapshot | null> {
  try {
    const workspace = await getCurrentWorkspace(supabase, userId);
    if (!workspace) return null;
    const [wallet, sub] = await Promise.all([
      getWallet(supabase, workspace.id),
      supabase.from("subscriptions").select("status, subscription_plans(slug, name)")
        .eq("workspace_id", workspace.id).in("status", ["active", "trialing", "past_due"])
        .order("current_period_end", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const plan = (sub.data?.subscription_plans ?? null) as { slug?: string; name?: string } | null;
    return {
      workspace_id: workspace.id,
      plan: plan?.slug ?? null,
      plan_name: plan?.name ?? null,
      plan_status: sub.data?.status ?? null,
      credits: typeof wallet?.balance === "number" ? wallet.balance : null,
    };
  } catch (e) {
    console.error("contact.account", safeError(e));
    return null;
  }
}

export type ClaimedFile = { path: string; name: string; size: number; mime: string };
export type VerifiedFile = { path: string; name: string; size: number; mime: ContactMime };

const PATH = /^[0-9]{4}-[0-9]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readClaimedFiles(raw: unknown): ClaimedFile[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > CONTACT_LIMITS.files) return null;
  const out: ClaimedFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    if (typeof r.path !== "string" || !PATH.test(r.path)) return null;
    if (out.some((f) => f.path === r.path)) return null;
    out.push({
      path: r.path,
      name: typeof r.name === "string" ? r.name.slice(0, 200) : "",
      size: typeof r.size === "number" ? r.size : 0,
      mime: typeof r.mime === "string" ? r.mime : "",
    });
  }
  return out;
}

/**
 * Read each picture back (the visitor's own session may, while the slot is
 * open — 0152) and judge it by what it IS. One bad file refuses the lot and
 * is removed; the others stay until the ticket binds them or the sweep does.
 */
export async function verifyAttachments(
  supabase: Client, files: ClaimedFile[],
): Promise<{ ok: true; files: VerifiedFile[] } | { ok: false; error: "attachment_invalid" | "upload_failed" }> {
  const out: VerifiedFile[] = [];
  for (const f of files) {
    const { data, error } = await supabase.storage.from(CONTACT_BUCKET).download(f.path);
    if (error || !data) return { ok: false, error: "upload_failed" };
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = sniff(bytes.subarray(0, 64));
    if (bytes.length === 0 || bytes.length > CONTACT_LIMITS.fileBytes || !isContactMime(mime)) {
      await supabase.storage.from(CONTACT_BUCKET).remove([f.path]).catch(() => undefined);
      return { ok: false, error: "attachment_invalid" };
    }
    out.push({ path: f.path, name: safeFileName(f.name, mime), size: bytes.length, mime });
  }
  return { ok: true, files: out };
}

/* ── words for the mails ────────────────────────────────────────────────── */

type PageWords = { time: string; topic: (t: TicketTopic) => string };

/** The response time and topic names as the published page says them (the
 *  one place an admin edits them), the dictionary's when the page is silent. */
async function pageWords(supabase: Client, locale: "pl" | "en" | "de"): Promise<PageWords> {
  const page = await getPublishedPage(supabase, "kontakt").catch(() => null);
  const block = page?.blocks.find((b) => isContactPageType(b.type));
  const dict = await getDictionaryFor(locale);
  const fallback = (key: string) => lookup(dict, `cms.contact.text.${key}`) ?? "";
  const read = (key: Parameters<typeof contactText>[1]) =>
    stegaStrip(block ? contactText(block.content ?? {}, key, locale) : "") || fallback(key);
  return { time: read("reply.time"), topic: (t) => read(`topic.${t}`) };
}

const MAIL_LABELS = {
  pl: { ticket: "Numer zgłoszenia", topic: "Temat", copy: "Twoja wiadomość:" },
  en: { ticket: "Ticket number", topic: "Topic", copy: "Your message:" },
  de: { ticket: "Ticketnummer", topic: "Thema", copy: "Deine Nachricht:" },
} as const;

async function confirmationTemplate(supabase: Client, token: string | null, event: string): Promise<EmailTemplateDef | null> {
  const published = token ? await lookupPublishedTemplate(supabase, token, event, "email").catch(() => null) : null;
  const def = (published?.channel === "email" ? published : null) ?? defaultTemplate(`${event}:email`);
  return def?.channel === "email" ? def.email : null;
}

export type TicketForMail = {
  id: string; ticket_no: number; email: string; topic: string; message: string; locale: string;
};

/**
 * The customer's confirmation, as it will be sent: the studio's words (no
 * name — the address is not proven, S9), the ticket number, the topic, the
 * response time, and a copy of the message as plain escaped paragraphs.
 */
export async function renderConfirmation(
  supabase: Client, token: string | null, ticket: TicketForMail,
): Promise<{ subject: string; html: string; text: string } | null> {
  const locale = cleanLocale(ticket.locale);
  const def = await confirmationTemplate(supabase, token, CONFIRMATION_EVENT[locale]);
  if (!def) return null;
  const words = await pageWords(supabase, locale);
  const topic = words.topic((ticket.topic as TicketTopic)) || ticket.topic;
  const data = { ticket: String(ticket.ticket_no), topic, response_time: words.time, email: ticket.email };
  const roll = (s: string) => renderPlaceholders(s, data).text.replace(/\s+/g, " ").trim();
  const subject = roll(def.subject) || `GrovBase #${ticket.ticket_no}`;
  const labels = MAIL_LABELS[locale];
  const message = ticket.message.replace(/\r\n?/g, "\n").trim();
  const { html, text } = renderEmailTemplate({
    title: roll(def.heading) || subject,
    intro: roll(def.body),
    fields: [
      { label: labels.ticket, value: `#${ticket.ticket_no}`, mono: true },
      { label: labels.topic, value: topic },
    ],
    paragraphs: [labels.copy, ...message.split(/\n\s*\n/)],
    footer: roll(def.footer),
    showLogo: def.showLogo,
  });
  return { subject, html, text };
}

/** Send one confirmation and record the outcome. Never throws. */
export async function sendConfirmation(
  supabase: Client, ticket: TicketForMail, opts: { asAdmin?: boolean } = {},
): Promise<"sent" | "failed" | "skipped"> {
  const token = dispatchToken();
  let status: "sent" | "failed" | "skipped" = "failed";
  let error: string | null = null;
  try {
    const rendered = await renderConfirmation(supabase, token, ticket);
    if (!rendered) {
      status = "skipped";
      error = "no_template";
    } else {
      const sent = await sendAuthMail(supabase, ticket.email, rendered);
      status = sent.sent ? "sent" : sent.error === "not_configured" ? "skipped" : "failed";
      error = sent.sent ? null : sent.error ?? "generic";
    }
  } catch (e) {
    status = "failed";
    error = safeError(e);
  }
  if (token || opts.asAdmin) {
    const { error: markError } = await supabase.rpc("contact_confirmation_mark", {
      p_token: token ?? "", p_id: ticket.id, p_status: status, p_error: error ?? undefined,
    });
    if (markError) console.error("contact.confirmation.mark", markError.code ?? "-");
  }
  if (status !== "sent") console.error("contact.confirmation", status, (error ?? "").replace(/[^\s@]+@[^\s@]+/g, "[address]").slice(0, 120));
  return status;
}

/** The admin's notification: one per ticket, whatever retries happen. */
export function notifyKey(ticketNo: number): string {
  return buildDedupeKey("contact.message", "ticket", ticketNo);
}

export type TicketForAdmin = TicketForMail & {
  name: string; nip: string | null; generation: string | null; files: number;
  account: AccountSnapshot | null; userId: string | null;
};

export async function notifyAdmin(supabase: Client, t: TicketForAdmin): Promise<void> {
  const words = await pageWords(supabase, "pl");
  const topic = words.topic(t.topic as TicketTopic) || t.topic;
  const account = t.userId
    ? [`konto ${t.userId.slice(0, 8)}`, t.account?.plan_name ?? t.account?.plan ?? "bez planu",
       t.account?.credits !== null && t.account?.credits !== undefined ? `${t.account.credits} kr.` : ""]
      .filter(Boolean).join(" · ")
    : "gość (bez konta)";
  await notify(supabase, {
    type: "contact.message",
    // The subject the admin's mail carries (lib/server/admin-email.ts).
    title: `[${topic}] #${t.ticket_no} – ${t.email}`,
    icon: "",
    rows: [
      ["#️⃣ Zgłoszenie", `#${t.ticket_no}`],
      ["🏷️ Temat", topic],
      ["👤 Imię", t.name || "—"],
      ["📧 E-mail", t.email],
      ["🧾 Konto", account],
      ...(t.nip ? [["🧮 NIP", t.nip] as [string, string]] : []),
      ...(t.generation ? [["🎬 Generacja", t.generation] as [string, string]] : []),
      ...(t.files > 0 ? [["📎 Załączniki", `${t.files} — w panelu`] as [string, string]] : []),
      ["🔗 Panel", absoluteUrl(`/admin/support/zgloszenia/${t.ticket_no}`)],
    ],
    quote: t.message.slice(0, 1500),
    data: { name: t.name, email: t.email, topic, message: t.message.slice(0, 1200), ticket: String(t.ticket_no) },
    footer: "GrovBase Kontakt",
    dedupeKey: notifyKey(t.ticket_no),
  });
}

/** Both mails of a new ticket — from `after()`, never while the visitor waits. */
export async function deliverTicket(supabase: Client, t: TicketForAdmin): Promise<void> {
  await Promise.allSettled([sendConfirmation(supabase, t), notifyAdmin(supabase, t)]);
}

/** The cron: failed confirmations again (at most three tries, claimed). */
export async function retryConfirmations(supabase: Client): Promise<{ sent: number; failed: number }> {
  const token = dispatchToken();
  if (!token) return { sent: 0, failed: 0 };
  const { data, error } = await supabase.rpc("contact_confirmations_due", { p_token: token, p_limit: 10 });
  if (error) {
    console.error("contact.retry", error.code ?? "-");
    return { sent: 0, failed: 0 };
  }
  let sent = 0, failed = 0;
  for (const row of data ?? []) {
    const status = await sendConfirmation(supabase, {
      id: row.id, ticket_no: Number(row.ticket_no), email: row.email, topic: row.topic, message: row.message, locale: row.locale,
    });
    if (status === "sent") sent++; else failed++;
  }
  return { sent, failed };
}

/** The cron: unused upload slots, removed from the bucket and forgotten. */
export async function sweepAttachments(supabase: Client): Promise<number> {
  const token = dispatchToken();
  if (!token) return 0;
  const { data, error } = await supabase.rpc("contact_attachments_expired", { p_token: token, p_limit: 50 });
  if (error || !data || data.length === 0) return 0;
  const paths = (data as string[]).filter((p) => PATH.test(p));
  if (paths.length > 0) await supabase.storage.from(CONTACT_BUCKET).remove(paths).catch(() => undefined);
  const { data: n } = await supabase.rpc("contact_attachments_forget", { p_token: token, p_paths: paths });
  return typeof n === "number" ? n : 0;
}

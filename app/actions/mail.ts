"use server";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { headers } from "next/headers";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/services/workspace";
import { logAudit } from "@/lib/services/audit";
import { decryptWith } from "@/lib/server/crypto";
import {
  appendToSent,
  deleteMessage,
  fetchNewSince,
  getMessage,
  listFolders,
  listMessages,
  setSeen,
  type ImapCredentials,
  type MailFolder,
  type MailListItem,
  type MailMessage,
} from "@/lib/server/imap";
import {
  dispatchToken,
  ensureDispatchHash,
  MAIL_DEFAULTS,
  readIntegrationSecrets,
  safeError,
  type MailConfig,
} from "@/lib/server/integrations";
import { buildDedupeKey, drainNotifications, notify } from "@/lib/server/notify";

/**
 * THE MAILBOX, AS THE ADMIN PANEL USES IT.
 *
 * Three rules run through every export here.
 *
 * First, each action re-checks the admin role. The admin layout guards pages,
 * not server actions, and an exported action is a public endpoint the moment
 * it is compiled — the page it is called from proves nothing.
 *
 * Second, no credential and no driver text ever comes back. The password is
 * decrypted for the duration of one IMAP or SMTP conversation and dropped;
 * failures answer with a stable code, because a mail server's own error can
 * quote the login it just refused and that string would land in a toast.
 *
 * Third, nothing here caches. Every read goes to the mailbox through these
 * actions, so there is no rendered page to revalidate — a stale inbox is not a
 * risk this module has.
 */

/** The only folder the poller watches. Everything else is read on demand. */
const INBOX = "INBOX";

/** Mail servers reject far bigger messages than this, and the function's own
 *  memory would too — the bytes are built twice over (once as MIME, once on
 *  the wire) inside one serverless invocation. But the binding limit is the
 *  platform's: Vercel refuses a serverless request body over 4.5 MB before the
 *  action runs at all, and that refusal reaches the admin as an opaque error
 *  instead of `attachments_too_large`. Staying at 4 leaves the last 0.5 MB as
 *  headroom for the text fields and the multipart overhead in the same body. */
const MAX_ATTACHMENT_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_RECIPIENTS = 25;
const SUBJECT_MAX = 300;
const BODY_MAX = 100_000;
const FOLDER_MAX = 200;
/** The preview Telegram shows for a new message. */
const NOTIFY_PREVIEW_CHARS = 200;

type Failure = { ok: false; error: string };

export type FoldersResult = { ok: true; folders: MailFolder[] } | Failure;
export type MessagesResult = { ok: true; items: MailListItem[]; total: number } | Failure;
export type MessageResult = { ok: true; message: MailMessage } | Failure;
export type SendResult = { ok: true; messageId: string } | Failure;
export type MailSyncResult = { ok: true; found: number; sent: number; failed: number } | Failure;
export type MailOkResult = { ok: true } | Failure;

/**
 * The vocabulary the UI translates. Anything else that escapes an action is
 * reported as the caller's fallback code — an unmapped message is exactly the
 * kind of string that carries a host name or a rejected user name in it.
 */
const STABLE_ERRORS = new Set([
  "unauthenticated",
  "not_admin",
  "not_configured",
  "not_enabled",
  "encryption_unavailable",
  "cron_secret_missing",
  "invalid",
  "no_recipients",
  "invalid_recipient",
  "too_many_recipients",
  "attachments_too_large",
  "not_found",
]);

function failure(e: unknown, fallback = "generic"): Failure {
  const code = e instanceof Error ? e.message : "";
  return { ok: false, error: STABLE_ERRORS.has(code) ? code : fallback };
}

/** Throws instead of returning, so the actions below can keep one try/catch
 *  around both the guard and the work. Matches app/actions/admin.ts. */
async function requireAdmin(): Promise<{ supabase: Client; adminId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/**
 * Config plus the two plaintext passwords, for one call. `readIntegrationSecrets`
 * needs the caller to pass RLS on integration_settings, which is why this path
 * is admin-only and the cron uses the definer function instead.
 */
async function mailSecrets(supabase: Client): Promise<{ config: MailConfig; secrets: Record<string, string> }> {
  const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  return { config, secrets };
}

function imapCredentials(config: MailConfig, secrets: Record<string, string>): ImapCredentials {
  const host = config.imap_host.trim();
  const user = config.imap_user.trim();
  const pass = secrets.imap_password ?? "";
  // A missing password is indistinguishable from a key that no longer opens the
  // stored one (readIntegrationSecrets answers with an empty bag either way),
  // and both mean the same thing to the admin: retype it.
  if (!host || !user || !pass) throw new Error("not_configured");
  return { host, port: config.imap_port, secure: config.imap_secure, user, pass };
}

async function imapFor(supabase: Client): Promise<ImapCredentials> {
  const { config, secrets } = await mailSecrets(supabase);
  return imapCredentials(config, secrets);
}

function folderName(value: string): string {
  const folder = value.trim().slice(0, FOLDER_MAX);
  // Control characters would end up inside an IMAP command line; imapflow quotes
  // the name, but a CR is not something a folder name ever legitimately holds.
  if (!folder || /[\r\n\0]/.test(folder)) throw new Error("invalid");
  return folder;
}

function messageUid(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid");
  return Math.trunc(value);
}

/* ------------------------------------------------------------------ reading */

export async function listFoldersAction(): Promise<FoldersResult> {
  try {
    const { supabase } = await requireAdmin();
    return { ok: true, folders: await listFolders(await imapFor(supabase)) };
  } catch (e) {
    return failure(e, "imap_error");
  }
}

export async function listMessagesAction(input: {
  folder: string;
  limit: number;
  before?: number;
  search?: string;
  unreadOnly?: boolean;
}): Promise<MessagesResult> {
  try {
    const { supabase } = await requireAdmin();
    const page = await listMessages(await imapFor(supabase), {
      folder: folderName(input.folder),
      limit: input.limit,
      before: input.before,
      // A search term is a server-side SEARCH argument, not a pattern we build:
      // trimming and capping is all it needs.
      search: (input.search ?? "").trim().slice(0, 200),
      unreadOnly: input.unreadOnly === true,
    });
    return { ok: true, items: page.items, total: page.total };
  } catch (e) {
    return failure(e, "imap_error");
  }
}

export async function getMessageAction(input: {
  folder: string;
  uid: number;
  allowRemoteImages?: boolean;
}): Promise<MessageResult> {
  try {
    const { supabase } = await requireAdmin();
    const message = await getMessage(await imapFor(supabase), folderName(input.folder), messageUid(input.uid), {
      // Remote images stay blocked unless the reader asks for them: loading them
      // is what tells a sender their tracking pixel was opened.
      allowRemoteImages: input.allowRemoteImages === true,
    });
    if (!message) return { ok: false, error: "not_found" };
    return { ok: true, message };
  } catch (e) {
    return failure(e, "imap_error");
  }
}

/* ------------------------------------------------------------------ writing */

export async function setSeenAction(input: { folder: string; uid: number; seen: boolean }): Promise<MailOkResult> {
  try {
    const { supabase } = await requireAdmin();
    const done = await setSeen(await imapFor(supabase), folderName(input.folder), messageUid(input.uid), input.seen === true);
    return done ? { ok: true } : { ok: false, error: "not_found" };
  } catch (e) {
    return failure(e, "imap_error");
  }
}

export async function deleteMessageAction(input: { folder: string; uid: number }): Promise<MailOkResult> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const folder = folderName(input.folder);
    const uid = messageUid(input.uid);
    const done = await deleteMessage(await imapFor(supabase), folder, uid);
    if (!done) return { ok: false, error: "not_found" };
    // Deleting from the shared mailbox is an operator action on a record no
    // other log would show, so it gets an audit line. The subject is not copied
    // into it: the audit table is read by more people than the mailbox is.
    await logAudit(supabase, {
      actorId: adminId,
      action: "mail.deleted",
      entityType: "mail_message",
      entityId: `${folder}:${uid}`,
    });
    return { ok: true };
  } catch (e) {
    return failure(e, "imap_error");
  }
}

/* ------------------------------------------------------------------ sending */

/** Bare addresses only. A display name would be a second place a newline could
 *  hide, and the panel composes to addresses the reader picked. */
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/**
 * "a@b.c, Name <d@e.f>; g@h.i" → ["a@b.c", "d@e.f", "g@h.i"].
 * An entry that is not an address fails the whole send: silently dropping one
 * would mean the admin believes a message went somewhere it never did.
 */
function parseRecipients(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(/[,;\n]/)) {
    const entry = part.trim();
    if (!entry) continue;
    const angled = entry.match(/<([^<>]+)>\s*$/);
    const address = (angled ? angled[1] : entry).trim();
    if (!ADDRESS.test(address)) throw new Error("invalid_recipient");
    if (!out.includes(address)) out.push(address);
  }
  if (out.length > MAX_RECIPIENTS) throw new Error("too_many_recipients");
  return out;
}

function headerValue(value: string, max: number): string {
  // MimeNode encodes and folds header values, so this is about intent rather
  // than injection: a subject with a newline in it was pasted, not typed.
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

/** A Message-ID has to be globally unique and end in a domain that exists, or
 *  spam filters treat the message as forged. The sender's own domain is the
 *  only one we can honestly claim. */
function newMessageId(fromEmail: string, host: string): string {
  const domain = (fromEmail.split("@")[1] ?? host).trim().toLowerCase().replace(/[^a-z0-9.-]/g, "");
  return `<${randomUUID()}@${domain || "localhost"}>`;
}

/** References are message-ids from the thread we are answering; anything that
 *  is not one is dropped rather than repeated back into the header. */
function referenceList(value: string): string[] {
  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^<[^<>\s]+>$/.test(entry))
    .slice(0, 20);
}

/** Attachment names are echoed into a MIME header and, later, into a download.
 *  Path separators and control characters have no business in either. */
function attachmentName(name: string): string {
  const clean = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.slice(0, 120) || "attachment";
}

/**
 * SMTP, built from the mail integration — deliberately not from
 * `email_settings`. Those are two different mailboxes: this one is the address
 * the admin reads and replies from, and a reply has to leave from the account
 * it arrived at or it fails SPF at the first hop.
 *
 * `smtp_same_as_imap` is about the credential pair only. Host, port and
 * encryption stay their own fields, because a provider with one login for two
 * different hosts is common.
 */
function smtpTransportFor(config: MailConfig, secrets: Record<string, string>) {
  const host = config.smtp_host.trim();
  const user = (config.smtp_same_as_imap ? config.imap_user : config.smtp_user).trim();
  const pass = config.smtp_same_as_imap ? secrets.imap_password : secrets.smtp_password;
  if (!host || !user || !pass) throw new Error("not_configured");
  const port = config.smtp_port || 587;
  return nodemailer.createTransport({
    host,
    port,
    // Implicit TLS from the first byte on 465; STARTTLS upgrades an already
    // open connection, which is why "none" and "starttls" both open plain.
    secure: config.smtp_encryption === "ssl",
    requireTLS: config.smtp_encryption === "starttls",
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/**
 * Send one message, then file a copy in Sent.
 *
 * FormData rather than a plain object because attachments come through it. The
 * MIME is built ONCE and handed to SMTP as `raw`, so the bytes the recipient
 * gets and the bytes the Sent folder keeps are the same message — and the Bcc
 * list, which travels in the envelope, never reaches a header either copy
 * could show.
 */
export async function sendMailAction(formData: FormData): Promise<SendResult> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { config, secrets } = await mailSecrets(supabase);

    const from = config.email.trim();
    if (!ADDRESS.test(from)) throw new Error("not_configured");

    const field = (name: string) => String(formData.get(name) ?? "");
    const to = parseRecipients(field("to"));
    const cc = parseRecipients(field("cc"));
    const bcc = parseRecipients(field("bcc"));
    if (to.length === 0) throw new Error("no_recipients");
    if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new Error("too_many_recipients");

    const subject = headerValue(field("subject"), SUBJECT_MAX);
    const text = field("text").slice(0, BODY_MAX);
    if (!subject && !text.trim()) throw new Error("invalid");

    const inReplyTo = headerValue(field("inReplyTo"), 400);
    const references = referenceList(field("references"));
    // The thread's own id belongs in References too, or a client that only reads
    // that header shows the reply as a new conversation.
    if (inReplyTo && /^<[^<>\s]+>$/.test(inReplyTo) && !references.includes(inReplyTo)) references.push(inReplyTo);

    const files = formData.getAll("attachments").filter((entry): entry is File => entry instanceof File);
    if (files.length > MAX_ATTACHMENTS) throw new Error("attachments_too_large");
    let total = 0;
    for (const file of files) total += file.size;
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error("attachments_too_large");
    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: attachmentName(file.name),
        content: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || "application/octet-stream",
      })),
    );

    const messageId = newMessageId(from, config.smtp_host);
    const raw = await new MailComposer({
      from: config.from_name.trim() ? { name: config.from_name.trim(), address: from } : from,
      to,
      // Bcc is deliberately absent: it is carried in the SMTP envelope below, so
      // no recipient — and no archived copy — can enumerate the blind list.
      cc: cc.length ? cc : undefined,
      subject,
      text,
      messageId,
      inReplyTo: inReplyTo || undefined,
      references: references.length ? references : undefined,
      attachments,
      // Every attachment is already a Buffer; this makes sure a crafted field
      // can never turn one into "read this path" or "fetch this URL".
      disableFileAccess: true,
      disableUrlAccess: true,
    }).compile().build();

    const transport = smtpTransportFor(config, secrets);
    try {
      await transport.sendMail({ envelope: { from, to: [...to, ...cc, ...bcc] }, raw });
    } finally {
      transport.close();
    }

    // The recipient has the message; a mailbox that refuses the copy is a worse
    // outcome to report than to swallow, and appendToSent never throws.
    const imap = imapCredentials(config, secrets);
    await appendToSent(imap, raw, config.sent_folder);

    await logAudit(supabase, {
      actorId: adminId,
      action: "mail.sent",
      entityType: "mail_message",
      entityId: messageId,
      // Recipients and the message id, never the body: the audit log is a
      // wider-read table than the mailbox it describes.
      after: { to: to.length, cc: cc.length, bcc: bcc.length, attachments: attachments.length },
    });
    return { ok: true, messageId };
  } catch (e) {
    return failure(e, "send_failed");
  }
}

/* --------------------------------------------------------------- the poller */

/**
 * Repeats the key resolution from integrations.ts for the reason notify.ts does:
 * `mail_sync_context` hands back the password as ciphertext, and the cron caller
 * is anonymous — RLS keeps it out of integration_settings, so the process has to
 * hold the key itself.
 */
function integrationsKeyHex(): string | null {
  for (const candidate of [process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY, process.env.APP_ENCRYPTION_KEY]) {
    const hex = candidate?.trim();
    if (hex && hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) return hex;
  }
  return null;
}

type SyncFolderState = { folder: string; lastUid: number; uidValidity: number | null };
type SyncContext = { enabled: boolean; config: MailConfig; imapPassword: string; folders: SyncFolderState[] };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** The mail row, its cursor and the decrypted password — or null when the token
 *  does not match, the row is missing, or the key no longer opens it. All four
 *  cases mean "cannot poll", and telling them apart is the admin panel's job. */
async function readSyncContext(supabase: Client, token: string): Promise<SyncContext | null> {
  const { data, error } = await supabase.rpc("mail_sync_context", { p_token: token });
  if (error) {
    console.error("mail.sync.context", safeError(error));
    return null;
  }
  // SQL NULL is the answer to a wrong token AND to a missing mail row — the
  // function refuses to tell those apart, and neither can be polled.
  const row = asRecord(data);
  if (Object.keys(row).length === 0) return null;

  const blob = asRecord(asRecord(row.secrets).imap_password);
  const keyHex = integrationsKeyHex();
  let imapPassword = "";
  if (keyHex && typeof blob.c === "string" && typeof blob.i === "string" && typeof blob.t === "string") {
    try {
      imapPassword = decryptWith(keyHex, blob.c, blob.i, blob.t);
    } catch {
      // A rotated key, not a broken mailbox. The empty password below turns
      // into "not_configured", which is what the admin has to fix anyway.
      console.error("mail.sync.decrypt");
    }
  }

  const folders: SyncFolderState[] = [];
  for (const entry of Array.isArray(row.folders) ? row.folders : []) {
    const state = asRecord(entry);
    const folder = typeof state.folder === "string" ? state.folder : "";
    if (folder) {
      folders.push({ folder, lastUid: asNumber(state.last_uid) ?? 0, uidValidity: asNumber(state.uid_validity) });
    }
  }

  return {
    enabled: row.enabled === true,
    // Over the defaults, exactly as readIntegration does it: a jsonb that
    // predates a field must not leave that field undefined in a typed config.
    config: { ...MAIL_DEFAULTS, ...asRecord(row.config) } as MailConfig,
    imapPassword,
    folders,
  };
}

async function commitSync(
  supabase: Client,
  token: string,
  input: { folder: string; lastUid?: number; uidValidity?: number; error?: string },
): Promise<void> {
  // The three optional arguments generate as `… | undefined`; leaving one out
  // is exactly the `default null` mail_sync_commit already declares for it.
  const { error } = await supabase.rpc("mail_sync_commit", {
    p_token: token,
    p_folder: input.folder,
    p_last_uid: input.lastUid,
    p_uid_validity: input.uidValidity,
    p_error: input.error,
  });
  if (error) console.error("mail.sync.commit", safeError(error));
}

/** "Otrzymano: 12:43" — the shop is Polish and so is the reader of these. */
function receivedAt(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
}

function senderLabel(item: MailListItem): string {
  const { name, address } = item.from;
  if (name && address) return `${name} <${address}>`;
  return address || name || "—";
}

/**
 * One new message → one Telegram notification. The dedupe key is the folder,
 * the UIDVALIDITY and the UID: a cron run that overlaps the admin pressing
 * "sync now" therefore announces each message exactly once, because the second
 * insert loses to the partial unique index instead of sending.
 */
async function announce(supabase: Client, item: MailListItem, folder: string, uidValidity: number): Promise<void> {
  const time = receivedAt(item.date);
  await notify(supabase, {
    type: "mail.received",
    title: "NOWY E-MAIL",
    icon: "✉️",
    rows: [
      ["Od", senderLabel(item)],
      ["Temat", item.subject || "(bez tematu)"],
    ],
    quote: item.preview.slice(0, NOTIFY_PREVIEW_CHARS),
    footer: time ? `Otrzymano: ${time}` : "",
    dedupeKey: buildDedupeKey("mail.received", folder, uidValidity, item.uid),
  });
}

/** The poll itself: everything above the remembered UID, announced and then
 *  committed. A failure records itself against the folder and leaves the cursor
 *  alone — a mailbox that was briefly unreachable must not look like a mailbox
 *  with no mail. */
async function pollInbox(supabase: Client, token: string): Promise<{ found: number } | { error: string }> {
  const ctx = await readSyncContext(supabase, token);
  if (!ctx) return { error: "not_configured" };
  // The switch is the admin's kill switch for the background half of the
  // module; reading the mailbox by hand does not need it, polling it does.
  if (!ctx.enabled) return { error: "not_enabled" };

  let cred: ImapCredentials;
  try {
    cred = imapCredentials(ctx.config, { imap_password: ctx.imapPassword });
  } catch {
    return { error: "not_configured" };
  }

  const state = ctx.folders.find((entry) => entry.folder === INBOX) ?? null;
  let batch: Awaited<ReturnType<typeof fetchNewSince>>;
  try {
    batch = await fetchNewSince(cred, INBOX, state?.lastUid ?? 0, state?.uidValidity ?? null);
  } catch (e) {
    await commitSync(supabase, token, { folder: INBOX, error: safeError(e) });
    return { error: "imap_error" };
  }

  for (const item of batch.items) await announce(supabase, item, INBOX, batch.uidValidity);

  // highestUid is the folder's watermark and already covers an empty batch (a
  // first sync, or a re-baseline after UIDVALIDITY changed); the reduce only
  // matters for a message that arrived between the open and the search.
  const lastUid = batch.items.reduce((max, item) => Math.max(max, item.uid), batch.highestUid);
  await commitSync(supabase, token, { folder: INBOX, lastUid, uidValidity: batch.uidValidity });
  return { found: batch.items.length };
}

type SyncCaller = "admin" | "cron" | "denied" | "cron_secret_missing";

function bearerToken(value: string | null): string {
  const header = (value ?? "").trim();
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
}

/** Constant-time over the digests rather than the strings: comparing the raw
 *  values would need equal lengths, and refusing early on a length mismatch is
 *  itself a measurement. */
function secretMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

/**
 * Who is allowed to run a sync, in one place — the admin's button and the cron
 * route both go through it, so the rule cannot drift between them.
 *
 * Vercel Cron presents `Authorization: Bearer <CRON_SECRET>`. Until that
 * variable exists in the deployment, the only accepted caller is a signed-in
 * admin: an anonymous request gets "cron_secret_missing", which says why it was
 * refused without leaving the endpoint open in the meantime.
 */
async function syncCaller(supabase: Client): Promise<SyncCaller> {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret) {
    const presented = bearerToken((await headers()).get("authorization"));
    if (presented && secretMatches(presented, secret)) return "cron";
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return secret ? "denied" : "cron_secret_missing";
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "admin" ? "admin" : "denied";
}

/**
 * Run the mailbox poll and flush the notification outbox.
 *
 * This is what makes the module work on a deployment that has no CRON_SECRET
 * and no scheduler yet: an admin pressing "sync now" does exactly what the cron
 * would do. `found` counts genuinely new messages; `sent`/`failed` count the
 * outbox rows the drain closed, which includes events other request paths
 * queued while Telegram was unreachable.
 */
export async function syncNowAction(): Promise<MailSyncResult> {
  try {
    const supabase = await createClient();
    const caller = await syncCaller(supabase);
    if (caller === "cron_secret_missing") return { ok: false, error: "cron_secret_missing" };
    if (caller === "denied") return { ok: false, error: "not_admin" };
    // Only an admin session can write app_settings, and the stored hash is what
    // lets the anonymous cron path claim anything at all. Arming it here means
    // the first admin visit is enough to make the schedule work later.
    if (caller === "admin") await ensureDispatchHash(supabase);

    const token = dispatchToken();
    if (!token) return { ok: false, error: "encryption_unavailable" };

    const outcome = await pollInbox(supabase, token);
    // Drain even when the mailbox itself failed: a waitlist signup queued a
    // minute ago has nothing to do with IMAP being down.
    const drained = await drainNotifications(supabase);
    if ("error" in outcome) return { ok: false, error: outcome.error };
    return { ok: true, found: outcome.found, sent: drained.sent, failed: drained.failed };
  } catch (e) {
    console.error("mail.sync", safeError(e));
    return { ok: false, error: "generic" };
  }
}

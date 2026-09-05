import "server-only";
import { buffer as readStream } from "stream/consumers";
import { ImapFlow } from "imapflow";
import type {
  FetchMessageObject,
  ListResponse,
  MessageAddressObject,
  MessageStructureObject,
  SearchObject,
} from "imapflow";
import { simpleParser } from "mailparser";
import type { AddressObject } from "mailparser";
import { safeError } from "@/lib/server/integrations";
import { previewText, sanitizeMailHtml } from "@/lib/server/mail-html";

/**
 * IMAP — reading the shop's mailbox from a serverless function.
 *
 * Vercel gives us one short-lived process per request, so this file does the
 * opposite of what an IMAP library usually wants: no pool, no IDLE, no
 * long-lived client. Every export opens a connection, does one job, and logs
 * out in a finally block, with timeouts short enough that a wrong host fails
 * the request instead of holding it until the platform kills it.
 *
 * The other rule is volume. A mailbox can hold fifty thousand messages and an
 * attachment can be twenty megabytes; nothing here fetches "everything". Lists
 * are capped, previews read a couple of kilobytes of one body part rather than
 * whole bodies, and the sync cap keeps a week-long outage from turning into a
 * hundred notifications.
 *
 * Credentials never leave: errors are rewritten through `safeError` and the
 * password is scrubbed from them before anything is thrown or logged.
 */

export type MailAddress = { name: string; address: string };

export type MailFolder = {
  path: string;
  name: string;
  specialUse: string | null;
  /** null when the server does not report counts on LIST — not zero. */
  unseen: number | null;
};

export type MailListItem = {
  uid: number;
  from: MailAddress;
  subject: string;
  preview: string;
  /** ISO 8601, or "" when the message carries no date we can parse. */
  date: string;
  seen: boolean;
  hasAttachments: boolean;
};

export type MailAttachmentMeta = { id: string; filename: string; size: number; contentType: string };

export type MailMessage = {
  uid: number;
  messageId: string | null;
  from: MailAddress;
  to: string[];
  cc: string[];
  date: string;
  subject: string;
  html: string | null;
  text: string;
  attachments: MailAttachmentMeta[];
  references: string[];
  blockedImages: number;
};

export type ImapCredentials = { host: string; port: number; secure: boolean; user: string; pass: string };

/** DNS + TLS + greeting have to fit inside a request, so they get a budget an
 *  order of magnitude below the platform's function timeout. */
const CONNECT_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 8_000;
const SOCKET_TIMEOUT_MS = 25_000;

/** Enough encoded bytes to yield a readable one-line preview after base64 or
 *  quoted-printable decoding, and far less than a body. */
const PREVIEW_BYTES = 2048;
const PREVIEW_CHARS = 200;
/** One FETCH per distinct body-part number. Real pages need two or three; the
 *  cap stops a pathological mix of MIME shapes from becoming N round trips. */
const PREVIEW_GROUPS = 6;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
/** A message larger than this is truncated for parsing rather than pulled into
 *  memory whole. Its attachment list still comes from BODYSTRUCTURE, which is
 *  metadata and always complete. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** A day-long outage must not produce a day of notifications at once. */
const MAX_NEW_MESSAGES = 25;

/** Servers that predate SPECIAL-USE only give us the folder name. */
const SENT_NAMES = ["Sent", "Sent Items", "Sent Messages", "INBOX.Sent", "Wysłane", "Elementy wysłane"];

/**
 * One connection, one job, always closed.
 *
 * The error listener is not optional: imapflow is an EventEmitter and an
 * 'error' with no listener is an uncaught exception that takes the whole
 * function down — which is exactly what a mail server dropping the socket
 * mid-command emits.
 */
async function withClient<T>(cred: ImapCredentials, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: cred.host.trim(),
    port: cred.port || (cred.secure ? 993 : 143),
    secure: cred.secure,
    auth: { user: cred.user.trim(), pass: cred.pass },
    logger: false,
    emitLogs: false,
    // Nothing here waits for a push: the process ends with the request, so
    // auto-IDLE would only add a command for the next call to break.
    disableAutoIdle: true,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  client.on("error", () => {});

  try {
    await client.connect();
    return await run(client);
  } catch (e) {
    throw new Error(scrub(e, cred));
  } finally {
    try {
      await client.logout();
    } catch {
      // Never connected, or already gone: drop the socket instead of leaving
      // the server to time out a half-open session.
      client.close();
    }
  }
}

/** No imapflow error is known to quote the password, but a proxy or a server
 *  greeting can echo the login line back at us — so it is removed by value on
 *  top of the pattern scrubbing `safeError` already does. */
function scrub(e: unknown, cred: ImapCredentials): string {
  const message = safeError(e) || "imap_error";
  return cred.pass ? message.split(cred.pass).join("***") : message;
}

/** Prove the credentials work without touching a single message. */
export async function verifyImap(cred: ImapCredentials): Promise<{ ok: boolean; error?: string }> {
  if (!cred.host.trim() || !cred.user.trim() || !cred.pass) return { ok: false, error: "not_configured" };
  try {
    await withClient(cred, (client) => client.noop());
    return { ok: true };
  } catch (e) {
    // withClient already scrubbed this message; it is safe to show an admin.
    return { ok: false, error: e instanceof Error ? e.message : "imap_error" };
  }
}

export async function listFolders(cred: ImapCredentials): Promise<MailFolder[]> {
  return withClient(cred, async (client) => {
    let entries: ListResponse[];
    try {
      // With LIST-STATUS (Dovecot has it) the unread counts ride along with the
      // LIST for free. Without it imapflow falls back to one STATUS per folder,
      // which is why the counts are asked for here and nowhere else.
      entries = await client.list({ statusQuery: { unseen: true } });
    } catch {
      // A server that refuses the extended form still has to answer a plain
      // LIST. The counts are then unknown, which is a missing badge — not a
      // broken folder list.
      entries = await client.list();
    }
    return entries
      .filter((entry) => !entry.flags.has("\\Noselect") && !entry.flags.has("\\NonExistent"))
      .map((entry) => ({
        path: entry.path,
        name: entry.name,
        specialUse: entry.specialUse ?? null,
        unseen: typeof entry.status?.unseen === "number" ? entry.status.unseen : null,
      }));
  });
}

/**
 * One page of a folder, newest first.
 *
 * `before` is a UID cursor: pass the lowest UID of the page you already have
 * to get the next one. `total` is the number of messages the filter matches,
 * so an unfiltered call reports the size of the folder.
 */
export async function listMessages(
  cred: ImapCredentials,
  opts: { folder: string; limit: number; before?: number; search?: string; unreadOnly?: boolean },
): Promise<{ items: MailListItem[]; total: number }> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const search = (opts.search ?? "").trim();
  const before = typeof opts.before === "number" && Number.isFinite(opts.before) ? Math.trunc(opts.before) : null;
  const filtered = Boolean(search) || opts.unreadOnly === true || before !== null;

  return withClient(cred, async (client) => {
    const mailbox = await client.mailboxOpen(opts.folder, { readOnly: true });
    if (mailbox.exists === 0) return { items: [], total: 0 };

    if (!filtered) {
      // The newest `limit` messages are the last `limit` sequence numbers, so
      // the common case costs no SEARCH at all.
      const first = Math.max(1, mailbox.exists - limit + 1);
      return { items: await toListItems(client, `${first}:${mailbox.exists}`, false), total: mailbox.exists };
    }

    if (before !== null && before <= 1) return { items: [], total: 0 };

    const criteria: SearchObject = {};
    if (opts.unreadOnly === true) criteria.seen = false;
    // Header terms plus body, evaluated by the server: it has the indexes, we
    // would have to download the folder to do the same thing worse.
    if (search) criteria.or = [{ subject: search }, { from: search }, { to: search }, { body: search }];
    if (before !== null) criteria.uid = `1:${before - 1}`;
    if (Object.keys(criteria).length === 0) criteria.all = true;

    const found = await client.search(criteria, { uid: true });
    const uids = (Array.isArray(found) ? [...found] : []).sort((a, b) => a - b);
    // Newest first means the highest UIDs, which is the tail of the sorted set.
    const page = uids.slice(Math.max(0, uids.length - limit));
    return { items: await toListItems(client, page, true), total: uids.length };
  });
}

/**
 * One message, body included.
 *
 * The source is downloaded once and handed to mailparser, which is also what
 * turns embedded cid: images into data: URIs — those cost no network request,
 * so they survive the remote-image block and inline logos still render.
 */
export async function getMessage(
  cred: ImapCredentials,
  folder: string,
  uid: number,
  opts?: { allowRemoteImages?: boolean },
): Promise<MailMessage | null> {
  return withClient(cred, async (client) => {
    // Read-only: opening a message is not the same act as marking it read, and
    // the reader calls setSeen when it means to.
    await client.mailboxOpen(folder, { readOnly: true });
    const message = await client.fetchOne(
      uid,
      { uid: true, envelope: true, internalDate: true, bodyStructure: true, source: { maxLength: MAX_SOURCE_BYTES } },
      { uid: true },
    );
    if (!message || !message.source) return null;

    const parsed = await simpleParser(message.source);
    const raw = typeof parsed.html === "string" ? parsed.html : null;
    const clean = raw ? sanitizeMailHtml(raw, { allowRemoteImages: opts?.allowRemoteImages === true }) : null;

    return {
      uid: message.uid,
      messageId: parsed.messageId ?? message.envelope?.messageId ?? null,
      from: addressOf(message.envelope?.from),
      to: addressList(parsed.to),
      cc: addressList(parsed.cc),
      date: isoDate(parsed.date ?? message.internalDate ?? message.envelope?.date),
      subject: (parsed.subject ?? message.envelope?.subject ?? "").trim(),
      html: clean?.html ?? null,
      text: parsed.text ?? "",
      attachments: attachmentList(message.bodyStructure),
      references: referenceList(parsed.references),
      blockedImages: clean?.blockedImages ?? 0,
    };
  });
}

export async function setSeen(cred: ImapCredentials, folder: string, uid: number, seen: boolean): Promise<boolean> {
  return withClient(cred, async (client) => {
    await client.mailboxOpen(folder);
    return seen
      ? client.messageFlagsAdd(uid, ["\\Seen"], { uid: true })
      : client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
  });
}

/**
 * Delete the way a mail client does: move to Trash when the server has one.
 *
 * Nothing here ever expunges. That matters more than it looks: on a server
 * without the MOVE extension, imapflow emulates a move with COPY + \Deleted +
 * EXPUNGE, and it issues that delete whether or not the COPY succeeded — so a
 * refused copy destroys the message instead of moving it, scoped by UID where
 * the server has UIDPLUS and FOLDER-WIDE where it does not, which would also
 * erase every other message anyone had flagged. UIDPLUS therefore makes the
 * emulation narrower, never safe, so the emulation is simply never allowed to
 * run: only a server advertising MOVE gets the server-side move, everything
 * else copies by hand, flags the original solely once that copy is confirmed,
 * and leaves the removal to the server's own housekeeping.
 */
export async function deleteMessage(cred: ImapCredentials, folder: string, uid: number): Promise<boolean> {
  return withClient(cred, async (client) => {
    const trash = await findFolder(client, "\\Trash");
    await client.mailboxOpen(folder);
    if (trash && trash !== folder) {
      // MOVE alone: imapflow decides whether to emulate on that capability and
      // on nothing else, so anything wider here buys the emulation, not a move.
      if (client.capabilities.has("MOVE")) {
        const moved = await client.messageMove(uid, trash, { uid: true });
        if (moved) return true;
      } else if (await client.messageCopy(uid, trash, { uid: true })) {
        return client.messageFlagsAdd(uid, ["\\Deleted"], { uid: true });
      }
    }
    return client.messageFlagsAdd(uid, ["\\Deleted"], { uid: true });
  });
}

/**
 * File a copy of an outgoing message in Sent. Best effort by design: SMTP has
 * already delivered it, so a mailbox that refuses the copy must not turn a
 * successful send into a failure. `folder` overrides the discovered path when
 * the admin configured one.
 */
export async function appendToSent(cred: ImapCredentials, raw: Buffer, folder?: string): Promise<void> {
  try {
    await withClient(cred, async (client) => {
      const target = folder?.trim() || (await findFolder(client, "\\Sent", SENT_NAMES));
      if (!target) return;
      await client.append(target, raw, ["\\Seen"]);
    });
  } catch {
    // Swallowed on purpose — see above.
  }
}

export async function fetchAttachment(
  cred: ImapCredentials,
  folder: string,
  uid: number,
  id: string,
): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  // `id` is a MIME part number and is interpolated into an IMAP command, so
  // anything that is not digits and dots never reaches the server.
  if (!/^\d+(\.\d+)*$/.test(id)) return null;
  return withClient(cred, async (client) => {
    await client.mailboxOpen(folder, { readOnly: true });
    // download() undoes the transfer encoding as it streams and stops at
    // maxBytes, so an oversized part cannot fill the function's memory.
    const download = await client.download(uid, id, { uid: true, maxBytes: MAX_ATTACHMENT_BYTES });
    if (!download || !download.content) return null;
    const content = await readStream(download.content);
    return {
      filename: (download.meta.filename ?? "").trim() || `attachment-${id}`,
      contentType: download.meta.contentType || "application/octet-stream",
      content,
    };
  });
}

/**
 * What the cron asks: "anything above the UID I last saw?"
 *
 * Two situations mean the remembered UID is meaningless — the folder was never
 * synced, and the server renumbered it (UIDVALIDITY changed). Both re-baseline
 * to the current watermark and report NOTHING, because replaying a mailbox as
 * new mail would fire a notification per message. `highestUid` is that
 * watermark and is always at or above every returned UID, so the caller can
 * store it even when `items` is empty.
 */
export async function fetchNewSince(
  cred: ImapCredentials,
  folder: string,
  lastUid: number,
  uidValidity: number | null,
): Promise<{ uidValidity: number; items: MailListItem[]; highestUid: number }> {
  return withClient(cred, async (client) => {
    const mailbox = await client.mailboxOpen(folder, { readOnly: true });
    const currentValidity = Number(mailbox.uidValidity);
    // uidNext is the UID the next arrival will get, so one below it is the
    // highest UID this folder can currently hold.
    const highestUid = Math.max(0, (mailbox.uidNext || 1) - 1);
    const rebaseline = lastUid <= 0 || (uidValidity !== null && currentValidity !== uidValidity);

    if (rebaseline || mailbox.exists === 0) return { uidValidity: currentValidity, items: [], highestUid };

    const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
    // "N:*" does not mean "everything above N": IMAP always includes the
    // highest UID in the range even when it sits below N, so a quiet folder
    // answers with its newest — and already announced — message.
    const uids = (Array.isArray(found) ? found : []).filter((value) => value > lastUid).sort((a, b) => a - b);
    const page = uids.slice(Math.max(0, uids.length - MAX_NEW_MESSAGES));
    return { uidValidity: currentValidity, items: await toListItems(client, page, true), highestUid };
  });
}

/* ---------------------------------------------------------------- internals */

/** Special-use flag first, folder name only as a fallback for servers that
 *  never learned RFC 6154. */
async function findFolder(client: ImapFlow, specialUse: string, names: string[] = []): Promise<string | null> {
  const entries = await client.list();
  const flagged = entries.find((entry) => entry.specialUse === specialUse);
  if (flagged) return flagged.path;
  const wanted = names.map((name) => name.toLowerCase());
  const named = entries.find(
    (entry) => wanted.includes(entry.name.toLowerCase()) || wanted.includes(entry.path.toLowerCase()),
  );
  return named?.path ?? null;
}

/** Envelopes, flags and structure in one FETCH; previews in a second pass. */
async function toListItems(client: ImapFlow, range: string | number[], byUid: boolean): Promise<MailListItem[]> {
  if (Array.isArray(range) && range.length === 0) return [];
  const messages = await client.fetchAll(
    range,
    { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true },
    { uid: byUid },
  );
  const previews = await fetchPreviews(client, messages);
  return messages
    .map((message) => ({
      uid: message.uid,
      from: addressOf(message.envelope?.from),
      subject: (message.envelope?.subject ?? "").trim(),
      preview: previews.get(message.uid) ?? "",
      date: isoDate(message.internalDate ?? message.envelope?.date),
      seen: message.flags?.has("\\Seen") ?? false,
      hasAttachments: attachmentNodes(message.bodyStructure).length > 0,
    }))
    .sort((a, b) => b.uid - a.uid);
}

type TextPart = { key: string; encoding: string; charset: string; isHtml: boolean };

/**
 * A preview costs one partial read of one body part, never a body.
 *
 * BODYSTRUCTURE tells us which part number holds the text, and messages that
 * agree on that number are read in a single FETCH — so a normal page of mail
 * is two or three commands however many messages it holds.
 */
async function fetchPreviews(client: ImapFlow, messages: FetchMessageObject[]): Promise<Map<number, string>> {
  const previews = new Map<number, string>();
  const parts = new Map<number, TextPart>();
  const byKey = new Map<string, number[]>();

  for (const message of messages) {
    const part = pickTextPart(message.bodyStructure);
    if (!part) continue;
    parts.set(message.uid, part);
    const uids = byKey.get(part.key);
    if (uids) uids.push(message.uid);
    else byKey.set(part.key, [message.uid]);
  }

  const groups = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, PREVIEW_GROUPS);
  for (const [key, uids] of groups) {
    // Sequential on purpose: one connection carries one command at a time, so
    // firing these in parallel would only queue them.
    const fetched = await client.fetchAll(uids, { uid: true, bodyParts: [{ key, maxLength: PREVIEW_BYTES }] }, { uid: true });
    for (const message of fetched) {
      const part = parts.get(message.uid);
      // imapflow reports part keys lowercased, so "TEXT" comes back as "text".
      const raw = message.bodyParts?.get(key.toLowerCase());
      if (!part || !raw) continue;
      const body = decodePart(raw, part.encoding, part.charset);
      previews.set(message.uid, part.isHtml ? previewText(body, "", PREVIEW_CHARS) : previewText(null, body, PREVIEW_CHARS));
    }
  }
  return previews;
}

/** The part a human would read: plain text if the sender sent any, HTML
 *  otherwise. */
function pickTextPart(root: MessageStructureObject | undefined): TextPart | null {
  if (!root) return null;
  const plain = findText(root, "plain");
  const node = plain ?? findText(root, "html");
  if (!node) return null;
  return {
    // A non-multipart message has no part number of its own; BODY[TEXT] is the
    // portable way to ask for its body without the headers.
    key: node.part ?? "TEXT",
    encoding: node.encoding ?? "",
    charset: node.parameters?.charset ?? "",
    isHtml: plain === null,
  };
}

function findText(node: MessageStructureObject, subtype: "plain" | "html"): MessageStructureObject | null {
  // An encapsulated message is an attachment, not this message's body — and
  // imapflow gives its child the wrapper's part number, so BODY[n] would come
  // back as the whole nested message, headers included.
  if (node.type === "message/rfc822") return null;
  if (node.childNodes?.length) {
    for (const child of node.childNodes) {
      const hit = findText(child, subtype);
      if (hit) return hit;
    }
    return null;
  }
  if (node.type !== `text/${subtype}`) return null;
  // A .txt or .html file hanging off a message is not that message's body.
  if (node.disposition === "attachment") return null;
  return node;
}

function attachmentNodes(root: MessageStructureObject | undefined): MessageStructureObject[] {
  if (!root) return [];
  // A forwarded message is one attachment to the reader, even though
  // BODYSTRUCTURE nests the entire message inside it.
  if (root.type === "message/rfc822") return [root];
  if (root.childNodes?.length) return root.childNodes.flatMap((child) => attachmentNodes(child));
  return isAttachment(root) ? [root] : [];
}

function isAttachment(node: MessageStructureObject): boolean {
  if (node.type.startsWith("multipart/")) return false;
  // A part with a Content-ID exists to be referenced from the body, and
  // mailparser has already embedded it — listing it again would offer a
  // download of the logo the reader is looking at. Only an explicit
  // "attachment" disposition overrules that, because plenty of servers report
  // no disposition at all and the Content-ID is then the honest signal.
  if (node.id && node.disposition !== "attachment") return false;
  return node.disposition === "attachment" || Boolean(filenameOf(node));
}

function filenameOf(node: MessageStructureObject): string {
  return (node.dispositionParameters?.filename ?? node.parameters?.name ?? "").trim();
}

function attachmentList(root: MessageStructureObject | undefined): MailAttachmentMeta[] {
  return attachmentNodes(root).map((node, index) => ({
    // The MIME part number: stable for the message, safe to put back into an
    // IMAP command, and never a sender-supplied filename.
    id: node.part ?? "1",
    filename: filenameOf(node) || `attachment-${index + 1}`,
    size: decodedSize(node),
    contentType: node.type,
  }));
}

/** BODYSTRUCTURE reports the ENCODED octet count, and base64 inflates by 4/3 —
 *  reporting it raw would show a 3 MB photo as 4 MB. */
function decodedSize(node: MessageStructureObject): number {
  const size = node.size ?? 0;
  return node.encoding === "base64" ? Math.floor((size * 3) / 4) : size;
}

function addressOf(list: MessageAddressObject[] | undefined): MailAddress {
  const first = list?.[0];
  return { name: (first?.name ?? "").trim(), address: (first?.address ?? "").trim() };
}

function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
  const groups = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const group of groups) {
    for (const entry of group.value) {
      const address = (entry.address ?? "").trim();
      const name = (entry.name ?? "").trim();
      if (!address && !name) continue;
      out.push(name && address ? `${name} <${address}>` : address || name);
    }
  }
  return out;
}

function referenceList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function isoDate(value: Date | string | undefined): string {
  if (value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * Body parts arrive exactly as they sit in the message: still transfer-encoded
 * and still in the sender's charset. A partial read can also cut a base64
 * group or a multi-byte character in half — both decode to a trailing U+FFFD
 * that previewText drops.
 */
function decodePart(raw: Buffer, encoding: string, charset: string): string {
  if (raw.length === 0) return "";
  let bytes = raw;
  if (encoding === "base64") bytes = Buffer.from(raw.toString("ascii"), "base64");
  else if (encoding === "quoted-printable") bytes = decodeQuotedPrintable(raw.toString("latin1"));
  return decodeCharset(bytes, charset);
}

function decodeQuotedPrintable(text: string): Buffer {
  // Soft line breaks first: "=\r\n" is a wrap, not an escape.
  const joined = text.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    if (joined[i] === "=" && /^[0-9a-f]{2}$/i.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    out.push(joined.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/** Polish mail is still sent as iso-8859-2 and windows-1250, which Buffer
 *  cannot decode — TextDecoder can, and throws on a label it does not know
 *  rather than returning mojibake, which is why the fallback is explicit. */
function decodeCharset(bytes: Buffer, charset: string): string {
  const label = charset.trim() || "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

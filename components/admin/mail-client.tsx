"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Forward, ImageOff, Mail, MailOpen, Paperclip, Pencil,
  RefreshCw, Reply, ReplyAll, RotateCw, Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  deleteMessageAction, getMessageAction, listFoldersAction, listMessagesAction,
  setSeenAction, syncNowAction,
} from "@/app/actions/mail";
import type { MailFolder, MailListItem, MailMessage } from "@/lib/server/imap";
import {
  MailCompose, emptyDraft, forwardDraft, mailErrorKey, replyDraft, type MailDraft,
} from "@/components/admin/mail-compose";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Label, Select } from "@/components/ui/input";
import { RowAction } from "@/components/ui/record";
import { cn, formatBytes } from "@/lib/utils";

/**
 * SKRZYNKA — the mailbox, read live.
 *
 * Nothing on this screen is cached or pre-rendered: every pane asks the server
 * actions, which open one IMAP connection each. That is why the folder rail,
 * the list and the reader are three separate loads rather than one page
 * payload — a mailbox with fifty thousand messages must never become a render.
 *
 * The body of a message is injected with dangerouslySetInnerHTML because that
 * is the only way to show an e-mail at all. It is safe for exactly one reason:
 * lib/server/mail-html.ts already ran it through an allowlist on the server.
 * No other string on this screen is ever treated as markup.
 *
 * Layout is two designs, not one responsive grid. On a wide screen the three
 * panes scroll independently inside the admin content width; on a phone one
 * pane is visible at a time and opening a message replaces the list, which is
 * the only shape that leaves a mail row a comfortable tap target.
 */

const PAGE_SIZE = 25;
const INBOX = "INBOX";

/** RFC 6154 special-use flags — the portable way to recognise a folder whose
 *  name is localised or nested under a prefix. */
const FOLDER_KEYS_BY_SPECIAL_USE: Record<string, string> = {
  "\\Inbox": "comm.inbox",
  "\\Sent": "comm.sent",
  "\\Trash": "comm.trash",
  "\\Drafts": "comm.drafts",
  "\\Junk": "comm.spam",
  "\\Archive": "comm.archive",
};

/** Servers that predate SPECIAL-USE only give us a name, and this mailbox is
 *  Polish — so both spellings have to be recognised. */
const FOLDER_KEYS_BY_NAME: Record<string, string> = {
  "inbox": "comm.inbox",
  "odebrane": "comm.inbox",
  "sent": "comm.sent",
  "sent items": "comm.sent",
  "sent messages": "comm.sent",
  "wysłane": "comm.sent",
  "elementy wysłane": "comm.sent",
  "trash": "comm.trash",
  "deleted items": "comm.trash",
  "kosz": "comm.trash",
  "drafts": "comm.drafts",
  "kopie robocze": "comm.drafts",
  "junk": "comm.spam",
  "spam": "comm.spam",
  "archive": "comm.archive",
  "archiwum": "comm.archive",
};

/** Reading order, not alphabet: Odebrane first, Kosz last, everything the
 *  server invented in between. */
const FOLDER_RANK: Record<string, number> = {
  "comm.inbox": 0,
  "comm.sent": 1,
  "comm.drafts": 2,
  "comm.archive": 3,
  "comm.spam": 4,
  "comm.trash": 5,
};

function folderKey(folder: MailFolder): string | undefined {
  const bySpecialUse = folder.specialUse ? FOLDER_KEYS_BY_SPECIAL_USE[folder.specialUse] : undefined;
  return bySpecialUse ?? FOLDER_KEYS_BY_NAME[folder.name.trim().toLowerCase()];
}

function folderLabel(folder: MailFolder, t: (key: string) => string): string {
  const key = folderKey(folder);
  return key ? t(key) : folder.name;
}

function sortFolders(folders: MailFolder[]): MailFolder[] {
  return [...folders].sort((a, b) => {
    const rankA = FOLDER_RANK[folderKey(a) ?? ""] ?? 9;
    const rankB = FOLDER_RANK[folderKey(b) ?? ""] ?? 9;
    return rankA === rankB ? a.path.localeCompare(b.path) : rankA - rankB;
  });
}

function intlTag(locale: string): string {
  return locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB";
}

/** A list row shows the time for today's mail and the date for everything
 *  older — the same shorthand every mail client uses, because in a list the
 *  full stamp is noise. */
function listDate(iso: string, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(
    intlTag(locale),
    today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short" },
  ).format(date);
}

function fullDate(iso: string, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlTag(locale), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** A display name when the sender sent one, the address otherwise — never an
 *  empty cell, because a row with no sender reads as a broken list. */
function senderLabel(item: MailListItem): string {
  return item.from.name.trim() || item.from.address.trim() || "—";
}

/** The download route re-checks the admin role itself; these parameters only
 *  have to survive being put into a query string. */
function attachmentHref(folder: string, uid: number, id: string): string {
  return `/api/admin/mail/attachment?folder=${encodeURIComponent(folder)}&uid=${uid}&id=${encodeURIComponent(id)}`;
}

export function MailClient({ address }: {
  /** The mailbox this panel reads, so "reply all" can leave it out of the copy
   *  line instead of mailing the shop back into its own inbox. */
  address: string;
}) {
  const { t, locale } = useI18n();

  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folder, setFolder] = useState(INBOX);
  const [items, setItems] = useState<MailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  /** What is typed, and what was actually submitted: a SEARCH is a round trip
   *  to the mail server, so it happens on Enter and not on every keystroke. */
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [openUid, setOpenUid] = useState<number | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [readerBusy, setReaderBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [draft, setDraft] = useState<MailDraft | null>(null);

  /** Switching folder or searching while a slower request is in flight must not
   *  let the old answer overwrite the new one. */
  const listRequest = useRef(0);
  const readerRequest = useRef(0);

  const fail = useCallback((code: string | undefined) => {
    toast.error(t(mailErrorKey(code, "imap")));
  }, [t]);

  const loadFolders = useCallback(async () => {
    const res = await listFoldersAction();
    if (!res.ok) {
      fail(res.error);
      return;
    }
    setFolders(sortFolders(res.folders));
  }, [fail]);

  const loadList = useCallback(async () => {
    const id = ++listRequest.current;
    setListBusy(true);
    const res = await listMessagesAction({ folder, limit: PAGE_SIZE, search: query, unreadOnly });
    // A newer request owns the pane — and the busy flag with it.
    if (id !== listRequest.current) return;
    setListBusy(false);
    if (!res.ok) {
      setItems([]);
      setTotal(0);
      fail(res.error);
      return;
    }
    setItems(res.items);
    setTotal(res.total);
  }, [fail, folder, query, unreadOnly]);

  useEffect(() => { void loadFolders(); }, [loadFolders]);
  useEffect(() => { void loadList(); }, [loadList]);

  /** The rail's unread badge came from one LIST; keeping it in step locally is
   *  cheaper and calmer than re-listing every folder after a single click. */
  function bumpUnseen(delta: number) {
    setFolders((prev) => prev.map((entry) => (
      entry.path === folder && entry.unseen !== null
        ? { ...entry, unseen: Math.max(0, entry.unseen + delta) }
        : entry
    )));
  }

  function closeReader() {
    // Bump the counter so a reply from the request we are abandoning is dropped
    // instead of re-opening the pane the admin just closed.
    readerRequest.current += 1;
    setOpenUid(null);
    setMessage(null);
    setReaderBusy(false);
  }

  function changeFolder(next: string) {
    if (next === folder) return;
    closeReader();
    setFolder(next);
  }

  const openMessage = useCallback(async (uid: number, allowRemoteImages: boolean) => {
    const id = ++readerRequest.current;
    setOpenUid(uid);
    setMessage(null);
    setReaderBusy(true);
    const res = await getMessageAction({ folder, uid, allowRemoteImages });
    if (id !== readerRequest.current) return;
    setReaderBusy(false);
    if (!res.ok) {
      fail(res.error);
      return;
    }
    setMessage(res.message);
  }, [fail, folder]);

  /**
   * `was` is the flag the row currently carries. Passing it in means the local
   * unread count is only ever adjusted when the message really changed state —
   * clicking "mark as read" twice cannot drive the badge below the truth.
   */
  async function applySeen(uid: number, seen: boolean, was: boolean, silent = false) {
    if (was === seen) return;
    setActionBusy(true);
    const res = await setSeenAction({ folder, uid, seen });
    setActionBusy(false);
    if (!res.ok) {
      // Auto-marking on open is a side effect of reading, not something the
      // admin asked for: it fails quietly rather than throwing a toast at them.
      if (!silent) fail(res.error);
      return;
    }
    setItems((prev) => prev.map((entry) => (entry.uid === uid ? { ...entry, seen } : entry)));
    bumpUnseen(seen ? -1 : 1);
  }

  function select(item: MailListItem) {
    void openMessage(item.uid, false);
    // Opening a message is what marks it read in every mail client; getMessage
    // itself opens the folder read-only precisely so this stays a choice.
    if (!item.seen) void applySeen(item.uid, true, false, true);
  }

  async function remove(uid: number) {
    const row = items.find((entry) => entry.uid === uid);
    setActionBusy(true);
    const res = await deleteMessageAction({ folder, uid });
    setActionBusy(false);
    if (!res.ok) {
      fail(res.error);
      return;
    }
    toast.success(t("comm.deleted"));
    setItems((prev) => prev.filter((entry) => entry.uid !== uid));
    setTotal((prev) => Math.max(0, prev - 1));
    if (row && !row.seen) bumpUnseen(-1);
    closeReader();
    // Two folders changed size, so the rail is refreshed rather than guessed at.
    void loadFolders();
  }

  async function loadMore() {
    if (items.length === 0) return;
    const oldest = items.reduce((min, entry) => Math.min(min, entry.uid), items[0].uid);
    const id = listRequest.current;
    setMoreBusy(true);
    const res = await listMessagesAction({
      folder, limit: PAGE_SIZE, before: oldest, search: query, unreadOnly,
    });
    if (id !== listRequest.current) return;
    setMoreBusy(false);
    if (!res.ok) {
      fail(res.error);
      return;
    }
    // The cursor is a UID, so a page cannot overlap the one before it — but a
    // message deleted between the two requests can still shift the totals.
    setItems((prev) => [...prev, ...res.items]);
  }

  async function sync() {
    setSyncing(true);
    const res = await syncNowAction();
    setSyncing(false);
    if (!res.ok) {
      fail(res.error);
      return;
    }
    toast.success(t("comm.syncDone"));
    await Promise.all([loadList(), loadFolders()]);
  }

  function refresh() {
    void loadList();
    void loadFolders();
  }

  const busy = listBusy || readerBusy || actionBusy || syncing;
  const openRow = openUid === null ? null : items.find((entry) => entry.uid === openUid) ?? null;

  const reader = (
    <Reader
      folder={folder}
      message={message}
      busy={readerBusy}
      seen={openRow?.seen ?? true}
      disabled={actionBusy}
      locale={locale}
      t={t}
      onBack={closeReader}
      onShowImages={() => { if (openUid !== null) void openMessage(openUid, true); }}
      onReply={(all) => { if (message) setDraft(replyDraft(message, address, all)); }}
      onForward={() => { if (message) setDraft(forwardDraft(message, t)); }}
      onToggleSeen={() => {
        if (openRow) void applySeen(openRow.uid, !openRow.seen, openRow.seen);
      }}
      onDelete={() => { if (openUid !== null) void remove(openUid); }}
    />
  );

  const list = (
    <MessageList
      items={items}
      openUid={openUid}
      busy={listBusy}
      moreBusy={moreBusy}
      hasMore={items.length < total}
      locale={locale}
      t={t}
      onSelect={select}
      onLoadMore={() => { void loadMore(); }}
    />
  );

  return (
    <div data-mail-client>
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setDraft(emptyDraft())} data-mail-compose-open>
            <Pencil size={14} aria-hidden />
            {t("comm.compose")}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={refresh}>
            <RefreshCw size={14} aria-hidden className={cn(listBusy && "animate-spin")} />
            {t("comm.refresh")}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void sync(); }}>
            <RotateCw size={14} aria-hidden className={cn(syncing && "animate-spin")} />
            {t("comm.syncNow")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            className="min-w-0 flex-1 sm:max-w-sm"
            onSubmit={(e) => { e.preventDefault(); setQuery(term.trim()); }}
          >
            <Input
              type="search"
              value={term}
              placeholder={t("comm.search")}
              aria-label={t("comm.search")}
              onChange={(e) => setTerm(e.target.value)}
              // A cleared box returns to the unfiltered folder without waiting
              // for an Enter the admin has no reason to press.
              onBlur={() => { if (!term.trim() && query) setQuery(""); }}
            />
          </form>
          <Chip active={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)}>
            {t("comm.unread")}
          </Chip>
        </div>
      </div>

      {/* Desktop: folders | list | body, each pane scrolling on its own inside a
          height derived from the viewport so the page itself never scrolls.
          The split engages at xl, not lg: the admin rail is a hard 208px plus
          48px of page padding, and the two fixed tracks eat another 616px, so
          at 1024px the body pane would be a ~112px text column. */}
      <div className="hidden xl:grid xl:h-[calc(100dvh-19rem)] xl:min-h-[26rem] xl:grid-cols-[13.5rem_23rem_minmax(0,1fr)] xl:gap-4">
        <Card className="min-h-0 overflow-hidden">
          <nav className="thin-scroll h-full overflow-y-auto p-2" aria-label={t("comm.folders")}>
            <ul className="space-y-0.5">
              {folders.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => changeFolder(entry.path)}
                    aria-current={entry.path === folder ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
                      entry.path === folder
                        ? "bg-accent-soft/60 font-semibold text-accent"
                        : "font-medium text-muted hover:bg-raised hover:text-ink",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{folderLabel(entry, t)}</span>
                    {entry.unseen !== null && entry.unseen > 0 && (
                      <span className="shrink-0 rounded-full bg-[rgb(var(--faint)/0.18)] px-1.5 text-[10px] font-semibold tabular-nums">
                        {entry.unseen}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <div className="thin-scroll h-full overflow-y-auto">{list}</div>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <div className="thin-scroll h-full overflow-y-auto">
            {openUid === null
              ? <Placeholder text={t("comm.selectMessage")} />
              : reader}
          </div>
        </Card>
      </div>

      {/* Phone and narrow laptop: one pane at a time. The admin layout's main
          element already carries the dock-clearing bottom padding, so these
          panes stay in the page flow instead of paying for it twice. */}
      <div className="xl:hidden">
        {openUid === null ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="mail-folder">{t("comm.folders")}</Label>
              <Select id="mail-folder" value={folder} onChange={(e) => changeFolder(e.target.value)}>
                {folders.length === 0 && <option value={folder}>{t("comm.inbox")}</option>}
                {folders.map((entry) => (
                  <option key={entry.path} value={entry.path}>
                    {folderLabel(entry, t)}
                    {entry.unseen !== null && entry.unseen > 0 ? ` (${entry.unseen})` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <Card className="overflow-hidden">{list}</Card>
          </div>
        ) : (
          <Card className="overflow-hidden">{reader}</Card>
        )}
      </div>

      <MailCompose
        draft={draft}
        onClose={() => setDraft(null)}
        onSent={() => { setDraft(null); refresh(); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- panes */

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center px-6 py-10 text-center">
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

type ListProps = {
  items: MailListItem[];
  openUid: number | null;
  busy: boolean;
  moreBusy: boolean;
  hasMore: boolean;
  locale: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onSelect: (item: MailListItem) => void;
  onLoadMore: () => void;
};

function MessageList({ items, openUid, busy, moreBusy, hasMore, locale, t, onSelect, onLoadMore }: ListProps) {
  if (items.length === 0) {
    return <Placeholder text={busy ? t("common.loading") : t("comm.noMessages")} />;
  }
  return (
    <>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.uid}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              aria-current={item.uid === openUid ? "true" : undefined}
              className={cn(
                "flex w-full min-h-[64px] items-start gap-2.5 px-3.5 py-3 text-left transition-colors sm:px-4",
                item.uid === openUid ? "bg-accent-soft/40" : "hover:bg-raised/50",
              )}
            >
              {/* The unread marker keeps its column whether or not it is lit, so
                  the rows below it do not shift by a dot's width. */}
              <span aria-hidden className="mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
                {!item.seen && <span className="h-2 w-2 rounded-full bg-accent" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", item.seen ? "font-medium text-muted" : "font-semibold text-ink")}>
                    {senderLabel(item)}
                  </span>
                  {item.hasAttachments && <Paperclip size={12} aria-hidden className="shrink-0 text-faint" />}
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{listDate(item.date, locale)}</span>
                </span>
                {/* An em dash rather than a sentence: a message with no subject
                    needs a placeholder glyph, not a translated apology. */}
                <span className={cn("mt-0.5 block truncate text-[13px]", item.seen ? "text-muted" : "font-semibold text-ink")}>
                  {item.subject || "—"}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-faint">{item.preview}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="border-t border-line p-3">
          <Button size="sm" variant="secondary" className="w-full" disabled={moreBusy} onClick={onLoadMore}>
            {moreBusy ? t("common.loading") : t("comm.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

type ReaderProps = {
  folder: string;
  message: MailMessage | null;
  busy: boolean;
  seen: boolean;
  disabled: boolean;
  locale: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onBack: () => void;
  onShowImages: () => void;
  onReply: (all: boolean) => void;
  onForward: () => void;
  onToggleSeen: () => void;
  onDelete: () => void;
};

function Reader({
  folder, message, busy, seen, disabled, locale, t,
  onBack, onShowImages, onReply, onForward, onToggleSeen, onDelete,
}: ReaderProps) {
  // Below xl the reader IS the pane — the folder picker and the list are hidden
  // while a uid is open — so the way back has to survive a load that is still
  // running or that failed. Without it a refused IMAP connection strands the
  // admin on a blank pane with no control that can clear the open uid.
  if (!message) {
    return (
      <>
        <div className="flex items-center gap-2 px-4 pt-3.5 sm:px-5 xl:hidden">
          <RowAction icon={ArrowLeft} label={t("comm.back")} onClick={onBack} />
        </div>
        <Placeholder text={busy ? t("common.loading") : t("comm.selectMessage")} />
      </>
    );
  }

  return (
    <article className="min-w-0">
      <header className="border-b border-line px-4 py-3.5 sm:px-5">
        <div className="mb-3 flex items-center gap-2 xl:hidden">
          <RowAction icon={ArrowLeft} label={t("comm.back")} onClick={onBack} />
        </div>
        <h2 className="break-words text-[15px] font-semibold leading-snug tracking-tight">
          {message.subject || "—"}
        </h2>
        <dl className="mt-2.5 space-y-1 text-[12.5px]">
          <Row label={t("comm.from")} value={message.from.name
            ? `${message.from.name} <${message.from.address}>`
            : message.from.address} />
          {message.to.length > 0 && <Row label={t("comm.to")} value={message.to.join(", ")} />}
          {message.cc.length > 0 && <Row label={t("comm.cc")} value={message.cc.join(", ")} />}
          <Row label={t("comm.date")} value={fullDate(message.date, locale)} />
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-1">
          <RowAction icon={Reply} label={t("comm.reply")} disabled={disabled} onClick={() => onReply(false)} />
          <RowAction icon={ReplyAll} label={t("comm.replyAll")} disabled={disabled} onClick={() => onReply(true)} />
          <RowAction icon={Forward} label={t("comm.forward")} disabled={disabled} onClick={onForward} />
          <RowAction
            icon={seen ? Mail : MailOpen}
            label={seen ? t("comm.markUnread") : t("comm.markRead")}
            disabled={disabled}
            onClick={onToggleSeen}
          />
          <RowAction icon={Trash2} label={t("comm.delete")} tone="danger" disabled={disabled} onClick={onDelete} />
        </div>
      </header>

      {message.blockedImages > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunken/50 px-4 py-2.5 sm:px-5">
          <ImageOff size={13} aria-hidden className="text-faint" />
          <span className="text-[12px] text-muted">
            {t("comm.imagesBlocked", { count: message.blockedImages })}
          </span>
          <button
            type="button"
            onClick={onShowImages}
            disabled={busy}
            className="text-[12px] font-semibold text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {t("comm.showImages")}
          </button>
        </div>
      )}

      <div className="px-4 py-4 sm:px-5">
        {message.html ? (
          // Sanitized on the server by lib/server/mail-html.ts — the only string
          // on this screen allowed to be markup. The wrapper bounds it: a mail
          // laid out for a 900px table scrolls inside this box instead of
          // widening the admin page.
          //
          // It also gives the mail its own light canvas rather than inheriting
          // the app theme. Mail is authored for white: the sanitizer drops the
          // <body> tag and the `background` shorthand that carried the sender's
          // own white, so on the dark panel a newsletter's `color:#333` would be
          // black on near-black. Background AND text colour are both pinned —
          // fixing only the background would leave --ink's near-white text
          // invisible for mails that set no colour at all — and the link and
          // quote-rule colours are literals because their tokens flip with the
          // theme and the dark values do not read on white.
          <div
            className="thin-scroll max-w-full overflow-x-auto rounded-lg bg-white p-3 text-[13.5px] leading-relaxed text-[#20162d] [color-scheme:light] [&_a]:text-[#b000ac] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#d2c6e8] [&_blockquote]:pl-3 [&_img]:h-auto [&_img]:max-w-full [&_table]:max-w-full"
            dangerouslySetInnerHTML={{ __html: message.html }}
          />
        ) : (
          <pre className="thin-scroll whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-ink">
            {message.text}
          </pre>
        )}
      </div>

      {message.attachments.length > 0 && (
        <section className="border-t border-line px-4 py-3.5 sm:px-5">
          <p className="overline mb-2">{t("comm.attachments")}</p>
          <ul className="space-y-1.5">
            {message.attachments.map((file) => (
              <li key={file.id}>
                <a
                  href={attachmentHref(folder, message.uid, file.id)}
                  className="flex items-center gap-2 rounded-xl bg-sunken/60 px-3 py-2.5 text-[13px] transition-colors hover:bg-raised"
                >
                  <Paperclip size={13} aria-hidden className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatBytes(file.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** One header line of the reader. A recipient list is long and holds no spaces
 *  to break at, so the value wraps inside itself rather than pushing the pane
 *  sideways — the one thing this layout must never do. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-faint">{label}:</dt>
      <dd className="min-w-0 break-words text-muted">{value}</dd>
    </div>
  );
}

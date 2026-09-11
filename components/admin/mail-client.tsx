"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/notify";
import {
  ArrowLeft, Forward, ImageOff, Mail, MailOpen, Paperclip, Pencil,
  RefreshCw, Reply, ReplyAll, RotateCw, Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  deleteMessageAction, getMessageAction, listFoldersAction, listMessagesAction,
  openMailboxAction, setSeenAction, syncNowAction,
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

/** One cache entry per thing the admin can be looking at. Search text and the
 *  unread filter change WHICH messages a folder returns, so they are part of
 *  the identity of the view — a cached inbox must never be shown for a search
 *  that has not run yet. */
function viewKey(folder: string, query: string, unreadOnly: boolean): string {
  return `${folder}\u0000${query}\u0000${unreadOnly ? "1" : "0"}`;
}

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
  /** The last page seen for each folder/search/filter combination, so going
   *  back to one paints immediately instead of opening a new IMAP connection
   *  and showing an empty pane while it does. Held in a ref rather than state:
   *  writing to it must never itself cause a render. It lives for as long as
   *  the screen does — a mailbox is not a cache that should outlive the tab. */
  const pages = useRef(new Map<string, { items: MailListItem[]; total: number }>());
  /** How many pages deep the admin has scrolled in the CURRENT view. Refresh
   *  re-asks for that depth in one command instead of the first 25, so hitting
   *  Odśwież after paging through four screens no longer throws three of them
   *  away and scrolls the reader back to the top. */
  const depth = useRef(1);

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

  const loadList = useCallback(async (keepPages = 1) => {
    const id = ++listRequest.current;
    const key = viewKey(folder, query, unreadOnly);
    // STALE WHILE REVALIDATE. Every server action here opens its own IMAP
    // connection, so stepping back into a folder used to mean staring at an
    // empty pane for as long as a fresh login and a FETCH take — for a list the
    // admin was looking at ten seconds ago. Painting the cached page first
    // makes the folder switch feel instant; the request still goes out, and
    // whatever it returns replaces what is on screen.
    const cached = pages.current.get(key);
    if (cached) {
      setItems(cached.items);
      setTotal(cached.total);
    }
    // Revalidate at the depth the admin actually has open. Without this,
    // returning to a folder they had paged through four times painted the
    // cached 100 rows and then snapped back to 25 a second later. The server
    // clamps at MAX_LIMIT (lib/server/imap.ts) and one FETCH of 100 costs the
    // same round trip as one of 25, so restoring depth is free.
    const keep = cached ? Math.ceil(cached.items.length / PAGE_SIZE) : keepPages;
    const want = Math.min(100, PAGE_SIZE * Math.max(1, keep));
    // The skeleton belongs to a pane with nothing in it. With a cached page
    // showing, a spinner over real rows is just noise.
    setListBusy(!cached);
    const res = await listMessagesAction({ folder, limit: want, search: query, unreadOnly });
    // A newer request owns the pane — and the busy flag with it.
    if (id !== listRequest.current) return;
    setListBusy(false);
    if (!res.ok) {
      // A failed revalidation must not leave a stale page looking live: the
      // cache entry goes with it, so the next visit re-asks instead of showing
      // messages that may no longer be there.
      pages.current.delete(key);
      setItems([]);
      setTotal(0);
      fail(res.error);
      return;
    }
    pages.current.set(key, { items: res.items, total: res.total });
    depth.current = Math.max(1, Math.ceil(res.items.length / PAGE_SIZE));
    setItems(res.items);
    setTotal(res.total);
  }, [fail, folder, query, unreadOnly]);

  /**
   * FIRST PAINT IS ONE REQUEST, NOT TWO.
   *
   * The rail and the first page used to be two effects calling two actions,
   * and each action opens its own IMAP connection — so the screen paid two
   * full logins before showing a row. `openMailboxAction` does both on one
   * connection. Everything after this (folder switches, paging, refresh)
   * keeps using the separate actions, because by then only one of the two is
   * actually out of date.
   */
  const opened = useRef(false);
  /** Consumed once by the list effect below, so the opening request is not
   *  immediately duplicated. A ref rather than a condition on folder/query:
   *  the admin can navigate back to an unfiltered INBOX later, and that visit
   *  MUST re-run loadList — otherwise the pane keeps showing whichever folder
   *  they came from. */
  const primed = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    primed.current = true;
    void (async () => {
      const id = ++listRequest.current;
      setListBusy(true);
      const res = await openMailboxAction({ folder: INBOX, limit: PAGE_SIZE });
      setListBusy(false);
      if (!res.ok) {
        fail(res.error);
        return;
      }
      // THE RAIL IS APPLIED BEFORE THE RACE GUARD, deliberately. It is not part
      // of the list race: the folder list is the same whichever folder is
      // selected. Behind the guard it was lost for good whenever the admin
      // clicked a folder during the 1-3s opening request — and since this is
      // now the only thing that fetches the rail on load, "lost" meant an empty
      // folder column until a delete happened to refresh it.
      setFolders(sortFolders(res.folders));
      if (res.foldersError) fail(res.foldersError);
      if (id !== listRequest.current) return;
      pages.current.set(viewKey(INBOX, "", false), { items: res.items, total: res.total });
      depth.current = 1;
      setItems(res.items);
      setTotal(res.total);
    })();
    // Deliberately mount-only: this is the opening shot. Later changes to
    // folder/search/filter are the other effect's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The opening request already fetched this exact view; skip once, then
    // behave normally for every folder switch, search and filter change.
    if (primed.current) {
      primed.current = false;
      return;
    }
    void loadList();
  }, [loadList]);

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
    // The unread filter selects on exactly the flag that just changed, so every
    // cached view of this mailbox is now potentially wrong. Cheaper to forget
    // them than to reason about which ones survived.
    pages.current.clear();
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
    // The message left this folder and arrived in Kosz, so both cached views
    // are stale. Same reasoning as applySeen: forget, do not patch.
    pages.current.clear();
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
    // Clear the flag BEFORE the staleness check, not after. When the admin
    // switched folder mid-request the old code returned on the guard below
    // with moreBusy still true, and nothing else ever set it back — so
    // "Wczytaj starsze" stayed disabled for the rest of the session. Unlike
    // listBusy, which a newer loadList immediately re-owns, this flag has
    // exactly one writer.
    setMoreBusy(false);
    if (id !== listRequest.current) return;
    if (!res.ok) {
      fail(res.error);
      return;
    }
    // The cursor is a UID, so a page cannot overlap the one before it — but a
    // message deleted between the two requests can still shift the totals.
    setItems((prev) => {
      const next = [...prev, ...res.items];
      // The cache holds what the pane holds, so coming back to a folder the
      // admin had already paged through returns them to where they were rather
      // than to the first 25.
      pages.current.set(viewKey(folder, query, unreadOnly), { items: next, total });
      depth.current = Math.max(1, Math.ceil(next.length / PAGE_SIZE));
      return next;
    });
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
    await Promise.all([loadList(depth.current), loadFolders()]);
  }

  function refresh() {
    // Same view, same depth — re-read what is on screen rather than collapsing
    // it back to the first page.
    void loadList(depth.current);
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
        onSent={() => {
            setDraft(null);
            // Sending appends a copy to Wysłane, so every cached view of this
            // mailbox is now one message out of date — same reasoning as
            // applySeen and remove.
            pages.current.clear();
            refresh();
          }}
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

/**
 * The list's own loading state, in the SHAPE of the list.
 *
 * An empty pane holding the word "Ładowanie…" tells the admin nothing except
 * that something is wrong somewhere, and on a phone it reads as a broken
 * screen. Rows of the right height say "messages are coming, here is where
 * they will be" and keep the pane from jumping when they arrive.
 */
function ListSkeleton() {
  return (
    <ul className="divide-y divide-line" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <li key={i} className="flex min-h-[64px] items-start gap-2.5 px-3.5 py-3 sm:px-4">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--faint)/0.18)]" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="flex items-center gap-2">
              {/* Staggered widths so it reads as a list of different senders
                  rather than a loading bar pretending to be one. */}
              <span className="skeleton block h-3 rounded" style={{ width: `${38 + ((i * 13) % 26)}%` }} />
              <span className="skeleton ml-auto block h-2.5 w-10 rounded" />
            </span>
            <span className="skeleton block h-3 rounded" style={{ width: `${52 + ((i * 17) % 30)}%` }} />
            <span className="skeleton block h-2.5 rounded" style={{ width: `${60 + ((i * 11) % 25)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function MessageList({ items, openUid, busy, moreBusy, hasMore, locale, t, onSelect, onLoadMore }: ListProps) {
  if (items.length === 0) {
    return busy ? <ListSkeleton /> : <Placeholder text={t("comm.noMessages")} />;
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

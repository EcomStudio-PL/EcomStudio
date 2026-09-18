"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Ban, Download, FolderMinus, FolderPlus, Plus, Upload, Users,
} from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveBlob, stamp } from "@/lib/save-image";
import { formatDate, formatInstantShort } from "@/lib/utils";
import { LOCALES } from "@/lib/newsletter";
import type { ContactFilter, ContactRow } from "@/lib/services/newsletter";
import {
  bulkAddToGroupAction, bulkBlockContactsAction, bulkRemoveFromGroupAction,
  createContactAction, exportContactsCsvAction,
} from "@/app/actions/newsletter";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { ImportDialog } from "@/components/admin/newsletter/import-dialog";

/**
 * THE CONTACT LIST.
 *
 * A table from `lg` up and a stack of cards below it — `AdminTable` owns that
 * switch, so this screen reads the same way as the waitlist and the CRM instead
 * of inventing a third responsive table. At 320px nothing forces the page
 * sideways: the filters stack, the action buttons wrap, and the cards put the
 * address on its own line with the rest paired underneath.
 *
 * WHY THE FILTER ROW IS WRITTEN HERE RATHER THAN WITH `FilterBar`. Two things
 * this screen needs that the shared bar cannot do: changing a filter has to
 * RESET THE PAGE (page 4 of a different filter is almost always empty, and an
 * operator who lands there thinks the filter found nothing), and it has to CLEAR
 * THE SELECTION (the ticked rows are no longer on screen, and a bulk block
 * aimed at rows nobody can see is the worst bug this screen could have).
 * `components/admin/waitlist-manager.tsx` made the same call for the same
 * reason.
 *
 * SELECTION IS THIS PAGE'S ROWS AND NOBODY ELSE'S. It is deliberately not
 * carried across pagination: a "zaznacz wszystkie 4 281" that survives
 * navigation is a bulk block waiting to be misfired, and every bulk action here
 * is something an operator has to be able to see the extent of before pressing
 * it.
 */

type Option = { key: string; name: string };
type GroupOption = { id: string; name: string };

export function ContactList({ rows, total, page, pages, sources, groups, groupsByContact }: {
  rows: ContactRow[];
  total: number;
  page: number;
  pages: number;
  sources: Option[];
  /** Static groups only — a segment has no membership rows to add to. */
  groups: GroupOption[];
  /** contact id → group ids, for the "Grupy" column. */
  groupsByContact: Record<string, string[]>;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(params.get("q") ?? "");
  const [bulkGroup, setBulkGroup] = useState("");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  /** The filter the server is currently answering, rebuilt from the URL so the
   *  export cannot disagree with the list on screen. */
  const currentFilter: ContactFilter = {
    search: params.get("q") ?? undefined,
    sourceKey: params.get("source") ?? undefined,
    groupId: params.get("group") ?? undefined,
    consent: params.get("consent") ?? undefined,
    locale: params.get("locale") ?? undefined,
  };
  const activeFilters =
    ["q", "source", "group", "consent", "locale"].filter((key) => params.get(key)).length;

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (!("page" in patch)) next.delete("page");
    setSelected(new Set());
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const sourceName = new Map(sources.map((s) => [s.key, s.name]));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  /** One place where a failed action becomes a sentence. Every error a
   *  newsletter action returns is a key under `newsletter.err.*`. */
  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));

  function bulkGroupChange(op: "add" | "remove") {
    if (!bulkGroup || selected.size === 0) return;
    start(async () => {
      const input = { contactIds: [...selected], groupId: bulkGroup };
      const res = op === "add"
        ? await bulkAddToGroupAction(input)
        : await bulkRemoveFromGroupAction(input);
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.saved"));
      setSelected(new Set());
      router.refresh();
    });
  }

  function bulkBlock() {
    start(async () => {
      const res = await bulkBlockContactsAction({ contactIds: [...selected] });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.contacts.blockDone", { n: res.data?.blocked ?? 0 }));
      setSelected(new Set());
      setConfirmBlock(false);
      router.refresh();
    });
  }

  /**
   * The file is built on the server from the whole filtered set — or from
   * exactly the ticked rows — and the browser only turns text into a file.
   * `truncated` is surfaced as a warning rather than swallowed: a silently
   * short export is a file somebody will go on to treat as the complete list.
   */
  function exportCsv(ids?: string[]) {
    start(async () => {
      const res = await exportContactsCsvAction({ ...currentFilter, ids });
      if (!res.ok) { fail(res.error); return; }
      if (!res.data) return;
      await saveBlob(
        new Blob([res.data.csv], { type: "text/csv;charset=utf-8" }),
        `grovbase-kontakty-${stamp()}.csv`,
      );
      if (res.data.truncated) {
        toast.warning(t("newsletter.contacts.exportTruncated", { n: res.data.rows }));
      } else {
        toast.success(t("newsletter.contacts.exported", { n: res.data.rows }));
      }
    });
  }

  /** Consented, not consented, or gone — three states, each said in words as
   *  well as in colour, because "which of these may I mail" is the one question
   *  this list exists to answer. */
  function consentCell(contact: ContactRow) {
    if (contact.unsubscribedAt) {
      return <Badge tone="neutral" dot>{t("newsletter.consent.unsubscribed")}</Badge>;
    }
    return contact.marketingConsent
      ? <Badge tone="success" dot>{t("newsletter.consent.yes")}</Badge>
      : <Badge tone="warning" dot>{t("newsletter.consent.no")}</Badge>;
  }

  const headers = [
    "",
    t("newsletter.col.email"),
    t("newsletter.col.name"),
    t("newsletter.col.source"),
    t("newsletter.col.groups"),
    t("newsletter.col.consent"),
    t("newsletter.col.created"),
    t("newsletter.col.lastActivity"),
  ];

  const tableRows = rows.map((contact) => {
    const memberships = (groupsByContact[contact.id] ?? [])
      .map((id) => groupName.get(id))
      .filter((name): name is string => Boolean(name));
    return [
      <label key="pick" className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected.has(contact.id)}
          onChange={() => toggle(contact.id)}
          aria-label={contact.email}
          className="h-4 w-4 accent-[rgb(var(--accent))]"
        />
        <span className="sr-only">{contact.email}</span>
      </label>,
      <Link key="email" href={`/admin/newsletter/kontakty/${contact.id}`}
        className="break-all font-medium transition-colors hover:text-accent">
        {contact.email}
      </Link>,
      // Nothing in a card cell may refuse to wrap: at 320px the phone layout
      // puts these in a two-column grid, and one unbreakable string is the
      // whole page scrolling sideways.
      <span key="name">
        {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—"}
      </span>,
      <span key="source" className="text-muted">
        {sourceName.get(contact.sourceKey) ?? contact.sourceKey}
      </span>,
      <span key="groups" className="text-muted">
        {memberships.length > 0 ? memberships.join(", ") : t("newsletter.contact.noGroups")}
      </span>,
      consentCell(contact),
      <span key="created" className="text-muted">
        {formatDate(contact.createdAt, locale)}
      </span>,
      <span key="activity" className="text-muted">
        {contact.lastActivityAt ? formatInstantShort(contact.lastActivityAt, locale) : "—"}
      </span>,
    ];
  });

  return (
    <div data-contact-list className="space-y-4">
      {/* ── FILTERS ───────────────────────────────────────────────────────
          Stacked on a phone, one row from `sm` up. The search is a form so
          Enter submits it; the selects apply on change, because a select that
          needs a second click to take effect is a select people stop using. */}
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <form className="min-w-0 sm:w-64"
          onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() }); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t("newsletter.contacts.search")}
            aria-label={t("newsletter.contacts.search")} />
        </form>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Select value={params.get("source") ?? ""} aria-label={t("newsletter.filter.source")}
            className="sm:w-40" onChange={(e) => apply({ source: e.target.value })}>
            <option value="">{t("newsletter.filter.source")}</option>
            {sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </Select>

          <Select value={params.get("group") ?? ""} aria-label={t("newsletter.filter.group")}
            className="sm:w-40" onChange={(e) => apply({ group: e.target.value })}>
            <option value="">{t("newsletter.filter.group")}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>

          <Select value={params.get("consent") ?? ""} aria-label={t("newsletter.filter.consent")}
            className="sm:w-40" onChange={(e) => apply({ consent: e.target.value })}>
            <option value="">{t("newsletter.filter.consent")}</option>
            <option value="consented">{t("newsletter.consent.yes")}</option>
            <option value="no_consent">{t("newsletter.consent.no")}</option>
            <option value="unsubscribed">{t("newsletter.consent.unsubscribed")}</option>
          </Select>

          <Select value={params.get("locale") ?? ""} aria-label={t("newsletter.filter.locale")}
            className="sm:w-32" onChange={(e) => apply({ locale: e.target.value })}>
            <option value="">{t("newsletter.filter.locale")}</option>
            {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </Select>
        </div>

        {activeFilters > 0 && (
          <Button type="button" size="sm" variant="ghost" data-contact-clear
            onClick={() => { setQ(""); setSelected(new Set()); router.push(pathname); }}>
            ✕ {t("newsletter.filter.clear")} ({activeFilters})
          </Button>
        )}

        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button size="sm" data-contact-add onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden />{t("newsletter.contacts.add")}
          </Button>
          <Button size="sm" variant="secondary" data-contact-import onClick={() => setImporting(true)}>
            <Upload size={14} aria-hidden />{t("newsletter.contacts.import")}
          </Button>
          <Button size="sm" variant="secondary" data-contact-export
            disabled={pending || total === 0} onClick={() => exportCsv()}>
            <Download size={14} aria-hidden />{t("newsletter.contacts.export")}
          </Button>
        </div>
      </div>

      {/* ── BULK BAR ──────────────────────────────────────────────────────
          Only while something is ticked. Add/remove share one group select:
          two selects side by side is two chances to aim the wrong one. */}
      {selected.size > 0 && (
        <div data-contact-bulk className="panel rounded-2xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">
              {t("newsletter.contacts.selected")}: {selected.size}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("newsletter.contacts.clearSelection")}
            </Button>
          </div>
          <div className="mt-2.5 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Select value={bulkGroup} aria-label={t("newsletter.contacts.pickGroup")}
              className="sm:w-48" onChange={(e) => setBulkGroup(e.target.value)}>
              <option value="">{t("newsletter.contacts.pickGroup")}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            {/* One button per row on a phone. Two-up at 320px wraps a label
                like "Usuń z grupy" inside a fixed-height button, which puts
                the second line outside the button rather than inside it. */}
            <div className="grid gap-2 sm:flex">
              <Button size="sm" variant="secondary" disabled={pending || !bulkGroup}
                onClick={() => bulkGroupChange("add")}>
                <FolderPlus size={14} aria-hidden />{t("newsletter.contacts.addToGroup")}
              </Button>
              <Button size="sm" variant="secondary" disabled={pending || !bulkGroup}
                onClick={() => bulkGroupChange("remove")}>
                <FolderMinus size={14} aria-hidden />{t("newsletter.contacts.removeFromGroup")}
              </Button>
            </div>
            <div className="grid gap-2 sm:ml-auto sm:flex">
              <Button size="sm" variant="secondary" disabled={pending}
                onClick={() => exportCsv([...selected])}>
                <Download size={14} aria-hidden />{t("newsletter.contacts.export")}
              </Button>
              <Button size="sm" variant="danger" disabled={pending}
                onClick={() => setConfirmBlock(true)}>
                <Ban size={14} aria-hidden />{t("newsletter.contacts.block")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── THE LIST ──────────────────────────────────────────────────────
          An empty list and an empty FILTER are different situations and get
          different words: one is "there is nobody yet", the other is "nobody
          matches what you asked for", and only the first deserves a button. */}
      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={activeFilters > 0
            ? t("newsletter.contacts.noneFiltered") : t("newsletter.contacts.none")}
          action={activeFilters > 0 ? (
            <Button size="sm" variant="secondary"
              onClick={() => { setQ(""); router.push(pathname); }}>
              {t("newsletter.filter.clear")}
            </Button>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={14} aria-hidden />{t("newsletter.contacts.add")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
                <Upload size={14} aria-hidden />{t("newsletter.contacts.import")}
              </Button>
            </div>
          )}
        />
      ) : (
        <>
          <AdminTable primary={1} headers={headers} rows={tableRows}
            empty={t("newsletter.contacts.none")} />

          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
            <button type="button" disabled={rows.length === 0}
              onClick={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
              className="font-medium transition-colors hover:text-ink disabled:opacity-40">
              {allOnPage
                ? t("newsletter.contacts.clearSelection") : t("newsletter.contacts.selectPage")}
            </button>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">
                {t("common.pageOf", { a: page, b: pages })} · {total}
              </span>
              <Button size="sm" variant="ghost" disabled={page <= 1}
                onClick={() => apply({ page: String(page - 1) })}>‹</Button>
              <Button size="sm" variant="ghost" disabled={page >= pages}
                onClick={() => apply({ page: String(page + 1) })}>›</Button>
            </div>
          </div>
        </>
      )}

      <AddContactModal
        open={adding}
        onClose={() => setAdding(false)}
        sources={sources}
        groups={groups}
        onDone={() => { setAdding(false); router.refresh(); }}
      />

      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        sources={sources}
        groups={groups}
        onDone={() => { setImporting(false); router.refresh(); }}
      />

      <ConfirmModal
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        onConfirm={bulkBlock}
        title={t("newsletter.contacts.blockTitle")}
        body={t("newsletter.contacts.blockBody")}
        confirmLabel={t("newsletter.contacts.block")}
        danger
        pending={pending}
      />
    </div>
  );
}

/**
 * ADD ONE CONTACT BY HAND.
 *
 * THE CONSENT SWITCH IS AN ASSERTION, not a preference, and the form says so:
 * ticking it records a dated grant sourced to the panel and attributed to the
 * admin who did it. That is why the wording version sits next to it — a grant
 * with no record of WHICH text was on screen is a claim, not evidence.
 *
 * The address is validated here only so the operator hears about a typo before
 * the round trip. The rule that counts is the database's own check constraint,
 * and `createContactAction` answers with `err.email` either way.
 */
function AddContactModal({ open, onClose, sources, groups, onDone }: {
  open: boolean;
  onClose: () => void;
  sources: Option[];
  groups: GroupOption[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactLocale, setContactLocale] = useState("pl");
  const [sourceKey, setSourceKey] = useState("");
  const [tags, setTags] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentVersion, setConsentVersion] = useState("v1");
  const [groupId, setGroupId] = useState("");

  function reset() {
    setEmail(""); setFirstName(""); setLastName(""); setContactLocale("pl");
    setSourceKey(""); setTags(""); setConsent(false); setConsentVersion("v1"); setGroupId("");
  }

  function submit() {
    start(async () => {
      const res = await createContactAction({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        locale: contactLocale,
        sourceKey: sourceKey || undefined,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        marketingConsent: consent,
        consentVersion: consent ? consentVersion : null,
        groupIds: groupId ? [groupId] : [],
      });
      if (!res.ok) { toast.error(t(`newsletter.err.${res.error}`)); return; }
      // Created, but not mailable — and the operator hears why now rather than
      // wondering later why a contact they marked as consenting shows none.
      if (res.data?.suppressed) toast.warning(t("newsletter.contacts.addedSuppressed"));
      else toast.success(t("common.saved"));
      reset();
      onDone();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={t("newsletter.contacts.add")}>
      <div className="space-y-3">
        <div>
          <Label htmlFor="nl-email">{t("newsletter.col.email")}</Label>
          <Input id="nl-email" type="email" inputMode="email" autoComplete="off"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="nl-first">{t("newsletter.col.name")}</Label>
            <Input id="nl-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="nl-last">{t("newsletter.contact.lastName")}</Label>
            <Input id="nl-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="nl-locale">{t("newsletter.col.locale")}</Label>
            <Select id="nl-locale" value={contactLocale}
              onChange={(e) => setContactLocale(e.target.value)}>
              {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="nl-source">{t("newsletter.filter.source")}</Label>
            <Select id="nl-source" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
              <option value="">—</option>
              {sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="nl-tags" hint={t("newsletter.contact.tagsHint")}>
            {t("newsletter.contact.tags")}
          </Label>
          <Input id="nl-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        {groups.length > 0 && (
          <div>
            <Label htmlFor="nl-group">{t("newsletter.filter.group")}</Label>
            <Select id="nl-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">—</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </div>
        )}

        <div className="plate rounded-xl p-3">
          <label className="flex items-start gap-2.5 text-[13px] font-semibold">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
            {t("newsletter.contact.consentGrant")}
          </label>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            {t("newsletter.contact.consentGrantHint")}
          </p>
          {consent && (
            <div className="mt-3">
              <Label htmlFor="nl-consent-version">{t("newsletter.consent.version")}</Label>
              <Input id="nl-consent-version" value={consentVersion}
                onChange={(e) => setConsentVersion(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button disabled={pending || !email.trim()} onClick={submit}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </Modal>
  );
}

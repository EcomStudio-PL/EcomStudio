"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Layers, ShieldOff, Trash2, UserRound } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { LOCALES, SUPPRESSION_REASONS } from "@/lib/newsletter";
import type { ContactRow } from "@/lib/services/newsletter";
import {
  blockContactAction, bulkAddToGroupAction, bulkRemoveFromGroupAction,
  deleteContactAction, removeSuppressionAction, updateContactAction,
} from "@/app/actions/newsletter";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";

/**
 * EDITING ONE CONTACT.
 *
 * THE ADDRESS IS NOT A FIELD HERE, and that is the same decision the action
 * made: suppression is keyed on the address, the unsubscribe token is bound to
 * the person, and queued messages carry a frozen copy of it — retyping an
 * address turns one person into two half-people across three tables. A wrong
 * address is deleted and added again.
 *
 * GROUP MEMBERSHIP SAVES ON THE SPOT, the rest of the form saves on "Zapisz".
 * A checkbox that silently waits for a save button somewhere else is a checkbox
 * people believe they have already used, and membership is the one thing on
 * this screen that is a single unambiguous fact rather than an edit in
 * progress. Only static groups are listed: a segment is a saved filter with no
 * membership to join.
 *
 * BLOCKING AND DELETING ARE DELIBERATELY NOT THE SAME BUTTON. A block is
 * reversible and keeps the history that proves what was sent; a delete takes
 * the events, the sends and the consent record with it. The confirmations say
 * exactly that, because this is the screen where somebody reaches for the
 * wrong one.
 */

type Option = { key: string; name: string };
type GroupOption = { id: string; name: string };

export function ContactDetail({ contact, sources, groups, memberOf, blockedReason }: {
  contact: ContactRow;
  sources: Option[];
  /** Static groups only. */
  groups: GroupOption[];
  memberOf: string[];
  /** The suppression reason, when this address is blocked. */
  blockedReason: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [firstName, setFirstName] = useState(contact.firstName ?? "");
  const [lastName, setLastName] = useState(contact.lastName ?? "");
  const [locale, setLocale] = useState(contact.locale);
  const [sourceKey, setSourceKey] = useState(contact.sourceKey);
  const [tags, setTags] = useState(contact.tags.join(", "));
  const [consent, setConsent] = useState(contact.marketingConsent);
  const [consentVersion, setConsentVersion] = useState(contact.consentVersion ?? "v1");

  const [member, setMember] = useState<Set<string>>(new Set(memberOf));
  const [reason, setReason] = useState<string>("blocked");
  const [note, setNote] = useState("");
  const [confirmUnblock, setConfirmUnblock] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));

  function save() {
    start(async () => {
      const res = await updateContactAction({
        id: contact.id,
        firstName: firstName || null,
        lastName: lastName || null,
        locale,
        sourceKey,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        marketingConsent: consent,
        consentVersion: consent ? consentVersion : null,
      });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.saved"));
      router.refresh();
    });
  }

  /** One group, on or off. The local set moves first so the checkbox answers
   *  the click, and moves back if the server refuses. */
  function toggleGroup(groupId: string, next: boolean) {
    setMember((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(groupId); else copy.delete(groupId);
      return copy;
    });
    start(async () => {
      const input = { contactIds: [contact.id], groupId };
      const res = next
        ? await bulkAddToGroupAction(input)
        : await bulkRemoveFromGroupAction(input);
      if (!res.ok) {
        setMember((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(groupId); else copy.add(groupId);
          return copy;
        });
        fail(res.error);
        return;
      }
      router.refresh();
    });
  }

  function block() {
    start(async () => {
      const res = await blockContactAction({
        contactId: contact.id, reason, note: note || null,
      });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.suppressions.added"));
      setNote("");
      router.refresh();
    });
  }

  function unblock() {
    start(async () => {
      const res = await removeSuppressionAction(contact.email);
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.suppressions.removed"));
      setConfirmUnblock(false);
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const res = await deleteContactAction(contact.id);
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.deleted"));
      // The contact no longer exists, so there is nothing to refresh into —
      // back to the list rather than a page that would 404 on reload.
      router.push("/admin/newsletter/kontakty");
    });
  }

  return (
    <div className="space-y-4" data-contact-detail>
      {/* ── THE PROFILE ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("newsletter.contact.profile")} icon={UserRound} />
        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cd-first">{t("newsletter.col.name")}</Label>
              <Input id="cd-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cd-last">{t("newsletter.contact.lastName")}</Label>
              <Input id="cd-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cd-locale">{t("newsletter.col.locale")}</Label>
              <Select id="cd-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
                {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="cd-source">{t("newsletter.filter.source")}</Label>
              <Select id="cd-source" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
                {sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                {/* A source that has since been removed from the table still
                    describes where this contact came from, so it stays
                    selectable rather than silently becoming another one. */}
                {!sources.some((s) => s.key === contact.sourceKey) && (
                  <option value={contact.sourceKey}>{contact.sourceKey}</option>
                )}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="cd-tags" hint={t("newsletter.contact.tagsHint")}>
              {t("newsletter.contact.tags")}
            </Label>
            <Input id="cd-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>

          <div className="plate rounded-xl p-3">
            <label className="flex items-start gap-2.5 text-[13px] font-semibold">
              <input type="checkbox" checked={consent} data-contact-consent
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
              {t("newsletter.contact.consentGrant")}
            </label>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              {t("newsletter.contact.consentGrantHint")}
            </p>
            {consent && (
              <div className="mt-3">
                <Label htmlFor="cd-version">{t("newsletter.consent.version")}</Label>
                <Input id="cd-version" value={consentVersion}
                  onChange={(e) => setConsentVersion(e.target.value)} />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" disabled={pending} data-contact-save onClick={save}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── GROUPS ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("newsletter.col.groups")} icon={Layers} />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          {groups.length === 0 ? (
            <p className="text-[13px] text-muted">{t("newsletter.groups.none")}</p>
          ) : (
            <ul className="thin-scroll max-h-56 space-y-1 overflow-y-auto">
              {groups.map((group) => (
                <li key={group.id}>
                  <label className="flex min-h-[36px] items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors hover:bg-raised/50">
                    <input type="checkbox" checked={member.has(group.id)} disabled={pending}
                      onChange={(e) => toggleGroup(group.id, e.target.checked)}
                      className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
                    <span className="min-w-0 truncate">{group.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ── BLOCK, UNBLOCK, DELETE ──────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("newsletter.suppressions.title")} icon={ShieldOff} />
        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          {blockedReason ? (
            <>
              <p className="text-[13px] leading-relaxed text-muted">
                {t("newsletter.contact.blockedNotice", {
                  reason: t(`newsletter.reason.${blockedReason}`),
                })}
              </p>
              <Button size="sm" variant="secondary" disabled={pending}
                data-contact-unblock onClick={() => setConfirmUnblock(true)}>
                {t("newsletter.suppressions.remove")}
              </Button>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cd-reason">{t("admin.reason")}</Label>
                  <Select id="cd-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                    {SUPPRESSION_REASONS.map((r) => (
                      <option key={r} value={r}>{t(`newsletter.reason.${r}`)}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="cd-note">{t("newsletter.col.note")}</Label>
                  <Input id="cd-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <Button size="sm" variant="secondary" disabled={pending}
                data-contact-block onClick={block}>
                <Ban size={14} aria-hidden />{t("newsletter.contacts.block")}
              </Button>
            </>
          )}

          <div className="border-t border-line pt-3">
            <Button size="sm" variant="danger" disabled={pending}
              data-contact-delete onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} aria-hidden />{t("common.delete")}
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmModal
        open={confirmUnblock}
        onClose={() => setConfirmUnblock(false)}
        onConfirm={unblock}
        title={t("newsletter.suppressions.removeTitle")}
        body={t("newsletter.suppressions.removeBody")}
        confirmLabel={t("newsletter.suppressions.remove")}
        pending={pending}
      />

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={t("newsletter.contact.deleteTitle")}
        body={t("newsletter.contact.deleteBody")}
        confirmLabel={t("common.delete")}
        danger
        pending={pending}
      />
    </div>
  );
}

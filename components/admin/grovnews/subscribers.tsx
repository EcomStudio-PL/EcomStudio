"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Search, Settings2, UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { AdminTable } from "@/components/ui/admin-table";
import {
  grantGrovNewsAction, searchGrovNewsUsersAction, updateGrovNewsEntitlementAction, type UserHit,
} from "@/app/actions/grovnews";
import { ADMIN_GRANT_SOURCES, GRANT_PRESETS, effectiveStatus, type EffectiveStatus, type GrantPreset } from "@/lib/grovnews";
import type { AdminEntitlement } from "@/lib/services/grovnews";
import type { MailEligibility } from "@/lib/services/grovnews-research";

const TONE: Record<EffectiveStatus, "success" | "warning" | "neutral" | "danger" | "info"> = {
  ACTIVE: "success", SCHEDULED: "info", EXPIRED: "neutral", REVOKED: "danger",
};

/** Whether the newsletter would mail this person — its own consent and
 *  suppression rules, read on the server. Suppression always wins. */
const MAIL_TONE: Record<MailEligibility, "success" | "warning" | "neutral" | "danger"> = {
  ok: "success", no_contact: "neutral", no_consent: "warning", unsubscribed: "neutral", suppressed: "danger",
};

export type SubscriberRow = AdminEntitlement & { mail: MailEligibility };

/** Numeric, in Warsaw time: "25.09.2026". A client component is rendered on
 *  the server AND in the browser, and the two ICU builds spell month NAMES
 *  differently — which is a hydration error. Numbers they agree on. */
function useFormatDate() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Warsaw",
  });
  return (iso: string | null) => (iso ? fmt.format(new Date(iso)) : null);
}

/** Preset buttons + a custom date, shared by "grant" and "change date". */
function PresetPicker({ preset, onPreset, custom, onCustom }: {
  preset: GrantPreset; onPreset: (p: GrantPreset) => void; custom: string; onCustom: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("grovnewsAdm.duration")}>
        {GRANT_PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={preset === p} onClick={() => onPreset(p)}
            className={`min-h-9 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors ${
              preset === p ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink"}`}>
            {t(`grovnewsAdm.preset.${p}`)}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <Input type="date" className="mt-2" value={custom} aria-label={t("grovnewsAdm.preset.custom")}
          onChange={(e) => onCustom(e.target.value)} />
      )}
    </div>
  );
}

export function SubscribersManager({ rows }: { rows: SubscriberRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useFormatDate();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<"" | EffectiveStatus>("");
  const [granting, setGranting] = useState(false);
  const [managing, setManaging] = useState<AdminEntitlement | null>(null);

  const now = useMemo(() => new Date(), [rows]);
  const visible = rows.filter((r) => {
    const s = effectiveStatus({ status: r.status, starts_at: r.startsAt, expires_at: r.expiresAt }, now);
    if (status && s !== status) return false;
    const q = filter.trim().toLowerCase();
    return !q || r.email.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q);
  });

  const done = (res: { ok: boolean; error?: string }, okKey: string) => {
    if (res.ok) { toast.success(t(okKey)); router.refresh(); return true; }
    toast.error(t(res.error === "forbidden" ? "grovnewsAdm.errForbidden" : res.error === "invalid" ? "grovnewsAdm.errInvalid" : "common.error"));
    return false;
  };

  return (
    <div className="space-y-4" data-grovnews-subscribers>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("grovnewsAdm.filterUsers")}
            aria-label={t("grovnewsAdm.filterUsers")} className="pl-9" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as "" | EffectiveStatus)}
          aria-label={t("grovnewsAdm.fStatus")} className="sm:w-44">
          <option value="">{t("grovnewsAdm.allStatuses")}</option>
          {(["ACTIVE", "SCHEDULED", "EXPIRED", "REVOKED"] as const).map((s) => (
            <option key={s} value={s}>{t(`grovnewsAdm.ent.${s}`)}</option>
          ))}
        </Select>
        <Button onClick={() => setGranting(true)} className="shrink-0">
          <UserPlus size={15} aria-hidden />{t("grovnewsAdm.grant")}
        </Button>
      </div>

      <p className="flex min-w-0 items-start gap-2 text-[12.5px] leading-relaxed text-muted" data-grovnews-mail-note>
        <Mail size={14} aria-hidden className="mt-0.5 shrink-0 text-faint" />
        <span className="min-w-0">{t("grovnewsAdm.mailNote")}</span>
      </p>

      <AdminTable
        empty={t("grovnewsAdm.noSubscribers")}
        // Access and e-mail status share a cell: two separate facts, one glance,
        // and the table keeps the width it had before the e-mail column.
        headers={[t("grovnewsAdm.colUser"), `${t("grovnewsAdm.colStatus")} · ${t("grovnewsAdm.colMail")}`, t("grovnewsAdm.colSource"),
          t("grovnewsAdm.colStart"), t("grovnewsAdm.colExpires"), t("grovnewsAdm.colNote"), ""]}
        rows={visible.map((r) => {
          const s = effectiveStatus({ status: r.status, starts_at: r.startsAt, expires_at: r.expiresAt }, now);
          return [
            <span key="u" className="block min-w-0 max-w-[16rem]" title={r.email}>
              <span className="block truncate">{r.name || r.email}</span>
              {r.name && <span className="block truncate text-[11.5px] font-normal text-muted">{r.email}</span>}
            </span>,
            <span key="s" className="flex min-w-0 flex-col items-start gap-1">
              <Badge tone={TONE[s]} dot>{t(`grovnewsAdm.ent.${s}`)}</Badge>
              <span className="max-w-full" data-grovnews-mail={r.mail}>
                <Badge tone={MAIL_TONE[r.mail]} className="max-w-full whitespace-normal">{t(`grovnewsAdm.mailStatus.${r.mail}`)}</Badge>
              </span>
            </span>,
            <span key="src" className="lg:whitespace-nowrap">{t(`grovnewsAdm.source.${r.source}`)}</span>,
            <span key="from" className="whitespace-nowrap tabular-nums">{fmt(r.startsAt)}</span>,
            <span key="to" className="whitespace-nowrap tabular-nums">{fmt(r.expiresAt) ?? t("grovnewsAdm.forever")}</span>,
            r.note ? <span key="n" className="line-clamp-2 text-[12px] text-muted">{r.note}</span> : "",
            <Button key="m" size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => setManaging(r)}>
              <Settings2 size={14} aria-hidden />{t("grovnewsAdm.manage")}
            </Button>,
          ];
        })}
      />

      <GrantModal open={granting} onClose={() => setGranting(false)} pending={pending}
        onGrant={(input) => start(async () => { if (done(await grantGrovNewsAction(input), "grovnewsAdm.granted")) setGranting(false); })} />

      {managing && (
        <ManageModal row={managing} pending={pending} onClose={() => setManaging(null)}
          onChange={(change, okKey) => start(async () => {
            if (done(await updateGrovNewsEntitlementAction(managing.id, change), okKey)) setManaging(null);
          })} />
      )}
    </div>
  );
}

type GrantInput = Parameters<typeof grantGrovNewsAction>[0];

function GrantModal({ open, onClose, onGrant, pending }: {
  open: boolean; onClose: () => void; onGrant: (input: GrantInput) => void; pending: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);
  const [user, setUser] = useState<UserHit | null>(null);
  const [source, setSource] = useState<GrantInput["source"]>("ADMIN_GRANT");
  const [preset, setPreset] = useState<GrantPreset>("30");
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open || user || q.trim().length < 2) { setHits([]); return; }
    const id = setTimeout(async () => {
      const res = await searchGrovNewsUsersAction(q);
      setHits(res.ok ? res.users : []);
    }, 250);
    return () => clearTimeout(id);
  }, [q, open, user]);

  return (
    <Modal open={open} onClose={onClose} title={t("grovnewsAdm.grantTitle")}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="gn-user">{t("grovnewsAdm.findUser")}</Label>
          {user ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{user.name || user.email}</span>
                <span className="block truncate text-[12px] text-muted">{user.email}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => { setUser(null); setQ(""); }}>{t("grovnewsAdm.change")}</Button>
            </div>
          ) : (
            <>
              <Input id="gn-user" value={q} autoComplete="off" placeholder={t("grovnewsAdm.findUserHint")}
                onChange={(e) => setQ(e.target.value)} />
              {hits.length > 0 && (
                <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-line p-1">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => setUser(h)}
                        className="flex w-full min-w-0 flex-col rounded-lg px-2.5 py-2 text-left hover:bg-raised">
                        <span className="truncate text-sm font-medium">{h.name || h.email}</span>
                        {h.name && <span className="truncate text-[12px] text-muted">{h.email}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div>
          <Label htmlFor="gn-source">{t("grovnewsAdm.colSource")}</Label>
          <Select id="gn-source" value={source} onChange={(e) => setSource(e.target.value as GrantInput["source"])}>
            {ADMIN_GRANT_SOURCES.map((s) => <option key={s} value={s}>{t(`grovnewsAdm.source.${s}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label>{t("grovnewsAdm.duration")}</Label>
          <PresetPicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
        </div>
        <div>
          <Label htmlFor="gn-note" hint={`${note.length}/1000`}>{t("grovnewsAdm.colNote")}</Label>
          <Textarea id="gn-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={pending || !user || (preset === "custom" && !custom)}
            onClick={() => user && onGrant({ userId: user.id, source, preset, customDate: custom || null, note: note || null })}>
            {t("grovnewsAdm.grant")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type Change = Parameters<typeof updateGrovNewsEntitlementAction>[1];

function ManageModal({ row, onClose, onChange, pending }: {
  row: AdminEntitlement; onClose: () => void; pending: boolean;
  onChange: (change: Change, okKey: string) => void;
}) {
  const { t } = useI18n();
  const fmt = useFormatDate();
  const [preset, setPreset] = useState<GrantPreset>("30");
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState(row.note ?? "");
  const s = effectiveStatus({ status: row.status, starts_at: row.startsAt, expires_at: row.expiresAt });

  return (
    <Modal open onClose={onClose} title={row.name || row.email}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <Badge tone={TONE[s]} dot>{t(`grovnewsAdm.ent.${s}`)}</Badge>
          <span>{t(`grovnewsAdm.source.${row.source}`)}</span>
          <span aria-hidden>·</span>
          <span>{t("grovnewsAdm.colExpires")}: {fmt(row.expiresAt) ?? t("grovnewsAdm.forever")}</span>
        </div>

        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.extend")}</p>
          <div className="flex flex-wrap gap-1.5">
            {[7, 30, 90, 365].map((d) => (
              <Button key={d} size="sm" variant="secondary" disabled={pending || row.expiresAt === null}
                onClick={() => onChange({ kind: "extend", days: d }, "grovnewsAdm.extended")}>
                +{t(`grovnewsAdm.preset.${d}`)}
              </Button>
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.setExpiry")}</p>
          <PresetPicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
          <Button size="sm" className="mt-2" disabled={pending || (preset === "custom" && !custom)}
            onClick={() => onChange({ kind: "setExpiry", preset, customDate: custom || null }, "grovnewsAdm.dateChanged")}>
            {t("grovnewsAdm.applyDate")}
          </Button>
        </section>

        <section>
          <Label htmlFor="gn-manage-note" hint={`${note.length}/1000`}>{t("grovnewsAdm.colNote")}</Label>
          <Textarea id="gn-manage-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" variant="secondary" className="mt-2" disabled={pending}
            onClick={() => onChange({ kind: "note", note }, "grovnewsAdm.saved")}>{t("grovnewsAdm.saveNote")}</Button>
        </section>

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          {row.status === "REVOKED" ? (
            <Button variant="secondary" disabled={pending} onClick={() => onChange({ kind: "restore" }, "grovnewsAdm.restored")}>
              {t("grovnewsAdm.restore")}
            </Button>
          ) : (
            <Button variant="danger" disabled={pending} onClick={() => onChange({ kind: "revoke" }, "grovnewsAdm.revoked")}>
              {t("grovnewsAdm.revoke")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </Modal>
  );
}

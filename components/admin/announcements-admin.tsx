"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import {
  audienceCountAction, findUserByEmailAction, publishDraftAction, saveAnnouncementAction, withdrawAnnouncementAction,
} from "@/app/actions/announcements";
import {
  ANNOUNCEMENT_LIMITS, announcementState, validateAnnouncement,
  type AnnouncementAudience, type AnnouncementDraft, type AnnouncementError, type AnnouncementPriority,
} from "@/lib/notifications/announcement";
import { NotificationRow } from "@/components/layout/notifications-bell";
import { BannerView } from "@/components/layout/important-banner";
import { Segmented } from "@/components/ui/segmented";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

export type AnnouncementRow = {
  id: string; title: string; body: string; cta_label: string | null; cta_href: string | null;
  priority: string; audience_label: string | null; status: string;
  publish_at: string | null; published_at: string | null; expires_at: string | null;
  recipient_count: number; withdrawn_at: string | null; created_at: string;
  delivered: number; reads: number;
};

type Plan = { id: string; name: string };
type AudienceKind = AnnouncementAudience["kind"];

/** datetime-local ⇄ ISO, in the admin's own time zone. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

const STATE_TONE = { draft: "accent", scheduled: "info", active: "success", expired: "neutral", withdrawn: "danger" } as const;

/**
 * KOMUNIKATY (admin). Write → see exactly what customers will see (the bell
 * row, and the bar for „Ważny”) with the audience counted by the database →
 * publish now, schedule, or keep as a draft. Below, every message with its
 * state and read figures, and „Wycofaj”.
 */
export function AnnouncementsAdmin({ rows, plans, locale }: { rows: AnnouncementRow[]; plans: Plan[]; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [withCta, setWithCta] = useState(false);
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaHref, setCtaHref] = useState("");
  const [priority, setPriority] = useState<AnnouncementPriority>("normal");
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [kind, setKind] = useState<AudienceKind>("all");
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userHits, setUserHits] = useState<{ id: string; email: string; name: string | null }[]>([]);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [shownErrors, setShownErrors] = useState<AnnouncementError[]>([]);

  const audience: AnnouncementAudience = useMemo(() => {
    if (kind === "plans") return { kind, plan_ids: planIds };
    if (kind === "user") return { kind, user_id: user?.id ?? "" };
    return { kind };
  }, [kind, planIds, user]);

  const draft = (mode: AnnouncementDraft["mode"]): AnnouncementDraft => ({
    title, body, ctaLabel: withCta ? ctaLabel : "", ctaHref: withCta ? ctaHref : "",
    priority, audience, mode,
    publishAt: mode === "schedule" ? toIso(publishAt) : null,
    expiresAt: toIso(expiresAt),
  });

  // The audience, counted by the database (debounced). Never a guess.
  useEffect(() => {
    setConfirming(false);
    const ready = kind === "all" || kind === "no_plan" || (kind === "plans" && planIds.length > 0) || (kind === "user" && user);
    if (!ready) { setCount(null); return; }
    let live = true;
    const id = setTimeout(() => {
      void audienceCountAction(audience).then((r) => { if (live) setCount(r.ok ? r.count : null); });
    }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [audience, kind, planIds.length, user]);

  useEffect(() => {
    if (kind !== "user" || userQuery.trim().length < 3) { setUserHits([]); return; }
    let live = true;
    const id = setTimeout(() => {
      void findUserByEmailAction(userQuery).then((r) => { if (live) setUserHits(r.ok ? r.users : []); });
    }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [kind, userQuery]);

  const errors = validateAnnouncement(draft(when));
  const err = (f: AnnouncementError) => shownErrors.includes(f);

  function reset() {
    setTitle(""); setBody(""); setWithCta(false); setCtaLabel(""); setCtaHref(""); setPriority("normal");
    setWhen("now"); setPublishAt(""); setExpiresAt(""); setKind("all"); setPlanIds([]); setUser(null); setUserQuery("");
    setConfirming(false); setShownErrors([]);
  }

  function submit(mode: AnnouncementDraft["mode"]) {
    const d = draft(mode);
    const problems = validateAnnouncement(d);
    if (problems.length > 0) { setShownErrors(problems); return; }
    // Sending is a second, deliberate click that names the audience size.
    if (mode !== "draft" && !confirming) { setConfirming(true); return; }
    start(async () => {
      const r = await saveAnnouncementAction(d);
      if (!r.ok) {
        if (r.fields) setShownErrors(r.fields);
        notify.error(t("comm.ann.saveFailed"));
        setConfirming(false);
        return;
      }
      notify.success(t(mode === "now" ? "comm.ann.published" : mode === "schedule" ? "comm.ann.scheduled" : "comm.ann.drafted"));
      reset();
      router.refresh();
    });
  }

  const previewRow = {
    id: "preview", type: "announcement", category: "important" as const,
    title: title.trim() || t("comm.ann.previewTitle"), body: body.trim() || t("comm.ann.previewBody"),
    href: withCta ? ctaHref : null, meta: { priority, cta_label: withCta ? ctaLabel : null, cta_href: withCta ? ctaHref : null },
    read_at: null, created_at: new Date().toISOString(), pinned: priority === "important",
  };
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const audienceText = kind === "all" ? t("comm.ann.aud.all") : kind === "no_plan" ? t("comm.ann.aud.noPlan")
    : kind === "plans" ? t("comm.ann.aud.plansLabel", { plans: plans.filter((p) => planIds.includes(p.id)).map((p) => p.name).join(", ") || "—" })
      : t("comm.ann.aud.userLabel", { email: user?.email ?? "—" });

  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form className="panel space-y-5 rounded-2xl p-5" onSubmit={(e) => { e.preventDefault(); submit(when); }} data-announcement-form>
          <div>
            <Label htmlFor="ann-title" hint={`${title.length}/${ANNOUNCEMENT_LIMITS.title}`}>{t("comm.ann.fTitle")}</Label>
            <Input id="ann-title" value={title} maxLength={ANNOUNCEMENT_LIMITS.title} onChange={(e) => setTitle(e.target.value)}
              aria-invalid={err("title")} />
          </div>
          <div>
            <Label htmlFor="ann-body" hint={`${body.length}/${ANNOUNCEMENT_LIMITS.body}`}>{t("comm.ann.fBody")}</Label>
            <Textarea id="ann-body" value={body} maxLength={ANNOUNCEMENT_LIMITS.body} onChange={(e) => setBody(e.target.value)}
              aria-invalid={err("body")} />
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withCta} onChange={(e) => setWithCta(e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--accent))]" />
              {t("comm.ann.fCta")}
            </label>
            {withCta && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ann-cta-label">{t("comm.ann.fCtaLabel")}</Label>
                  <Input id="ann-cta-label" value={ctaLabel} maxLength={ANNOUNCEMENT_LIMITS.ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)} aria-invalid={err("cta_label") || err("cta_pair")} />
                </div>
                <div>
                  <Label htmlFor="ann-cta-href" hint={t("comm.ann.fCtaHrefHint")}>{t("comm.ann.fCtaHref")}</Label>
                  <Input id="ann-cta-href" value={ctaHref} maxLength={ANNOUNCEMENT_LIMITS.ctaHref} placeholder="/credits"
                    onChange={(e) => setCtaHref(e.target.value)} aria-invalid={err("cta_href") || err("cta_pair")} />
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>{t("comm.ann.fPriority")}</Label>
            <Segmented value={priority} onChange={(v) => setPriority(v as AnnouncementPriority)} label={t("comm.ann.fPriority")}
              options={[
                { value: "normal", label: t("comm.ann.priority.normal"), meta: t("comm.ann.priority.normalHint") },
                { value: "important", label: t("comm.ann.priority.important"), meta: t("comm.ann.priority.importantHint") },
              ]} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("comm.ann.fPublish")}</Label>
              <Segmented value={when} onChange={(v) => setWhen(v as "now" | "schedule")} label={t("comm.ann.fPublish")} size="sm"
                options={[{ value: "now", label: t("comm.ann.publishNow") }, { value: "schedule", label: t("comm.ann.publishLater") }]} />
              {when === "schedule" && (
                <Input type="datetime-local" className="mt-2" value={publishAt} onChange={(e) => setPublishAt(e.target.value)}
                  aria-label={t("comm.ann.fPublishAt")} aria-invalid={err("publish_at")} />
              )}
            </div>
            <div>
              <Label htmlFor="ann-expires" hint={t("comm.ann.optional")}>{t("comm.ann.fExpires")}</Label>
              <Input id="ann-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                aria-invalid={err("expires_at")} />
            </div>
          </div>

          <div>
            <Label>{t("comm.ann.fAudience")}</Label>
            <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label={t("comm.ann.fAudience")}>
              {(["all", "no_plan", "plans", "user"] as const).map((k) => (
                <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px]",
                  kind === k ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/40" : "border-line")}>
                  <input type="radio" name="ann-audience" checked={kind === k} onChange={() => setKind(k)}
                    className="accent-[rgb(var(--accent))]" />
                  {t(`comm.ann.aud.${k === "no_plan" ? "noPlan" : k}`)}
                </label>
              ))}
            </div>
            {kind === "plans" && (
              <div className="mt-2 flex flex-wrap gap-2" data-ann-plans>
                {plans.length === 0 && <p className="text-xs text-muted">{t("comm.ann.noPlans")}</p>}
                {plans.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
                    <input type="checkbox" checked={planIds.includes(p.id)} className="accent-[rgb(var(--accent))]"
                      onChange={(e) => setPlanIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))} />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
            {kind === "user" && (
              <div className="mt-2 space-y-1.5">
                <Input value={userQuery} onChange={(e) => { setUserQuery(e.target.value); setUser(null); }}
                  placeholder={t("comm.ann.userSearch")} aria-label={t("comm.ann.userSearch")} aria-invalid={err("user")} />
                {user ? (
                  <p className="text-xs text-success">{t("comm.ann.userPicked", { email: user.email })}</p>
                ) : userHits.length > 0 && (
                  <ul className="overflow-hidden rounded-xl border border-line">
                    {userHits.map((u) => (
                      <li key={u.id}>
                        <button type="button" onClick={() => { setUser({ id: u.id, email: u.email }); setUserQuery(u.email); setUserHits([]); }}
                          className="block w-full px-3 py-2 text-left text-[13px] hover:bg-raised">
                          {u.email}{u.name ? <span className="text-muted"> · {u.name}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {shownErrors.length > 0 && (
            <p className="text-[13px] text-danger" role="alert">
              {shownErrors.map((e) => t(`comm.ann.err.${e}`)).join(" · ")}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button type="submit" disabled={pending} data-ann-submit>
              {confirming
                ? t("comm.ann.confirm", { n: count ?? "?" })
                : t(when === "now" ? "comm.ann.publish" : "comm.ann.schedule")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => submit("draft")}>{t("comm.ann.saveDraft")}</Button>
            {confirming && (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
            )}
          </div>
        </form>

        <aside className="space-y-4" data-announcement-preview>
          <div className="panel rounded-2xl p-4">
            <p className="overline mb-3">{t("comm.ann.preview")}</p>
            <div className="overlay rounded-2xl p-1.5">
              <NotificationRow n={previewRow} t={t} locale={locale} date={fmt.format(new Date())} />
            </div>
            {priority === "important" && (
              <div className="mt-3 overflow-hidden rounded-xl border border-line">
                <p className="px-3 pt-2 text-[11px] text-faint">{t("comm.ann.previewBar")}</p>
                <BannerView title={previewRow.title} body={previewRow.body} ctaLabel={withCta ? ctaLabel : null}
                  ctaHref={withCta ? ctaHref : null} closeLabel={t("notif.v2.closeBar")} />
              </div>
            )}
            <dl className="mt-4 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">{t("comm.ann.fPriority")}</dt>
                <dd>{t(`comm.ann.priority.${priority}`)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">{t("comm.ann.fCta")}</dt>
                <dd className="truncate">{withCta && ctaLabel ? `${ctaLabel} → ${ctaHref}` : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">{t("comm.ann.fAudience")}</dt>
                <dd className="truncate text-right">{audienceText}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">{t("comm.ann.recipients")}</dt>
                <dd className="font-semibold tabular-nums" data-ann-count>{count ?? "—"}</dd></div>
            </dl>
            {errors.length > 0 && shownErrors.length === 0 && (
              <p className="mt-3 text-[11.5px] text-faint">{t("comm.ann.incomplete")}</p>
            )}
          </div>
        </aside>
      </div>

      <AnnouncementList rows={rows} locale={locale} />
    </div>
  );
}

function AnnouncementList({ rows, locale }: { rows: AnnouncementRow[]; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [arming, setArming] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const d = (s: string | null) => (s ? fmt.format(new Date(s)) : "—");

  function withdraw(id: string) {
    if (arming !== id) { setArming(id); return; }
    start(async () => {
      const r = await withdrawAnnouncementAction(id);
      setArming(null);
      if (!r.ok) { notify.error(t("comm.ann.withdrawFailed")); return; }
      notify.success(t("comm.ann.withdrawn"));
      router.refresh();
    });
  }
  function publish(id: string) {
    start(async () => {
      const r = await publishDraftAction(id);
      if (!r.ok) { notify.error(t("comm.ann.saveFailed")); return; }
      notify.success(t("comm.ann.published"));
      router.refresh();
    });
  }

  if (rows.length === 0) return <p className="text-sm text-muted">{t("comm.ann.empty")}</p>;
  return (
    <div className="space-y-2" data-announcement-list>
      <p className="overline">{t("comm.ann.listTitle")}</p>
      {rows.map((r) => {
        const state = announcementState(r);
        const base = r.recipient_count || r.delivered;
        const pct = base > 0 ? Math.round((r.reads / base) * 100) : 0;
        return (
          <div key={r.id} className="panel flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl p-4" data-announcement={state}>
            <div className="min-w-0 flex-1 basis-64">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span className="min-w-0 truncate">{r.title}</span>
                <Badge tone={STATE_TONE[state]}>{t(`comm.ann.state.${state}`)}</Badge>
                {r.priority === "important" && <Badge tone="accent">{t("comm.ann.priority.important")}</Badge>}
              </p>
              <p className="mt-0.5 text-xs text-muted">{r.audience_label ?? "—"}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-0.5 text-[12px] sm:grid-cols-4">
              <div><dt className="text-faint">{t("comm.ann.colPublished")}</dt><dd>{d(r.published_at ?? r.publish_at)}</dd></div>
              <div><dt className="text-faint">{t("comm.ann.colExpires")}</dt><dd>{d(r.expires_at)}</dd></div>
              <div><dt className="text-faint">{t("comm.ann.recipients")}</dt><dd className="tabular-nums">{base}</dd></div>
              <div><dt className="text-faint">{t("comm.ann.colReads")}</dt><dd className="tabular-nums">{r.reads} ({pct}%)</dd></div>
            </dl>
            <div className="flex gap-2">
              {state === "draft" && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => publish(r.id)}>{t("comm.ann.publish")}</Button>
              )}
              {state !== "withdrawn" && (
                <Button size="sm" variant={arming === r.id ? "danger" : "ghost"} disabled={pending} onClick={() => withdraw(r.id)}
                  data-ann-withdraw>
                  {t(arming === r.id ? "comm.ann.withdrawConfirm" : "comm.ann.withdraw")}
                </Button>
              )}
              {state === "withdrawn" && r.withdrawn_at && (
                <span className="text-[12px] text-muted">{t("comm.ann.withdrawnAt", { date: d(r.withdrawn_at) })}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

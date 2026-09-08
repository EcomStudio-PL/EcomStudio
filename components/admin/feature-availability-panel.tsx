"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck, ChevronDown, Eye, EyeOff, Loader2, Search, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import {
  FEATURE_GROUPS, FEATURE_STATUSES,
  type FeatureGroup, type FeatureKey, type FeatureStatus,
} from "@/lib/features";
import {
  batchFeatureStatusAction, batchMenuVisibilityAction, saveFeatureAvailabilityAction,
  setClientPreviewAction, type FeatureAdminRow,
} from "@/app/actions/features";

/**
 * DOSTĘPNOŚĆ FUNKCJI — the switchboard for every real user-facing module.
 *
 * The list is long enough now (two dozen modules) that a wall of large tiles
 * stopped being usable: this is a COMPACT row per feature — name, route,
 * status dot, menu state — with the advanced settings (window, auto-reopen,
 * custom copy) behind a per-row expander. Above it: search, a category filter,
 * a status filter, and multi-select with bulk actions, so "wyłącz wszystkie
 * narzędzia" is three clicks rather than eight forms.
 *
 * Everything here is a REQUEST: the server action re-checks the admin role and
 * refuses any key outside the registry, so nothing in this component is a
 * security boundary — it is the operator's console.
 */

/**
 * One colour per status, and the colour carries the meaning: green is running,
 * orange needs attention now, purple is planned but not yet, grey is switched
 * off on purpose. "Wyłączone" is a decision, not a fault, so red stays reserved
 * for the failures on the other admin screens.
 */
const STATUS_DOT: Record<FeatureStatus, string> = {
  ACTIVE: "bg-success",
  COMING_SOON: "bg-accent2",
  MAINTENANCE: "bg-warning",
  DISABLED: "bg-muted",
};

const STATUS_CHIP: Record<FeatureStatus, string> = {
  ACTIVE: "bg-[rgb(var(--success)/0.14)] text-success",
  COMING_SOON: "bg-accent2-soft text-accent2",
  MAINTENANCE: "bg-[rgb(var(--warning)/0.14)] text-warning",
  DISABLED: "bg-raised text-muted",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local → ISO instant (the browser parses in ITS zone, which is the
 *  zone the admin is thinking in; the server only ever stores UTC). */
function toIso(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const SELECT_CLS = "h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]";

export function FeatureAvailabilityPanel({ rows, previewing }: {
  rows: FeatureAdminRow[];
  /** Is this admin currently looking at the app as a customer? */
  previewing: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<FeatureGroup | "all">("all");
  const [status, setStatus] = useState<FeatureStatus | "all">("all");
  const [selected, setSelected] = useState<Set<FeatureKey>>(new Set());

  // The search matches what the admin can SEE: the label, the route, and the
  // registry key — typing "mailing", "/k/" or "image_" all land somewhere.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (group !== "all" && r.group !== group) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return `${t(r.nameKey)} ${r.path} ${r.key}`.toLowerCase().includes(q);
    });
  }, [rows, query, group, status, t]);

  const byGroup = useMemo(() => FEATURE_GROUPS
    .map((g) => ({ key: g, items: visible.filter((r) => r.group === g) }))
    .filter((g) => g.items.length > 0), [visible]);

  const toggle = (key: FeatureKey) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const setMany = (keys: FeatureKey[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const k of keys) { if (on) next.add(k); else next.delete(k); }
    return next;
  });

  const visibleKeys = visible.map((r) => r.key);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const filtered = query.trim() !== "" || group !== "all" || status !== "all";

  return (
    <div className="space-y-4">
      <PreviewToggle previewing={previewing} />

      {/* FILTERS — one row on desktop, stacked on a phone; nothing here ever
          overflows sideways. */}
      <Card className="p-3.5 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <div>
            <Label>{t("featAdm.search")}</Label>
            <div className="relative mt-1.5">
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t("featAdm.searchPlaceholder")} className="pl-9 pr-9" />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label={t("common.clear")}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-faint hover:text-ink">
                  <X size={14} aria-hidden />
                </button>
              )}
            </div>
          </div>
          <div>
            <Label>{t("featAdm.filterGroup")}</Label>
            <select value={group} onChange={(e) => setGroup(e.target.value as FeatureGroup | "all")}
              className={`mt-1.5 ${SELECT_CLS}`}>
              <option value="all">{t("featAdm.scopeAll")}</option>
              {FEATURE_GROUPS.map((g) => (
                <option key={g} value={g}>{t(`featAdm.groups.${g}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t("featAdm.filterStatus")}</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as FeatureStatus | "all")}
              className={`mt-1.5 ${SELECT_CLS}`}>
              <option value="all">{t("featAdm.anyStatus")}</option>
              {FEATURE_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`featAdm.status.${s}`)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[12.5px] text-muted">
          <label className="flex items-center gap-2 font-medium text-ink">
            <input type="checkbox" checked={allVisibleSelected}
              onChange={(e) => setMany(visibleKeys, e.target.checked)}
              className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" />
            {t("featAdm.selectAllVisible")}
          </label>
          <span>{t("featAdm.showing", { n: visible.length, total: rows.length })}</span>
          {filtered && (
            <button type="button"
              onClick={() => { setQuery(""); setGroup("all"); setStatus("all"); }}
              className="font-semibold text-accent hover:underline">
              {t("featAdm.clearFilters")}
            </button>
          )}
        </div>
      </Card>

      {byGroup.length === 0 && (
        <p className="px-1 text-sm text-muted">{t("featAdm.noMatches")}</p>
      )}

      {byGroup.map((section) => {
        const keys = section.items.map((r) => r.key);
        const allSelected = keys.every((k) => selected.has(k));
        return (
          <section key={section.key}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <input type="checkbox" checked={allSelected}
                onChange={(e) => setMany(keys, e.target.checked)}
                aria-label={t("featAdm.selectGroup", { group: t(`featAdm.groups.${section.key}`) })}
                className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" />
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-faint">
                {t(`featAdm.groups.${section.key}`)}
              </h2>
              <span className="text-[11px] text-faint">({section.items.length})</span>
            </div>
            <Card className="divide-y divide-line overflow-hidden p-0">
              {section.items.map((row) => (
                <FeatureRow key={row.key} row={row}
                  selected={selected.has(row.key)} onToggle={() => toggle(row.key)} />
              ))}
            </Card>
          </section>
        );
      })}

      {/* The bulk bar only exists while something is selected — it is an
          action on a selection, not permanent chrome. */}
      <BulkBar keys={[...selected]} onDone={() => setSelected(new Set())}
        onClear={() => setSelected(new Set())} />
    </div>
  );
}

/* ── podgląd jako klient ────────────────────────────────────────────────────*/

/**
 * The admin sees every restricted module (that is the point of the bypass).
 * This turns the bypass off for THIS browser so the operator can check what a
 * customer actually gets. It only ever removes privilege, and the real role is
 * still what the server checks first.
 */
function PreviewToggle({ previewing }: { previewing: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const set = async (on: boolean) => {
    setBusy(true);
    const res = await setClientPreviewAction(on);
    setBusy(false);
    if (res.ok) { toast.success(t(on ? "featAdm.previewOn" : "featAdm.previewOff")); router.refresh(); }
    else toast.error(t("common.error"));
  };

  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl px-3.5 py-2.5 ${
      previewing ? "bg-[rgb(var(--warning)/0.12)] text-warning" : "bg-raised text-muted"}`}>
      <span className="flex items-center gap-2 text-[13px] font-medium">
        {previewing ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        {previewing ? t("featAdm.previewActive") : t("featAdm.previewHint")}
      </span>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void set(!previewing)}>
        {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
        {t(previewing ? "featAdm.previewStop" : "featAdm.previewStart")}
      </Button>
    </div>
  );
}

/* ── bulk actions ───────────────────────────────────────────────────────────*/

type BulkOp =
  | { kind: "status"; status: FeatureStatus }
  | { kind: "menu"; hidden: boolean };

function BulkBar({ keys, onDone, onClear }: {
  keys: FeatureKey[];
  onDone: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState<BulkOp | null>(null);
  const [busy, setBusy] = useState(false);

  if (keys.length === 0) return null;

  const apply = async (op: BulkOp) => {
    setPending(null);
    setBusy(true);
    const res = op.kind === "status"
      ? await batchFeatureStatusAction(keys, op.status)
      : await batchMenuVisibilityAction(keys, op.hidden);
    setBusy(false);
    if (res.ok) { toast.success(t("featAdm.batchDone")); onDone(); router.refresh(); }
    else toast.error(t("common.error"));
  };

  const label = (op: BulkOp) => op.kind === "status"
    ? t(`featAdm.bulkSet.${op.status}`)
    : t(op.hidden ? "featAdm.bulkHide" : "featAdm.bulkShow");

  const ops: BulkOp[] = [
    ...FEATURE_STATUSES.map((s) => ({ kind: "status" as const, status: s })),
    { kind: "menu", hidden: true },
    { kind: "menu", hidden: false },
  ];

  return (
    <>
      {/* Sticky above the mobile chrome: `--page-bottom` is the same token the
          app shell reserves, so the bar can never sit on the navigation. */}
      <div className="sticky bottom-0 z-30 -mx-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="overlay flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 shadow-e3">
          <span className="text-[13px] font-semibold text-ink">
            {t("featAdm.selectedN", { n: keys.length })}
          </span>
          <span className="min-w-0 flex-1" />
          {ops.map((op) => (
            <Button key={op.kind === "status" ? op.status : String(op.hidden)}
              variant="secondary" size="sm" disabled={busy}
              onClick={() => setPending(op)}>
              {label(op)}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
            {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
            {t("common.cancel")}
          </Button>
        </div>
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal>
          <Card className="w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-ink">{t("featAdm.batchConfirmTitle")}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {pending.kind === "status"
                ? t("featAdm.batchConfirmBody", { n: keys.length, status: t(`featAdm.status.${pending.status}`) })
                : t("featAdm.batchConfirmMenu", { n: keys.length, action: label(pending) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPending(null)}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => void apply(pending)}>
                <BadgeCheck size={14} aria-hidden className="mr-1.5" />
                {t("featAdm.apply")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/* ── one compact row ────────────────────────────────────────────────────────*/

type RowState = {
  status: FeatureStatus;
  hiddenFromMenu: boolean;
  startsLocal: string;
  endsLocal: string;
  autoReenable: boolean;
  customTitle: string;
  customMessage: string;
};

function FeatureRow({ row, selected, onToggle }: {
  row: FeatureAdminRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<RowState>({
    status: row.status,
    hiddenFromMenu: row.hiddenFromMenu,
    startsLocal: toLocalInput(row.startsAt),
    endsLocal: toLocalInput(row.endsAt),
    autoReenable: row.autoReenable,
    customTitle: row.customTitle,
    customMessage: row.customMessage,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = (update: Partial<RowState>) => {
    setValue((prev) => ({ ...prev, ...update }));
    setDirty(true);
    // Changing the status from the collapsed row still needs somewhere to
    // press Save, so the advanced panel opens with it.
    setOpen(true);
  };

  const save = async () => {
    const startsAt = toIso(value.startsLocal);
    const endsAt = toIso(value.endsLocal);
    if (startsAt && endsAt && startsAt >= endsAt) { toast.error(t("featAdm.windowError")); return; }
    setBusy(true);
    const res = await saveFeatureAvailabilityAction({
      key: row.key,
      status: value.status,
      hiddenFromMenu: value.hiddenFromMenu,
      startsAt,
      endsAt,
      autoReenable: value.autoReenable,
      customTitle: value.customTitle,
      customMessage: value.customMessage,
    });
    setBusy(false);
    if (res.ok) { setDirty(false); toast.success(t("featAdm.saved")); router.refresh(); }
    else if (res.error === "window") toast.error(t("featAdm.windowError"));
    else toast.error(t("common.error"));
  };

  const restricted = value.status !== "ACTIVE";
  const inputCls = "mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]";
  const scheduled = Boolean(value.startsLocal || value.endsLocal);

  return (
    <div className={selected ? "bg-[rgb(var(--accent)/0.05)]" : undefined}>
      {/* COMPACT ROW — checkbox, identity, state, expander. Wraps instead of
          scrolling sideways on a phone. */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 sm:px-4">
        <input type="checkbox" checked={selected} onChange={onToggle}
          aria-label={t(row.nameKey)}
          className="h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]" />
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[value.status]}`} />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13.5px] font-semibold text-ink">{t(row.nameKey)}</span>
              {dirty && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-warning">•</span>}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate font-mono text-[11px] text-faint">{row.path}</span>
              {value.hiddenFromMenu && (
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                  {t("featAdm.hiddenChip")}
                </span>
              )}
              {scheduled && (
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                  {t("featAdm.scheduledChip")}
                </span>
              )}
            </span>
          </span>
          <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline ${STATUS_CHIP[value.status]}`}>
            {t(`featAdm.status.${value.status}`)}
          </span>
          <ChevronDown size={16} aria-hidden
            className={`shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* ADVANCED — everything that needs deliberate thought lives here, so the
          list itself stays scannable. */}
      {open && (
        <div className="animate-fade space-y-3.5 border-t border-line bg-raised/40 px-3 py-3.5 sm:px-4">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {FEATURE_STATUSES.map((s) => (
              <button key={s} type="button" onClick={() => patch({ status: s })}
                aria-pressed={value.status === s}
                className={`min-h-[40px] rounded-xl border px-2 py-2 text-[12px] font-semibold transition-colors ${
                  value.status === s
                    ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.12)] text-ink"
                    : "border-line bg-surface text-muted hover:text-ink"}`}>
                {t(`featAdm.status.${s}`)}
              </button>
            ))}
          </div>

          {/* Menu visibility is INDEPENDENT of the status (§28) — except for
              DISABLED, which removes the entry by construction. */}
          {value.status === "DISABLED" ? (
            <p className="text-[12px] leading-relaxed text-faint">{t("featAdm.hiddenForced")}</p>
          ) : (
            <label className="flex items-center justify-between gap-4">
              <span className="text-[13px] font-medium text-ink">{t("featAdm.hidden")}</span>
              <Switch checked={value.hiddenFromMenu} onChange={(v) => patch({ hiddenFromMenu: v })}
                label={t("featAdm.hidden")} />
            </label>
          )}

          {restricted && (
            <>
              <div>
                <p className="text-[12px] font-semibold text-muted">{t("featAdm.window")}</p>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>{t("featAdm.from")}</Label>
                    <input type="datetime-local" value={value.startsLocal}
                      onChange={(e) => patch({ startsLocal: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <Label>{t("featAdm.to")}</Label>
                    <input type="datetime-local" value={value.endsLocal}
                      onChange={(e) => patch({ endsLocal: e.target.value })} className={inputCls} />
                  </div>
                </div>
                <label className="mt-2.5 flex items-center justify-between gap-4">
                  <span className="text-[13px] font-medium text-ink">{t("featAdm.autoRe")}</span>
                  <Switch checked={value.autoReenable} onChange={(v) => patch({ autoReenable: v })}
                    label={t("featAdm.autoRe")} />
                </label>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{t("featAdm.windowHint")}</p>
              </div>

              {value.status !== "DISABLED" && (
                <div className="space-y-3">
                  <div>
                    <Label>{t("featAdm.customTitle")}</Label>
                    <Input value={value.customTitle} onChange={(e) => patch({ customTitle: e.target.value })}
                      className="mt-1.5" maxLength={120} placeholder={t("featAdm.customTitlePlaceholder")} />
                  </div>
                  <div>
                    <Label>{t("featAdm.customMessage")}</Label>
                    <textarea value={value.customMessage} rows={2} maxLength={500}
                      onChange={(e) => patch({ customMessage: e.target.value })}
                      placeholder={t("featAdm.customMessagePlaceholder")}
                      className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]" />
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-faint">{t("featAdm.customHint")}</p>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-[11px] text-faint">
              {row.updatedAt
                ? `${t("featAdm.updated")}: ${new Date(row.updatedAt).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw" })}`
                : t("featAdm.neverChanged")}
            </p>
            <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

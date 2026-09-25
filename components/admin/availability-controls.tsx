"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { BadgeCheck, Eye, EyeOff, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import {
  FEATURE_STATUSES,
  type AvailabilityMap, type FeatureKey, type FeatureStatus, type MenuBadge,
} from "@/lib/features";
import {
  batchFeatureStatusAction, batchMenuVisibilityAction, saveFeatureAvailabilityAction,
  setClientPreviewAction, type FeatureAdminRow,
} from "@/app/actions/features";
import { customerExposure, withDraft, type ExposureRow } from "@/lib/tool-panel";
import { cn } from "@/lib/utils";

/**
 * AVAILABILITY — status and visibility, the half of "Narzędzia i silniki"
 * that used to be the "Dostępność funkcji" screen.
 *
 * Same table (`feature_availability`), same four statuses, same server
 * actions (app/actions/features.ts), which re-check the admin role and refuse
 * any key outside the registry. Nothing here is a security boundary; the
 * FeatureGate and the menu rules that read the table are.
 *
 * STATUS IS NOT VISIBILITY. The status decides whether a customer can USE a
 * module (Wkrótce and maintenance open onto their own screen, Wyłączony is
 * gone). Visibility decides whether it is LISTED — in the menu, on /tools, on
 * Start, in its category, which all read the one `hidden_from_menu` switch.
 * A "Wkrótce" tool can be listed with its badge; a live one can be unlisted
 * while it is piloted.
 */

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

/** One numbered block of a tool's configuration. */
export function ConfigSection({ n, title, children, className }: {
  n?: number;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4", className)}>
      <h3 className="mb-3 flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-faint">
        {n !== undefined && (
          <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-raised text-[10px] tabular-nums text-muted">
            {n}
          </span>
        )}
        {title}
      </h3>
      {children}
    </section>
  );
}

/* ── podgląd jako klient ────────────────────────────────────────────────────*/

/**
 * The admin sees every restricted module (that is the point of the bypass).
 * This turns the bypass off for THIS browser so the operator can check what a
 * customer actually gets. It only ever removes privilege, and the real role is
 * still what the server checks first.
 */
export function PreviewToggle({ previewing }: { previewing: boolean }) {
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
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
        {previewing ? <EyeOff size={15} aria-hidden className="shrink-0" /> : <Eye size={15} aria-hidden className="shrink-0" />}
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

export function BulkBar({ keys, onDone, onClear }: {
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
      {/* Sticky ABOVE the admin dock on a phone (the dock is fixed to the
          bottom below `lg`, and `--dock-h` is its height), at the very bottom
          on a desktop where there is no dock. */}
      <div className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-30 -mx-1 px-1 pb-2 pt-2 lg:bottom-0 lg:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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

/* ── status + widoczność of one entry ───────────────────────────────────────*/

type Draft = {
  status: FeatureStatus;
  hiddenFromMenu: boolean;
  startsLocal: string;
  endsLocal: string;
  autoReenable: boolean;
  customTitle: string;
  customMessage: string;
};

const draftFrom = (row: FeatureAdminRow): Draft => ({
  status: row.status,
  hiddenFromMenu: row.hiddenFromMenu,
  startsLocal: toLocalInput(row.startsAt),
  endsLocal: toLocalInput(row.endsAt),
  autoReenable: row.autoReenable,
  customTitle: row.customTitle,
  customMessage: row.customMessage,
});

const INPUT_CLS = "mt-1.5 h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]";

/**
 * SECTIONS "STATUS" AND "WIDOCZNOŚĆ" — one row of `feature_availability`, one
 * Save. They are two sections because they are two decisions; they share a
 * button because they are one record, and saving one with the other's stale
 * value would be the bug the split was meant to prevent.
 *
 * The caller keys this component on the saved record, so a bulk action or a
 * save elsewhere remounts it with the new values instead of leaving a stale
 * draft on screen.
 */
export function AvailabilityEditor({ row, availability, first, layout, extra }: {
  row: FeatureAdminRow;
  /** The live switchboard — what every OTHER module is set to right now. */
  availability: AvailabilityMap;
  /** The number of the Status section (3 for a tool, 1 otherwise). */
  first: number;
  /** "stack" in a tool's right column; "split" side by side for the rest. */
  layout: "stack" | "split";
  /** What this switch covers, shown under the visibility readout. */
  extra?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const saved = useMemo(() => draftFrom(row), [row]);
  const [value, setValue] = useState<Draft>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const patch = (update: Partial<Draft>) => setValue((prev) => ({ ...prev, ...update }));

  // What a customer gets once this is saved: the SAME functions /tools,
  // Start and the menus render with, fed the switchboard with this one entry
  // replaced by the draft.
  const exposure = useMemo(
    () => customerExposure(row.key, withDraft(availability, row.key, value)),
    [availability, row.key, value],
  );

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
    if (res.ok) { toast.success(t("featAdm.saved")); router.refresh(); }
    else if (res.error === "window") toast.error(t("featAdm.windowError"));
    else toast.error(t("common.error"));
  };

  const restricted = value.status !== "ACTIVE";
  const scheduled = restricted && Boolean(value.startsLocal || value.endsLocal);

  return (
    <div className="min-w-0 space-y-3.5">
      <div className={cn("grid gap-3.5 [&>*]:min-w-0", layout === "split" && "lg:grid-cols-2")}>
        <ConfigSection n={first} title={t("aicc.panel.sec.status")}>
          <div role="group" aria-label={t("aicc.panel.sec.status")} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {FEATURE_STATUSES.map((s) => (
              <button key={s} type="button" onClick={() => patch({ status: s })}
                aria-pressed={value.status === s}
                className={`min-h-[40px] min-w-0 rounded-xl border px-2 py-2 text-[12px] font-semibold leading-tight transition-colors ${
                  value.status === s
                    ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.12)] text-ink"
                    : "border-line bg-surface text-muted hover:text-ink"}`}>
                {t(`featAdm.status.${s}`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">{t(`aicc.panel.statusHint.${value.status}`)}</p>

          {restricted && (
            <div className="mt-3.5 space-y-3.5 border-t border-line pt-3.5">
              <div>
                <p className="text-[12px] font-semibold text-muted">{t("featAdm.window")}</p>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                  <div>
                    <Label>{t("featAdm.from")}</Label>
                    <input type="datetime-local" value={value.startsLocal}
                      onChange={(e) => patch({ startsLocal: e.target.value })} className={INPUT_CLS} />
                  </div>
                  <div>
                    <Label>{t("featAdm.to")}</Label>
                    <input type="datetime-local" value={value.endsLocal}
                      onChange={(e) => patch({ endsLocal: e.target.value })} className={INPUT_CLS} />
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
            </div>
          )}
        </ConfigSection>

        <ConfigSection n={first + 1} title={t("aicc.panel.sec.visibility")}>
          {/* Visibility is INDEPENDENT of the status (§28) — except for
              DISABLED, which removes the entry by construction. */}
          {value.status === "DISABLED" ? (
            <p className="text-[12px] leading-relaxed text-faint">{t("featAdm.hiddenForced")}</p>
          ) : (
            <>
              <label className="flex items-center justify-between gap-4">
                <span className="text-[13px] font-semibold text-ink">{t("aicc.panel.visible")}</span>
                <Switch checked={!value.hiddenFromMenu} onChange={(v) => patch({ hiddenFromMenu: !v })}
                  label={t("aicc.panel.visible")} />
              </label>
              <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{t("aicc.panel.visibleHint")}</p>
            </>
          )}

          <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">{t("aicc.panel.whereTitle")}</p>
          <ExposureList rows={exposure} />
          {scheduled && <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("aicc.panel.windowPreview")}</p>}
          {extra}
        </ConfigSection>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] text-faint">
          {row.updatedAt
            ? `${t("featAdm.updated")}: ${new Date(row.updatedAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw" })}`
            : t("featAdm.neverChanged")}
        </p>
        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
          {t("aicc.panel.saveAvailability")}
        </Button>
      </div>
    </div>
  );
}

/* ── where the customer meets it ────────────────────────────────────────────*/

const BADGE_STATUS: Record<Exclude<MenuBadge, null>, FeatureStatus> = {
  soon: "COMING_SOON", maintenance: "MAINTENANCE", disabled: "DISABLED",
};

function ExposureList({ rows }: { rows: ExposureRow[] }) {
  const { t } = useI18n();
  return (
    <ul className="mt-1.5 divide-y divide-line">
      {rows.map((r) => {
        const detail = r.state === "na"
          ? t(`aicc.panel.na.${r.surface}`)
          : r.where.map((k) => t(k)).join(" · ");
        return (
          <li key={r.surface} data-surface={r.surface} data-state={r.state}
            className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className={cn("block text-[13px] font-medium", r.state === "na" ? "text-muted" : "text-ink")}>
                {t(`aicc.panel.surface.${r.surface}`)}
              </span>
              {detail && <span className="block text-[11.5px] leading-snug text-faint">{detail}</span>}
            </span>
            <ExposurePill row={r} />
          </li>
        );
      })}
    </ul>
  );
}

function ExposurePill({ row }: { row: ExposureRow }) {
  const { t } = useI18n();
  switch (row.state) {
    case "shown":
      return <Badge tone="success" className="shrink-0">{t("aicc.panel.state.shown")}</Badge>;
    case "badged":
      return (
        <Badge tone={row.badge === "maintenance" ? "warning" : "accent"} className="shrink-0">
          {t("aicc.panel.state.badged", { badge: t(`featAdm.status.${BADGE_STATUS[row.badge ?? "soon"]}`) })}
        </Badge>
      );
    case "hidden":
      return <Badge tone="neutral" className="shrink-0">{t("aicc.panel.state.hidden")}</Badge>;
    default:
      return <span className="shrink-0 text-[11.5px] font-semibold text-faint">{t("aicc.panel.state.na")}</span>;
  }
}

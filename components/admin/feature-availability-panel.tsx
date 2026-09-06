"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import { FEATURE_STATUSES, type FeatureKey, type FeatureStatus } from "@/lib/features";
import {
  batchFeatureStatusAction, saveFeatureAvailabilityAction, type FeatureAdminRow,
} from "@/app/actions/features";

/**
 * DOSTĘPNOŚĆ FUNKCJI — one tile per registry module (C6). Each tile is a
 * self-contained form: status, menu visibility, optional time window with
 * auto-reenable, and the custom copy for the customer screen. Nothing applies
 * until its Save; the server re-checks the admin role and the registry on
 * every write. The batch bar (C7) sets one status across a scope in one call.
 */

const GROUP_ORDER = ["create", "edit", "workspace"] as const;

const STATUS_DOT: Record<FeatureStatus, string> = {
  ACTIVE: "bg-success",
  COMING_SOON: "bg-warning",
  MAINTENANCE: "bg-warning",
  DISABLED: "bg-danger",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local → ISO instant (the browser parses in ITS zone, which is the
 *  zone the admin is thinking in; the server only ever sees UTC). */
function toIso(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function FeatureAvailabilityPanel({ rows }: { rows: FeatureAdminRow[] }) {
  const { t } = useI18n();
  const groups = useMemo(() => GROUP_ORDER
    .map((g) => ({ key: g, items: rows.filter((r) => r.group === g) }))
    .filter((g) => g.items.length > 0), [rows]);

  return (
    <div className="space-y-6">
      <BatchBar rows={rows} />
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint">
            {t(`featAdm.groups.${group.key}`)}
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {group.items.map((row) => <FeatureTile key={row.key} row={row} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── batch (C7) ─────────────────────────────────────────────────────────────*/

function BatchBar({ rows }: { rows: FeatureAdminRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [scope, setScope] = useState<"all" | "create" | "edit" | "workspace">("all");
  const [status, setStatus] = useState<FeatureStatus>("ACTIVE");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const keys = useMemo(() => rows
    .filter((r) => scope === "all" || r.group === scope)
    .map((r) => r.key as FeatureKey), [rows, scope]);

  const apply = async () => {
    setConfirm(false);
    setBusy(true);
    const res = await batchFeatureStatusAction(keys, status);
    setBusy(false);
    if (res.ok) { toast.success(t("featAdm.batchDone")); router.refresh(); }
    else toast.error(t("common.error"));
  };

  const selectCls = "h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>{t("featAdm.batchScope")}</Label>
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}
            className={`mt-1.5 block ${selectCls}`}>
            <option value="all">{t("featAdm.scopeAll")}</option>
            <option value="create">{t("featAdm.groups.create")}</option>
            <option value="edit">{t("featAdm.groups.edit")}</option>
            <option value="workspace">{t("featAdm.groups.workspace")}</option>
          </select>
        </div>
        <div>
          <Label>{t("featAdm.batchStatus")}</Label>
          <select value={status} onChange={(e) => setStatus(e.target.value as FeatureStatus)}
            className={`mt-1.5 block ${selectCls}`}>
            {FEATURE_STATUSES.map((s) => <option key={s} value={s}>{t(`featAdm.status.${s}`)}</option>)}
          </select>
        </div>
        <Button variant="secondary" onClick={() => setConfirm(true)} disabled={busy || keys.length === 0}>
          {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
          {t("featAdm.apply")} ({keys.length})
        </Button>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal>
          <Card className="w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-ink">{t("featAdm.batchConfirmTitle")}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {t("featAdm.batchConfirmBody", { n: keys.length, status: t(`featAdm.status.${status}`) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => void apply()}>
                <BadgeCheck size={14} aria-hidden className="mr-1.5" />
                {t("featAdm.apply")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}

/* ── one tile ───────────────────────────────────────────────────────────────*/

type TileState = {
  status: FeatureStatus;
  hiddenFromMenu: boolean;
  startsLocal: string;
  endsLocal: string;
  autoReenable: boolean;
  customTitle: string;
  customMessage: string;
};

function FeatureTile({ row }: { row: FeatureAdminRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState<TileState>({
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

  const patch = (update: Partial<TileState>) => {
    setValue((prev) => ({ ...prev, ...update }));
    setDirty(true);
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

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[value.status]}`} />
            {t(row.nameKey)}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-faint">{row.path}</p>
        </div>
        {row.updatedAt && (
          <p className="shrink-0 text-[11px] text-faint">
            {t("featAdm.updated")}: {new Date(row.updatedAt).toLocaleDateString("pl-PL")}
          </p>
        )}
      </div>

      {/* Status — a segmented row, one honest state at a time. */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {FEATURE_STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => patch({ status: s })}
            aria-pressed={value.status === s}
            className={`rounded-xl border px-2 py-2 text-[12px] font-semibold transition-colors ${
              value.status === s
                ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.12)] text-ink"
                : "border-line bg-surface text-muted hover:text-ink"}`}>
            {t(`featAdm.status.${s}`)}
          </button>
        ))}
      </div>

      {restricted && (
        <div className="mt-4 space-y-3.5 border-t border-line pt-3.5">
          {value.status === "DISABLED" ? (
            <p className="text-[12px] leading-relaxed text-faint">{t("featAdm.hiddenForced")}</p>
          ) : (
            <label className="flex items-center justify-between gap-4">
              <span className="text-[13px] font-medium text-ink">{t("featAdm.hidden")}</span>
              <Switch checked={value.hiddenFromMenu} onChange={(v) => patch({ hiddenFromMenu: v })}
                label={t("featAdm.hidden")} />
            </label>
          )}

          <div>
            <p className="text-[12px] font-semibold text-muted">{t("featAdm.window")}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
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
                  className="mt-1.5" maxLength={120} />
              </div>
              <div>
                <Label>{t("featAdm.customMessage")}</Label>
                <textarea value={value.customMessage} rows={2} maxLength={500}
                  onChange={(e) => patch({ customMessage: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]" />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end border-t border-line pt-3.5">
        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
          {t("common.save")}
        </Button>
      </div>
    </Card>
  );
}

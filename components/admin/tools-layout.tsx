"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, ChevronDown, ExternalLink, LayoutGrid, Loader2, Plus, RotateCcw, Settings2, X,
} from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import type { AvailabilityMap, MenuBadge } from "@/lib/features";
import { CATALOG_ITEMS, catalogItem, type HubCardDef } from "@/lib/tool-cards";
import {
  itemBadge, itemLabelKey, placementsOf, sectionDef, unplacedItems,
  type LayoutFlags, type ToolsLayout,
} from "@/lib/tool-layout";
import { resetToolsLayoutAction, saveToolsLayoutAction } from "@/app/actions/tool-layout";
import { cn, formatInstant } from "@/lib/utils";

/**
 * NARZĘDZIA I SILNIKI → UKŁAD DLA KLIENTÓW — the presentation layer of the
 * catalogue (lib/tool-layout.ts), and the three per-item switches shown on a
 * tool's own row. Nothing here touches what a tool does: every write goes
 * through app/actions/tool-layout.ts, which stores one normalised document.
 */

export const FLAG_KEYS = ["tools", "menu", "start"] as const satisfies readonly (keyof LayoutFlags)[];

const LAYOUT_HREF = "/admin/ai/uklad";

/* ── the two views of the screen ─────────────────────────────────────────── */

export function ToolsViewTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const tabs = [
    { href: "/admin/ai", key: "config", icon: Settings2 },
    { href: LAYOUT_HREF, key: "layout", icon: LayoutGrid },
  ] as const;
  return (
    <nav aria-label={t("aicc.layout.tabsLabel")}
      className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = tab.href === LAYOUT_HREF ? pathname.startsWith(LAYOUT_HREF) : !pathname.startsWith(LAYOUT_HREF);
        return (
          <Link key={tab.key} href={tab.href} aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold transition-colors",
              active
                ? "bg-accent2-soft text-accent2 ring-1 ring-[rgb(var(--accent2)/0.30)]"
                : "text-muted hover:bg-raised hover:text-ink",
            )}>
            <tab.icon size={15} aria-hidden />
            {t(`aicc.layout.tab.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}

/* ── three independent switches ──────────────────────────────────────────── */

/**
 * Narzędzia / Menu / Start. Each switch changes its own flag only. They wrap
 * instead of squeezing: three side by side where they fit, fewer per line on
 * a narrow column, one per line on a phone.
 */
export function FlagToggles({ flags, onChange, disabled, itemName }: {
  flags: LayoutFlags;
  onChange: (next: LayoutFlags) => void;
  disabled?: boolean;
  itemName: string;
}) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={itemName}
      className="flex flex-wrap gap-1.5 [&>*]:min-w-[8.5rem] [&>*]:flex-1">
      {FLAG_KEYS.map((f) => (
        <label key={f} data-flag={f} data-on={flags[f] ? "1" : "0"}
          title={t(`aicc.layout.flagFull.${f}`)}
          className="flex min-h-[40px] items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[12px] font-medium text-ink">{t(`aicc.layout.flag.${f}`)}</span>
          <Switch checked={flags[f]} disabled={disabled}
            onChange={(v) => onChange({ ...flags, [f]: v })}
            label={`${t(`aicc.layout.flagFull.${f}`)} — ${itemName}`} />
        </label>
      ))}
    </div>
  );
}

const BADGE_STATUS: Record<Exclude<MenuBadge, null>, string> = {
  soon: "COMING_SOON", maintenance: "MAINTENANCE", disabled: "DISABLED",
};

function StatusPill({ badge }: { badge: MenuBadge }) {
  const { t } = useI18n();
  if (!badge) return null;
  return (
    <Badge tone={badge === "maintenance" ? "warning" : badge === "disabled" ? "neutral" : "accent"} className="shrink-0">
      {t(`featAdm.status.${BADGE_STATUS[badge]}`)}
    </Badge>
  );
}

/* ── on a tool's own row ─────────────────────────────────────────────────── */

/**
 * The catalogue items a switchboard entry governs, each with its three layout
 * switches. A switch saves at once (the other two, and the rest of the layout,
 * are left as stored); the readout above re-runs with the new flags.
 */
export function ItemPlacements({ items, layout, availability, onFlags, note }: {
  items: HubCardDef[];
  layout: ToolsLayout;
  availability: AvailabilityMap;
  onFlags: (itemKey: string, flags: LayoutFlags) => Promise<boolean>;
  /** Why these items answer to this entry (a category's, a hub's). */
  note?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;

  const change = async (key: string, next: LayoutFlags) => {
    setBusy(key);
    const ok = await onFlags(key, next);
    setBusy(null);
    if (ok) toast.success(t("aicc.layout.flagSaved"));
    else toast.error(t("common.error"));
  };

  return (
    <div className="mt-3.5 border-t border-line pt-3" data-placements>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
        {t("aicc.layout.placementTitle", { n: items.length })}
      </p>
      <ul className="mt-1 divide-y divide-line">
        {items.map((item) => {
          const name = t(itemLabelKey(item));
          const where = placementsOf(layout, item.key)
            .map((s) => t(sectionDef(s)?.titleKey ?? s));
          return (
            <li key={item.key} data-item={item.key} className="min-w-0 py-2.5">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{name}</span>
                  <span className="block text-[11.5px] leading-snug text-faint">
                    {where.length > 0
                      ? t("aicc.layout.placementIn", { sections: where.join(" · ") })
                      : t("aicc.layout.placementNone")}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {busy === item.key && <Loader2 size={13} className="animate-spin text-faint" aria-hidden />}
                  <StatusPill badge={itemBadge(availability, item)} />
                </span>
              </div>
              <FlagToggles flags={layout.flags[item.key] ?? { tools: false, menu: false, start: false }}
                itemName={name} disabled={busy !== null}
                onChange={(next) => void change(item.key, next)} />
            </li>
          );
        })}
      </ul>
      {note && <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{note}</p>}
      <Link href={LAYOUT_HREF}
        className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:opacity-80">
        {t("aicc.layout.placementLink")} <ExternalLink size={12} aria-hidden />
      </Link>
    </div>
  );
}

/* ── the editor ──────────────────────────────────────────────────────────── */

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

const clone = (l: ToolsLayout): ToolsLayout => ({
  v: 1,
  sections: l.sections.map((s) => ({ ...s, items: [...s.items] })),
  flags: Object.fromEntries(Object.entries(l.flags).map(([k, f]) => [k, { ...f }])),
});

function IconButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-35">
      {children}
    </button>
  );
}

/**
 * The whole layout, edited as a draft and saved in one go. The caller keys
 * this on the stored version, so a save (or a reload after a conflict)
 * remounts it with what is stored.
 */
export function ToolsLayoutEditor({ initial, updatedAt, availability }: {
  initial: ToolsLayout;
  /** The stored version this draft started from — null while the default is in force. */
  updatedAt: string | null;
  availability: AvailabilityMap;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<ToolsLayout>(() => clone(initial));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);

  const edit = (fn: (l: ToolsLayout) => void) => setDraft((prev) => { const next = clone(prev); fn(next); return next; });
  const nameOf = (key: string) => {
    const item = catalogItem(key);
    return item ? t(itemLabelKey(item)) : key;
  };
  const sectionName = (key: string) => t(sectionDef(key)?.titleKey ?? key);
  const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b), locale);
  const unplaced = unplacedItems(draft);

  const save = async () => {
    setBusy(true);
    const res = await saveToolsLayoutAction(draft, updatedAt);
    setBusy(false);
    if (res.ok) { toast.success(t("aicc.layout.saved")); router.refresh(); return; }
    if (res.error === "conflict") { setConflict(true); return; }
    toast.error(t("common.error"));
  };

  const reset = async () => {
    setConfirmReset(false);
    setBusy(true);
    const res = await resetToolsLayoutAction();
    setBusy(false);
    if (res.ok) { toast.success(t("aicc.layout.saved")); router.refresh(); }
    else toast.error(t("common.error"));
  };

  return (
    <div className="min-w-0 space-y-3.5" data-layout-editor>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[12px] text-faint">
          {updatedAt
            ? t("aicc.layout.lastSaved", { at: formatInstant(updatedAt, locale) })
            : t("aicc.layout.isDefault")}
        </p>
        <Button variant="ghost" size="sm" disabled={busy || updatedAt === null} onClick={() => setConfirmReset(true)}>
          <RotateCcw size={14} aria-hidden className="mr-1.5" />
          {t("aicc.layout.reset")}
        </Button>
      </div>

      <p className="rounded-xl bg-raised px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted">
        {t("aicc.layout.flagsNote")}
      </p>

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[rgb(var(--warning)/0.12)] px-3.5 py-2.5 text-[13px] text-warning">
          <span className="min-w-0">{t("aicc.layout.conflict")}</span>
          <Button variant="secondary" size="sm" onClick={() => router.refresh()}>{t("aicc.layout.reload")}</Button>
        </div>
      )}

      <ol className="space-y-2.5">
        {draft.sections.map((s, si) => {
          const def = sectionDef(s.key);
          const Icon = def?.icon ?? LayoutGrid;
          const expanded = open[s.key] === true;
          const panelId = `layout-sec-${s.key}`;
          const addable = CATALOG_ITEMS.map((i) => i.key).filter((k) => !s.items.includes(k)).sort(byName);
          return (
            <li key={s.key} data-section={s.key} data-visible={s.visible ? "1" : "0"}>
              <Card className={cn("min-w-0 overflow-hidden", !s.visible && "opacity-80")}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-raised text-[11px] font-bold tabular-nums text-muted">
                    {si + 1}
                  </span>
                  <Icon size={16} aria-hidden className="shrink-0 text-accent2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{sectionName(s.key)}</span>
                    <span className="block text-[11.5px] text-faint">{t("aicc.layout.itemsN", { n: s.items.length })}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <IconButton label={`${t("aicc.layout.moveUp")} — ${sectionName(s.key)}`} disabled={si === 0}
                      onClick={() => edit((l) => { l.sections = move(l.sections, si, si - 1); })}>
                      <ArrowUp size={15} aria-hidden />
                    </IconButton>
                    <IconButton label={`${t("aicc.layout.moveDown")} — ${sectionName(s.key)}`} disabled={si === draft.sections.length - 1}
                      onClick={() => edit((l) => { l.sections = move(l.sections, si, si + 1); })}>
                      <ArrowDown size={15} aria-hidden />
                    </IconButton>
                  </span>
                  <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                    <label className="flex items-center gap-2.5">
                      <Switch checked={s.visible} label={`${t("aicc.layout.sectionVisible")} — ${sectionName(s.key)}`}
                        onChange={(v) => edit((l) => { l.sections[si].visible = v; })} />
                      <span className="text-[12.5px] font-medium text-ink">{t("aicc.layout.sectionVisible")}</span>
                    </label>
                    <button type="button" aria-expanded={expanded} aria-controls={panelId}
                      onClick={() => setOpen((o) => ({ ...o, [s.key]: !expanded }))}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-accent2-soft px-3 text-[12.5px] font-semibold text-accent2 transition-[filter] hover:brightness-110">
                      {t("aicc.layout.showItems")}
                      <ChevronDown size={14} aria-hidden className={cn("transition-transform duration-200", expanded && "rotate-180")} />
                    </button>
                  </div>
                  {!s.visible && <p className="w-full text-[11.5px] leading-relaxed text-faint">{t("aicc.layout.sectionHidden")}</p>}
                </div>

                {expanded && (
                  <div id={panelId} className="border-t border-line bg-raised/40 px-3 py-3 sm:px-4">
                    {s.items.length === 0 && (
                      <p className="pb-2 text-[12px] text-faint">{t("aicc.layout.emptySection")}</p>
                    )}
                    <ol className="divide-y divide-line">
                      {s.items.map((key, ii) => {
                        const item = catalogItem(key);
                        if (!item) return null;
                        const name = nameOf(key);
                        const also = placementsOf(draft, key).filter((k) => k !== s.key).map(sectionName);
                        return (
                          <li key={key} data-item={key} className="min-w-0 py-2.5">
                            <div className="mb-1.5 flex items-start gap-2">
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{name}</span>
                                  <StatusPill badge={itemBadge(availability, item)} />
                                </span>
                                <span className="block truncate text-[11.5px] text-faint">{item.href}</span>
                                {also.length > 0 && (
                                  <span className="block text-[11.5px] text-accent2">{t("aicc.layout.alsoIn", { sections: also.join(" · ") })}</span>
                                )}
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                <IconButton label={`${t("aicc.layout.moveUp")} — ${name}`} disabled={ii === 0}
                                  onClick={() => edit((l) => { l.sections[si].items = move(l.sections[si].items, ii, ii - 1); })}>
                                  <ArrowUp size={14} aria-hidden />
                                </IconButton>
                                <IconButton label={`${t("aicc.layout.moveDown")} — ${name}`} disabled={ii === s.items.length - 1}
                                  onClick={() => edit((l) => { l.sections[si].items = move(l.sections[si].items, ii, ii + 1); })}>
                                  <ArrowDown size={14} aria-hidden />
                                </IconButton>
                                <IconButton label={`${t("aicc.layout.remove")} — ${name}`}
                                  onClick={() => edit((l) => { l.sections[si].items.splice(ii, 1); })}>
                                  <X size={14} aria-hidden />
                                </IconButton>
                              </span>
                            </div>
                            <FlagToggles flags={draft.flags[key] ?? { tools: false, menu: false, start: false }} itemName={name}
                              onChange={(next) => edit((l) => { l.flags[key] = next; })} />
                          </li>
                        );
                      })}
                    </ol>
                    <AddItem label={t("aicc.layout.addLabel")} keys={addable} nameOf={nameOf}
                      onAdd={(k) => edit((l) => { l.sections[si].items.push(k); })} />
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>

      {unplaced.length > 0 && (
        <Card className="min-w-0 px-3 py-3 sm:px-4" data-unplaced>
          <p className="text-[13px] font-semibold text-ink">{t("aicc.layout.unplacedTitle", { n: unplaced.length })}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-faint">{t("aicc.layout.unplacedSub")}</p>
          <ul className="mt-2 divide-y divide-line">
            {[...unplaced].sort(byName).map((key) => {
              const item = catalogItem(key);
              if (!item) return null;
              const name = nameOf(key);
              return (
                <li key={key} data-item={key} className="min-w-0 py-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{name}</span>
                        <StatusPill badge={itemBadge(availability, item)} />
                      </span>
                      <span className="block truncate text-[11.5px] text-faint">{item.href}</span>
                    </span>
                    <Select aria-label={`${t("aicc.layout.addTo")} — ${name}`} value=""
                      className="h-9 w-full min-w-0 text-[12.5px] sm:w-56"
                      onChange={(e) => {
                        const target = e.target.value;
                        if (target) edit((l) => { l.sections.find((x) => x.key === target)?.items.push(key); });
                      }}>
                      <option value="">{t("aicc.layout.addTo")}</option>
                      {draft.sections.map((s) => <option key={s.key} value={s.key}>{sectionName(s.key)}</option>)}
                    </Select>
                  </div>
                  <FlagToggles flags={draft.flags[key] ?? { tools: false, menu: false, start: false }} itemName={name}
                    onChange={(next) => edit((l) => { l.flags[key] = next; })} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Sticky above the admin dock on a phone, at the bottom on a desktop —
          the same placement as the bulk bar on the configuration view. */}
      {(dirty || busy) && (
        <div className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-30 -mx-1 px-1 pb-2 pt-2 lg:bottom-0 lg:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="overlay flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 shadow-e3" data-savebar>
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">{t("aicc.layout.unsaved")}</span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(clone(initial)); setConflict(false); }}>
              {t("aicc.layout.discard")}
            </Button>
            <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" aria-hidden /> : null}
              {t("aicc.layout.save")}
            </Button>
          </div>
        </div>
      )}

      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal>
          <Card className="w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-ink">{t("aicc.layout.resetTitle")}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("aicc.layout.resetBody")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => void reset()}>{t("aicc.layout.reset")}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function AddItem({ label, keys, nameOf, onAdd }: {
  label: string;
  keys: string[];
  nameOf: (key: string) => string;
  onAdd: (key: string) => void;
}) {
  const { t } = useI18n();
  const [pick, setPick] = useState("");
  if (keys.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
      <Select aria-label={label} value={pick} onChange={(e) => setPick(e.target.value)}
        className="h-9 min-w-0 flex-1 text-[12.5px] sm:max-w-xs">
        <option value="">{t("aicc.layout.addPlaceholder")}</option>
        {/* The route disambiguates two items of one name (the edit tool and
            the Moda workflow "Niewidzialny manekin"). */}
        {keys.map((k) => <option key={k} value={k}>{`${nameOf(k)} — ${catalogItem(k)?.href ?? k}`}</option>)}
      </Select>
      <Button variant="secondary" size="sm" disabled={!pick} onClick={() => { onAdd(pick); setPick(""); }}>
        <Plus size={14} aria-hidden className="mr-1" />
        {t("aicc.layout.add")}
      </Button>
    </div>
  );
}

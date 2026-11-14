"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";
import type { IceLocale } from "@/lib/ice/types";
import {
  icePricingCardsRestoreAction, icePricingCardsSaveAction, icePricingCardsStateAction,
} from "@/app/actions/ice";
import type { PricingCardsState } from "@/lib/server/ice/pricing-cards";
import {
  CARD_GROUP_IDS, CARD_GROUP_TITLE, CARD_LIMITS, allowedStatuses, checkCardsDoc, defaultPlanCard, editGroup,
  itemIds, lineState, missingFeatures, missingLocales, moveItem, newCustomId, planCardConfig, withPlan,
  type CardGroupId, type CardItem, type CardStatus, type PlanCardConfig, type PricingCardsDoc,
} from "@/components/plan/card-features";
import { featureOn, type FeatureKey } from "@/components/plan/pricing-config";
import { Btn, LocaleTabs, Sheet, call, cls, errorText, when, type T } from "./shared";
import { Chevron, Eye, Grip, IconBtn, useRowDrag } from "./layout-panel";
import s from "./editor.module.css";

/**
 * „Edytuj stronę” → KARTY PLANÓW (Plany V3, 0179): the feature lines of each
 * plan card, per plan. Edits collect in a draft („Cofnij” steps back through
 * it, „Anuluj” drops it); „Zapisz” publishes the whole document with
 * compare-and-set; „Historia” restores any saved state — after a refresh too.
 *
 * A line bound to a feature cannot be marked against the truth of the plan
 * (the select offers only what the plan really has, and says why); a custom
 * line is the admin's own words and mark. Nothing here touches a price, a
 * credit amount or a capability.
 *
 *
 * The default names it shows are the card's own words (pricing.feat.*,
 * pricing.group.*); the editor's i18n scope carries those namespaces
 * (lib/i18n/scopes.ts, derived by scripts/i18n-scope-tests.ts).
 */
const featName = (t: T, f: FeatureKey) => t(`pricing.feat.${f}`);
const groupName = (t: T, g: CardGroupId) => t(CARD_GROUP_TITLE[g]);
export function PricingCardsPanel({ t, locale, crumbs, onClose }: {
  t: T; locale: IceLocale; crumbs: string; onClose: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<PricingCardsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PricingCardsDoc | null>(null);
  const [undo, setUndo] = useState<PricingCardsDoc[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [lang, setLang] = useState<IceLocale>(locale);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<CardGroupId>>(new Set(["highlights"]));
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ error: string; at: string | null } | null>(null);

  const adopt = useCallback((next: PricingCardsState) => {
    setState(next);
    setDraft(next.doc);
    setUndo([]);
    setProblem(null);
    setSlug((cur) => (next.plans.some((p) => p.slug === cur) ? cur
      : next.plans.find((p) => p.slug === "pro")?.slug ?? next.plans[0]?.slug ?? ""));
  }, []);

  useEffect(() => {
    void call(icePricingCardsStateAction()).then((res) => {
      if (res.ok) adopt(res.data);
      else setError(res.error === "migration_missing" ? t("ice.cards.migrationMissing") : errorText(t, res.error));
    });
  }, [adopt, t]);

  const dirty = Boolean(state && draft && JSON.stringify(state.doc) !== JSON.stringify(draft));
  const plan = state?.plans.find((p) => p.slug === slug) ?? null;
  const config = useMemo(() => (draft && slug ? planCardConfig(draft, slug) : null), [draft, slug]);

  // The latest draft, read by edits that run later (a toast's „Cofnij”).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const lastKey = useRef<string | null>(null);
  /**
   * One edit of a plan's card, kept for „Cofnij”. Typing in one field is one
   * step (`key`), not one step per letter.
   */
  const applyTo: ApplyTo = (planSlug, fn, key) => {
    const cur = draftRef.current;
    if (!cur) return;
    const next = withPlan(cur, planSlug, fn(planCardConfig(cur, planSlug)));
    draftRef.current = next;
    if (!key || key !== lastKey.current) setUndo((u) => [...u.slice(-49), cur]);
    lastKey.current = key ?? null;
    setDraft(next);
    setProblem(null);
  };
  const stepBack = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    lastKey.current = null;
    setUndo((u) => u.slice(0, -1));
    setDraft(prev);
  };
  const cancel = () => {
    if (!state) return;
    lastKey.current = null;
    setDraft(state.doc);
    setUndo([]);
    setEditing(null);
    setProblem(null);
  };
  const close = () => {
    if (dirty && !window.confirm(t("ice.cards.confirmLeave"))) return;
    onClose();
  };

  const answer = (res: Awaited<ReturnType<typeof icePricingCardsSaveAction>>, done: string) => {
    if (res.ok) {
      adopt(res.data);
      setEditing(null);
      notify.success(done);
      router.refresh();
      return;
    }
    if (res.error === "conflict" && res.current) {
      // Someone saved meanwhile: their version becomes the base; the draft
      // stays, so the admin decides (Anuluj = take theirs, Zapisz = overwrite).
      setState(res.current as PricingCardsState);
      notify.error(t("ice.cards.conflict"));
      return;
    }
    if (res.error === "invalid" && res.current) {
      const c = res.current as { error: string; at: string | null };
      setProblem(c);
      notify.error(problemText(t, c.error));
      return;
    }
    notify.error(res.error === "noop" ? t("ice.cards.noop") : errorText(t, res.error));
  };

  const save = async () => {
    if (!state || !draft) return;
    const checked = checkCardsDoc(draft);
    if (!checked.ok) {
      setProblem({ error: checked.error, at: checked.at ?? null });
      notify.error(problemText(t, checked.error));
      return;
    }
    setBusy(true);
    const res = await call(icePricingCardsSaveAction({ doc: checked.doc, base: state.updatedAt }));
    setBusy(false);
    answer(res, t("ice.cards.saved"));
  };
  const restore = async (version: string) => {
    if (!state) return;
    if (!window.confirm(t(dirty ? "ice.cards.confirmRestoreDirty" : "ice.cards.confirmRestore"))) return;
    setBusy(true);
    const res = await call(icePricingCardsRestoreAction({ version, base: state.updatedAt }));
    setBusy(false);
    answer(res, t("ice.cards.restored"));
  };

  const footer = state && draft && (
    <div className={s.row} data-cards-actions="">
      <Btn small kind="ghost" disabled={undo.length === 0 || busy} title={t("ice.cards.undoHint")} onClick={stepBack}>↶ {t("ice.cards.undo")}</Btn>
      <Btn small kind="ghost" disabled={!dirty || busy} onClick={cancel}>{t("ice.cards.cancel")}</Btn>
      <Btn small kind="primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? t("ice.saving") : t("ice.cards.save")}</Btn>
      {dirty && <span className={cls(s.chip, s.bulkChipWarn)} data-cards-dirty="">{t("ice.cards.unsaved")}</span>}
    </div>
  );

  return (
    <Sheet t={t} wide title={t("ice.cards.title")} crumbs={crumbs} onClose={close} footer={footer}>
      {error && <p className={s.error}>{error}</p>}
      {!state && !error && <p className={s.meta}>{t("ice.loading")}</p>}
      {state && draft && config && plan && (
        <>
          <p className={s.meta}>{t("ice.cards.sub")}</p>
          {/* flexShrink 0: a scrolling tab strip in the sheet's flex column
              would otherwise shrink to nothing once the groups are long. */}
          <div className={s.tabs} style={{ flexShrink: 0 }} role="tablist" aria-label={t("ice.cards.plans")} data-cards-plans="">
            {state.plans.map((p) => (
              <button key={p.slug} type="button" role="tab" aria-selected={p.slug === slug} data-cards-plan={p.slug}
                className={cls(s.tab, p.slug === slug && s.tabOn, draft.plans[p.slug] && s.tabMark)}
                onClick={() => { setSlug(p.slug); setEditing(null); }}>
                {p.slug === "agency" ? t("plans.tier.business") : p.name}
              </button>
            ))}
          </div>
          <div className={s.row} style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span className={s.meta}>{t("ice.cards.language")}</span>
            <LocaleTabs t={t} value={lang} onChange={setLang} />
            {draft.plans[slug] && (
              <Btn small kind="ghost" disabled={busy} onClick={() => {
                if (window.confirm(t("ice.cards.confirmPlanDefault"))) applyTo(slug, () => defaultPlanCard(slug));
              }}>{t("ice.cards.planDefault")}</Btn>
            )}
          </div>
          {problem && <p className={s.error} data-cards-problem="">{problemText(t, problem.error)}{problem.at ? ` (${problem.at})` : ""}</p>}

          {CARD_GROUP_IDS.map((gid) => {
            const group = config.groups.find((g) => g.id === gid);
            if (!group) return null;
            return (
              <GroupEditor key={`${slug}:${gid}`} t={t} lang={lang} slug={slug} caps={plan.capabilities}
                config={config} gid={gid} open={openGroups.has(gid)} busy={busy} editing={editing}
                onToggle={() => setOpenGroups((o) => {
                  const n = new Set(o);
                  if (n.has(gid)) n.delete(gid); else n.add(gid);
                  return n;
                })}
                onEdit={setEditing} applyTo={applyTo} />
            );
          })}

          <h3 className={s.tileName} style={{ marginTop: 18 }}>{t("ice.cards.history")}</h3>
          <p className={s.meta}>{t("ice.cards.historyHint")}</p>
          <ol className={s.list} data-cards-history="">
            {state.versions.length === 0 && <li className={s.meta}>{t("ice.cards.historyEmpty")}</li>}
            {state.versions.map((v, i) => (
              <li key={v.id} className={s.row} style={{ justifyContent: "space-between", flexWrap: "wrap" }} data-cards-version={v.id}>
                <span className={s.meta}>
                  {when(v.createdAt, locale)} · {v.author ?? "—"} · {t(v.action === "restore" ? "ice.cards.actRestore" : "ice.cards.actSave")}
                  {i === 0 && <span className={s.chip} style={{ marginLeft: 6 }}>{t("ice.cards.current")}</span>}
                </span>
                {i > 0 && v.restorable && (
                  <Btn small kind="ghost" disabled={busy} onClick={() => void restore(v.id)}>{t("ice.cards.restore")}</Btn>
                )}
              </li>
            ))}
          </ol>
          <div className={s.row}>
            <Btn small kind="ghost" disabled={busy || (state.updatedAt === null)} onClick={() => void restore("default")}>
              {t("ice.cards.restoreDefault")}
            </Btn>
          </div>
        </>
      )}
    </Sheet>
  );
}

type ApplyTo = (slug: string, fn: (c: PlanCardConfig) => PlanCardConfig, key?: string) => void;

function problemText(t: T, code: string): string {
  const known = ["custom_needs_text", "text_too_long", "bad_placeholder", "bad_text", "too_large", "bad_items"];
  return t(known.includes(code) ? `ice.cards.err.${code}` : "ice.cards.err.generic");
}

function GroupEditor({ t, lang, slug, caps, config, gid, open, busy, editing, onToggle, onEdit, applyTo }: {
  t: T; lang: IceLocale; slug: string; caps: Record<string, number | boolean>; config: PlanCardConfig; gid: CardGroupId;
  open: boolean; busy: boolean; editing: string | null;
  onToggle: () => void; onEdit: (id: string | null) => void; applyTo: ApplyTo;
}) {
  const apply = (fn: (c: PlanCardConfig) => PlanCardConfig, key?: string) => applyTo(slug, fn, key);
  const group = config.groups.find((g) => g.id === gid)!;
  const items = group.items;
  const title = group.title?.[lang] ?? "";
  const shown = items.filter((i) => !i.hidden && lineState(i, slug, caps)).length;
  const { props, rowCls } = useRowDrag((from, to) => apply((c) => moveItem(c, gid, from, to)));
  const missing = missingFeatures(config);

  const add = () => {
    const id = newCustomId(itemIds(config));
    apply((c) => editGroup(c, gid, (g) => { g.items.push({ id, label: { [lang]: "" }, status: "yes" }); }));
    onEdit(id);
  };
  const remove = (item: CardItem, index: number) => {
    if (!window.confirm(t("ice.cards.confirmRemove"))) return;
    apply((c) => editGroup(c, gid, (g) => { g.items = g.items.filter((x) => x.id !== item.id); }));
    notify.success(t("ice.cards.removed"), {
      action: {
        label: t("ice.cards.undo"),
        onClick: () => apply((c) => editGroup(c, gid, (g) => {
          if (!g.items.some((x) => x.id === item.id)) g.items.splice(Math.min(index, g.items.length), 0, item);
        })),
      },
    });
  };

  return (
    <section className={s.field} data-cards-group={gid} style={{ borderTop: "1px solid var(--ice-line, rgba(0,0,0,.08))", paddingTop: 10 }}>
      <div className={s.row} style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <button type="button" className={cls(s.btn, s.ghost, s.small)} aria-expanded={open} onClick={onToggle} data-cards-toggle={gid}>
          <Chevron dir={open ? "down" : "right"} /> {title || groupName(t, gid)}
          <span className={s.chip} style={{ marginLeft: 6 }}>{t("ice.cards.count", { n: shown, all: items.length })}</span>
          {group.hidden && <span className={cls(s.chip, s.bulkChipWarn)} style={{ marginLeft: 4 }}>{t("ice.cards.groupHidden")}</span>}
          {!group.hidden && shown === 0 && <span className={cls(s.chip, s.bulkChipWarn)} style={{ marginLeft: 4 }}>{t("ice.cards.groupEmpty")}</span>}
        </button>
        <label className={s.check} data-cards-group-visible={gid}>
          <input type="checkbox" checked={!group.hidden} disabled={busy}
            onChange={(e) => apply((c) => editGroup(c, gid, (g) => { if (e.target.checked) delete g.hidden; else g.hidden = true; }))} />
          {t("ice.cards.groupVisible")}
        </label>
      </div>
      {open && (
        <>
          <label className={s.field}>
            <span className={s.meta}>{t("ice.cards.groupName", { lang: lang.toUpperCase() })}</span>
            <input className={s.input} value={title} maxLength={CARD_LIMITS.text} placeholder={groupName(t, gid)}
              data-cards-group-name={gid}
              onChange={(e) => {
                const v = e.target.value;
                apply((c) => editGroup(c, gid, (g) => {
                  const next = { ...(g.title ?? {}), [lang]: v };
                  if (!v.trim()) delete next[lang];
                  if (Object.keys(next).length) g.title = next; else delete g.title;
                }), `title:${gid}:${lang}`);
              }} />
          </label>
          {group.title && missingLocales(group.title).length > 0 && (
            <p className={s.note}>{t("ice.cards.groupNameFallback", { langs: missingLocales(group.title).map((l) => l.toUpperCase()).join(", ") })}</p>
          )}
          <ol className={s.list} data-cards-items={gid}>
            {items.map((item, i) => (
              <ItemRow key={item.id} t={t} lang={lang} slug={slug} caps={caps} item={item} index={i} count={items.length}
                busy={busy} editing={editing === item.id} rowCls={rowCls(i)} dragProps={props(i, item.id)}
                onEdit={() => onEdit(editing === item.id ? null : item.id)}
                onMove={(to) => apply((c) => moveItem(c, gid, i, to))}
                onChange={(fn, key) => apply((c) => editGroup(c, gid, (g) => { const it = g.items.find((x) => x.id === item.id); if (it) fn(it); }), key)}
                onRemove={() => remove(item, i)} />
            ))}
          </ol>
          <div className={s.row} style={{ flexWrap: "wrap" }}>
            <Btn small disabled={busy || items.length >= CARD_LIMITS.itemsPerGroup} onClick={add}>{t("ice.cards.add")}</Btn>
            {missing.length > 0 && (
              <select className={s.input} style={{ maxWidth: 260 }} value="" disabled={busy || items.length >= CARD_LIMITS.itemsPerGroup}
                aria-label={t("ice.cards.addFeature")} data-cards-add-feature={gid}
                onChange={(e) => {
                  const f = e.target.value as FeatureKey;
                  if (!f) return;
                  apply((c) => editGroup(c, gid, (g) => { g.items.push({ id: `f:${f}`, feature: f, status: "auto" }); }));
                }}>
                <option value="">{t("ice.cards.addFeature")}</option>
                {missing.map((f) => <option key={f} value={f}>{featName(t, f)}</option>)}
              </select>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type DragProps = ReturnType<ReturnType<typeof useRowDrag>["props"]>;

function ItemRow({ t, lang, slug, caps, item, index, count, busy, editing, rowCls, dragProps, onEdit, onMove, onChange, onRemove }: {
  t: T; lang: IceLocale; slug: string; caps: Record<string, number | boolean>; item: CardItem; index: number; count: number;
  busy: boolean; editing: boolean; rowCls: string; dragProps: DragProps;
  onEdit: () => void; onMove: (to: number) => void; onChange: (fn: (it: CardItem) => void, key?: string) => void; onRemove: () => void;
}) {
  const own = item.label?.[lang] ?? "";
  const fallback = item.feature ? featName(t, item.feature) : "";
  const shownAs = lineState(item, slug, caps);
  const truth = item.feature ? featureOn(item.feature, slug, caps) : null;
  const allowed = allowedStatuses(item, slug, caps);
  const lacking = item.feature ? [] : missingLocales(item.label);
  const mark = shownAs === "yes" ? "✓" : shownAs === "soon" ? "⏱" : shownAs === "no" ? "✕" : "—";
  return (
    <li className={rowCls} {...dragProps} data-cards-item={item.id}>
      <span className={s.dragHandle} aria-hidden="true" title={t("ice.layout.dragHint")}><Grip /></span>
      <span className={s.bulkInfo} style={{ gridColumn: "span 2" }}>
        <span className={s.tileName} style={{ opacity: item.hidden || !shownAs ? 0.6 : 1 }}>
          <span aria-hidden="true">{mark} </span>{own || fallback || t("ice.cards.noText")}
        </span>
        <span className={s.row} style={{ flexWrap: "wrap" }}>
          <span className={s.chip}>{item.feature ? t("ice.cards.bound") : t("ice.cards.custom")}</span>
          {item.hidden && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.cards.hiddenChip")}</span>}
          {!item.hidden && !shownAs && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.cards.notOnPlan")}</span>}
          {!own && item.feature && <span className={s.chip}>{t("ice.cards.defaultText")}</span>}
          {lacking.length > 0 && (
            <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.cards.missingLangs", { langs: lacking.map((l) => l.toUpperCase()).join(", ") })}</span>
          )}
        </span>
      </span>
      <span className={s.bulkTools}>
        <IconBtn label={t("ice.layout.earlier")} disabled={index === 0 || busy} data={`${item.id}|up`} onClick={() => onMove(index - 1)}><Chevron dir="up" /></IconBtn>
        <IconBtn label={t("ice.layout.later")} disabled={index === count - 1 || busy} data={`${item.id}|down`} onClick={() => onMove(index + 1)}><Chevron dir="down" /></IconBtn>
        <IconBtn label={item.hidden ? t("ice.layout.show") : t("ice.layout.hide")} disabled={busy} data={`${item.id}|hide`}
          onClick={() => onChange((it) => { if (it.hidden) delete it.hidden; else it.hidden = true; })}><Eye off={Boolean(item.hidden)} /></IconBtn>
        <Btn small onClick={onEdit}>{editing ? t("ice.cards.done") : t("ice.layout.edit")}</Btn>
        <IconBtn label={t("ice.layout.remove")} disabled={busy} data={`${item.id}|remove`} onClick={onRemove}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </IconBtn>
      </span>
      {editing && (
        <div className={s.field} style={{ gridColumn: "1 / -1" }} data-cards-form={item.id}>
          <label className={s.field}>
            <span className={s.meta}>{t("ice.cards.text", { lang: lang.toUpperCase() })}</span>
            <input className={s.input} value={own} maxLength={CARD_LIMITS.text} placeholder={fallback} data-cards-text={item.id}
              onChange={(e) => {
                const v = e.target.value;
                onChange((it) => {
                  const next = { ...(it.label ?? {}), [lang]: v };
                  // A bound line without words falls back to its own label;
                  // a custom line keeps the empty field until it is written.
                  if (!v.trim() && it.feature) delete next[lang];
                  if (Object.keys(next).length) it.label = next; else delete it.label;
                }, `text:${item.id}:${lang}`);
              }} />
          </label>
          <p className={s.note}>{t(item.feature ? "ice.cards.textHintBound" : "ice.cards.textHintCustom")}</p>
          <label className={s.field}>
            <span className={s.meta}>{t("ice.cards.status")}</span>
            <select className={s.input} value={item.feature ? (allowed.includes(item.status) ? item.status : "auto") : item.status}
              disabled={busy || allowed.length < 2} data-cards-status={item.id}
              onChange={(e) => onChange((it) => { it.status = e.target.value as CardStatus; })}>
              {allowed.map((st) => <option key={st} value={st}>{statusLabel(t, st, truth)}</option>)}
            </select>
          </label>
          <p className={s.note} data-cards-lock={item.id}>
            {truth === "yes" ? t("ice.cards.lockYes")
              : truth === "soon" ? t("ice.cards.lockSoon")
              : truth === "no" ? t("ice.cards.lockNo")
              : t("ice.cards.customHint")}
          </p>
        </div>
      )}
    </li>
  );
}

function statusLabel(t: T, st: CardStatus, truth: "yes" | "soon" | "no" | null): string {
  if (st === "auto") {
    return truth === "no" ? t("ice.cards.st.autoHidden")
      : truth === "soon" ? t("ice.cards.st.autoSoon") : t("ice.cards.st.autoYes");
  }
  return t(`ice.cards.st.${st}`);
}

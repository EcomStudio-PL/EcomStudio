"use client";
import { createContext, useContext } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { MediaPicker } from "@/components/admin/media-picker";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { CMS_ICON_NAMES } from "@/lib/cms-icons";
import { FORM_HANDLERS } from "@/lib/cms-forms";
import { FEATURE_GROUPS } from "@/lib/features";
import { readField, toggleOn, writeField, type FieldDef } from "@/lib/cms-schema";
import type { LinkTarget } from "@/lib/cms-links";
import type { CmsBlockContent, CmsItem, CmsPoint, LocaleText } from "@/lib/cms";
import { aboutSlotSpec, hasPlaceholder } from "@/lib/about-page";
import { isCompletePair, readGalleryContent } from "@/lib/launch/gallery";
import { IceEditButton } from "./visual-editor";
import { LegalDocField } from "./legal-doc-field";

/**
 * THE CONTENT INPUTS.
 *
 * Which inputs a section shows comes from lib/cms-schema.ts, so adding a
 * section type is a table entry rather than another editor. This file knows
 * how to DRAW each kind of field and nothing about which section uses it.
 *
 * Every branch renders a real label — never a key — because a raw
 * `cms.label.heroBadge` on screen is a bug a person can see.
 */

export type Locale = "pl" | "en" | "de";
export const LOCALES: Locale[] = ["pl", "en", "de"];

/* ── WHERE A LINK CAN GO ──────────────────────────────────────────────────
 *
 * Every address field in the builder — a hero's button, a card's link, a
 * sticky CTA — shares one list of destinations: the pages that exist, the
 * anchors on the page being edited, the app's public entrances. It is a
 * `<datalist>`, so it suggests without taking the field over: an external
 * campaign URL is still just typed in.
 *
 * Through context rather than props because these fields are three levels
 * down inside repeatable item rows, and threading the same array through
 * every one of them would be the only thing those components learned.
 */
const LinkTargetsContext = createContext<LinkTarget[]>([]);

/** The id every address input points its `list` at. One datalist per screen. */
const LINK_LIST_ID = "cms-link-targets";

export function LinkTargetsProvider({ targets, children }: {
  targets: LinkTarget[]; children: React.ReactNode;
}) {
  return (
    <LinkTargetsContext.Provider value={targets}>
      {children}
      <datalist id={LINK_LIST_ID} data-link-targets>
        {targets.map((tg) => (
          <option key={tg.value} value={tg.value} label={tg.label} />
        ))}
      </datalist>
    </LinkTargetsContext.Provider>
  );
}

export function Field({ def, locale, content, onChange, onChangeWith, visible }: {
  def: FieldDef; locale: Locale; content: CmsBlockContent;
  onChange: (content: CmsBlockContent) => void;
  /** Apply an edit to the LATEST content, for fields that write twice. */
  onChangeWith: (update: (content: CmsBlockContent) => CmsBlockContent) => void;
  /** The section's own switch — read by the gallery summary only. */
  visible?: boolean;
}) {
  const { t } = useI18n();
  const label = t(`cms.label.${def.label}`);
  const hint = def.hint ? t(`cms.label.${def.hint}`) : undefined;
  const value = readField(content, def, locale);
  const set = (next: string) => onChange(writeField(content, def, locale, next));
  const localized = def.kind === "text" || def.kind === "textarea" || def.kind === "richtext";
  const id = `cms-${def.key.replace(/[.#]/g, "-")}`;

  if (def.kind === "items") {
    return <ItemsField label={label} hint={hint} locale={locale} content={content} onChange={onChange}
      field={def.key === "tiles" ? "tiles" : "items"} options={def.items} />;
  }

  // The section's pictures (O nas): media slots, not URLs in the block —
  // listed with their shape, and where they are changed.
  if (def.kind === "slots") {
    return <SlotsSummary label={label} hint={hint} slots={def.slots ?? []} />;
  }

  // A whole legal document (the language on the tab), with its own editor.
  if (def.kind === "legaldoc") {
    return <LegalDocField label={label} hint={hint} locale={locale} content={content} onChange={onChange} />;
  }

  // A group heading of a long form (the launch page). It stores nothing; it
  // is what turns ninety inputs into sections a person can find again.
  if (def.kind === "heading") {
    return (
      <div className="border-t border-line pt-4 first:border-t-0 first:pt-0" data-field-group={def.label}>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</h3>
        {hint && <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      </div>
    );
  }

  /*
    "POKAŻ SEKCJĘ …" — ON MEANS THE SECTION IS ON THE PAGE.

    One value for every language (the language tabs do not apply), written
    explicitly as "1" or "0" once touched; until then the box shows the
    section's own default, which for the price strip and the "who is behind
    it" tile is OFF — neither goes public before the owner has looked at it.
  */
  if (def.kind === "toggle") {
    const on = toggleOn(content, def);
    return (
      <div data-field-toggle={def.key}>
        <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-[13px] font-semibold tracking-tight text-ink">
          <input id={id} type="checkbox" checked={on}
            className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
            onChange={(e) => set(e.target.checked ? "1" : "0")} />
          {label}
        </label>
        {hint && <p className="mt-1.5 pl-[26px] text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      </div>
    );
  }

  if (def.kind === "gallery") {
    return <GallerySummary label={label} hint={hint} content={content} visible={visible ?? true} />;
  }

  if (def.kind === "groups") {
    // Which parts of the product a live section shows. The values are the
    // registry's own groups — there is no second list of tool categories.
    const selected = new Set(content.filter ?? []);
    const toggle = (group: string) => {
      const next = new Set(selected);
      if (next.has(group)) next.delete(group); else next.add(group);
      onChange({ ...content, filter: next.size > 0 ? [...next] : undefined });
    };
    return (
      <div>
        <Label>{label}</Label>
        <div className="flex flex-wrap gap-1.5">
          {FEATURE_GROUPS.map((group) => (
            <button key={group} type="button" onClick={() => toggle(group)}
              aria-pressed={selected.has(group)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                selected.has(group)
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line text-muted hover:bg-raised"}`}>
              {t(`cms.group.${group}`)}
            </button>
          ))}
        </div>
        {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
      </div>
    );
  }

  if (def.kind === "handler") {
    // A NAME from the approved list, never a URL. See lib/cms-forms.ts.
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Select id={id} value={value} onChange={(e) => set(e.target.value)}>
          {FORM_HANDLERS.map((h) => (
            <option key={h.key} value={h.key}>{t(`cms.handler.${h.key}`)}</option>
          ))}
        </Select>
        {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
      </div>
    );
  }

  if (def.kind === "media") {
    // The picker can set the URL and the alt text in the same tick (choosing
    // a library image seeds its alt). Both writes must build on the SAME
    // latest content or the second silently discards the first — hence the
    // functional updater rather than two independent writeField calls.
    const altDef: FieldDef = { ...def, key: "alt", kind: "text" };
    return (
      <div>
        <MediaPicker
          value={value}
          onChange={(url) => onChangeWith((c) => writeField(c, def, locale, url))}
          label={label}
          kind={def.key === "posterUrl" ? "image" : "any"}
          alt={def.key === "mediaUrl" ? readField(content, altDef, locale) : undefined}
          onAltChange={def.key === "mediaUrl"
            ? (next) => onChangeWith((c) => writeField(c, altDef, locale, next))
            : undefined}
        />
        {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
      </div>
    );
  }

  if (def.kind === "align") {
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Select id={id} value={value || "right"} onChange={(e) => set(e.target.value)}>
          <option value="right">{t("cms.alignRight")}</option>
          <option value="left">{t("cms.alignLeft")}</option>
        </Select>
      </div>
    );
  }

  /**
   * A DEADLINE IS A MOMENT, NOT A STRING. `datetime-local` gives the admin
   * their own clock; what is stored is the instant it refers to, so the
   * countdown a visitor in Berlin sees ends at the same second as the one in
   * Warsaw. The conversion is done here, at the edge, rather than leaving an
   * ambiguous "2026-09-20T23:59" to be guessed at by the renderer.
   */
  if (def.kind === "datetime") {
    const asLocalInput = (iso: string): string => {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return "";
      const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
      return d.toISOString().slice(0, 16);
    };
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-2">
          <Input id={id} type="datetime-local" value={asLocalInput(value)}
            onChange={(e) => {
              const ms = Date.parse(e.target.value);
              set(Number.isFinite(ms) ? new Date(ms).toISOString() : "");
            }} />
          {value && (
            <button type="button" onClick={() => set("")} data-clear-datetime
              className="shrink-0 rounded-lg px-2.5 py-2 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
              {t("common.clear")}
            </button>
          )}
        </div>
        {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      </div>
    );
  }

  if (def.kind === "richtext") {
    return (
      <div>
        <Label htmlFor={id} hint={locale.toUpperCase()}>{label}</Label>
        <Textarea id={id} rows={14} value={value} spellCheck
          className="font-mono text-[12.5px] leading-relaxed"
          onChange={(e) => set(e.target.value)} />
        {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      </div>
    );
  }

  if (def.kind === "url") {
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <LinkInput id={id} value={value} onChange={set} />
        {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor={id} hint={localized ? locale.toUpperCase() : undefined}>{label}</Label>
      {def.kind === "textarea"
        ? <Textarea id={id} rows={3} value={value} onChange={(e) => set(e.target.value)} />
        : <Input id={id} value={value} onChange={(e) => set(e.target.value)} />}
      {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
    </div>
  );
}

/**
 * An address field with the page's own destinations behind it.
 *
 * The line underneath is the whole point: it names where the link goes when
 * the value matches something that exists, and says nothing when it is an
 * external address. A CTA pointing at `/cennk` therefore looks different from
 * one pointing at `/cennik` BEFORE the page is published, which is the only
 * moment the typo is cheap.
 */
export function LinkInput({ id, value, onChange, placeholder }: {
  id?: string; value: string; onChange: (next: string) => void; placeholder?: string;
}) {
  const { t } = useI18n();
  const targets = useContext(LinkTargetsContext);
  const match = targets.find((tg) => tg.value === value.trim());
  return (
    <>
      <Input id={id} value={value} inputMode="url" list={LINK_LIST_ID} spellCheck={false}
        data-link-input placeholder={placeholder ?? "https://… / /cennik / #oferta"}
        onChange={(e) => onChange(e.target.value)} />
      {match && (
        <p className="mt-1.5 text-[11.5px] text-muted" data-link-resolved>
          {t("cms.linkGoesTo")} {match.label}
        </p>
      )}
    </>
  );
}

/**
 * A PRZED/PO GALLERY OF THE LAUNCH PAGE, AS THE BUILDER SHOWS IT.
 *
 * Read-only on purpose: the pairs are chosen, cropped, aligned and ordered in
 * "Edytuj stronę", against the page itself, with a compare-and-set on every
 * save. What this says is what the DRAFT holds (pairs, complete or not, the
 * switch), and the button opens the launch page in the inline editor straight
 * on this gallery's panel.
 */
function GallerySummary({ label, hint, content, visible }: {
  label: string; hint?: string; content: CmsBlockContent; visible: boolean;
}) {
  const { t } = useI18n();
  const gallery = readGalleryContent(content);
  const items = gallery?.items ?? [];
  const complete = items.filter(isCompletePair).length;
  const name = gallery ? t(`cms.label.launchGallery${gallery.gallery[0].toUpperCase()}${gallery.gallery.slice(1)}`) : label;
  return (
    <div data-gallery-summary={gallery?.gallery ?? ""}>
      <Label>{name}</Label>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl border border-line bg-sunken/50 p-3 text-[12.5px]">
        <dt className="text-faint">{t("cms.label.launchGalleryPairs")}</dt>
        <dd className="font-semibold tabular-nums">{items.length}</dd>
        <dt className="text-faint">{t("cms.label.launchGalleryComplete")}</dt>
        <dd className="tabular-nums">{complete}</dd>
        <dt className="text-faint">{t("cms.label.launchGalleryIncomplete")}</dt>
        <dd className={items.length - complete > 0 ? "font-semibold tabular-nums text-warning" : "tabular-nums"}>
          {items.length - complete}
        </dd>
        <dt className="text-faint">{t("cms.label.launchGalleryState")}</dt>
        <dd>{t(visible ? "cms.label.launchGalleryShown" : "cms.label.launchGalleryHidden")}</dd>
      </dl>
      {items.length > 0 && complete === 0 && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("cms.label.launchGalleryNoComplete")}</p>
      )}
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      {gallery && (
        <div className="mt-2.5">
          <IceEditButton path="/" elementId={`g:${gallery.gallery}`} label={t("cms.label.launchGalleryEdit")}
            className="w-full lg:w-auto" />
        </div>
      )}
    </div>
  );
}

/**
 * THE PICTURES OF AN O NAS SECTION. They are media slots — framed with a
 * focal point and zoom, a separate phone file, a clip where allowed — so they
 * are set where that machinery lives: "Edytuj stronę" (click the picture on
 * the page) or Admin → Media → Sekcje aplikacji. This row only says which
 * pictures the section has and in what shape; it stores nothing.
 */
function SlotsSummary({ label, hint, slots }: { label: string; hint?: string; slots: readonly string[] }) {
  const { t } = useI18n();
  return (
    <div data-about-slots>
      <Label>{label}</Label>
      <ul className="space-y-1.5 rounded-xl border border-line bg-sunken/50 p-3 text-[12.5px]">
        {slots.map((key) => {
          const spec = aboutSlotSpec(key);
          return (
            <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-medium text-ink">{spec ? t(`media.slot.${spec.label}`) : key}</span>
              {spec && (
                <span className="tabular-nums text-faint">
                  {spec.ratio.replace("/", ":")} · {spec.width}×{spec.height} px{spec.video ? ` · ${t("cms.label.aboutVideoOk")}` : ""}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      <a href="/admin/media?tab=sekcje" className="mt-1.5 inline-block text-[12px] font-semibold text-accent hover:underline">
        {t("cms.label.aboutPicturesOpen")}
      </a>
    </div>
  );
}

/** "[treść do potwierdzenia]" anywhere in a row (any language): the public
 *  page leaves the row out whatever its switch says. */
function rowHasPlaceholder(item: CmsItem): boolean {
  const texts = [item.title, item.description, item.badge, ...(item.points ?? []).filter((p) => !p.hidden).map((p) => p.title)];
  return texts.some((v) => Object.values((v ?? {}) as LocaleText).some((x) => hasPlaceholder(x)));
}

/** The points of one O nas card: a short line each, with an icon and its
 *  own switch. */
function PointsField({ points, locale, onChange }: {
  points: CmsPoint[]; locale: Locale; onChange: (next: CmsPoint[] | undefined) => void;
}) {
  const { t } = useI18n();
  const set = (next: CmsPoint[]) => onChange(next.length ? next : undefined);
  const patch = (j: number, part: Partial<CmsPoint>) => set(points.map((p, k) => (k === j ? { ...p, ...part } : p)));
  return (
    <div className="rounded-lg border border-line/70 bg-surface/60 p-2.5" data-points-field>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-muted">{t("cms.label.aboutPoints")}</span>
        <Button size="sm" variant="secondary" onClick={() => set([...points, {}])}>
          <Plus size={13} aria-hidden />{t("cms.label.aboutAddPoint")}
        </Button>
      </div>
      <div className="space-y-1.5">
        {points.map((p, j) => (
          <div key={j} className="grid grid-cols-[auto_1fr] items-center gap-2 sm:grid-cols-[auto_1fr_9rem_auto]">
            <label className="flex items-center" title={t("cms.label.itemVisible")}>
              <input type="checkbox" checked={!p.hidden} aria-label={t("cms.label.itemVisible")}
                className="h-4 w-4 accent-[rgb(var(--accent))]"
                onChange={(e) => patch(j, { hidden: e.target.checked ? undefined : true })} />
            </label>
            <Input placeholder={t("cms.label.aboutPoint")} value={((p.title ?? {}) as LocaleText)[locale] ?? ""}
              onChange={(e) => patch(j, { title: { ...((p.title ?? {}) as LocaleText), [locale]: e.target.value } })} />
            <Select value={p.icon ?? ""} className="col-span-2 sm:col-span-1"
              onChange={(e) => patch(j, { icon: e.target.value || undefined })}>
              <option value="">{t("cms.label.itemIcon")}</option>
              {CMS_ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
            <div className="col-span-2 flex justify-end gap-0.5 sm:col-span-1">
              <SmallBtn title={t("cms.moveUp")} disabled={j === 0}
                onClick={() => { const n = [...points]; [n[j - 1], n[j]] = [n[j], n[j - 1]]; set(n); }}>
                <ArrowUp size={14} />
              </SmallBtn>
              <SmallBtn title={t("common.delete")} onClick={() => set(points.filter((_, k) => k !== j))}>
                <Trash2 size={14} />
              </SmallBtn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The repeatable list — cards, steps, questions, contact rows, gallery
 *  images, comparison lines. One editor for all of them, because they are one
 *  shape with different fields showing. */
export function ItemsField({ label, hint, locale, content, onChange, field = "items", options }: {
  label: string; hint?: string; locale: Locale; content: CmsBlockContent;
  onChange: (content: CmsBlockContent) => void;
  /** Which list of the section this edits. `tiles` is contact_hub's second
   *  list (its channels) beside `items` (its topics). */
  field?: "items" | "tiles";
  /** O nas lists: a switch per row, points per row, no link or picture. */
  options?: FieldDef["items"];
}) {
  const { t } = useI18n();
  const items: CmsItem[] = content[field] ?? [];
  const setItems = (next: CmsItem[]) => onChange({ ...content, [field]: next });
  const patch = (i: number, part: Partial<CmsItem>) =>
    setItems(items.map((x, j) => (j === i ? { ...x, ...part } : x)));
  const text = (item: CmsItem, key: "title" | "description" | "badge") =>
    ((item[key] ?? {}) as LocaleText)[locale] ?? "";
  const setText = (i: number, key: "title" | "description" | "badge", value: string) =>
    patch(i, { [key]: { ...((items[i][key] ?? {}) as LocaleText), [locale]: value } });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <Button size="sm" variant="secondary" onClick={() => setItems([...items, {}])}>
          <Plus size={13} aria-hidden />{t("cms.addItem")}
        </Button>
      </div>
      {hint && <p className="mb-2 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-line bg-sunken/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{i + 1}</span>
                {options?.hideable && (
                  <label className="flex items-center gap-1.5 text-[11.5px] text-muted" data-item-visible={i}>
                    <input type="checkbox" checked={!item.hidden} className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
                      onChange={(e) => patch(i, { hidden: e.target.checked ? undefined : true })} />
                    {t("cms.label.itemVisible")}
                  </label>
                )}
              </span>
              <div className="flex items-center gap-0.5">
                <SmallBtn title={t("cms.moveUp")} disabled={i === 0}
                  onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setItems(n); }}>
                  <ArrowUp size={14} />
                </SmallBtn>
                <SmallBtn title={t("cms.moveDown")} disabled={i === items.length - 1}
                  onClick={() => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setItems(n); }}>
                  <ArrowDown size={14} />
                </SmallBtn>
                <SmallBtn title={t("common.delete")}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </SmallBtn>
              </div>
            </div>
            <div className="space-y-2">
              <Input placeholder={t("cms.label.itemTitle")} value={text(item, "title")}
                onChange={(e) => setText(i, "title", e.target.value)} />
              <Textarea rows={2} placeholder={t("cms.label.itemBody")} value={text(item, "description")}
                onChange={(e) => setText(i, "description", e.target.value)} />
              {options?.hideable && rowHasPlaceholder(item) && (
                <p className="text-[11.5px] leading-relaxed text-warning" data-item-placeholder={i}>
                  {t("cms.label.itemPlaceholder")}
                </p>
              )}
              {item.slot && aboutSlotSpec(item.slot) && (
                <p className="text-[11.5px] leading-relaxed text-faint" data-item-slot={item.slot}>
                  {t("cms.label.itemSlot", { name: t(`media.slot.${aboutSlotSpec(item.slot)!.label}`) })}
                </p>
              )}
              {options?.points && (
                <PointsField points={item.points ?? []} locale={locale} onChange={(points) => patch(i, { points })} />
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {!options?.plain && (
                  <LinkInput value={item.url ?? ""} placeholder={t("cms.label.itemUrl")}
                    onChange={(next) => patch(i, { url: next || undefined })} />
                )}
                {/* Stats render this instead of a title, and a comparison row
                    uses it for the other column — dropping it would make two
                    section types impossible to author. */}
                <Input placeholder={t("cms.label.itemValue")} value={item.value ?? ""}
                  onChange={(e) => patch(i, { value: e.target.value || undefined })} />
                <Input placeholder={t("cms.label.itemBadge")} value={text(item, "badge")}
                  onChange={(e) => setText(i, "badge", e.target.value)} />
                <Select value={item.icon ?? ""}
                  onChange={(e) => patch(i, { icon: e.target.value || undefined })}>
                  <option value="">{t("cms.label.itemIcon")}</option>
                  {CMS_ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                </Select>
              </div>
              {/* The picker, not a URL box: an image is chosen from the media
                  library, and nobody should be pasting storage paths by hand.
                  Not on an O nas row: its picture is a media slot. */}
              {!options?.plain && (
                <MediaPicker value={item.mediaUrl ?? ""} kind="any"
                  label={t("cms.label.itemMedia")}
                  onChange={(url) => patch(i, { mediaUrl: url || undefined })}
                  alt={((item.alt ?? {}) as LocaleText)[locale] ?? ""}
                  onAltChange={(next) =>
                    patch(i, { alt: { ...((item.alt ?? {}) as LocaleText), [locale]: next } })} />
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-faint">
            {t("cms.noItems")}
          </p>
        )}
      </div>
    </div>
  );
}

export function SmallBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string;
}) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35">
      {children}
    </button>
  );
}

/** The PL / EN / DE switch. One page holds all three languages in the same
 *  sections — nobody copies forty sections to change a language. */
export function LocaleTabs({ locale, onChange }: {
  locale: Locale; onChange: (locale: Locale) => void;
}) {
  return (
    <div className="flex rounded-lg bg-sunken/80 p-1" data-locale-tabs>
      {LOCALES.map((l) => (
        <button key={l} type="button" onClick={() => onChange(l)} aria-pressed={l === locale}
          className={`rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold uppercase transition-colors ${
            l === locale ? "bg-surface text-accent shadow-e1" : "text-muted hover:text-ink"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

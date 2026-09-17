"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { MediaPicker } from "@/components/admin/media-picker";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { CMS_ICON_NAMES } from "@/lib/cms-icons";
import { FORM_HANDLERS } from "@/lib/cms-forms";
import { FEATURE_GROUPS } from "@/lib/features";
import { readField, writeField, type FieldDef } from "@/lib/cms-schema";
import type { CmsBlockContent, CmsItem, LocaleText } from "@/lib/cms";

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

export function Field({ def, locale, content, onChange, onChangeWith }: {
  def: FieldDef; locale: Locale; content: CmsBlockContent;
  onChange: (content: CmsBlockContent) => void;
  /** Apply an edit to the LATEST content, for fields that write twice. */
  onChangeWith: (update: (content: CmsBlockContent) => CmsBlockContent) => void;
}) {
  const { t } = useI18n();
  const label = t(`cms.label.${def.label}`);
  const hint = def.hint ? t(`cms.label.${def.hint}`) : undefined;
  const value = readField(content, def, locale);
  const set = (next: string) => onChange(writeField(content, def, locale, next));
  const localized = def.kind === "text" || def.kind === "textarea" || def.kind === "richtext";
  const id = `cms-${def.key.replace(/\./g, "-")}`;

  if (def.kind === "items") {
    return <ItemsField label={label} hint={hint} locale={locale} content={content} onChange={onChange} />;
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

  return (
    <div>
      <Label htmlFor={id} hint={localized ? locale.toUpperCase() : undefined}>{label}</Label>
      {def.kind === "textarea"
        ? <Textarea id={id} rows={3} value={value} onChange={(e) => set(e.target.value)} />
        : <Input id={id} value={value} inputMode={def.kind === "url" ? "url" : undefined}
            placeholder={def.kind === "url" ? "https://… / /cennik" : undefined}
            onChange={(e) => set(e.target.value)} />}
      {hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}
    </div>
  );
}

/** The repeatable list — cards, steps, questions, contact rows, gallery
 *  images, comparison lines. One editor for all of them, because they are one
 *  shape with different fields showing. */
export function ItemsField({ label, hint, locale, content, onChange }: {
  label: string; hint?: string; locale: Locale; content: CmsBlockContent;
  onChange: (content: CmsBlockContent) => void;
}) {
  const { t } = useI18n();
  const items: CmsItem[] = content.items ?? [];
  const setItems = (next: CmsItem[]) => onChange({ ...content, items: next });
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
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
                {i + 1}
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
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder={t("cms.label.itemUrl")} value={item.url ?? ""}
                  onChange={(e) => patch(i, { url: e.target.value || undefined })} />
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
                  library, and nobody should be pasting storage paths by hand. */}
              <MediaPicker value={item.mediaUrl ?? ""} kind="any"
                label={t("cms.label.itemMedia")}
                onChange={(url) => patch(i, { mediaUrl: url || undefined })}
                alt={((item.alt ?? {}) as LocaleText)[locale] ?? ""}
                onAltChange={(next) =>
                  patch(i, { alt: { ...((item.alt ?? {}) as LocaleText), [locale]: next } })} />
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

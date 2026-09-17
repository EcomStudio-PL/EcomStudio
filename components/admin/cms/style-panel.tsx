"use client";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Label, Select } from "@/components/ui/input";
import {
  ALIGN_OPTIONS, BACKGROUND_OPTIONS, COLUMN_OPTIONS, SPACE_OPTIONS, WIDTH_OPTIONS,
} from "@/lib/cms-style";
import type { Breakpoint, SectionStyle, StyleValues } from "@/lib/cms";

/**
 * STYL and RESPONSIVE — the two tabs that decide how a section is laid out.
 *
 * STYL edits the base (desktop) values. RESPONSIVE edits the overrides for
 * tablet and phone, and shows what each control INHERITS when it has not been
 * overridden, so an admin can see that "duży odstęp" is already in force at
 * 390px without having to set it again.
 *
 * Every control is a preset, never a number. Thirty sections that each chose
 * their own padding stop looking like one website, and the enum is also why
 * nothing an admin types here can become a CSS rule.
 */

const INHERIT = "";

export function StylePanel({ style, onChange }: {
  style: SectionStyle; onChange: (style: SectionStyle) => void;
}) {
  const { t } = useI18n();
  const base = style.base ?? {};
  const set = (part: Partial<StyleValues>) =>
    onChange({ ...style, base: { ...base, ...part } });

  return (
    <div className="space-y-4" data-style-panel>
      <div className="grid grid-cols-2 gap-3">
        <Choice label={t("cms.style.paddingTop")} value={base.paddingTop ?? "lg"}
          options={SPACE_OPTIONS} prefix="cms.space"
          onChange={(v) => set({ paddingTop: v as StyleValues["paddingTop"] })} />
        <Choice label={t("cms.style.paddingBottom")} value={base.paddingBottom ?? "lg"}
          options={SPACE_OPTIONS} prefix="cms.space"
          onChange={(v) => set({ paddingBottom: v as StyleValues["paddingBottom"] })} />
      </div>
      <Choice label={t("cms.style.width")} value={base.width ?? "normal"}
        options={WIDTH_OPTIONS} prefix="cms.width"
        onChange={(v) => set({ width: v as StyleValues["width"] })} />
      <Choice label={t("cms.style.background")} value={base.background ?? "none"}
        options={BACKGROUND_OPTIONS} prefix="cms.bg"
        onChange={(v) => set({ background: v as StyleValues["background"] })} />
      <Choice label={t("cms.style.align")} value={base.align ?? "left"}
        options={ALIGN_OPTIONS} prefix="cms.align"
        onChange={(v) => set({ align: v as StyleValues["align"] })} />
      <Choice label={t("cms.style.columns")} value={String(base.columns ?? 3)}
        options={COLUMN_OPTIONS.map(String)} plain
        onChange={(v) => set({ columns: Number(v) })} />

      <label className="flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-3 text-[13px]">
        <input type="checkbox" checked={base.panel === true}
          className="h-4 w-4 accent-[rgb(var(--accent))]"
          onChange={(e) => set({ panel: e.target.checked })} />
        <span>
          {t("cms.style.panel")}
          <span className="mt-0.5 block text-[11.5px] text-faint">{t("cms.style.panelHint")}</span>
        </span>
      </label>
    </div>
  );
}

export function ResponsivePanel({ style, onChange }: {
  style: SectionStyle; onChange: (style: SectionStyle) => void;
}) {
  const { t } = useI18n();
  const hide = style.hide ?? {};
  const setHide = (part: Partial<NonNullable<SectionStyle["hide"]>>) =>
    onChange({ ...style, hide: { ...hide, ...part } });

  return (
    <div className="space-y-5" data-responsive-panel>
      {/* ── VISIBILITY ────────────────────────────────────────────────── */}
      <div>
        <Label>{t("cms.resp.visibility")}</Label>
        <div className="space-y-1.5">
          <DeviceToggle icon={<Monitor size={15} />} label={t("cms.device.desktop")}
            checked={hide.desktop !== true} onChange={(on) => setHide({ desktop: !on })} />
          <DeviceToggle icon={<Tablet size={15} />} label={t("cms.device.tablet")}
            checked={hide.tablet !== true} onChange={(on) => setHide({ tablet: !on })} />
          <DeviceToggle icon={<Smartphone size={15} />} label={t("cms.device.mobile")}
            checked={hide.mobile !== true} onChange={(on) => setHide({ mobile: !on })} />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{t("cms.resp.visibilityHint")}</p>
      </div>

      {/* ── OVERRIDES ─────────────────────────────────────────────────── */}
      <Overrides breakpoint="tablet" style={style} onChange={onChange}
        title={t("cms.resp.tablet")} sub={t("cms.resp.tabletRange")} />
      <Overrides breakpoint="mobile" style={style} onChange={onChange}
        title={t("cms.resp.mobile")} sub={t("cms.resp.mobileRange")} />
    </div>
  );
}

/** One breakpoint's overrides. "Dziedziczy" is a real option, not the absence
 *  of one: an admin has to be able to UNDO an override, and a select with no
 *  empty choice traps whatever was picked first. */
function Overrides({ breakpoint, style, onChange, title, sub }: {
  breakpoint: Exclude<Breakpoint, "base">;
  style: SectionStyle;
  onChange: (style: SectionStyle) => void;
  title: string; sub: string;
}) {
  const { t } = useI18n();
  const values = style[breakpoint] ?? {};
  const base = style.base ?? {};
  const set = (part: Partial<StyleValues>) => {
    const next: StyleValues = { ...values, ...part };
    // An override set back to "inherit" is REMOVED rather than stored as
    // undefined, so the JSON stays the set of decisions actually made.
    for (const key of Object.keys(next) as (keyof StyleValues)[]) {
      if (next[key] === undefined) delete next[key];
    }
    onChange({ ...style, [breakpoint]: Object.keys(next).length > 0 ? next : undefined });
  };

  return (
    <div className="rounded-xl border border-line p-3.5">
      <p className="text-[12.5px] font-semibold">{title}</p>
      <p className="mb-3 text-[11px] text-faint">{sub}</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Choice label={t("cms.style.paddingTop")} value={values.paddingTop ?? INHERIT}
            options={SPACE_OPTIONS} prefix="cms.space" inheritFrom={base.paddingTop ?? "lg"}
            onChange={(v) => set({ paddingTop: (v || undefined) as StyleValues["paddingTop"] })} />
          <Choice label={t("cms.style.paddingBottom")} value={values.paddingBottom ?? INHERIT}
            options={SPACE_OPTIONS} prefix="cms.space" inheritFrom={base.paddingBottom ?? "lg"}
            onChange={(v) => set({ paddingBottom: (v || undefined) as StyleValues["paddingBottom"] })} />
        </div>
        <Choice label={t("cms.style.align")} value={values.align ?? INHERIT}
          options={ALIGN_OPTIONS} prefix="cms.align" inheritFrom={base.align ?? "left"}
          onChange={(v) => set({ align: (v || undefined) as StyleValues["align"] })} />
        <Choice label={t("cms.style.columns")}
          value={values.columns ? String(values.columns) : INHERIT}
          options={COLUMN_OPTIONS.map(String)} plain
          inheritFrom={breakpoint === "mobile" ? "1" : "2"}
          onChange={(v) => set({ columns: v ? Number(v) : undefined })} />
      </div>
    </div>
  );
}

function Choice({ label, value, options, onChange, prefix, plain, inheritFrom }: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  /** i18n prefix for the option labels, e.g. "cms.space" → cms.space.lg */
  prefix?: string;
  /** The option IS the label (column counts). */
  plain?: boolean;
  /** When present, an "inherit" option is offered and names what it inherits. */
  inheritFrom?: string;
}) {
  const { t } = useI18n();
  const id = `cms-style-${label.replace(/\W+/g, "-").toLowerCase()}-${inheritFrom ?? "base"}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {inheritFrom !== undefined && (
          <option value={INHERIT}>
            {t("cms.resp.inherit")}
            {plain ? ` (${inheritFrom})` : prefix ? ` (${t(`${prefix}.${inheritFrom}`)})` : ""}
          </option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>{plain ? o : t(`${prefix}.${o}`)}</option>
        ))}
      </Select>
    </div>
  );
}

function DeviceToggle({ icon, label, checked, onChange }: {
  icon: React.ReactNode; label: string; checked: boolean; onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-[13px]">
      <input type="checkbox" checked={checked} className="h-4 w-4 accent-[rgb(var(--accent))]"
        onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="text-muted">{icon}</span>
      {label}
    </label>
  );
}

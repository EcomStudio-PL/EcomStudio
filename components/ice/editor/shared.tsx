"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { IceAsset, IceCrop, IceElement, IceLocale, IcePageInfo, IceResult, IceSlotSpec, IceTransport } from "@/lib/ice/types";
import { ICE_LOCALES } from "@/lib/ice/types";
import { UI_ATTR } from "./scan";
import s from "./editor.module.css";

/**
 * WHAT EVERY PANEL OF THE EDITOR SHARES: the context it is opened with, the
 * sheet it is drawn in, and a few small controls. One file so the panels look
 * and behave alike.
 */

export type T = (key: string, vars?: Record<string, string | number>) => string;

export type EditorCtx = {
  transport: IceTransport;
  /** The page being edited ("/home", "/o-nas", "/"). */
  path: string;
  /** The language the page is showing. */
  locale: IceLocale;
  info: IcePageInfo;
  t: T;
  pageLabel: string;
  /** Re-read the page's definition (CMS values and bases) and re-find the
   *  elements — after a save, when the page has re-rendered. */
  reload: () => Promise<void>;
  /** Open "Wgraj wiele" for one of the page's bulk groups. */
  openBulk: (groupKey: string) => void;
};

export const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/** Error codes the server can answer with that have their own message. */
const KNOWN = new Set([
  "conflict", "not_admin", "unauthenticated", "step_up_required", "unsupported", "unknown_key", "denied", "locale",
  "text_empty", "text_too_long", "text_invisible", "text_markup", "text_newline", "text_placeholders", "text_claim", "text_invalid",
  "unknown_slot", "media_type", "no_video_here", "no_mobile_here", "poster", "fit", "position", "crop", "alt",
  "alt_too_long", "alt_invisible", "alt_markup", "alt_newline",
  "asset_missing", "asset_kind", "asset_format", "asset_too_large", "format", "too_large", "upload_missing", "upload_failed",
  "block_missing", "not_published", "not_in_snapshot", "not_editable", "draft_diverged", "bad_path", "invalid", "noop", "network",
]);

export function errorText(t: T, code: string): string {
  return t(KNOWN.has(code) ? `ice.error.${code}` : "ice.error.generic");
}

/** Calls an action; a thrown network error becomes an ordinary refusal. */
export async function call<R>(p: Promise<IceResult<R>>): Promise<IceResult<R>> {
  try {
    return await p;
  } catch {
    return { ok: false, error: "network" };
  }
}

export function Sheet({ title, crumbs, onClose, children, footer, wide, t }: {
  title: string; crumbs?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; t: T;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, read by a listener that is installed ONCE: callers
  // pass an inline function, and re-running a focus effect on every render
  // pulled the caret out of the field after the first keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(`.${s.backdrop}`)) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Focus the panel's first text field once, when it opens (else its first
  // control) — never again while the admin is typing.
  useEffect(() => {
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>("input:not([type=range]):not([type=file]), textarea")
      ?? root?.querySelector<HTMLElement>("button:not([data-close])");
    first?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={ref} className={wide ? s.sheetWide : s.sheet} role="dialog" aria-label={title} {...{ [UI_ATTR]: "" }}>
      <div className={s.sheetHead}>
        <div style={{ minWidth: 0 }}>
          <h2>{title}</h2>
          {crumbs && <p className={s.crumbs}>{crumbs}</p>}
        </div>
        <button type="button" className={cls(s.btn, s.ghost, s.icon, s.closeBtn)} onClick={onClose} aria-label={t("ice.close")} data-close="">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className={s.sheetBody}>{children}</div>
      {footer && <div className={s.sheetFoot}>{footer}</div>}
    </div>
  );
}

export function LocaleTabs({ value, onChange, marked, t }: {
  value: IceLocale; onChange: (l: IceLocale) => void; marked?: ReadonlySet<IceLocale>; t: T;
}) {
  return (
    <div className={s.tabs} role="tablist" aria-label={t("ice.locale.label")}>
      {ICE_LOCALES.map((l) => (
        <button key={l} type="button" role="tab" aria-selected={value === l}
          className={cls(s.tab, value === l && s.tabOn, marked?.has(l) && s.tabMark)} onClick={() => onChange(l)}>
          {t(`ice.locale.${l}`)}
        </button>
      ))}
    </div>
  );
}

export function Btn({ children, onClick, kind, small, disabled, type = "button", title }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "danger"; small?: boolean;
  disabled?: boolean; type?: "button" | "submit"; title?: string;
}) {
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={cls(s.btn, kind === "primary" && s.primary, kind === "ghost" && s.ghost, kind === "danger" && s.danger, small && s.small)}>
      {children}
    </button>
  );
}

/* ── labels ───────────────────────────────────────────────────────────── */

export function roleLabel(t: T, el: IceElement): string {
  const base = t(`ice.role.${el.role.split(".")[0]}`);
  return el.index !== undefined ? `${base} ${el.index}` : base;
}

export function sectionLabel(t: T, info: IcePageInfo, elementId: string): string {
  if (info.kind !== "registry") return "";
  const sec = info.page.sections.find((x) => x.elements.some((e) => e.id === elementId));
  return sec ? t(`ice.sec.${sec.key}`) : "";
}

export function pageLabel(t: T, info: IcePageInfo, path: string): string {
  if (info.kind === "cms") return info.cms.title || path;
  if (info.page.type === "tool") return t("ice.page.tool", { path });
  return t(`ice.page.${info.page.key}`);
}

export function bytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function when(iso: string, locale: IceLocale): string {
  try {
    return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
      dateStyle: "medium", timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/* ── media helpers ────────────────────────────────────────────────────── */

/** "2336/1744" → 2336 / 1744. */
export function ratioNumber(ratio: string): number {
  const [w, h] = ratio.split("/").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
}

/** The smallest variant at least `min` px wide (for previews), else the
 *  original. */
export function previewUrl(a: IceAsset, min = 640): string {
  const sizes = Object.keys(a.variants).map(Number).filter((n) => n >= min).sort((x, y) => x - y);
  return sizes.length ? a.variants[String(sizes[0])] : a.url;
}

/** CSS for painting `asset` in a frame with `crop` — the same rule the page
 *  uses (object-position + scale about the focal point), never a stretch. */
export function cropStyle(crop: IceCrop | null | undefined, fit: "cover" | "contain" = "cover"): React.CSSProperties {
  const c = crop ?? { x: 50, y: 50, zoom: 1 };
  return {
    objectFit: fit,
    objectPosition: `${c.x}% ${c.y}%`,
    transform: c.zoom > 1 ? `scale(${c.zoom})` : undefined,
    transformOrigin: `${c.x}% ${c.y}%`,
  };
}

/** Warnings about a file for a slot: too small for the recommended size, a
 *  different shape than the frame (it will be cropped, never stretched). */
export function fitWarnings(t: T, a: Pick<IceAsset, "width" | "height" | "kind">, spec: Pick<IceSlotSpec, "width" | "height" | "ratio">): string[] {
  const out: string[] = [];
  if (!a.width || !a.height) return out;
  if (a.width < spec.width * 0.75 || a.height < spec.height * 0.75) {
    out.push(t("ice.media.warnSmall", { w: a.width, h: a.height, rw: spec.width, rh: spec.height }));
  }
  const want = ratioNumber(spec.ratio);
  const have = a.width / a.height;
  if (Math.abs(have - want) / want > 0.08) out.push(t("ice.media.warnRatio"));
  return out;
}

/** Reads a local image's size before upload (for bulk warnings). */
export async function localSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

/** Natural, case-insensitive order: "2.jpg" before "10.jpg". */
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

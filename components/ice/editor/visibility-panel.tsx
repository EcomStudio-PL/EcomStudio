"use client";
import { useId, useState } from "react";
import { notify } from "@/lib/notify";
import type { IceCmsToggle, IceLocale } from "@/lib/ice/types";
import { Btn, Sheet, call, errorText, type EditorCtx, type T } from "./shared";
import s from "./editor.module.css";

/**
 * "WIDOCZNOŚĆ" — THE PAGE'S SWITCHES IN ONE LIST.
 *
 * Every section of the page that can be switched off (the O nas sections) and,
 * inside it, every tile, card, question or point. A switch is live at once:
 * the draft and the published copy change together, with a page version (a
 * rollback point in Strony WWW → Historia), exactly like a text saved here.
 *
 * A switched-off element keeps its words: "Edytuj tekst" opens them (the
 * element is not on the page, so the panel works from its definition), and
 * it comes back the moment it is switched on. A visitor's page never carries
 * it — not in the HTML, not in the page data, not in the FAQ's structured
 * data. A text still holding "[…]" stays off the page even when switched on,
 * and the list says so.
 */

/** "Kto za tym stoi", "W co wierzymy · Element 6 · Twoje zdjęcia…",
 *  "Dla kogo · Element 1 · Punkt 2 · …" — for the history list. */
export function toggleLabel(t: T, x: IceCmsToggle, locale: IceLocale): string {
  const block = t(`ice.block.${x.blockType}`);
  return x.path.length === 0 ? block : `${block} · ${shortLabel(t, x, locale)}`;
}

function shortLabel(t: T, x: IceCmsToggle, locale: IceLocale): string {
  const name = x.label[locale] ?? x.label.pl ?? x.label.en ?? "";
  if (x.path.length === 0) return name || t(`ice.block.${x.blockType}`);
  const item = Number(x.path[1]) + 1;
  const where = x.path.length === 4
    ? `${t("ice.field.item", { n: item })} · ${t("ice.field.point", { n: Number(x.path[3]) + 1 })}`
    : t("ice.field.item", { n: item });
  return name ? `${where} · ${name}` : where;
}

function Switch({ x, label, strong, disabled, onChange }: {
  x: IceCmsToggle; label: string; strong?: boolean; disabled: boolean; onChange: (hidden: boolean) => void;
}) {
  const id = useId();
  return (
    <label className={s.check} htmlFor={id} style={strong ? { fontWeight: 600 } : undefined}>
      <input id={id} type="checkbox" checked={!x.hidden} disabled={disabled} data-ice-vis={x.id}
        onChange={(e) => onChange(!e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function VisibilityPanel({ ctx, onPick, onClose }: {
  ctx: EditorCtx; onPick: (uid: string) => void; onClose: () => void;
}) {
  const { t, info, transport } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggles = info.kind === "cms" ? info.cms.toggles : [];
  const sections = toggles.filter((x) => x.path.length === 0);

  const flip = async (x: IceCmsToggle, hidden: boolean) => {
    setBusy(true);
    setError(null);
    const res = await call(transport.cmsVisibility({ blockId: x.blockId, path: x.path, hidden, base: x.base }));
    if (!res.ok) {
      setError(errorText(t, res.error));
      if (res.error === "conflict" || res.error === "draft_diverged") await ctx.reload();
      setBusy(false);
      return;
    }
    notify.success(t(hidden ? "ice.vis.hiddenNow" : "ice.vis.shownNow"));
    // The next switch of the same section needs the block's new base.
    await ctx.reload();
    setBusy(false);
  };

  return (
    <Sheet t={t} title={t("ice.vis.title")} crumbs={`${ctx.pageLabel} · ${t("ice.cms.live")}`} onClose={onClose}>
      {error && <p className={s.error} role="alert">{error}</p>}
      <p className={s.meta}>{t("ice.vis.intro")}</p>
      {sections.map((sec) => {
        const children = toggles.filter((x) => x.blockId === sec.blockId && x.path.length > 0);
        return (
          <div key={sec.id} className={s.field} data-ice-vis-section={sec.blockType}>
            <Switch x={sec} strong disabled={busy} label={t(`ice.block.${sec.blockType}`)} onChange={(h) => void flip(sec, h)} />
            {sec.hidden && <p className={s.note}>{t("ice.vis.sectionOff")}</p>}
            {children.length > 0 && (
              <ul className={s.list} style={sec.hidden ? { opacity: 0.6 } : undefined}>
                {children.map((x) => (
                  <li key={x.id} className={s.item} style={x.path.length === 4 ? { marginLeft: 18 } : undefined}>
                    <span className={s.between}>
                      <Switch x={x} disabled={busy} label={shortLabel(t, x, ctx.locale)} onChange={(h) => void flip(x, h)} />
                      <Btn small kind="ghost" onClick={() => onPick(`c:${x.blockId}|${[...x.path, "title"].join("|")}`)}>
                        {t("ice.vis.editText")}
                      </Btn>
                    </span>
                    {x.placeholder && <p className={s.warn}>{t("ice.vis.placeholder")}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className={s.note}>{t("ice.vis.versionNote")}</p>
    </Sheet>
  );
}

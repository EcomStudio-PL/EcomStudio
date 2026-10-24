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
  // Kontakt V2: a channel, a FAQ link, the company tile.
  if (x.path[0] === "company") return t("ice.contact.company");
  if (x.path[0] === "tiles") {
    const where = t("ice.contact.faqLink", { n: Number(x.path[1]) + 1 });
    return name ? `${where} · ${name}` : where;
  }
  if (x.blockType === "contact_page") {
    const where = t("ice.contact.channel", { n: Number(x.path[1]) + 1 });
    return name ? `${where} · ${name}` : where;
  }
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

  const fields = info.kind === "cms" ? info.cms.fields : [];
  const fieldOf = (blockId: string, path: string[]) => fields.find((f) => f.blockId === blockId && f.path.join("|") === path.join("|"));

  const move = async (x: IceCmsToggle, to: number) => {
    if (!x.move) return;
    setBusy(true);
    setError(null);
    const res = await call(transport.cmsMove({ blockId: x.blockId, list: x.move.list, from: x.move.index, to, base: x.base }));
    if (!res.ok) {
      setError(errorText(t, res.error));
      if (res.error === "conflict" || res.error === "draft_diverged") await ctx.reload();
      setBusy(false);
      return;
    }
    notify.success(t("ice.contact.moved"));
    await ctx.reload();
    setBusy(false);
  };

  /** The buttons under a contact element: its link(s), or the company's
   *  four values. Each opens the one-field panel. */
  const contactButtons = (x: IceCmsToggle) => {
    if (x.blockType !== "contact_page") return null;
    const btn = (key: string, path: string[], kind: "text" | "link") => {
      const f = fieldOf(x.blockId, path);
      return f ? (
        <Btn key={key} small kind="ghost" onClick={() => onPick(`${kind === "link" ? "cl" : "c"}:${f.id}`)}>{t(`ice.contact.btn.${key}`)}</Btn>
      ) : null;
    };
    if (x.path[0] === "company") {
      return [btn("name", ["company", "title"], "text"), btn("address", ["company", "description"], "text"),
        btn("nip", ["company", "value"], "link"), btn("email", ["company", "url"], "link")];
    }
    const url = fieldOf(x.blockId, [...x.path, "url"]);
    return [
      btn("link", [...x.path, "url"], "link"),
      x.path[0] === "items" ? btn("description", [...x.path, "description"], "text") : null,
      url?.channel === "facebook" ? btn("messenger", [...x.path, "url2"], "link") : null,
    ];
  };

  /** The section's own words (content.fields): the form's labels, the
   *  topics, the success card — most of them are not on the page until a
   *  topic is picked or a message is sent, so they are listed here. */
  const sectionTexts = (blockId: string) => fields.filter((f) => f.blockId === blockId && f.kind === "text" && f.path[0] === "fields");

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
        const texts = sec.blockType === "contact_page" ? sectionTexts(sec.blockId) : [];
        return (
          <div key={sec.id} className={s.field} data-ice-vis-section={sec.blockType}>
            <Switch x={sec} strong disabled={busy} label={t(`ice.block.${sec.blockType}`)} onChange={(h) => void flip(sec, h)} />
            {sec.hidden && <p className={s.note}>{t("ice.vis.sectionOff")}</p>}
            {sec.blockType === "contact_page" && <p className={s.meta}>{t("ice.contact.intro")}</p>}
            {children.length > 0 && (
              <ul className={s.list} style={sec.hidden ? { opacity: 0.6 } : undefined}>
                {children.map((x) => (
                  <li key={x.id} className={s.item} style={x.path.length === 4 ? { marginLeft: 18 } : undefined}>
                    <span className={s.between}>
                      <Switch x={x} disabled={busy} label={shortLabel(t, x, ctx.locale)} onChange={(h) => void flip(x, h)} />
                      <span className={s.row}>
                        {x.move && (
                          <>
                            <Btn small kind="ghost" disabled={busy || x.move.index === 0}
                              onClick={() => void move(x, x.move!.index - 1)}>{t("ice.contact.up")}</Btn>
                            <Btn small kind="ghost" disabled={busy || x.move.index >= x.move.count - 1}
                              onClick={() => void move(x, x.move!.index + 1)}>{t("ice.contact.down")}</Btn>
                          </>
                        )}
                        {x.path[0] !== "company" && (
                          <Btn small kind="ghost" onClick={() => onPick(`c:${x.blockId}|${[...x.path, "title"].join("|")}`)}>
                            {t("ice.vis.editText")}
                          </Btn>
                        )}
                      </span>
                    </span>
                    {x.blockType === "contact_page" && <span className={s.row}>{contactButtons(x)}</span>}
                    {x.placeholder && <p className={s.warn}>{t("ice.vis.placeholder")}</p>}
                    {x.note && <p className={s.warn} data-ice-vis-note={x.note}>{t(`ice.contact.note.${x.note}`)}</p>}
                  </li>
                ))}
              </ul>
            )}
            {texts.length > 0 && (
              <details className={s.field}>
                <summary className={s.label}>{t("ice.contact.texts", { n: texts.length })}</summary>
                <ul className={s.list}>
                  {texts.map((f) => (
                    <li key={f.id} className={s.item}>
                      <span className={s.between}>
                        <span className={s.meta}>{t(`ice.contactField.${f.path[1].replace(/\./g, "_")}`)}</span>
                        <Btn small kind="ghost" onClick={() => onPick(`c:${f.id}`)}>{t("ice.vis.editText")}</Btn>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
      <p className={s.note}>{t("ice.vis.versionNote")}</p>
    </Sheet>
  );
}

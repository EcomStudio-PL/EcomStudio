"use client";
import { useCallback, useState } from "react";
import type { IceElement } from "@/lib/ice/types";
import { MediaPaint } from "./crop";
import { MediaPanel, useSlotStates } from "./media-panel";
import { Btn, Sheet, cls, errorText, roleLabel, sectionLabel, type EditorCtx } from "./shared";
import s from "./editor.module.css";

/**
 * A TOOL'S SAMPLE PHOTOS on /home — the five pictures a visitor can try the
 * tool with. A grid of the five slots; "Zmień" opens the ordinary slot panel
 * for one of them in place of the grid (with a way back), "Wgraj wiele" the
 * tool's bulk group.
 *
 * Samples are handed to the tool as a product photo, so they are pictures
 * only, in a format and size the tool's own upload takes — the slot specs
 * say so (sample: true) and the chooser, the upload and the server all hold
 * to it.
 */
export function SamplesPanel({ ctx, element, onClose }: { ctx: EditorCtx; element: IceElement; onClose: () => void }) {
  const { t } = ctx;
  const specs = element.slots ?? [];
  const toolKey = element.id.startsWith("samples:") ? element.id.slice("samples:".length) : element.id;
  const groupKey = `samples.${toolKey}`;
  const hasGroup = ctx.info.kind === "registry" && Boolean(ctx.info.page.bulk?.some((g) => g.key === groupKey));
  const { states, error, load } = useSlotStates(ctx, specs.map((x) => x.key));
  const [editing, setEditing] = useState<number | null>(null);
  const back = useCallback(() => {
    setEditing(null);
    void load();
  }, [load]);

  const spec = editing !== null ? specs[editing] : undefined;
  if (spec && editing !== null) {
    return (
      <MediaPanel key={spec.key} ctx={ctx} element={element} spec={spec} label={t("ice.samples.item", { n: editing + 1 })}
        onClose={onClose} onBack={back} onDone={back} />
    );
  }

  const title = roleLabel(t, element);
  const crumbs = [ctx.pageLabel, sectionLabel(t, ctx.info, element.id), title].filter(Boolean).join(" · ");
  const filled = specs.filter((x) => states?.find((y) => y.key === x.key)?.media).length;

  return (
    <Sheet t={t} title={title} crumbs={crumbs} onClose={onClose} footer={
      <>
        {hasGroup && <Btn onClick={() => ctx.openBulk(groupKey)}>{t("ice.media.bulk")}</Btn>}
        <span className={s.grow} />
        <Btn onClick={onClose}>{t("ice.close")}</Btn>
      </>
    }>
      <p className={s.note}>{t("ice.samples.note")}</p>
      {error && (
        <>
          <p className={s.error}>{errorText(t, error)}</p>
          <div><Btn small onClick={() => void load()}>{t("ice.media.retry")}</Btn></div>
        </>
      )}
      {!states && !error && <p className={s.meta}>{t("ice.media.loading")}</p>}
      {states && <p className={s.meta}>{t("ice.samples.count", { n: filled, total: specs.length })}</p>}
      <div className={s.grid} aria-busy={!states}>
        {specs.map((x, i) => {
          const st = states?.find((y) => y.key === x.key);
          const name = t("ice.samples.item", { n: i + 1 });
          const verb = st?.media ? t("ice.samples.change") : t("ice.samples.add");
          return (
            <button key={x.key} type="button" className={s.tile} disabled={!states} onClick={() => setEditing(i)} aria-label={`${name}: ${verb}`}>
              <span className={s.thumb} style={{ aspectRatio: x.ratio }}>
                {st?.media
                  ? <MediaPaint asset={st.media} crop={st.crop} fit={st.fit} min={320} />
                  : <span className={s.frameEmpty}>{t("ice.samples.empty")}</span>}
              </span>
              <span className={s.tileName}>{name}</span>
              <span className={s.tileMeta}>
                {st?.media?.width && st.media.height ? `${st.media.width}×${st.media.height} px` : t("ice.media.size", { w: x.width, h: x.height })}
              </span>
              <span className={cls(s.btn, s.small)} aria-hidden="true">{verb}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

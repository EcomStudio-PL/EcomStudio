"use client";
import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { seedInflight, useInflight, type InflightTile } from "@/lib/inflight/store";
import { InflightTileView } from "@/components/inflight/inflight-tile";
import { useBatchPump } from "@/lib/inflight/queue";
import { parseRatioLabel } from "@/lib/asset-ratio";

/** Which tiles a surface shows: a tool's own, or every tool's (the library). */
export type InflightScope = { tools: string[] } | "all";

/** The tiles of one surface, newest first — the oldest sits next to the
 *  finished results, so a result lands where its tile was. */
export function useInflightTiles(scope: InflightScope | undefined): InflightTile[] {
  const { tiles } = useInflight();
  const key = scope === "all" ? "all" : scope?.tools.join(",") ?? "";
  useEffect(() => { if (key) seedInflight({ discover: true }); }, [key]);
  return useMemo(() => {
    if (!key) return [];
    const allowed = key === "all" ? null : new Set(key.split(","));
    return tiles
      .filter((t) => !allowed || allowed.has(t.tool))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.addedAt - a.addedAt);
  }, [tiles, key]);
}

/** What a tile will become, as width / height: its format, else square. */
export function tileAspect(tile: InflightTile): number {
  return (tile.ratio ? parseRatioLabel(tile.ratio) : null) ?? 1;
}

/**
 * "W TRAKCIE" — the separate row a FILTERED gallery shows above its results
 * (a favourites filter must not mix a running job into liked images, and
 * must not hide it either).
 */
export function InflightRow({ tiles, onSettled }: { tiles: InflightTile[]; onSettled?: (id: string) => void }) {
  const { t } = useI18n();
  if (tiles.length === 0) return null;
  return (
    <section data-inflight-row aria-label={t("inflight.row")} className="mb-3">
      <p className="overline mb-1.5">{t("inflight.row")} · {tiles.length}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
        {tiles.map((tile) => (
          <InflightTileView key={tile.id} tile={tile} aspect={tileAspect(tile)} onSettled={onSettled} />
        ))}
      </div>
    </section>
  );
}

/**
 * "(2) GrovBase" in the tab while generations run — and the title exactly as
 * it was once they end. Only the live document title of this tab: the page's
 * metadata (what search engines and link previews read) is never touched.
 */
export function InflightTitle() {
  const { tiles } = useInflight();
  const pathname = usePathname();
  const running = tiles.filter((t) => !t.resolved).length;
  useEffect(() => { seedInflight(); }, []);
  // The photos of a click still waiting to be sent go out from here, on any
  // page of the app — leaving the tool does not stop its batch.
  useBatchPump();
  useEffect(() => {
    const strip = (title: string) => title.replace(/^\(\d+\)\s+/, "");
    const apply = () => {
      const base = strip(document.title);
      const want = running > 0 ? `(${running}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    apply();
    // A navigation rewrites the title from the next page's metadata; put the
    // count back on it (and only then — no loop: `apply` writes only when the
    // title differs from what it wants).
    const head = document.querySelector("head");
    if (!head) return;
    const mo = new MutationObserver(apply);
    mo.observe(head, { subtree: true, childList: true, characterData: true });
    return () => { mo.disconnect(); };
  }, [running, pathname]);
  return null;
}

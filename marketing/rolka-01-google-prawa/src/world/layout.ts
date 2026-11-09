import { GH, GW, thumbRect, HERO_INDEX, GL } from "../components/GoogleUI";
import { EH, EW, SLOT, SLOT_POS, EnvKind } from "../components/EnvCards";

// One spatial world (px). Every station lives at fixed world coordinates; the camera travels between them.
export const ST = {
  browser: { x: 0, y: 0, w: GW, h: GH },
  www: { x: 0, y: 1500, w: EW, h: EH },
  shop: { x: 0, y: 2100, w: EW, h: EH },
  social: { x: 0, y: 2700, w: EW, h: EH },
  bench: { x: 1300, y: 2700, w: 940, h: 1400 }, // edit panel → flips into the Google steps panel
  source: { x: 2560, y: 2950, w: 940, h: 1400 },
  tools: { x: 2560, y: 4560, w: 940, h: 1400 },
} as const;

export type Rect = { x: number; y: number; w: number; h: number }; // centre-based

export const tl = (s: { x: number; y: number; w: number; h: number }) => ({ x: s.x - s.w / 2, y: s.y - s.h / 2 });

export const slotCenter = (k: EnvKind): Rect => {
  const o = tl(ST[k]);
  const p = SLOT_POS[k];
  return { x: o.x + p.x + SLOT / 2, y: o.y + p.y + SLOT / 2, w: SLOT, h: SLOT };
};

export const browserThumb = (i = HERO_INDEX, toolsOpen = 0): Rect => {
  const o = tl(ST.browser);
  const r = thumbRect(i, toolsOpen);
  const imgH = r.h - 66;
  return { x: o.x + r.x + r.w / 2, y: o.y + r.y + imgH / 2, w: r.w, h: imgH };
};

/** World point of a local point on the Google panel at the bench. */
export const benchPoint = (lx: number, ly: number) => {
  const o = tl(ST.bench);
  return { x: o.x + lx, y: o.y + ly };
};

export const benchThumb = (i: number, toolsOpen = 1): Rect => {
  const o = tl(ST.bench);
  const r = thumbRect(i, toolsOpen);
  const imgH = r.h - 66;
  return { x: o.x + r.x + r.w / 2, y: o.y + r.y + imgH / 2, w: r.w, h: imgH };
};

export const GOOGLE_TARGETS = {
  grafika: { x: GL.tabs.grafika.x + GL.tabs.grafika.w / 2, y: GL.tabsY + GL.tabsH / 2 },
  narzedzia: { x: GL.narzedzia.x + GL.narzedzia.w / 2, y: GL.narzedzia.y + GL.narzedzia.h / 2 },
  rights: { x: GL.chips[4].x + GL.chips[4].w / 2, y: GL.toolsY + GL.chipH / 2 },
  cc: { x: GL.dropdown.x + 200, y: GL.dropdown.y + 10 + GL.dropdown.rowH * 1.5 },
};

import React from "react";
import { C, FONT_BODY } from "../config";
import { LOOKS, Vase, VaseLook } from "./Vase";
import { IconChevron, IconLink, IconSearch } from "./Icons";
import { mix, rand } from "../lib/anim";

// Educational SCHEMATIC of Google Grafika (per the package's 01/02 schematics and Google Search Help
// "Find images you can use & share": Grafika → Narzędzia → Prawa użytkowania). It is drawn, not captured,
// and carries a visible note that option layout can differ.

export const GW = 940;
export const GH = 1400;

export const GL = {
  tabs: {
    wszystko: { x: 40, w: 150 },
    grafika: { x: 200, w: 130 },
    wideo: { x: 340, w: 110 },
    wiadomosci: { x: 460, w: 180 },
  },
  tabsY: 330,
  tabsH: 62,
  narzedzia: { x: 708, y: 334, w: 192, h: 56 },
  toolsY: 410,
  chips: [
    { label: "Rozmiar", x: 40, w: 150 },
    { label: "Kolor", x: 198, w: 118 },
    { label: "Typ", x: 324, w: 96 },
    { label: "Czas", x: 428, w: 106 },
    { label: "Prawa użytkowania", x: 542, w: 358 },
  ],
  chipH: 58,
  dropdown: { x: 470, y: 482, w: 430, rowH: 66, options: ["Wszystkie", "Licencje Creative Commons", "Licencje komercyjne i inne"] },
  grid: { x0: 40, x1: 480, w: 420, y0: 420, h: 280, gap: 20, imgH: 214 },
} as const;

export const thumbRect = (i: number, toolsOpen = 0) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const h = GL.grid.h - toolsOpen * 34;
  const y0 = GL.grid.y0 + toolsOpen * 86;
  return { x: col === 0 ? GL.grid.x0 : GL.grid.x1, y: y0 + row * (h + GL.grid.gap), w: GL.grid.w, h };
};

export const HERO_INDEX = 3;

const DEFAULT_LOOKS: { look: VaseLook; flip?: boolean; s?: number }[] = [
  { look: LOOKS.lavender, s: 0.9 },
  { look: LOOKS.sage, flip: true, s: 1.05 },
  { look: LOOKS.blush, s: 0.95 },
  { look: LOOKS.hero },
  { look: LOOKS.sand, flip: true, s: 0.92 },
  { look: LOOKS.mint, s: 1.0 },
];
const CC_LOOKS: { look: VaseLook; flip?: boolean; s?: number }[] = [
  { look: LOOKS.mint, flip: true, s: 0.95 },
  { look: LOOKS.hero, s: 1.0 },
  { look: LOOKS.studio, s: 0.9 },
  { look: LOOKS.sage, s: 1.0 },
  { look: LOOKS.lavender, flip: true },
  { look: LOOKS.blush, s: 1.05 },
];

export type GoogleState = {
  id: string;
  typed?: number; // 0..1 portion of query typed
  caret?: boolean;
  resultsIn?: number; // 0..1 staggered appearance
  grafikaActive?: number; // 0..1
  hoverTab?: number; // 0..1 hover ring on "Grafika"
  narzedziaActive?: number;
  toolsOpen?: number;
  rightsActive?: number;
  dropdown?: number;
  ccHover?: number;
  ccSelected?: number;
  ccResults?: number; // 0..1 crossfade to filtered results
  heroSlotEmpty?: boolean;
  hoverThumb?: { i: number; v: number };
  detach?: number; // 0..1 thumbnails lift off the page
  licenseLink?: { i: number; v: number; hover: number };
  dim?: number;
  time?: number; // seconds, for the idle float of detached thumbnails
};

const QUERY = "dekoracyjny wazon";

export const GoogleUI: React.FC<GoogleState> = (p) => {
  const typed = p.typed ?? 1;
  const toolsOpen = p.toolsOpen ?? 0;
  const resultsIn = p.resultsIn ?? 1;
  const grafika = p.grafikaActive ?? 1;
  const detach = p.detach ?? 0;
  const q = QUERY.slice(0, Math.round(QUERY.length * typed));
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 36,
        background: C.paper,
        boxShadow: "0 60px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.6) inset",
        fontFamily: FONT_BODY,
        transformStyle: "preserve-3d",
      }}
    >
      {/* window chrome */}
      <div style={{ position: "absolute", left: 0, top: 0, width: GW, height: 72, background: C.paper2, borderRadius: "36px 36px 0 0", borderBottom: `2px solid ${C.paper3}` }}>
        {[34, 60, 86].map((x, i) => (
          <div key={x} style={{ position: "absolute", left: x - 8, top: 28, width: 16, height: 16, borderRadius: 8, background: ["#FF6B6B", "#FFC94D", "#4CD07D"][i], opacity: 0.85 }} />
        ))}
        <div style={{ position: "absolute", left: 130, top: 18, width: 760, height: 38, borderRadius: 19, background: C.paper, border: `2px solid ${C.paper3}` }}>
          <div style={{ position: "absolute", left: 22, top: 15, width: 220, height: 8, borderRadius: 4, background: "#D7DDE9" }} />
        </div>
      </div>
      {/* logo — plain type as in the package schematic (not the trademark logo artwork) */}
      <div style={{ position: "absolute", left: 46, top: 96, display: "flex", alignItems: "baseline", gap: 14, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 78, fontWeight: 700, color: C.googleBlue, letterSpacing: -2 }}>Google</span>
        <span style={{ fontSize: 44, fontWeight: 500, color: "#6B7280" }}>Grafika</span>
      </div>
      {/* search */}
      <div style={{ position: "absolute", left: 40, top: 206, width: 860, height: 94, borderRadius: 47, background: C.paper2, border: "2px solid #DCE2EE", boxShadow: "0 6px 18px rgba(28,37,65,0.08)" }}>
        <div style={{ position: "absolute", left: 44, top: 24, fontSize: 38, color: "#2B3553", whiteSpace: "nowrap" }}>
          {q}
          {p.caret ? <span style={{ display: "inline-block", width: 3, height: 40, background: C.googleBlue, marginLeft: 4, verticalAlign: -6 }} /> : null}
        </div>
        <div style={{ position: "absolute", right: 34, top: 28 }}>
          <IconSearch size={38} color={C.googleBlue} stroke={2.6} />
        </div>
      </div>
      {/* tabs */}
      {(Object.keys(GL.tabs) as (keyof typeof GL.tabs)[]).map((k) => {
        const tab = GL.tabs[k];
        const label = { wszystko: "Wszystko", grafika: "Grafika", wideo: "Wideo", wiadomosci: "Wiadomości" }[k];
        const active = k === "grafika" ? grafika : k === "wszystko" ? 1 - grafika : 0;
        return (
          <div key={k} style={{ position: "absolute", left: tab.x, top: GL.tabsY, width: tab.w, height: GL.tabsH, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {k === "grafika" && p.hoverTab ? (
              <div style={{ position: "absolute", inset: -4, borderRadius: 16, background: `rgba(66,133,244,${0.12 * p.hoverTab})`, border: `2px solid rgba(66,133,244,${0.5 * p.hoverTab})` }} />
            ) : null}
            <span style={{ position: "relative", fontSize: 30, fontWeight: active > 0.5 ? 700 : 600, color: active > 0.5 ? C.googleBlue : "#4A5578", whiteSpace: "nowrap" }}>{label}</span>
            <div style={{ position: "absolute", left: 14, right: 14, bottom: 0, height: 5, borderRadius: 3, background: C.googleBlue, transform: `scaleX(${active})`, transformOrigin: "center" }} />
          </div>
        );
      })}
      {/* Narzędzia */}
      <div
        style={{
          position: "absolute",
          left: GL.narzedzia.x,
          top: GL.narzedzia.y,
          width: GL.narzedzia.w,
          height: GL.narzedzia.h,
          borderRadius: 28,
          background: `rgba(214,40,207,${0.14 * (p.narzedziaActive ?? 0)})`,
          border: `2px solid ${(p.narzedziaActive ?? 0) > 0.05 ? `rgba(214,40,207,${0.85 * (p.narzedziaActive ?? 0)})` : "#DCE2EE"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 30,
          fontWeight: 700,
          color: (p.narzedziaActive ?? 0) > 0.5 ? "#9B1C95" : "#4A5578",
          transform: `scale(${1 + 0.06 * Math.sin(Math.PI * Math.min(1, (p.narzedziaActive ?? 0) * 1.3))})`,
        }}
      >
        Narzędzia
      </div>
      {/* tools row */}
      <div style={{ position: "absolute", left: 0, top: GL.toolsY, width: GW, height: GL.chipH, opacity: toolsOpen, transform: `translateY(${(1 - toolsOpen) * -24}px)` }}>
        {GL.chips.map((c, i) => {
          const isRights = i === 4;
          const act = isRights ? p.rightsActive ?? 0 : 0;
          const appear = Math.min(1, Math.max(0, toolsOpen * 1.6 - i * 0.12));
          return (
            <div
              key={c.label}
              style={{
                position: "absolute",
                left: c.x,
                top: 0,
                width: c.w,
                height: GL.chipH,
                borderRadius: 14,
                background: act > 0.05 ? `rgba(214,40,207,${0.12 + 0.06 * act})` : C.paper2,
                border: `2px solid ${act > 0.05 ? `rgba(214,40,207,${0.9 * act})` : "#DCE2EE"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontSize: 27,
                fontWeight: isRights ? 700 : 600,
                color: act > 0.5 ? "#9B1C95" : "#3A4466",
                whiteSpace: "nowrap",
                opacity: appear,
                transform: `translateY(${(1 - appear) * 14}px) scale(${1 + 0.05 * act})`,
              }}
            >
              {c.label}
              <IconChevron size={20} color={act > 0.5 ? "#9B1C95" : "#7A84A0"} />
            </div>
          );
        })}
      </div>
      {/* results */}
      <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
        {DEFAULT_LOOKS.map((d, i) => {
          const r = thumbRect(i, toolsOpen);
          const appear = Math.min(1, Math.max(0, resultsIn * 1.8 - i * 0.16));
          const isHero = i === HERO_INDEX;
          const empty = isHero && p.heroSlotEmpty;
          const cc = p.ccResults ?? 0;
          const alt = CC_LOOKS[i];
          // detaching: thumbnails lift off in z with a little spin
          const dd = Math.min(1, Math.max(0, detach * 1.5 - (i % 3) * 0.12 - Math.floor(i / 2) * 0.08));
          const dz = dd * (260 + rand(i + 3) * 380);
          const drx = dd * (rand(i + 7) * 30 - 12 + Math.sin((p.time ?? 0) * 1.1 + i) * 5);
          const dry = dd * (rand(i + 11) * 36 - 18);
          const dx = dd * (rand(i + 13) - 0.5) * 120;
          const fl = p.time ?? 0;
          const dy = dd * (-60 - rand(i + 17) * 160 + Math.sin(fl * 1.4 + i * 1.7) * 26);
          const hover = p.hoverThumb && p.hoverThumb.i === i ? p.hoverThumb.v : 0;
          const link = p.licenseLink && p.licenseLink.i === i ? p.licenseLink : null;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                opacity: appear,
                transform: `translate3d(${dx}px, ${dy + (1 - appear) * 40}px, ${dz}px) rotateX(${drx}deg) rotateY(${dry}deg) scale(${mix(0.92, 1, appear)})`,
                transformStyle: "preserve-3d",
              }}
            >
              {empty ? (
                <div style={{ position: "absolute", left: 0, top: 0, width: r.w, height: GL.grid.imgH, borderRadius: 22, border: "3px dashed #C9D1E2", background: "#F6F8FC" }} />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: r.w,
                    height: r.h - 66,
                    borderRadius: 22,
                    overflow: "hidden",
                    boxShadow: dd > 0 ? `0 ${30 * dd}px ${60 * dd}px rgba(0,0,0,${0.45 * dd})` : hover ? `0 0 0 ${5 * hover}px rgba(66,133,244,0.85)` : "0 4px 10px rgba(28,37,65,0.08)",
                  }}
                >
                  <div style={{ position: "absolute", inset: 0 }}>
                    <Vase id={`${p.id}-t${i}`} look={d.look} flip={d.flip} vaseScale={d.s} />
                  </div>
                  {cc > 0 ? (
                    <div style={{ position: "absolute", inset: 0, opacity: cc }}>
                      <Vase id={`${p.id}-c${i}`} look={alt.look} flip={alt.flip} vaseScale={alt.s} />
                    </div>
                  ) : null}
                </div>
              )}
              {!empty ? (
                <>
                  <div style={{ position: "absolute", left: 4, top: r.h - 52, width: 240, height: 12, borderRadius: 6, background: "#D9DFEA" }} />
                  <div style={{ position: "absolute", left: 4, top: r.h - 30, width: 150, height: 10, borderRadius: 5, background: "#E7EBF3" }} />
                </>
              ) : null}
              {link && link.v > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: r.h - 70,
                    height: 64,
                    padding: "0 22px",
                    borderRadius: 18,
                    background: "#FFFFFF",
                    border: `2px solid rgba(66,133,244,${0.5 + 0.5 * link.hover})`,
                    boxShadow: `0 14px 30px rgba(28,37,65,0.25), 0 0 0 ${6 * link.hover}px rgba(66,133,244,0.18)`,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 28,
                    fontWeight: 700,
                    color: C.googleBlue,
                    whiteSpace: "nowrap",
                    opacity: link.v,
                    transform: `translateY(${(1 - link.v) * 16}px) translateZ(20px)`,
                  }}
                >
                  <IconLink size={28} />
                  Szczegóły licencji
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {/* dropdown */}
      {(p.dropdown ?? 0) > 0 ? (
        <div
          style={{
            position: "absolute",
            left: GL.dropdown.x,
            top: GL.dropdown.y,
            width: GL.dropdown.w,
            padding: "10px 0",
            borderRadius: 22,
            background: "#FFFFFF",
            border: "2px solid #DCE2EE",
            boxShadow: "0 30px 60px rgba(14,20,40,0.35)",
            opacity: p.dropdown,
            transform: `translateY(${(1 - (p.dropdown ?? 0)) * -20}px) translateZ(40px)`,
            transformOrigin: "top center",
          }}
        >
          {GL.dropdown.options.map((o, i) => {
            const hov = i === 1 ? p.ccHover ?? 0 : 0;
            const sel = i === 1 ? p.ccSelected ?? 0 : i === 0 ? 1 - (p.ccSelected ?? 0) : 0;
            return (
              <div
                key={o}
                style={{
                  position: "relative",
                  height: GL.dropdown.rowH,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 26px",
                  fontSize: 29,
                  fontWeight: sel > 0.5 ? 700 : 500,
                  color: sel > 0.5 ? "#9B1C95" : "#2B3553",
                  background: `rgba(214,40,207,${0.1 * Math.max(hov, sel * (i === 1 ? 1 : 0))})`,
                  whiteSpace: "nowrap",
                }}
              >
                {o}
              </div>
            );
          })}
        </div>
      ) : null}
      {/* footnote */}
      <div style={{ position: "absolute", left: 40, top: 1326, width: 860, height: 48, borderRadius: 24, background: "#EEF1F7", display: "flex", alignItems: "center", padding: "0 24px", fontSize: 24, color: "#6B7590", whiteSpace: "nowrap" }}>
        Schemat edukacyjny — układ opcji może się różnić
      </div>
      {p.dim ? <div style={{ position: "absolute", inset: 0, borderRadius: 36, background: `rgba(5,10,22,${p.dim})` }} /> : null}
    </div>
  );
};

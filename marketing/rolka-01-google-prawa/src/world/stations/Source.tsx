import React from "react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../config";
import { E, lin, pulse, sp, window01 } from "../../lib/anim";
import { T } from "../../data/timeline";
import { thumbRect } from "../../components/GoogleUI";
import { LOOKS, Vase } from "../../components/Vase";
import { IconCheck, IconLink } from "../../components/Icons";
import { benchPoint, ST, tl } from "../layout";
import { BENCH_CLICKS } from "./Bench";
import { Flight, FlyingPhoto, Place } from "../primitives";

// LICENCJA_U_ZRODLA — the same photo opens on its source page; the licence terms are verified there
// (package assets/ui/03_sprawdz_licencje_u_zrodla, rebuilt as layers).

const S = ST.source;
const O = tl(S);
const IMG = { x: 40, y: 130, s: 400 };

const lr = thumbRect(1, 1);
const fromThumb = benchPoint(lr.x + lr.w / 2, lr.y + (lr.h - 66) / 2);

export const TO_SOURCE: Flight = {
  t0: BENCH_CLICKS.clickLink + 0.06,
  t1: T.sprawdzic - 0.04,
  from: { x: fromThumb.x, y: fromThumb.y, w: lr.w, h: lr.h - 66 },
  to: { x: O.x + IMG.x + IMG.s / 2, y: O.y + IMG.y + IMG.s / 2, w: IMG.s, h: IMG.s },
  arc: { x: 2000, y: 2350 },
  lift: 300,
  lean: 7,
  pre: 0.08,
  post: 0.12,
};

const ROWS = [
  { k: "Autor", q: "Kto jest autorem?" },
  { k: "Licencja", q: "Jaki typ licencji?" },
  { k: "Komercyjnie", q: "Czy wolno używać komercyjnie?" },
  { k: "Modyfikacje", q: "Czy wolno modyfikować?" },
  { k: "Atrybucja", q: "Czy trzeba podać autora?" },
];
const ROW0 = 650;
const ROW_H = 118;
// reveal on "sprawdzić warunki licencji u źródła", ticks while the voice lists the conditions
const REVEAL = [T.sprawdzic, T.sprawdzic + 0.22, T.sprawdzic + 0.44, T.sprawdzic + 0.66, T.sprawdzic + 0.88];
const TICK = [T.warunki + 0.12, T.licencji + 0.2, T.komercyjnie + 0.12, T.zrodla + 0.35, T.szczegolnie + 0.15];
const COMM = 2;

export const SOURCE_TICKS = TICK;

export const Source: React.FC<{ t: number }> = ({ t }) => {
  const inCTA = t > T.zapisz - 0.2;
  if (t < BENCH_CLICKS.clickLink - 0.4 || (t > T.aJesli + 1.0 && !inCTA)) return null;
  const cardIn = inCTA ? 1 : sp(t, BENCH_CLICKS.clickLink - 0.25, { damping: 18, stiffness: 110 });
  const headPulse = pulse(t, T.zrodla + 0.15, 0.35);
  const emph = window01(t, T.szczegolnie - 0.05, T.licEnd + 0.4, 0.3, 0.3) + pulse(t, T.komercyjnie + 0.15, 0.3) * 0.6;
  const footerIn = sp(t, T.szczegolnie + 0.5, { damping: 15 });
  const connector = window01(t, BENCH_CLICKS.clickLink - 0.05, T.sprawdzic + 0.7, 0.25, 0.4);

  return (
    <>
      {connector > 0 ? <Connector t={t} v={connector} /> : null}
      <Place x={S.x} y={S.y} w={S.w} h={S.h} z={-60 * (1 - cardIn)} opacity={Math.min(1, cardIn * 1.3)} ry={-10 * (1 - cardIn)}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 40, background: C.paper, boxShadow: "0 60px 140px rgba(0,0,0,0.55)", fontFamily: FONT_BODY }}>
          {/* source header */}
          <div
            style={{
              position: "absolute",
              left: 30,
              right: 30,
              top: 26,
              height: 78,
              borderRadius: 24,
              background: headPulse > 0.02 ? `rgba(249,80,225,${0.12 + 0.12 * headPulse})` : C.paper2,
              border: `2px solid rgba(214,40,207,${0.15 + 0.7 * headPulse})`,
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "0 26px",
            }}
          >
            <IconLink size={34} color={C.magenta} />
            <span style={{ fontWeight: 800, fontSize: 32, color: C.ink, whiteSpace: "nowrap" }}>Strona źródłowa / szczegóły licencji</span>
          </div>
          {/* meta block next to the image */}
          {[
            { k: "Autor", y: 160 },
            { k: "Licencja", y: 290 },
            { k: "Źródło", y: 420 },
          ].map((m, i) => (
            <div key={m.k} style={{ position: "absolute", left: 480, top: m.y, width: 420 }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.muted, whiteSpace: "nowrap" }}>{m.k}</div>
              <div style={{ marginTop: 14, height: 22, width: [300, 250, 340][i], borderRadius: 11, background: "#E3E8F1" }} />
              <div style={{ marginTop: 10, height: 16, width: [200, 300, 220][i], borderRadius: 8, background: "#EEF1F6" }} />
            </div>
          ))}
          <div style={{ position: "absolute", left: 40, top: 572, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 42, color: "#6B2FA0", whiteSpace: "nowrap" }}>PRZED UŻYCIEM SPRAWDŹ:</div>
          {ROWS.map((r, i) => {
            const v = inCTA ? 1 : sp(t, REVEAL[i], { damping: 16, stiffness: 170 });
            const tick = inCTA ? 1 : sp(t, TICK[i], { damping: 12, stiffness: 260 });
            const isC = i === COMM;
            const e = isC ? Math.min(1, emph) : 0;
            return (
              <div
                key={r.k}
                style={{
                  position: "absolute",
                  left: 30,
                  right: 30,
                  top: ROW0 + i * ROW_H,
                  height: ROW_H - 14,
                  borderRadius: 24,
                  background: isC ? `rgba(249,80,225,${0.1 * e})` : "transparent",
                  border: `3px solid rgba(214,40,207,${0.85 * e})`,
                  boxShadow: e > 0 ? `0 ${20 * e}px ${50 * e}px rgba(214,40,207,${0.3 * e})` : undefined,
                  transform: `translateX(${(1 - v) * 80}px) translateZ(${40 * e}px) scale(${1 + 0.05 * e})`,
                  opacity: Math.min(1, v * 1.4),
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  padding: "0 22px",
                }}
              >
                <div
                  style={{
                    width: 58,
                    height: 58,
                    flex: "0 0 58px",
                    borderRadius: 16,
                    border: `4px solid ${tick > 0.5 ? (isC ? C.magenta : "#1FAF84") : "#B9C2D6"}`,
                    background: tick > 0.5 ? (isC ? C.magenta : "#1FAF84") : "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div style={{ transform: `scale(${tick})` }}>
                    <IconCheck size={40} color="#fff" stroke={3.6} />
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 42, color: isC && e > 0.3 ? "#9B1C95" : C.ink, whiteSpace: "nowrap", lineHeight: 1.05 }}>{r.k}</span>
                  <span style={{ fontSize: 30, color: "#5A6482", whiteSpace: "nowrap" }}>{r.q}</span>
                </div>
              </div>
            );
          })}
          <div
            style={{
              position: "absolute",
              left: 30,
              top: 1272,
              height: 86,
              padding: "0 34px",
              borderRadius: 24,
              background: "#FCE4EF",
              color: "#9B1C4E",
              fontWeight: 800,
              fontSize: 34,
              display: "flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              opacity: inCTA ? 1 : footerIn,
              transform: `translateY(${(1 - footerIn) * 30}px)`,
            }}
          >
            Warunki licencji są decydujące
          </div>
          {/* the same photo, landed */}
          <div style={{ position: "absolute", left: IMG.x, top: IMG.y, width: IMG.s, height: IMG.s, borderRadius: 26, overflow: "hidden", opacity: t >= TO_SOURCE.t1 || inCTA ? 1 : 0, boxShadow: "0 16px 40px rgba(28,37,65,0.2)" }}>
            <Vase id="srcimg" look={LOOKS.hero} />
          </div>
          {t < TO_SOURCE.t1 && !inCTA ? <div style={{ position: "absolute", left: IMG.x, top: IMG.y, width: IMG.s, height: IMG.s, borderRadius: 26, border: "3px dashed #C9D1E2", background: "#F6F8FC" }} /> : null}
        </div>
      </Place>
      <FlyingPhoto id="tsrc" flights={[TO_SOURCE]} t={t} />
    </>
  );
};

/** Dashed path from the licence link on the results page to the source page. */
const Connector: React.FC<{ t: number; v: number }> = ({ t, v }) => {
  const a = benchPoint(lr.x + 330, lr.y + lr.h - 38);
  const b = { x: O.x + 40, y: O.y + 65 };
  const minX = Math.min(a.x, b.x) - 40;
  const minY = Math.min(a.y, b.y) - 200;
  const w = Math.abs(b.x - a.x) + 80;
  const h = Math.abs(b.y - a.y) + 400;
  const ax = a.x - minX;
  const ay = a.y - minY;
  const bx = b.x - minX;
  const by = b.y - minY;
  const draw = E.inOut(lin(t, BENCH_CLICKS.clickLink, BENCH_CLICKS.clickLink + 0.45));
  const d = `M${ax} ${ay} C ${ax + 200} ${ay - 260}, ${bx - 260} ${by - 220}, ${bx} ${by}`;
  return (
    <div style={{ position: "absolute", left: minX, top: minY, width: w, height: h, transform: "translateZ(150px)", opacity: v }}>
      <svg width={w} height={h} style={{ overflow: "visible" }}>
        <path d={d} fill="none" stroke={C.pink} strokeWidth={10} strokeLinecap="round" strokeDasharray="2 26" pathLength={1000} style={{ filter: "drop-shadow(0 0 12px rgba(249,80,225,0.8))" }} opacity={0.95} />
        <path d={d} fill="none" stroke="#fff" strokeWidth={4} pathLength={1000} strokeDasharray={`${1000 * draw} 1000`} opacity={0.9} />
      </svg>
    </div>
  );
};


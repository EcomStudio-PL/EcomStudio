import React from "react";
import { AbsoluteFill } from "remotion";
import { E, clamp01, lerp, qbez, rand, spr, tw } from "../lib/anim";
import { CUE } from "../timing";
import { DATA_LAUNCH, getPhoneA } from "../phoneTrack";
import { project } from "../components/Phone";
import { Kinetic } from "../components/Kinetic";
import { CardShadow, DataIcon, FlashRing } from "../components/Bits";
import { FONT_DISPLAY, FONT_MONO } from "../lib/fonts";
import { C } from "../lib/theme";

/**
 * 20.60–25.40 s — the phone comes apart in a CONTROLLED way: each chat element
 * lifts off at its spoken word and flies along an arc into a fanned cascade of
 * five data cards (fictional values only). 25.40–26.70 s — the cards converge,
 * a fuchsia flash, and two solution buttons are born: 100% ZAKRYJ / WYKADRUJ.
 */
type CardDef = {
  key: string;
  title: string;
  value: string;
  icon: "phone" | "pin" | "user" | "mail" | "bank";
  color: string;
  launch: number;
  src: { x: number; y: number; w: number; h: number; fill: string };
  slot: number;
};

const CARDS: CardDef[] = [
  { key: "tel", title: "TELEFON", value: "000 000 000", icon: "phone", color: "#F950E1", launch: DATA_LAUNCH.telefon, src: { x: 228, y: 848, w: 707, h: 225, fill: "#E7E9F3" }, slot: 0 },
  { key: "adr", title: "ADRES", value: "ul. Przykładowa 1", icon: "pin", color: "#38A5FF", launch: DATA_LAUNCH.adres, src: { x: 229, y: 1165, w: 715, h: 105, fill: "#E9ECF4" }, slot: 1 },
  { key: "kli", title: "DANE KLIENTA", value: "Klient testowy", icon: "user", color: "#A661EA", launch: DATA_LAUNCH.klient, src: { x: 177, y: 283, w: 854, h: 120, fill: "#FFFFFF" }, slot: 2 },
  { key: "mail", title: "E-MAIL", value: "demo@example.com", icon: "mail", color: "#F4A34D", launch: DATA_LAUNCH.email, src: { x: 399, y: 680, w: 567, h: 100, fill: "#CFF8EA" }, slot: 3 },
  { key: "bank", title: "INFORMACJE BANKOWE", value: "Dane testowe", icon: "bank", color: "#FF6B8B", launch: DATA_LAUNCH.bank, src: { x: 228, y: 485, w: 675, h: 145, fill: "#E7E9F3" }, slot: 4 },
];

const CW = 780;
const CH = 168;
const SLOT_Y = [548, 748, 948, 1148, 1348];
const SLOT_X = [528, 552, 530, 550, 532];
const SLOT_R = [-3, 2.5, -2, 3, -2.5];
const FLY = 22;
const GATHER0 = 748;
const GATHER1 = CUE.jakUniknac;

const hexToRgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixColor = (a: string, b: string, t: number) => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
};

type CardGeo = { x: number; y: number; w: number; h: number; rot: number; ry: number; morph: number; alpha: number; scale: number };

const cardGeo = (c: CardDef, frame: number): CardGeo | null => {
  if (frame < c.launch) return null;
  const pose = getPhoneA(c.launch).pose;
  const p0 = project(pose, c.src.x + c.src.w / 2, c.src.y + c.src.h / 2);
  const w0 = c.src.w * pose.s * p0.k;
  const h0 = c.src.h * pose.s * p0.k;
  const k = spr(frame, c.launch, { damping: 19, stiffness: 110 }, FLY + 8);
  const lin = clamp01((frame - c.launch) / FLY);
  const sx = SLOT_X[c.slot];
  const sy = SLOT_Y[c.slot];
  const side = c.slot % 2 === 0 ? -1 : 1;
  const cx = (p0.x + sx) / 2 + side * 330;
  const cy = Math.min(p0.y, sy) - 120;
  let x = qbez(p0.x, cx, sx, k);
  let y = qbez(p0.y, cy, sy, k);
  let w = lerp(w0, CW, k);
  let h = lerp(h0, CH, k);
  let rot = SLOT_R[c.slot] * k;
  let ry = side * 28 * Math.sin(lin * Math.PI);
  let alpha = 1;
  let scale = 1;
  // gentle idle float in the cascade
  const idle = Math.sin((frame - c.launch) * 0.07 + c.slot) * 5;
  y += idle * k;
  // gather (convergence into the "Jak tego uniknąć?" flash)
  if (frame >= GATHER0) {
    const g = tw(frame, GATHER0 + c.slot * 1.5, GATHER1 + 1, 0, 1, E.in);
    const gx = 540;
    const gy = 1000;
    const ccx = (x + gx) / 2 - side * 260;
    const ccy = (y + gy) / 2;
    x = qbez(x, ccx, gx, g);
    y = qbez(y, ccy, gy, g);
    scale = 1 - 0.7 * g;
    rot = rot * (1 - g) + side * 12 * g;
    ry = 0;
    alpha = 1 - tw(frame, GATHER1 - 3, GATHER1 + 1);
    w = CW;
    h = CH;
  }
  return { x, y, w, h, rot, ry, morph: clamp01(lin * 1.4), alpha, scale };
};

const DataCard: React.FC<{ c: CardDef; g: CardGeo; ghost?: number }> = ({ c, g, ghost }) => {
  const bg = mixColor(c.src.fill, "#1A1E31", clamp01(g.morph * 1.6));
  const content = clamp01((g.morph - 0.45) / 0.45);
  return (
    <div
      style={{
        position: "absolute",
        left: g.x - g.w / 2,
        top: g.y - g.h / 2,
        width: g.w,
        height: g.h,
        transform: `rotateY(${g.ry}deg) rotate(${g.rot}deg) scale(${g.scale})`,
        opacity: g.alpha * (ghost ?? 1),
      }}
    >
      {!ghost && <CardShadow x={0} y={0} w={g.w} h={g.h} opacity={0.75 * g.morph} />}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 24 + 12 * g.morph,
          background: bg,
          border: `2.5px solid ${c.color}${Math.round(140 * g.morph).toString(16).padStart(2, "0")}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 8,
            height: "100%",
            background: c.color,
            opacity: g.morph,
          }}
        />
        {!ghost && (
          <div style={{ position: "absolute", left: 36, top: 0, height: "100%", display: "flex", alignItems: "center", gap: 30, opacity: content }}>
            <div
              style={{
                width: 104,
                height: 104,
                borderRadius: 30,
                background: `${c.color}33`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <DataIcon kind={c.icon} color={c.color} size={64} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 850, fontSize: 46, letterSpacing: -1, color: C.ink, lineHeight: 1.05 }}>{c.title}</div>
              <div style={{ position: "relative", marginTop: 12, display: "inline-block" }}>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 500, fontSize: 32, color: "#C3C9DA" }}>{c.value}</span>
                {/* semi-transparent marker over the value: it still shows through */}
                <span
                  style={{
                    position: "absolute",
                    left: -10,
                    right: -14,
                    top: 2,
                    bottom: -2,
                    borderRadius: 20,
                    background: "rgba(13,15,24,0.78)",
                    transformOrigin: "0% 50%",
                    transform: `scaleX(${clamp01((g.morph - 0.6) / 0.4)}) rotate(-1deg)`,
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const DataFront: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 612 || frame > 816) return null;
  const headOut = tw(frame, GATHER0 - 6, GATHER0 + 6, 0, 1, E.in);
  const burst = tw(frame, GATHER1, GATHER1 + 18, 0, 1, E.out);
  return (
    <AbsoluteFill style={{ perspective: 1800 }}>
      {frame < GATHER1 + 4 && (
        <>
          <div style={{ opacity: 1 - headOut }}>
            <Kinetic
              frame={frame}
              x={100}
              y={300}
              lines={[{ size: 84, weight: 900, words: [{ t: "CO", at: CUE.dotyczy }, { t: "MOŻE", at: CUE.dotyczy + 5 }, { t: "WYCIEC?", at: CUE.dotyczy + 10, grad: true }] }]}
            />
          </div>
          {CARDS.map((c) => {
            const g = cardGeo(c, frame);
            if (!g) return null;
            const trail = frame >= GATHER0 ? [3, 6, 9] : [];
            return (
              <React.Fragment key={c.key}>
                {trail.map((d, i) => {
                  const gg = cardGeo(c, frame - d);
                  return gg ? <DataCard key={i} c={c} g={gg} ghost={0.22 - i * 0.06} /> : null;
                })}
                <DataCard c={c} g={g} />
              </React.Fragment>
            );
          })}
          <div
            style={{
              position: "absolute",
              left: 0,
              width: 1080,
              top: 1478,
              textAlign: "center",
              fontFamily: FONT_MONO,
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: 4,
              color: C.inkMute,
              opacity: Math.min(tw(frame, 700, 716), 1 - headOut),
            }}
          >
            TYLKO FIKCYJNE DANE
          </div>
        </>
      )}
      {/* convergence flash */}
      {burst > 0 && burst < 1 && (
        <div
          style={{
            position: "absolute",
            left: 540 - 520,
            top: 1000 - 520,
            width: 1040,
            height: 1040,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(249,80,225,0.75) 0%, rgba(214,40,207,0.25) 30%, rgba(214,40,207,0) 62%)",
            opacity: (1 - burst) * 0.9,
            transform: `scale(${0.4 + burst * 0.9})`,
          }}
        />
      )}
      <FlashRing x={540} y={1000} p={burst} r0={60} r1={560} />
      <HowFront frame={frame} />
    </AbsoluteFill>
  );
};

const HowFront: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < GATHER1 - 2) return null;
  const out = tw(frame, 790, 802, 0, 1, E.in);
  const split = spr(frame, GATHER1 + 3, { damping: 15, stiffness: 120 });
  const leftGo = tw(frame, 796, 806, 0, 1, E.in);
  const rightGo = tw(frame, 792, 804, 0, 1, E.in);
  const btn = (side: -1 | 1) => {
    let tx = 540 + side * 240 * split + (side === 1 ? rightGo * 700 : 0);
    let ty = 1000 + 150 * split;
    if (side === -1) {
      tx += (540 - tx) * leftGo;
      ty += (1010 - ty) * leftGo;
    }
    const sc = (0.3 + 0.7 * split) * (side === -1 ? 1 + 0.6 * leftGo : 1);
    const op = side === -1 ? 1 - leftGo : 1 - tw(frame, 798, 804);
    return { tx, ty, sc, op };
  };
  const L = btn(-1);
  const R = btn(1);
  return (
    <>
      <div style={{ opacity: 1 - out, transform: `translateY(${-out * 80}px)` }}>
        <Kinetic
          frame={frame}
          x={540}
          y={440}
          align="center"
          lines={[
            { size: 112, weight: 900, words: [{ t: "JAK", at: GATHER1 }, { t: "TEGO", at: GATHER1 + 4 }] },
            { size: 150, weight: 900, gap: 8, words: [{ t: "UNIKNĄĆ?", at: GATHER1 + 9, grad: true }] },
          ]}
        />
      </div>
      {[
        { g: L, label: "100% ZAKRYJ", icon: "rect" as const },
        { g: R, label: "WYKADRUJ", icon: "crop" as const },
      ].map(({ g, label, icon }, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: g.tx - 200,
            top: g.ty - 75,
            width: 400,
            height: 150,
            borderRadius: 42,
            background: i === 0 ? "linear-gradient(135deg, #2A1030 0%, #1A1E31 100%)" : "linear-gradient(135deg, #1A1E31 0%, #241238 100%)",
            border: `3px solid ${C.pinkHot}`,
            boxShadow: `0 30px 70px rgba(0,0,0,0.55), 0 0 40px rgba(249,80,225,${0.25 * (1 - rand(i))})`,
            transform: `scale(${g.sc}) rotateY(${(1 - split) * (i === 0 ? 30 : -30)}deg)`,
            opacity: clamp01(split * 2) * g.op,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
          }}
        >
          {icon === "rect" ? (
            <div style={{ width: 52, height: 40, borderRadius: 7, background: "#FFFFFF" }} />
          ) : (
            <svg width={56} height={56} viewBox="0 0 56 56">
              <path d="M14 4 V42 H52 M4 14 H42 V52" fill="none" stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 44, letterSpacing: -1, color: C.ink, whiteSpace: "nowrap" }}>{label}</span>
        </div>
      ))}
    </>
  );
};

import React from "react";
import { Img, staticFile } from "remotion";
import { C, FONT_BODY, FONT_DISPLAY, WIDTH } from "../config";
import { T } from "../data/timeline";
import { E, lin, mix, pulse, ramp, rand, sp, window01 } from "../lib/anim";
import { IconComment, WarningObject } from "../components/Icons";

// CTA_ZAPISZ → CTA_A_TY → CTA_KOMENTARZE (screen space, in front of the drifting world).

const LOGO_RATIO = 3256 / 706;

/** Depth wash over the world while the CTA plays (the world itself is defocused in World.tsx — no backdrop-filter). */
export const CtaWash: React.FC<{ t: number }> = ({ t }) => {
  const v = ramp(t, T.narzedziEnd + 0.05, T.zapisz + 0.4, E.inOut);
  if (v <= 0) return null;
  return <div style={{ position: "absolute", inset: 0, background: `rgba(5,9,22,${0.5 * v})` }} />;
};

export const CTA: React.FC<{ t: number }> = ({ t }) => {
  if (t < T.narzedziEnd) return null;
  return (
    <>
      <SaveBeat t={t} />
      <QuestionBeat t={t} />
    </>
  );
};

// ---------------------------------------------------------------- ZAPISZ
const SaveBeat: React.FC<{ t: number }> = ({ t }) => {
  const t0 = T.narzedziEnd + 0.12;
  const t1 = T.aTy - 0.02;
  if (t < t0 || t > t1) return null;
  const inP = sp(t, t0, { damping: 13, stiffness: 120 });
  const outP = ramp(t, T.bleduEnd - 0.05, t1, E.in);
  const fill = E.out(lin(t, T.zapisz - 0.02, T.zapisz + 0.32));
  const beat = pulse(t, T.zapisz + 0.05, 0.18);
  const floatY = Math.sin(t * 2.4) * 10;
  const ry = mix(150, 0, inP) + Math.sin(t * 1.7) * 10;
  const word = E.out(lin(t, T.zapisz - 0.04, T.zapisz + 0.3));
  const sub = E.out(lin(t, T.rolke - 0.12, T.rolke + 0.22));
  const warn = sp(t, T.kosztownego + 0.05, { damping: 10, stiffness: 220 });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - outP, transform: `translateY(${-outP * 120}px) scale(${1 - 0.15 * outP})` }}>
      {/* pulse rings */}
      {[0, 0.16].map((d, i) => {
        const r = lin(t, T.zapisz + d, T.zapisz + d + 0.7);
        return r > 0 && r < 1 ? (
          <div key={i} style={{ position: "absolute", left: 540 - 140 - 260 * r, top: 720 - 140 - 260 * r, width: 280 + 520 * r, height: 280 + 520 * r, borderRadius: "50%", border: `${10 * (1 - r) + 1}px solid rgba(249,80,225,${0.8 * (1 - r)})` }} />
        ) : null;
      })}
      {/* particles */}
      {Array.from({ length: 14 }).map((_, i) => {
        const r = lin(t, T.zapisz + 0.02, T.zapisz + 0.8);
        if (r <= 0 || r >= 1) return null;
        const a = (i / 14) * Math.PI * 2 + rand(i) * 0.4;
        const dist = 160 + 260 * E.out(r) * (0.7 + rand(i + 3) * 0.6);
        return <div key={i} style={{ position: "absolute", left: 540 + Math.cos(a) * dist - 7, top: 720 + Math.sin(a) * dist - 7, width: 14, height: 14, borderRadius: 7, background: i % 2 ? C.pink : "#fff", opacity: 1 - r }} />;
      })}
      {/* 3D bookmark */}
      <div style={{ position: "absolute", left: 540 - 150, top: 720 - 200 + floatY, width: 300, height: 400, perspective: 1200 }}>
        <div style={{ position: "absolute", inset: 0, transform: `rotateY(${ry}deg) rotateX(${8 * Math.sin(t * 1.3)}deg) scale(${(0.3 + 0.7 * inP) * (1 + 0.12 * beat)})`, transformStyle: "preserve-3d", filter: "drop-shadow(0 40px 60px rgba(0,0,0,0.55))" }}>
          <svg viewBox="0 0 300 400" width={300} height={400} style={{ overflow: "visible" }}>
            <defs>
              <linearGradient id="bmFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#F950E1" />
                <stop offset="1" stopColor="#8A3FFF" />
              </linearGradient>
              <clipPath id="bmClip">
                <path d="M40 20 Q40 0 60 0 H240 Q260 0 260 20 V380 L150 300 L40 380 Z" />
              </clipPath>
            </defs>
            <path d="M40 20 Q40 0 60 0 H240 Q260 0 260 20 V380 L150 300 L40 380 Z" fill="rgba(255,255,255,0.08)" stroke="#fff" strokeWidth="12" strokeLinejoin="round" />
            <g clipPath="url(#bmClip)">
              <rect x="0" y={400 - 400 * fill} width="300" height="400" fill="url(#bmFill)" />
            </g>
            <path d="M40 20 Q40 0 60 0 H240 Q260 0 260 20 V380 L150 300 L40 380 Z" fill="none" stroke="#fff" strokeWidth="12" strokeLinejoin="round" />
            <path d="M95 165 L135 205 L210 120" fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="200" strokeDashoffset={200 * (1 - E.out(lin(t, T.zapisz + 0.2, T.zapisz + 0.5)))} />
          </svg>
        </div>
        {warn > 0 ? (
          <div style={{ position: "absolute", right: -70, top: -40, transform: `scale(${warn}) rotate(${-10 + Math.sin(t * 18) * 4 * window01(t, T.kosztownego, T.bleduEnd, 0.05, 0.2)}deg)` }}>
            <WarningObject size={130} />
          </div>
        ) : null}
      </div>
      {/* ZAPISZ */}
      <div style={{ position: "absolute", left: 0, width: WIDTH, top: 1000, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ overflow: "hidden", padding: "0 10px" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 196, lineHeight: 1, letterSpacing: -2, color: C.white, transform: `translateY(${(1 - word) * 105}%) scale(${1 + 0.06 * beat})`, textShadow: "0 0 50px rgba(249,80,225,0.55)" }}>ZAPISZ</div>
        </div>
        <div style={{ marginTop: 14, height: 10, width: 520 * word, borderRadius: 5, background: "linear-gradient(90deg,#F950E1,#8A3FFF)" }} />
        <div style={{ marginTop: 18, overflow: "hidden" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 72, color: C.pink, transform: `translateY(${(1 - sub) * 105}%)`, whiteSpace: "nowrap" }}>TĘ ROLKĘ</div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- A TY? + two answers + 2.5D comment
const QuestionBeat: React.FC<{ t: number }> = ({ t }) => {
  if (t < T.aTy - 0.05) return null;
  const punch = sp(t, T.aTy - 0.02, { damping: 10, stiffness: 240 });
  const settle = E.inOut(lin(t, T.aTyEnd + 0.12, T.sprawdzales + 0.25));
  const size = mix(250, 150, settle);
  const y = mix(800, 420, settle);
  const logoIn = sp(t, T.sprawdzales + 0.05, { damping: 18 });
  const bubbleIn = sp(t, T.sprawdzales - 0.1, { damping: 15, stiffness: 140 });
  const aIn = sp(t, T.sprawdzales + 0.05, { damping: 14, stiffness: 150 });
  const bIn = sp(t, T.czy - 0.05, { damping: 14, stiffness: 150 });
  const aFocus = window01(t, T.sprawdzales, T.zdjecQ + 0.35, 0.2, 0.25);
  const bFocus = window01(t, T.czy, T.googleEnd + 0.6, 0.2, 0.25);
  const float = (k: number) => Math.sin(t * 1.6 + k) * 6;
  return (
    <>
      {/* GrovBase signature (after the voice has named it) */}
      <div style={{ position: "absolute", left: (WIDTH - 360) / 2, top: 196, width: 360, height: 360 / LOGO_RATIO, opacity: Math.min(1, logoIn * 1.5), transform: `translateY(${(1 - logoIn) * -20}px)` }}>
        <Img src={staticFile("brand/grovbase_pink_white.png")} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
      {/* A TY? */}
      <div style={{ position: "absolute", left: 0, width: WIDTH, top: y, transform: `translateY(-50%) scale(${(1.45 - 0.45 * punch) * (1 + 0.04 * pulse(t, T.aTy + 0.15, 0.2))})`, opacity: Math.min(1, punch * 2.5), display: "flex", justifyContent: "center" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 1, letterSpacing: -2, color: C.white, whiteSpace: "nowrap", textShadow: "0 0 60px rgba(249,80,225,0.6)" }}>
          A <span style={{ color: C.pink }}>TY?</span>
        </div>
      </div>
      {/* comment object 2.5D */}
      <div style={{ position: "absolute", left: 110, top: 560 + float(0), width: 860, height: 150, perspective: 1000, opacity: Math.min(1, bubbleIn * 1.5) }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `rotateX(${mix(60, 10, bubbleIn)}deg) rotateY(-12deg) translateZ(${mix(-200, 0, bubbleIn)}px)`,
            borderRadius: 40,
            background: "linear-gradient(150deg, rgba(31,44,84,0.96), rgba(17,27,54,0.96))",
            border: "2px solid rgba(249,80,225,0.5)",
            boxShadow: "0 40px 80px rgba(0,0,0,0.5), 0 0 40px rgba(214,40,207,0.25)",
            display: "flex",
            alignItems: "center",
            gap: 26,
            padding: "0 34px",
          }}
        >
          <div style={{ width: 86, height: 86, borderRadius: 43, background: "linear-gradient(135deg,#F950E1,#8A3FFF)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconComment size={46} color="#fff" stroke={2.4} />
          </div>
          <div style={{ flex: 1, height: 74, borderRadius: 37, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 14, padding: "0 30px" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", opacity: 0.35 + 0.65 * Math.max(0, Math.sin(t * 7 - i * 0.9)) }} />
            ))}
          </div>
        </div>
      </div>
      {/* answers */}
      {[
        { k: "A", text: "Sprawdzałem prawa do zdjęć", c: C.green, deep: C.greenDeep, v: aIn, f: aFocus, y: 790 },
        { k: "B", text: "Pobierałem je z Google", c: "#FF7A90", deep: C.redDeep, v: bIn, f: bFocus, y: 1010 },
      ].map((o, i) => (
        <div key={o.k} style={{ position: "absolute", left: 90, top: o.y + float(i + 1), width: 900, height: 176, perspective: 1100, opacity: Math.min(1, o.v * 1.5) }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `rotateY(${mix(i === 0 ? -70 : 70, i === 0 ? 6 : -6, o.v)}deg) translateZ(${40 * o.f}px) scale(${1 + 0.03 * o.f})`,
              borderRadius: 36,
              background: "linear-gradient(150deg, #1A2649 0%, #111B36 100%)",
              border: `3px solid ${o.f > 0.05 ? o.c : "rgba(120,140,190,0.35)"}`,
              boxShadow: `0 30px 70px rgba(0,0,0,0.5)${o.f > 0 ? `, 0 0 ${50 * o.f}px ${o.c}55` : ""}`,
              display: "flex",
              alignItems: "center",
              gap: 26,
              padding: "0 34px",
              fontFamily: FONT_BODY,
            }}
          >
            <div style={{ width: 96, height: 96, flex: "0 0 96px", borderRadius: 30, background: o.deep, border: `4px solid ${o.c}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 54, color: o.c }}>{o.k}</div>
            <div style={{ fontWeight: 800, fontSize: 45, color: C.white, lineHeight: 1.1, flex: 1, whiteSpace: "nowrap" }}>{o.text}</div>
          </div>
        </div>
      ))}
    </>
  );
};

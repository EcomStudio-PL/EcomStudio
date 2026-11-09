import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { interpolatePath } from "@remotion/paths";
import { E, clamp01, spr, track, tw } from "../lib/anim";
import { CUE } from "../timing";
import { Kinetic } from "../components/Kinetic";
import { STEP_Y, stepX } from "./S09Check";
import { FONT_DISPLAY, FONT_MONO } from "../lib/fonts";
import { C } from "../lib/theme";

/**
 * 40.10–42.40 s — CTA "Zapisz": the last green check becomes a bookmark, the
 * files flip away and the tip-card flips in (3D card flip).
 * 42.60–45.60 s — CTA comment: the tip-card flows into the question bubble.
 * No fake comments, no counters.
 */
const CHECK_D = "M18 52 L40 74 L84 28";
const BOOK_D = "M26 12 L74 12 L74 90 L50 72 L26 90 Z";

export const ctaGroupFlip = (frame: number) => track(frame, [[1194, 0], [1206, -90, E.in]]);

const CARD = { cx: 540, cy: 985, w: 840, h: 1010 };
const BUBBLE = { cx: 540, cy: 880, w: 880, h: 640 };

export const CtaFront: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 1192) return null;
  const flipIn = track(frame, [[1204, 90], [1222, 0, E.out]]);
  const toBubble = tw(frame, 1272, 1296, 0, 1, E.inOut);
  const w = CARD.w + (BUBBLE.w - CARD.w) * toBubble;
  const h = CARD.h + (BUBBLE.h - CARD.h) * toBubble;
  const cx = CARD.cx;
  const cy = CARD.cy + (BUBBLE.cy - CARD.cy) * toBubble;
  const tipOut = tw(frame, 1268, 1282, 0, 1, E.in);
  const settle = tw(frame, 1300, 1368, 0, 1, E.soft);
  return (
    <AbsoluteFill style={{ perspective: 2000, transform: `scale(${1 + 0.025 * settle})` }}>
      {frame >= 1204 && (
        <div
          style={{
            position: "absolute",
            left: cx - w / 2,
            top: cy - h / 2,
            width: w,
            height: h,
            transform: `rotateY(${flipIn}deg)`,
            opacity: flipIn > 89 ? 0 : 1,
          }}
        >
          {/* card / bubble body */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 60,
              background: "linear-gradient(160deg, #2A1236 0%, #1A1530 45%, #12142A 100%)",
              border: "3px solid rgba(214,40,207,0.75)",
              boxShadow: "0 50px 120px rgba(0,0,0,0.6), 0 0 80px rgba(214,40,207,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
            }}
          />
          {/* speech-bubble tail (grows during the morph) */}
          <svg
            width={160}
            height={120}
            viewBox="0 0 160 120"
            style={{ position: "absolute", left: 110, top: h - 6, opacity: toBubble, transform: `scaleY(${toBubble})`, transformOrigin: "50% 0%" }}
          >
            <path d="M10 0 L120 0 L24 110 Z" fill="#14152B" stroke="rgba(214,40,207,0.75)" strokeWidth={3} strokeLinejoin="round" />
            <rect x={6} y={-8} width={118} height={10} fill="#14152B" />
          </svg>
          {/* tip-card content */}
          {tipOut < 1 && (
            <div style={{ position: "absolute", inset: 0, opacity: 1 - tipOut, transform: `translateY(${-tipOut * 60}px)` }}>
              <Kinetic
                frame={frame}
                x={w / 2}
                y={210}
                width={w}
                align="center"
                lines={[
                  { size: 158, weight: 900, words: [{ t: "ZAPISZ", at: CUE.zapisz + 6 }] },
                  { size: 124, weight: 900, gap: 4, words: [{ t: "TĘ", at: CUE.zapisz + 12, grad: true }, { t: "ROLKĘ", at: CUE.zapisz + 16, grad: true }] },
                ]}
              />
              <Kinetic
                frame={frame}
                x={w / 2}
                y={560}
                width={w}
                align="center"
                lines={[
                  { size: 48, weight: 800, words: [{ t: "ZANIM", at: CUE.zanim }, { t: "WYŚLESZ", at: CUE.zanim + 4 }] },
                  { size: 48, weight: 800, gap: 6, words: [{ t: "KOLEJNY", at: CUE.zanim + 9 }, { t: "SCREENSHOT", at: CUE.zanim + 13, color: C.pinkHot }] },
                ]}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  width: w,
                  top: 735,
                  textAlign: "center",
                  fontFamily: FONT_MONO,
                  fontWeight: 700,
                  fontSize: 28,
                  letterSpacing: 2,
                  color: C.inkDim,
                  opacity: tw(frame, 1236, 1248),
                }}
              >
                ZAKRYJ <span style={{ color: C.pinkHot }}>·</span> WYKADRUJ <span style={{ color: C.pinkHot }}>·</span> SPRAWDŹ
              </div>
              <div style={{ position: "absolute", left: 0, width: w, top: 830, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, opacity: tw(frame, 1220, 1234) }}>
                <Img src={staticFile("brand/grovbase_pink_white.png")} style={{ width: 236, height: "auto" }} />
                <div style={{ fontFamily: FONT_MONO, fontWeight: 500, fontSize: 22, letterSpacing: 3, color: C.inkMute }}>PORADA BEZPIECZEŃSTWA</div>
              </div>
            </div>
          )}
          {/* question content */}
          {frame >= CUE.aTy - 2 && (
            <>
              <Kinetic
                frame={frame}
                x={w / 2}
                y={70}
                width={w}
                align="center"
                lines={[{ size: 190, weight: 900, tracking: -6, words: [{ t: "A", at: CUE.aTy, grad: true }, { t: "TY?", at: CUE.aTy + 3, grad: true }] }]}
              />
              <Kinetic
                frame={frame}
                x={w / 2}
                y={330}
                width={w}
                align="center"
                lines={[
                  { size: 76, weight: 900, words: [{ t: "ZAKRYWASZ", at: CUE.tezWczesniej }, { t: "DANE", at: CUE.tezWczesniej + 22 }] },
                  { size: 76, weight: 900, gap: 8, words: [{ t: "MARKEREM?", at: CUE.zwyklymMarkerem, bar: "rgba(13,15,24,0.78)" }] },
                ]}
              />
            </>
          )}
        </div>
      )}
      <Bookmark frame={frame} />
      <CommentRow frame={frame} />
    </AbsoluteFill>
  );
};

const Bookmark: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 1194 || frame > 1290) return null;
  const k = tw(frame, 1194, 1214, 0, 1, E.inOut);
  const morph = tw(frame, 1196, 1210, 0, 1, E.inOut);
  const fill = tw(frame, CUE.zapisz, CUE.zapisz + 8, 0, 1, E.out);
  const out = tw(frame, 1266, 1280, 0, 1, E.in);
  const sx = stepX(2) - 70;
  const sy = STEP_Y;
  const ex = 540;
  const ey = CARD.cy - CARD.h / 2 + 120;
  const x = sx + (ex - sx) * k;
  const y = sy + (ey - sy) * k - Math.sin(k * Math.PI) * 160;
  const size = 34 + (150 - 34) * k;
  const d = interpolatePath(morph, CHECK_D, BOOK_D);
  const pop = 1 + Math.sin(clamp01((frame - CUE.zapisz) / 10) * Math.PI) * 0.16 * (frame >= CUE.zapisz ? 1 : 0);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: "absolute", left: x - size / 2, top: y - size / 2, overflow: "visible", opacity: 1 - out, transform: `scale(${pop * (1 - out * 0.4)}) translateY(${-out * 40}px)` }}
    >
      <path
        d={d}
        fill={fill > 0 ? `rgba(249,80,225,${fill})` : "none"}
        stroke={morph < 0.5 ? "#8DFFE1" : C.pinkHot}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const CommentRow: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 1300) return null;
  const p = spr(frame, 1306, { damping: 15 });
  const wob = Math.sin((frame - 1306) * 0.5) * 5 * Math.exp(-Math.max(0, frame - 1316) * 0.02) + Math.sin(frame * 0.18) * 1.5;
  const logo = tw(frame, 1316, 1332);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 1330,
          transform: `translate(-50%, -50%) translateY(${(1 - p) * 40}px)`,
          opacity: clamp01(p * 1.5),
          display: "flex",
          alignItems: "center",
          gap: 22,
          background: "rgba(14,16,30,0.9)",
          border: "2px solid rgba(255,255,255,0.16)",
          borderRadius: 50,
          padding: "20px 38px 20px 26px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        <svg width={64} height={60} viewBox="0 0 64 60" style={{ transform: `rotate(${wob}deg)` }}>
          <path d="M8 6 H56 Q60 6 60 10 V38 Q60 42 56 42 H26 L12 54 V42 H8 Q4 42 4 38 V10 Q4 6 8 6 Z" fill={C.pink} />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={20 + i * 12} cy={24} r={4.2} fill="#FFFFFF" opacity={0.45 + 0.55 * Math.max(0, Math.sin(frame * 0.32 - i * 0.9))} />
          ))}
        </svg>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 42, letterSpacing: -0.5, color: C.ink, whiteSpace: "nowrap" }}>
          Odpowiedz w komentarzu
        </span>
      </div>
      <div style={{ position: "absolute", left: 540, top: 1500, transform: "translate(-50%, -50%)", opacity: logo }}>
        <Img src={staticFile("brand/grovbase_pink_white.png")} style={{ width: 230, height: "auto", display: "block" }} />
      </div>
    </>
  );
};

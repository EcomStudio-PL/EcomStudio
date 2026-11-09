import React from "react";
import { clamp01, spr, tw, E } from "../lib/anim";
import { FONT_DISPLAY, FONT_MONO } from "../lib/fonts";
import { C, GRAD_PINK } from "../lib/theme";

export type KWord = {
  t: string;
  /** Frame the word lands (synced to the voice cue). */
  at: number;
  color?: string;
  grad?: boolean;
  /** Pink highlight bar wiping in behind the word. */
  bar?: string;
};

export type KLine = {
  words: KWord[];
  size: number;
  weight?: number;
  tracking?: number;
  mono?: boolean;
  /** Extra space above this line (px). */
  gap?: number;
};

/**
 * Kinetic typography: every word is masked and rises into place on a spring,
 * synced to its spoken cue. Exits are staggered upward through the same masks.
 * Mask padding is generous so Polish diacritics (Ś Ź Ż Ą Ę Ł Ó) are never cut.
 */
export const Kinetic: React.FC<{
  frame: number;
  lines: KLine[];
  x: number;
  y: number;
  align?: "left" | "center";
  width?: number;
  exitAt?: number;
  exitDur?: number;
  /** Camera-follow drift (px) — typography rides the camera move. */
  driftX?: number;
  driftY?: number;
  rotate?: number;
  opacity?: number;
}> = ({ frame, lines, x, y, align = "left", width = 880, exitAt, exitDur = 10, driftX = 0, driftY = 0, rotate = 0, opacity = 1 }) => {
  let wi = 0;
  return (
    <div
      style={{
        position: "absolute",
        left: align === "center" ? x - width / 2 : x,
        top: y,
        width,
        transform: `translate(${driftX}px, ${driftY}px) rotate(${rotate}deg)`,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
      }}
    >
      {lines.map((ln, li) => (
        <div
          key={li}
          style={{
            display: "flex",
            flexWrap: "nowrap",
            gap: `0 ${ln.size * 0.24}px`,
            marginTop: ln.gap ?? 0,
            justifyContent: align === "center" ? "center" : "flex-start",
            whiteSpace: "nowrap",
          }}
        >
          {ln.words.map((w, i) => {
            const idx = wi++;
            const sp = spr(frame, w.at, { damping: 16, stiffness: 170 });
            const ex = exitAt !== undefined ? tw(frame, exitAt + idx * 1.5, exitAt + idx * 1.5 + exitDur, 0, 1, E.in) : 0;
            const shown = frame >= w.at - 1 && ex < 1;
            const barP = w.bar ? tw(frame, w.at + 2, w.at + 12, 0, 1, E.out) : 0;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  overflow: "hidden",
                  padding: `${ln.size * 0.2}px ${ln.size * 0.06}px ${ln.size * 0.16}px`,
                  margin: `${-ln.size * 0.2}px ${-ln.size * 0.06}px ${-ln.size * 0.16}px`,
                  visibility: shown ? "visible" : "hidden",
                }}
              >
                {w.bar && (
                  <span
                    style={{
                      position: "absolute",
                      left: ln.size * 0.02,
                      right: ln.size * 0.02,
                      top: ln.size * 0.24,
                      bottom: ln.size * 0.14,
                      background: w.bar,
                      borderRadius: ln.size * 0.12,
                      transformOrigin: "0% 50%",
                      transform: `scaleX(${barP})`,
                    }}
                  />
                )}
                <span
                  style={{
                    position: "relative",
                    display: "inline-block",
                    fontFamily: ln.mono ? FONT_MONO : FONT_DISPLAY,
                    fontWeight: ln.weight ?? 850,
                    fontSize: ln.size,
                    lineHeight: 1,
                    letterSpacing: ln.tracking ?? (ln.mono ? 2 : -ln.size * 0.03),
                    color: w.grad ? "transparent" : w.color ?? C.ink,
                    backgroundImage: w.grad ? GRAD_PINK : undefined,
                    WebkitBackgroundClip: w.grad ? "text" : undefined,
                    backgroundClip: w.grad ? "text" : undefined,
                    transform: `translateY(${(1 - sp) * 105 - ex * 110}%) rotate(${(1 - sp) * 5}deg)`,
                    transformOrigin: "0% 100%",
                    opacity: clamp01(sp * 1.4),
                  }}
                >
                  {w.t}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Small glass chip label (mono). */
export const Chip: React.FC<{
  children: React.ReactNode;
  x: number;
  y: number;
  p: number;
  tone?: "dark" | "pink" | "danger" | "safe";
  size?: number;
  anchor?: "left" | "center";
}> = ({ children, x, y, p, tone = "dark", size = 30, anchor = "center" }) => {
  if (p <= 0.001) return null;
  const bg =
    tone === "pink"
      ? C.pink
      : tone === "danger"
        ? "rgba(58,18,38,0.94)"
        : tone === "safe"
          ? "rgba(14,73,59,0.94)"
          : "rgba(14,16,30,0.88)";
  const border =
    tone === "danger" ? C.danger : tone === "safe" ? "#4FF1C6" : tone === "pink" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.16)";
  const color = tone === "danger" ? C.dangerSoft : tone === "safe" ? C.safeSoft : "#FFFFFF";
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(${anchor === "center" ? "-50%" : "0"}, -50%) scale(${0.85 + 0.15 * p})`,
        opacity: clamp01(p * 1.5),
        background: bg,
        border: `2px solid ${border}`,
        borderRadius: size * 0.6,
        padding: `${size * 0.36}px ${size * 0.7}px`,
        fontFamily: FONT_MONO,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: 1.5,
        color,
        whiteSpace: "nowrap",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        gap: size * 0.4,
      }}
    >
      {children}
    </div>
  );
};

/** Geometric "≠" — drawn, not typed (the glyph is not in the display font subset). */
export const NotEqual: React.FC<{ size: number; p: number; color?: string }> = ({ size, p, color = C.danger }) => {
  const bar = clamp01(p / 0.6);
  const slash = clamp01((p - 0.45) / 0.55);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", overflow: "visible" }}>
      <rect x={14} y={33} width={72 * bar} height={11} rx={5.5} fill={color} />
      <rect x={14} y={57} width={72 * bar} height={11} rx={5.5} fill={color} />
      <path d="M66 12 L34 88" stroke={color} strokeWidth={11} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - slash} />
    </svg>
  );
};

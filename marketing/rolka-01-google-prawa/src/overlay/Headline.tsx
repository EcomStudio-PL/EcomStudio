import React from "react";
import { FONT_DISPLAY, WIDTH } from "../config";
import { E, lin, ramp, shake, sp } from "../lib/anim";

export type HLine = { text: string; color: string; size?: number; node?: React.ReactNode };

type Props = {
  t: number;
  t0: number;
  t1: number;
  lines: HLine[];
  y: number; // centre y
  mode?: "mask" | "slam" | "flip";
  plate?: string | null; // plate colour (rgba) or null
  glow?: string;
  stagger?: number;
};

/** Kinetic headline: phrase-level animation (masked rise, 2.5D flip or impact slam). Readability first. */
export const Headline: React.FC<Props> = ({ t, t0, t1, lines, y, mode = "mask", plate = "rgba(6,11,26,0.78)", glow, stagger = 0.09 }) => {
  if (t < t0 - 0.05 || t > t1 + 0.05) return null;
  const outP = ramp(t, t1 - 0.22, t1, E.in);
  const slam = mode === "slam" ? sp(t, t0, { damping: 11, stiffness: 260 }) : 1;
  const plateIn = ramp(t, t0, t0 + 0.22, E.out);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        width: WIDTH,
        top: y,
        transform: `translateY(-50%) translateY(${-outP * 40}px) scale(${mode === "slam" ? 1.7 - 0.7 * slam : 1}) rotate(${shake(t, t0, 2.5, 14, 6)}deg)`,
        opacity: (mode === "slam" ? Math.min(1, slam * 3) : 1) * (1 - outP),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        perspective: 900,
      }}
    >
      <div
        style={{
          position: "relative",
          padding: plate ? "18px 40px 22px" : 0,
          borderRadius: 30,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        {plate ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 30,
              background: plate,
              boxShadow: glow ? `0 0 0 2px ${glow}55, 0 20px 60px rgba(0,0,0,0.5), 0 0 60px ${glow}33` : "0 20px 60px rgba(0,0,0,0.45)",
              transform: `scaleX(${0.6 + 0.4 * plateIn})`,
              opacity: plateIn,
            }}
          />
        ) : null}
        {lines.map((l, i) => {
          const li = lin(t, t0 + i * stagger, t0 + i * stagger + 0.32);
          const p = E.out(li);
          const size = l.size ?? 110;
          const lineStyle: React.CSSProperties =
            mode === "flip"
              ? { transform: `rotateX(${(1 - p) * -80}deg) translateY(${(1 - p) * 30}px)`, opacity: p, transformOrigin: "50% 100%" }
              : mode === "mask"
                ? { transform: `translateY(${(1 - p) * 105}%)` }
                : {};
          return (
            <div key={i} style={{ position: "relative", overflow: mode === "mask" ? "hidden" : "visible", padding: "0 6px" }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: size,
                  lineHeight: 1.04,
                  letterSpacing: size > 100 ? -1 : 0,
                  color: l.color,
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  textShadow: glow ? `0 0 30px ${glow}66` : "0 6px 24px rgba(0,0,0,0.5)",
                  ...lineStyle,
                }}
              >
                {l.node}
                {l.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

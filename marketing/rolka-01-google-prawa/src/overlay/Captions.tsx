import React from "react";
import { C, FONT_BODY, SAFE, WIDTH } from "../config";
import { CAPTION_GROUPS, groupEnd, groupStart, Tone } from "../data/captions";
import { WORDS } from "../data/words";
import { E, lin, mix, ramp } from "../lib/anim";

const TONE: Record<Tone, string> = { alarm: "#FF5A78", brand: "#F950E1", info: "#FFD16C", ok: "#72E9C2" };

export const CAPTION_CENTER_Y = 1548; // two lines max → 1470..1630, bottom safe line = 1670

/** Dynamic captions: spoken text verbatim, word-synced highlight from measured timings. */
export const Captions: React.FC<{ t: number; hidden?: boolean; y?: number }> = ({ t, hidden, y = CAPTION_CENTER_Y }) => {
  if (hidden) return null;
  let idx = -1;
  for (let i = 0; i < CAPTION_GROUPS.length; i++) if (t >= groupStart(CAPTION_GROUPS[i]) - 0.08) idx = i;
  if (idx < 0) return null;
  const g = CAPTION_GROUPS[idx];
  const start = groupStart(g) - 0.08;
  const next = CAPTION_GROUPS[idx + 1];
  const end = Math.min(groupEnd(g) + 0.5, next ? groupStart(next) - 0.08 : 99);
  if (t > end) return null;
  const inP = ramp(t, start - 0.04, start + 0.1, E.out); // first frame of a phrase is already visible (no 1-frame gap)
  const outP = next && groupStart(next) - 0.08 <= groupEnd(g) + 0.5 ? 0 : ramp(t, end - 0.12, end, E.in);
  const words = WORDS.slice(g.from, g.to + 1);
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.side,
        width: WIDTH - SAFE.side * 2,
        top: y,
        transform: `translateY(-50%) translateY(${(1 - inP) * 26 - outP * 12}px)`,
        opacity: inP * (1 - outP),
        display: "flex",
        justifyContent: "center",
        fontFamily: FONT_BODY,
        fontWeight: 800,
        fontSize: 66,
        lineHeight: 1.12,
        letterSpacing: -0.6,
        textAlign: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: WIDTH - SAFE.side * 2,
          padding: "14px 30px 18px",
          borderRadius: 28,
          background: "rgba(6,11,26,0.74)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06) inset",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          columnGap: 20,
          rowGap: 2,
        }}
      >
      {words.map((w, k) => {
        const i = g.from + k;
        const tone = g.hl?.[i];
        const spoken = lin(t, w.s - 0.04, w.s + 0.06);
        const current = t >= w.s - 0.04 && t < w.e + 0.04 ? 1 : 0;
        const pop = ramp(t, w.s - 0.04, w.s + 0.1, E.outBack) * (1 - ramp(t, w.e, w.e + 0.18));
        const color = tone ? TONE[tone] : C.white;
        return (
          <span
            key={i}
            style={{
              position: "relative",
              display: "inline-block",
              color,
              opacity: mix(0.42, 1, spoken),
              transform: `translateY(${-5 * pop}px) scale(${1 + 0.025 * pop})`,
              textShadow: "0 3px 0 rgba(4,8,20,0.55), 0 6px 22px rgba(4,8,20,0.75)",
              whiteSpace: "nowrap",
            }}
          >
            {current && tone ? (
              <span
                style={{
                  position: "absolute",
                  left: -7,
                  right: -7,
                  top: "12%",
                  bottom: "4%",
                  borderRadius: 14,
                  background: `${color}2E`,
                  zIndex: -1,
                }}
              />
            ) : null}
            {w.w}
          </span>
        );
      })}
      </div>
    </div>
  );
};

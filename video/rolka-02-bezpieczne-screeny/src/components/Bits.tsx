import React from "react";
import { Img, staticFile } from "remotion";
import { clamp01 } from "../lib/anim";
import { C } from "../lib/theme";

/** Dark gradient band that keeps headlines legible over the white screen. */
export const Scrim: React.FC<{ top: number; height: number; opacity: number; from?: "top" | "bottom" }> = ({ top, height, opacity, from = "top" }) =>
  opacity <= 0.001 ? null : (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        height,
        opacity,
        background:
          from === "top"
            ? "linear-gradient(180deg, rgba(5,6,13,0.94) 0%, rgba(5,6,13,0.86) 55%, rgba(5,6,13,0) 100%)"
            : "linear-gradient(0deg, rgba(5,6,13,0.94) 0%, rgba(5,6,13,0.8) 55%, rgba(5,6,13,0) 100%)",
      }}
    />
  );

/** flash_ring.svg (assets/objects) as an expanding shock ring. */
export const FlashRing: React.FC<{ x: number; y: number; p: number; r0?: number; r1?: number; color?: string }> = ({
  x,
  y,
  p,
  r0 = 120,
  r1 = 520,
  color = C.pinkHot,
}) => {
  if (p <= 0 || p >= 1) return null;
  const r = r0 + (r1 - r0) * p;
  return (
    <svg style={{ position: "absolute", left: x - r - 10, top: y - r - 10, overflow: "visible" }} width={r * 2 + 20} height={r * 2 + 20}>
      <circle cx={r + 10} cy={r + 10} r={r} fill="none" stroke={color} strokeWidth={14 * (1 - p) + 2} opacity={0.68 * (1 - p)} />
      <circle cx={r + 10} cy={r + 10} r={r * 0.79} fill="none" stroke="#FFFFFF" strokeWidth={5 * (1 - p) + 1} opacity={0.25 * (1 - p)} />
    </svg>
  );
};

/** checkmark.svg (assets/objects) — drawn as a badge. */
export const CheckBadge: React.FC<{ x: number; y: number; p: number; size?: number }> = ({ x, y, p, size = 96 }) => {
  if (p <= 0.001) return null;
  const k = 0.3 + 0.7 * clamp01(p * 1.3) + Math.sin(clamp01(p) * Math.PI) * 0.08;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      style={{ position: "absolute", left: x - size / 2, top: y - size / 2, transform: `scale(${k})`, opacity: clamp01(p * 3), overflow: "visible" }}
    >
      <circle cx={128} cy={128} r={114} fill="#0E493B" stroke="#4FF1C6" strokeWidth={10} />
      <path
        d="M62 127 L109 170 L196 80"
        fill="none"
        stroke="#BEFFEB"
        strokeWidth={24}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - clamp01((p - 0.25) / 0.75)}
      />
    </svg>
  );
};

/** Warning emblem from 09_alert_bezpieczenstwo.svg, as separate animatable rings. */
export const AlertEmblem: React.FC<{ p: number; pulse: number; size: number }> = ({ p, pulse, size }) => (
  <svg width={size} height={size} viewBox="-340 -340 680 680" style={{ display: "block", overflow: "visible" }}>
    <circle r={320 + pulse * 20} fill="#F94586" opacity={0.14 * p} />
    <circle r={262} fill="none" stroke="#F950E1" strokeWidth={5} opacity={0.52 * p} strokeDasharray={`${1646 * clamp01(p * 1.2)} 1646`} transform="rotate(-90)" />
    <circle r={200 * (0.6 + 0.4 * clamp01(p * 1.4))} fill="#2B152A" stroke="#F950E1" strokeWidth={7} />
    <g transform={`scale(${0.5 + 0.5 * clamp01((p - 0.15) * 1.6)})`} opacity={clamp01((p - 0.1) * 2)}>
      <path d="M0 -132 L-127 102 Q-134 117 -112 117 H112 Q134 117 127 102 Z" fill="#FFDCED" />
      <rect x={-11} y={-45} width={22} height={87} rx={11} fill="#5D1740" />
      <circle cy={74} r={13} fill="#5D1740" />
    </g>
  </svg>
);

/** Miniature of the same fictional screenshot (used when it "spreads" online). */
export const MiniShot: React.FC<{ w: number }> = ({ w }) => {
  const h = (w * 1210) / 900;
  return (
    <svg width={w} height={h} viewBox="154 225 900 1210" style={{ display: "block" }}>
      <rect x={154} y={225} width={900} height={1210} rx={82} fill="#1C2034" stroke="#525475" strokeWidth={8} />
      <rect x={177} y={283} width={854} height={1085} rx={47} fill="#F4F6FA" />
      <rect x={177} y={283} width={854} height={120} rx={47} fill="#FFFFFF" />
      <circle cx={245} cy={344} r={35} fill="#F1DEFA" />
      <rect x={300} y={318} width={240} height={26} rx={13} fill="#C9CEDA" />
      <rect x={228} y={485} width={675} height={145} rx={24} fill="#E7E9F3" />
      <rect x={399} y={680} width={567} height={100} rx={26} fill="#CFF8EA" />
      <rect x={228} y={848} width={707} height={225} rx={25} fill="#E7E9F3" />
      <rect x={252} y={937} width={590} height={91} rx={13} fill="#FFFFFF" />
      <path d="M268 985 C454 963 614 1000 839 978" fill="none" stroke="#0D0F18" strokeWidth={95} strokeLinecap="round" opacity={0.78} />
      <rect x={229} y={1165} width={715} height={105} rx={22} fill="#E9ECF4" />
    </svg>
  );
};

/** Card drop shadow (pre-rendered texture, stretched to any card size). */
export const CardShadow: React.FC<{ x: number; y: number; w: number; h: number; opacity?: number }> = ({ x, y, w, h, opacity = 1 }) => (
  <Img
    src={staticFile("textures/card_shadow.png")}
    style={{
      position: "absolute",
      left: x - (w * 90) / 400 + w * 0.04,
      top: y - (h * 90) / 200 + h * 0.07,
      width: w * (580 / 400),
      height: h * (380 / 200),
      opacity,
    }}
  />
);

/** Simple geometric line icons for the data cards. */
export const DataIcon: React.FC<{ kind: "phone" | "pin" | "user" | "mail" | "bank"; color: string; size: number }> = ({ kind, color, size }) => {
  const sw = 7;
  const common = { fill: "none", stroke: color, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {kind === "phone" && (
        <>
          <rect x={30} y={14} width={40} height={72} rx={9} {...common} />
          <path d="M45 74 H55" {...common} />
        </>
      )}
      {kind === "pin" && (
        <>
          <path d="M50 88 C50 88 22 60 22 40 A28 28 0 0 1 78 40 C78 60 50 88 50 88 Z" {...common} />
          <circle cx={50} cy={40} r={10} {...common} />
        </>
      )}
      {kind === "user" && (
        <>
          <circle cx={50} cy={34} r={16} {...common} />
          <path d="M20 86 C20 66 34 58 50 58 C66 58 80 66 80 86" {...common} />
        </>
      )}
      {kind === "mail" && (
        <>
          <rect x={14} y={24} width={72} height={52} rx={8} {...common} />
          <path d="M16 28 L50 54 L84 28" {...common} />
        </>
      )}
      {kind === "bank" && (
        <>
          <path d="M14 38 L50 16 L86 38 Z" {...common} />
          <path d="M26 44 V74 M42 44 V74 M58 44 V74 M74 44 V74 M14 84 H86" {...common} />
        </>
      )}
    </svg>
  );
};

"use client";
import { useId, type CSSProperties, type ReactNode } from "react";
import type { GuideArt } from "@/lib/tool-guides";

/**
 * THE BUILT-IN ILLUSTRATIONS OF A TUTORIAL STEP.
 *
 * Drawn, not photographed, and drawn on purpose: each shows the CONTROL a
 * step is about — a drop zone, a ratio, a palette, a before/after handle —
 * never a finished result, so no illustration claims an output the tool would
 * then have to live up to. They are painted from the theme's own tokens, so
 * light and dark come for free and the brand accent is the brand accent.
 * An admin can lay a library picture over any of them.
 */

const c = {
  surface: "rgb(var(--surface))",
  raised: "rgb(var(--raised))",
  sunken: "rgb(var(--sunken))",
  line: "rgb(var(--line-strong))",
  ink: "rgb(var(--ink))",
  muted: "rgb(var(--muted))",
  faint: "rgb(var(--faint))",
  accent: "rgb(var(--accent))",
  soft: "rgb(var(--accent) / 0.16)",
  glow: "rgb(var(--accent-glow) / 0.35)",
  violet: "rgb(var(--violet) / 0.55)",
};

type S = CSSProperties;
const card: S = { fill: c.surface, stroke: c.line, strokeWidth: 1.2 };
const raised: S = { fill: c.raised, stroke: c.line, strokeWidth: 1 };
const accentFill: S = { fill: c.accent };
const softFill: S = { fill: c.soft };
const stroke = (color: string, w = 2): S => ({ fill: "none", stroke: color, strokeWidth: w, strokeLinecap: "round", strokeLinejoin: "round" });

/** A product, the same bottle everywhere, so a step never reads as a promise
 *  about a particular kind of product. */
function Product({ x, y, s = 1, tone = c.accent }: { x: number; y: number; s?: number; tone?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-7} y={-34} width={14} height={9} rx={2} style={{ fill: c.ink, opacity: 0.85 }} />
      <path d="M-14 -25 h28 a6 6 0 0 1 6 6 v34 a8 8 0 0 1 -8 8 h-24 a8 8 0 0 1 -8 -8 v-34 a6 6 0 0 1 6 -6 z" style={{ fill: tone, opacity: 0.9 }} />
      <rect x={-11} y={-6} width={22} height={11} rx={2} style={{ fill: c.surface, opacity: 0.85 }} />
    </g>
  );
}

function Thumb({ x, y, w = 46, h = 46, tone = c.violet, children }: { x: number; y: number; w?: number; h?: number; tone?: string; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={9} style={raised} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx={6} style={{ fill: tone, opacity: 0.35 }} />
      {children}
    </g>
  );
}

function Sparkle({ x, y, r = 7 }: { x: number; y: number; r?: number }) {
  return <path d={`M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z`} style={accentFill} />;
}

function Pill({ x, y, w, label, on = false }: { x: number; y: number; w: number; label?: string; on?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={22} rx={11} style={on ? { fill: c.soft, stroke: c.accent, strokeWidth: 1.4 } : raised} />
      {label && <text x={x + w / 2} y={y + 15} textAnchor="middle" style={{ fill: on ? c.accent : c.muted, fontSize: 10, fontWeight: 600, fontFamily: "inherit" }}>{label}</text>}
    </g>
  );
}

function Checker({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const cells: ReactNode[] = [];
  const size = 12;
  for (let i = 0; i < Math.ceil(w / size); i++) {
    for (let j = 0; j < Math.ceil(h / size); j++) {
      if ((i + j) % 2 === 0) cells.push(<rect key={`${i}-${j}`} x={x + i * size} y={y + j * size} width={Math.min(size, w - i * size)} height={Math.min(size, h - j * size)} style={{ fill: c.line, opacity: 0.45 }} />);
    }
  }
  return <g>{cells}</g>;
}

const SCENES: Record<GuideArt, () => ReactNode> = {
  upload: () => (
    <>
      <rect x={70} y={38} width={180} height={112} rx={16} style={{ fill: c.surface, stroke: c.accent, strokeWidth: 1.6, strokeDasharray: "6 6" }} />
      <circle cx={160} cy={84} r={18} style={softFill} />
      <path d="M160 93 v-18 m-7 7 l7 -7 l7 7" style={stroke(c.accent, 2.4)} />
      <rect x={124} y={112} width={72} height={8} rx={4} style={{ fill: c.line }} />
      <Thumb x={34} y={120} w={40} h={40}><Product x={54} y={142} s={0.42} /></Thumb>
      <Thumb x={246} y={30} w={40} h={40} tone={c.glow}><Product x={266} y={52} s={0.42} /></Thumb>
    </>
  ),
  order: () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <Thumb x={46 + i * 60} y={62} w={50} h={50} tone={i === 1 ? c.glow : c.violet}><Product x={71 + i * 60} y={88} s={0.48} /></Thumb>
          <circle cx={58 + i * 60} cy={60} r={9} style={i === 1 ? accentFill : { fill: c.ink }} />
          <text x={58 + i * 60} y={64} textAnchor="middle" style={{ fill: c.surface, fontSize: 10, fontWeight: 700 }}>{i + 1}</text>
        </g>
      ))}
      <path d="M118 132 l-8 7 l8 7 M138 132 l8 7 l-8 7" style={stroke(c.accent, 2.2)} />
      <rect x={104} y={124} width={48} height={30} rx={10} style={{ fill: "none", stroke: c.accent, strokeWidth: 1.2, opacity: 0.6 }} />
    </>
  ),
  session: () => (
    <>
      <rect x={50} y={44} width={104} height={112} rx={14} style={{ fill: c.soft, stroke: c.accent, strokeWidth: 1.6 }} />
      <rect x={60} y={54} width={84} height={62} rx={9} style={{ fill: c.surface }} />
      <Product x={102} y={92} s={0.62} />
      <rect x={60} y={124} width={60} height={7} rx={3.5} style={{ fill: c.accent, opacity: 0.6 }} />
      <rect x={60} y={137} width={40} height={6} rx={3} style={{ fill: c.line }} />
      <rect x={166} y={44} width={104} height={112} rx={14} style={card} />
      <rect x={176} y={54} width={84} height={62} rx={9} style={{ fill: c.raised }} />
      <rect x={176} y={96} width={84} height={20} style={{ fill: c.line, opacity: 0.5 }} />
      <Product x={218} y={92} s={0.62} tone={c.violet} />
      <rect x={176} y={124} width={60} height={7} rx={3.5} style={{ fill: c.line }} />
      <rect x={176} y={137} width={40} height={6} rx={3} style={{ fill: c.line, opacity: 0.6 }} />
    </>
  ),
  settings: () => (
    <>
      <rect x={52} y={34} width={216} height={132} rx={16} style={card} />
      <rect x={68} y={50} width={60} height={7} rx={3.5} style={{ fill: c.muted, opacity: 0.6 }} />
      <Pill x={68} y={64} w={40} label="1:1" on />
      <Pill x={114} y={64} w={40} label="4:5" />
      <Pill x={160} y={64} w={46} label="16:9" />
      <rect x={68} y={100} width={70} height={7} rx={3.5} style={{ fill: c.muted, opacity: 0.6 }} />
      <rect x={68} y={118} width={184} height={6} rx={3} style={{ fill: c.line }} />
      <rect x={68} y={118} width={110} height={6} rx={3} style={accentFill} />
      <circle cx={178} cy={121} r={9} style={{ fill: c.surface, stroke: c.accent, strokeWidth: 2 }} />
      <Pill x={68} y={136} w={34} label="2K" on />
      <Pill x={108} y={136} w={34} label="4K" />
    </>
  ),
  format: () => (
    <>
      <rect x={44} y={58} width={70} height={70} rx={8} style={card} />
      <rect x={128} y={44} width={64} height={98} rx={8} style={{ fill: c.surface, stroke: c.accent, strokeWidth: 1.8 }} />
      <rect x={206} y={68} width={84} height={50} rx={8} style={card} />
      <rect x={134} y={70} width={52} height={46} rx={5} style={{ fill: c.soft }} />
      <Product x={160} y={100} s={0.55} />
      <Product x={79} y={98} s={0.5} tone={c.violet} />
      <Product x={248} y={98} s={0.4} tone={c.violet} />
      <text x={79} y={146} textAnchor="middle" style={{ fill: c.muted, fontSize: 10, fontWeight: 600 }}>1:1</text>
      <text x={160} y={160} textAnchor="middle" style={{ fill: c.accent, fontSize: 10, fontWeight: 700 }}>4:5</text>
      <text x={248} y={136} textAnchor="middle" style={{ fill: c.muted, fontSize: 10, fontWeight: 600 }}>16:9</text>
    </>
  ),
  prompt: () => (
    <>
      <rect x={46} y={44} width={228} height={96} rx={16} style={card} />
      <rect x={62} y={62} width={168} height={8} rx={4} style={{ fill: c.ink, opacity: 0.55 }} />
      <rect x={62} y={80} width={192} height={8} rx={4} style={{ fill: c.ink, opacity: 0.35 }} />
      <rect x={62} y={98} width={120} height={8} rx={4} style={{ fill: c.ink, opacity: 0.35 }} />
      <rect x={186} y={95} width={2.4} height={14} style={accentFill} />
      <Sparkle x={258} y={48} r={9} />
      <Pill x={62} y={150} w={74} />
      <Pill x={142} y={150} w={58} on />
    </>
  ),
  inspiration: () => (
    <>
      <rect x={58} y={42} width={78} height={98} rx={12} style={{ fill: c.violet, opacity: 0.5 }} />
      <rect x={146} y={42} width={58} height={46} rx={12} style={{ fill: c.glow }} />
      <rect x={146} y={94} width={58} height={46} rx={12} style={{ fill: c.soft, stroke: c.line, strokeWidth: 1 }} />
      <circle cx={88} cy={74} r={14} style={{ fill: c.surface, opacity: 0.7 }} />
      <path d="M58 122 q30 -26 78 -8 v26 h-78 z" style={{ fill: c.surface, opacity: 0.45 }} />
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={230 + (i % 2) * 22} cy={66 + Math.floor(i / 2) * 22} r={8} style={{ fill: [c.accent, c.violet, c.glow, c.line][i] }} />)}
      <Sparkle x={250} y={128} r={8} />
    </>
  ),
  retouch: () => (
    <>
      <rect x={60} y={40} width={200} height={120} rx={14} style={card} />
      <rect x={60} y={40} width={100} height={120} rx={14} style={{ fill: c.line, opacity: 0.45 }} />
      <Product x={110} y={104} s={0.95} tone={c.muted} />
      <Product x={210} y={104} s={0.95} />
      <line x1={160} y1={40} x2={160} y2={160} style={stroke(c.surface, 3)} />
      <path d="M232 52 l18 -18" style={stroke(c.ink, 3)} />
      <Sparkle x={254} y={30} r={8} />
      <Sparkle x={236} y={70} r={5} />
    </>
  ),
  generate: () => (
    <>
      <rect x={60} y={60} width={200} height={20} rx={10} style={{ fill: c.line, opacity: 0.6 }} />
      <rect x={60} y={60} width={128} height={20} rx={10} style={softFill} />
      <rect x={70} y={98} width={180} height={44} rx={14} style={{ fill: c.accent, filter: "drop-shadow(0 10px 16px rgb(var(--accent) / 0.35))" }} />
      <Sparkle x={112} y={120} r={8} />
      <rect x={128} y={115} width={90} height={9} rx={4.5} style={{ fill: c.surface, opacity: 0.9 }} />
      {[0, 1, 2].map((i) => <circle key={i} cx={146 + i * 14} cy={164} r={4} style={{ fill: c.accent, opacity: 0.4 + i * 0.25 }} />)}
    </>
  ),
  result: () => (
    <>
      <Thumb x={46} y={36} w={72} h={60} tone={c.glow}><Product x={82} y={70} s={0.55} /></Thumb>
      <Thumb x={124} y={36} w={72} h={60}><Product x={160} y={70} s={0.55} tone={c.violet} /></Thumb>
      <Thumb x={202} y={36} w={72} h={60}><Product x={238} y={70} s={0.55} /></Thumb>
      <Thumb x={46} y={102} w={110} h={62}><Product x={101} y={138} s={0.6} /></Thumb>
      <Thumb x={164} y={102} w={110} h={62} tone={c.glow}><Product x={219} y={138} s={0.6} tone={c.violet} /></Thumb>
      <rect x={52} y={42} width={26} height={14} rx={7} style={accentFill} />
      <circle cx={65} cy={49} r={2.6} style={{ fill: "#fff" }} />
      <circle cx={262} cy={114} r={8} style={{ fill: c.surface, stroke: c.line, strokeWidth: 1 }} />
      <path d="M258.5 113.5 a2 2 0 0 1 3.5 -1.2 a2 2 0 0 1 3.5 1.2 c0 2 -3.5 4 -3.5 4 s-3.5 -2 -3.5 -4z" style={accentFill} />
    </>
  ),
  compare: () => (
    <>
      <rect x={60} y={36} width={200} height={128} rx={14} style={card} />
      <rect x={60} y={36} width={110} height={128} rx={14} style={{ fill: c.line, opacity: 0.5 }} />
      <Product x={130} y={110} s={1} tone={c.muted} />
      <Product x={200} y={110} s={1} />
      <line x1={170} y1={36} x2={170} y2={164} style={stroke(c.surface, 3)} />
      <circle cx={170} cy={100} r={13} style={{ fill: c.surface, stroke: c.accent, strokeWidth: 2 }} />
      <path d="M165 100 l-4 -4 m4 4 l-4 4 M175 100 l4 -4 m-4 4 l4 4" style={stroke(c.accent, 1.8)} />
    </>
  ),
  download: () => (
    <>
      <rect x={96} y={36} width={128} height={86} rx={14} style={card} />
      <Product x={160} y={86} s={0.8} />
      <circle cx={160} cy={140} r={22} style={{ fill: c.accent, filter: "drop-shadow(0 8px 14px rgb(var(--accent) / 0.35))" }} />
      <path d="M160 130 v18 m-7 -7 l7 7 l7 -7" style={stroke("#fff", 2.6)} />
      <rect x={54} y={150} width={60} height={14} rx={7} style={raised} />
      <rect x={206} y={150} width={60} height={14} rx={7} style={raised} />
    </>
  ),
  background: () => (
    <>
      <rect x={70} y={34} width={180} height={132} rx={14} style={card} />
      <Checker x={78} y={42} w={164} h={116} />
      <Product x={160} y={118} s={1.1} />
      <Pill x={84} y={140} w={42} label="PNG" on />
      <Pill x={132} y={140} w={46} label="WebP" />
    </>
  ),
  color: () => (
    <>
      <rect x={84} y={30} width={152} height={104} rx={14} style={{ fill: c.soft, stroke: c.accent, strokeWidth: 1.4 }} />
      <Product x={160} y={96} s={1} />
      {["#ffffff", "#111111", "#f4d6e4", "#d9e8ff", "#e9f5e1", "rgb(var(--accent))"].map((fill, i) => (
        <circle key={i} cx={90 + i * 28} cy={152} r={10} style={{ fill, stroke: c.line, strokeWidth: 1.2 }} />
      ))}
      <circle cx={90 + 5 * 28} cy={152} r={14} style={{ fill: "none", stroke: c.accent, strokeWidth: 1.6 }} />
    </>
  ),
  scene: () => (
    <>
      <rect x={52} y={34} width={216} height={132} rx={14} style={{ fill: c.violet, opacity: 0.35 }} />
      <circle cx={226} cy={66} r={16} style={{ fill: c.glow }} />
      <rect x={52} y={124} width={216} height={42} rx={0} style={{ fill: c.surface, opacity: 0.7 }} />
      <path d="M52 124 h216" style={stroke(c.line, 1.5)} />
      <Product x={150} y={118} s={1} />
      <rect x={84} y={92} width={22} height={32} rx={4} style={{ fill: c.surface, opacity: 0.55 }} />
      <Sparkle x={72} y={56} r={7} />
    </>
  ),
  shadow: () => (
    <>
      <rect x={52} y={34} width={216} height={132} rx={14} style={card} />
      <ellipse cx={110} cy={136} rx={30} ry={6} style={{ fill: c.ink, opacity: 0.18 }} />
      <Product x={110} y={118} s={0.95} />
      <ellipse cx={212} cy={140} rx={24} ry={4.5} style={{ fill: c.ink, opacity: 0.12 }} />
      <Product x={212} y={104} s={0.95} tone={c.violet} />
      <path d="M200 124 v6 M212 124 v8 M224 124 v6" style={stroke(c.faint, 1.4)} />
    </>
  ),
  garment: () => (
    <>
      <rect x={70} y={30} width={180} height={140} rx={16} style={card} />
      <path d="M160 46 a8 8 0 1 1 8 8 l-8 6" style={stroke(c.ink, 2.2)} />
      <path d="M118 74 l42 -14 l42 14 l14 30 l-18 8 l-6 -12 v58 h-64 v-58 l-6 12 l-18 -8 z" style={{ fill: c.accent, opacity: 0.88 }} />
      <path d="M146 64 q14 12 28 0" style={stroke(c.surface, 2)} />
      <Sparkle x={228} y={52} r={7} />
    </>
  ),
  person: () => (
    <>
      <rect x={70} y={30} width={180} height={140} rx={16} style={card} />
      <circle cx={160} cy={70} r={20} style={{ fill: c.line }} />
      <path d="M112 170 v-26 a30 30 0 0 1 30 -30 h36 a30 30 0 0 1 30 30 v26 z" style={{ fill: c.accent, opacity: 0.88 }} />
      <path d="M146 114 l14 14 l14 -14" style={stroke(c.surface, 2)} />
    </>
  ),
  face: () => (
    <>
      <rect x={52} y={42} width={96} height={116} rx={14} style={card} />
      <circle cx={100} cy={86} r={22} style={{ fill: c.line }} />
      <path d="M66 158 v-14 a24 24 0 0 1 24 -24 h20 a24 24 0 0 1 24 24 v14 z" style={{ fill: c.violet }} />
      <rect x={172} y={56} width={96} height={88} rx={14} style={{ fill: c.soft, stroke: c.accent, strokeWidth: 1.4 }} />
      <circle cx={220} cy={100} r={26} style={{ fill: c.accent, opacity: 0.75 }} />
      <path d="M150 92 h18 m-6 -6 l6 6 l-6 6" style={stroke(c.accent, 2.2)} />
    </>
  ),
  resize: () => (
    <>
      <rect x={60} y={40} width={200} height={124} rx={12} style={card} />
      <rect x={96} y={62} width={128} height={80} rx={9} style={{ fill: c.soft, stroke: c.accent, strokeWidth: 1.4 }} />
      <Product x={160} y={112} s={0.75} />
      <path d="M96 52 h128 m-122 -5 l-6 5 l6 5 m116 -10 l6 5 l-6 5" style={stroke(c.muted, 1.6)} />
      <path d="M244 62 v80 m-5 -74 l5 -6 l5 6 m-10 68 l5 6 l5 -6" style={stroke(c.muted, 1.6)} />
    </>
  ),
  compress: () => (
    <>
      <rect x={52} y={50} width={84} height={104} rx={12} style={card} />
      <rect x={64} y={62} width={60} height={60} rx={8} style={{ fill: c.violet, opacity: 0.35 }} />
      <rect x={64} y={130} width={44} height={8} rx={4} style={{ fill: c.ink, opacity: 0.5 }} />
      <path d="M150 102 h24 m-7 -7 l7 7 l-7 7" style={stroke(c.accent, 2.4)} />
      <rect x={190} y={70} width={70} height={84} rx={12} style={{ fill: c.surface, stroke: c.accent, strokeWidth: 1.4 }} />
      <rect x={200} y={80} width={50} height={50} rx={7} style={{ fill: c.soft }} />
      <rect x={200} y={138} width={30} height={8} rx={4} style={accentFill} />
      <path d="M200 50 a26 26 0 0 1 50 0" style={stroke(c.line, 5)} />
      <path d="M200 50 a26 26 0 0 1 36 -18" style={stroke(c.accent, 5)} />
    </>
  ),
};

export function GuideArtwork({ art, className }: { art: GuideArt; className?: string }) {
  const scene = SCENES[art] ?? SCENES.result;
  // One gradient per drawing: two illustrations on one screen (the tutorial
  // over a starter gallery) must not share an id.
  const wash = `guide-wash-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 320 200" role="presentation" aria-hidden="true" focusable="false" className={className}
      preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={wash} cx="70%" cy="10%" r="90%">
          <stop offset="0%" style={{ stopColor: "rgb(var(--accent))", stopOpacity: 0.16 }} />
          <stop offset="60%" style={{ stopColor: "rgb(var(--violet))", stopOpacity: 0.08 }} />
          <stop offset="100%" style={{ stopColor: "rgb(var(--surface))", stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={320} height={200} style={{ fill: `url(#${wash})` }} />
      {scene()}
    </svg>
  );
}

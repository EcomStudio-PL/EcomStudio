import React from "react";

// Layered rebuild of the package's own illustration (assets/illustrations/01_przykladowe_zdjecie.svg):
// background, ground, shadow, vase body, rim, stems and leaves are separate layers so that the
// edit scenes can crop / remove the background / restyle the very same drawing live.

export type VaseLook = {
  bg: string;
  ground: string;
  body: string;
  stroke: string;
  leaf: string;
  stem: string;
};

export const LOOKS = {
  hero: { bg: "#D4E6EC", ground: "#ADC8BE", body: "#F7F2E9", stroke: "#C7BFB4", leaf: "#87A77F", stem: "#59745A" },
  lavender: { bg: "#E4DFF4", ground: "#C9C0E6", body: "#F7F2E9", stroke: "#C2BAD0", leaf: "#8FA884", stem: "#5D7660" },
  sage: { bg: "#E3EBDD", ground: "#C7D6BC", body: "#EFE7DA", stroke: "#C3B9A8", leaf: "#7E9F78", stem: "#55704F" },
  blush: { bg: "#F6E1E8", ground: "#E8C3CF", body: "#FAF5EE", stroke: "#D2C1BC", leaf: "#8AA781", stem: "#5A7558" },
  sand: { bg: "#F3EBDD", ground: "#E0D2B8", body: "#D9A98C", stroke: "#B98A6E", leaf: "#7F9E77", stem: "#56714F" },
  mint: { bg: "#DDF0EC", ground: "#B5D9D0", body: "#FFFFFF", stroke: "#C6D3D1", leaf: "#7FA48A", stem: "#4F6E58" },
  studio: { bg: "#FBE7F6", ground: "#F3C7E8", body: "#FFFFFF", stroke: "#E2C6DA", leaf: "#8AAE86", stem: "#567456" },
} satisfies Record<string, VaseLook>;

type Props = {
  id: string;
  look?: VaseLook;
  /** 0 = background removed (checkerboard visible), 1 = original photo background */
  bgAlpha?: number;
  /** AI restyle progress 0..1 (glaze + blossoms) */
  ai?: number;
  /** Zoom into the picture: scale around (cx, cy) in 0..350 units */
  zoom?: { s: number; cx: number; cy: number };
  /** Mirror horizontally (for thumbnail variety) */
  flip?: boolean;
  /** Vase scale inside frame (thumbnail variety) */
  vaseScale?: number;
  style?: React.CSSProperties;
};

const BODY =
  "M143 95 H206 Q202 115 205 128 C215 158 239 182 232 220 C226 259 198 280 175 279 C152 280 124 259 118 220 C111 182 135 157 145 128 Q149 115 143 95Z";

export const Vase: React.FC<Props> = ({ id, look = LOOKS.hero, bgAlpha = 1, ai = 0, zoom, flip, vaseScale = 1, style }) => {
  const z = zoom ?? { s: 1, cx: 175, cy: 175 };
  const vs = vaseScale;
  const vaseT = `translate(175 280) scale(${vs}) translate(-175 -280)`;
  const viewT = `translate(175 175) scale(${z.s}) translate(${-z.cx} ${-z.cy})`;
  const blossom = Math.max(0, Math.min(1, (ai - 0.25) / 0.6));
  return (
    <svg viewBox="0 0 350 350" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%", display: "block", ...style }}>
      <defs>
        <pattern id={`${id}-chk`} width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="28" height="28" fill="#E9EDF5" />
          <rect width="14" height="14" fill="#CDD4E2" />
          <rect x="14" y="14" width="14" height="14" fill="#CDD4E2" />
        </pattern>
        <linearGradient id={`${id}-shade`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="1" stopColor="#1B2440" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={`${id}-glaze`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F950E1" />
          <stop offset="1" stopColor="#8A3FFF" />
        </linearGradient>
        <radialGradient id={`${id}-light`} cx="0.3" cy="0.15" r="0.9">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.45" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform={viewT}>
        <rect x="-200" y="-200" width="750" height="750" fill={`url(#${id}-chk)`} />
        <g opacity={bgAlpha}>
          <rect x="-200" y="-200" width="750" height="750" fill={look.bg} />
          <path d="M-200 212 Q175 160 550 207 V550 H-200Z" fill={look.ground} />
          <rect x="-200" y="-200" width="750" height="750" fill={`url(#${id}-light)`} />
        </g>
        <g transform={flip ? "translate(350 0) scale(-1 1)" : undefined}>
          <g transform={vaseT}>
            <ellipse cx="175" cy="288" rx="104" ry="15" fill="#607B86" opacity={0.32 * (0.35 + 0.65 * bgAlpha)} />
            <path d={BODY} fill={look.body} stroke={look.stroke} strokeWidth="4" />
            <path d={BODY} fill={`url(#${id}-glaze)`} opacity={0.92 * ai} />
            <path d={BODY} fill={`url(#${id}-shade)`} />
            {ai > 0 ? (
              <g opacity={ai} fill="none" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="3">
                <path d="M128 190 Q175 175 222 190" />
                <path d="M122 222 Q175 207 228 222" />
                <path d="M130 252 Q175 240 220 252" />
              </g>
            ) : null}
            <ellipse cx="175" cy="95" rx="32" ry="7" fill="#E1D8CE" stroke="#B8AFA6" strokeWidth="2" />
            <path d="M176 111 Q160 65 151 29 M178 112 Q205 60 220 33 M177 109 Q177 60 182 28" fill="none" stroke={look.stem} strokeWidth="5" />
            <path
              d="M150 48 Q132 33 129 18 Q150 20 162 38 M211 52 Q233 27 242 27 Q239 48 211 62 M177 57 Q160 28 177 18 Q195 36 180 61"
              fill={look.leaf}
            />
            {blossom > 0 ? (
              <g>
                {[
                  [151, 26],
                  [221, 31],
                  [182, 22],
                ].map(([x, y], i) => (
                  <g key={i} transform={`translate(${x} ${y}) scale(${blossom * (0.9 + i * 0.12)})`}>
                    {[0, 72, 144, 216, 288].map((r) => (
                      <ellipse key={r} cx="0" cy="-11" rx="7" ry="11" fill="#F950E1" transform={`rotate(${r})`} opacity="0.95" />
                    ))}
                    <circle r="5.5" fill="#FFD16C" />
                  </g>
                ))}
              </g>
            ) : null}
          </g>
        </g>
      </g>
    </svg>
  );
};

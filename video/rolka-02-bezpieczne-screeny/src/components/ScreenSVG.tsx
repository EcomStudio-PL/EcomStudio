import React from "react";
import { FONT_DISPLAY } from "../lib/fonts";
import { clamp01 } from "../lib/anim";

/**
 * The fictional chat screenshot, rebuilt as SEPARATE animatable layers from the
 * pack vectors (assets/demo/01_screen_original.svg, 02_marker_polprzezroczysty.svg,
 * 04_nieprzezroczysty_prostokat.svg). Coordinates are the original SVG units
 * (phone body = 154..1054 × 225..1435), so 1 unit = 1 px at phone scale 1.
 *
 * This component renders ONLY image pixels (what would be in the saved file):
 * screen, header, bubbles and the cover (marker / rectangle). Editor UI lives in
 * PhoneOverlays so that the brightness/contrast demo filters exactly the pixels.
 */

/** Marker strokes from 02_marker_polprzezroczysty.svg. */
export const MARKER_P1 = { d: [268, 989, 454, 963, 614, 1000, 839, 978], w: 83 };
export const MARKER_P2 = { d: [258, 1010, 436, 1000, 622, 1035, 854, 1007], w: 47 };
/** Number field from the pack (rect 252,937 590×91 rx13). */
export const FIELD = { x: 252, y: 937, w: 590, h: 91 };
export const FIELD_CY = FIELD.y + FIELD.h / 2;
/** Straightened brush = capsule exactly covering the field (round caps r = h/2). */
const LINE_TARGET = [FIELD.x + FIELD.h / 2, FIELD_CY, 464, FIELD_CY, 630, FIELD_CY, FIELD.x + FIELD.w - FIELD.h / 2, FIELD_CY];

export const cubicD = (n: number[]) => `M${n[0]} ${n[1]} C${n[2]} ${n[3]} ${n[4]} ${n[5]} ${n[6]} ${n[7]}`;
export const MARKER_D1 = cubicD(MARKER_P1.d);
export const MARKER_D2 = cubicD(MARKER_P2.d);

/** One gesture = two sequential swipes: stroke 1 (0..0.5), return, stroke 2 (0.58..1). */
export const strokeSplit = (draw: number) => ({
  p1: clamp01(draw / 0.5),
  p2: clamp01((draw - 0.58) / 0.42),
});
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

export type CoverState = {
  /** 0..1 drawing progress of both brush strokes (stroke 1 then stroke 2). */
  draw: number;
  /** 0 = brush, 1 = straightened capsule, 2 = geometric rectangle. */
  morph: number;
  /** Layer alpha. Marker = 0.78 (semi-transparent). Rectangle = 1. */
  alpha: number;
  /** Hide the cover in the composite (it is shown as a separate 3D layer). */
  hidden?: boolean;
};

export type ScreenState = {
  scrollY: number;
  /** Reveal 0..1 per bubble (1: client msg, 2: reply, 3: number msg, 4: thanks). */
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  /** 0..1 hide (lifted away as a card) per element: header, b1..b4. */
  lift: { h: number; b1: number; b2: number; b3: number; b4: number };
  cover: CoverState;
  /** Screenshot capture pulse 0..1 (content shrinks inside a white rim). */
  capture: number;
};

export const defaultScreen = (): ScreenState => ({
  scrollY: 0,
  b1: 1,
  b2: 1,
  b3: 1,
  b4: 1,
  lift: { h: 0, b1: 0, b2: 0, b3: 0, b4: 0 },
  cover: { draw: 0, morph: 0, alpha: 0.78 },
  capture: 0,
});

const T: React.CSSProperties = { fontFamily: FONT_DISPLAY };

const Bubble: React.FC<{
  reveal: number;
  lift: number;
  ax: number;
  ay: number;
  children: React.ReactNode;
}> = ({ reveal, lift, ax, ay, children }) => {
  const r = clamp01(reveal);
  if (r <= 0.001 || lift >= 0.999) return null;
  const k = 0.82 + 0.18 * r;
  return (
    <g
      opacity={Math.min(1, r * 1.6) * (1 - lift)}
      transform={`translate(${ax} ${ay + (1 - r) * 26}) scale(${k}) translate(${-ax} ${-ay})`}
    >
      {children}
    </g>
  );
};

export const Cover: React.FC<{ cover: CoverState; idp: string }> = ({ cover }) => {
  const { draw, morph, alpha } = cover;
  if (draw <= 0.001) return null;
  const { p1, p2 } = strokeSplit(draw);
  const m1 = clamp01(morph);
  const m2 = clamp01(morph - 1);
  const color = morph > 1 ? "#151924" : "#0D0F18";
  if (m2 > 0) {
    // Geometric rectangle: capsule → sharp-cornered opaque block.
    const rx = FIELD.h / 2 + (9 - FIELD.h / 2) * m2;
    return (
      <g opacity={alpha}>
        <rect x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} rx={rx} fill={color} />
      </g>
    );
  }
  const d1 = cubicD(mix(MARKER_P1.d, LINE_TARGET, m1));
  const d2 = cubicD(mix(MARKER_P2.d, LINE_TARGET, m1));
  const w1 = MARKER_P1.w + (FIELD.h - MARKER_P1.w) * m1;
  const w2 = MARKER_P2.w + (FIELD.h - MARKER_P2.w) * m1;
  return (
    // Group opacity: one semi-transparent layer (alpha < 1), as an editor's marker layer.
    <g opacity={alpha}>
      {p1 > 0 && (
        <path d={d1} fill="none" stroke={color} strokeWidth={w1} strokeLinecap="round" pathLength={1} strokeDasharray="1 2" strokeDashoffset={1 - p1} />
      )}
      {p2 > 0 && (
        <path d={d2} fill="none" stroke={color} strokeWidth={w2} strokeLinecap="round" pathLength={1} strokeDasharray="1 2" strokeDashoffset={1 - p2} />
      )}
    </g>
  );
};

export const ScreenSVG: React.FC<{ st: ScreenState; idp: string }> = ({ st, idp }) => {
  const clipId = `${idp}-msgclip`;
  const scrClip = `${idp}-scrclip`;
  const cap = clamp01(st.capture);
  const k = 1 - 0.05 * cap;
  return (
    <svg
      width={900}
      height={1210}
      viewBox="154 225 900 1210"
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={177} y={403} width={854} height={965} />
        </clipPath>
        <clipPath id={scrClip}>
          <rect x={177} y={283} width={854} height={1085} rx={47} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${scrClip})`}>
        {/* capture rim (screenshot flash) */}
        <rect x={177} y={283} width={854} height={1085} fill={cap > 0 ? "#FFFFFF" : "#F4F6FA"} />
        <g transform={`translate(604 825) scale(${k}) translate(-604 -825)`}>
          <rect x={177} y={283} width={854} height={1085} rx={47 * (1 + cap)} fill="#F4F6FA" />
          {/* messages */}
          <g clipPath={`url(#${clipId})`}>
            <g transform={`translate(0 ${st.scrollY})`}>
              <Bubble reveal={st.b1} lift={st.lift.b1} ax={228} ay={630}>
                <rect x={228} y={485} width={675} height={145} rx={24} fill="#E7E9F3" />
                <text x={259} y={537} fill="#35384C" fontSize={28} fontWeight={500} style={T}>
                  Hej! Prześlij proszę
                </text>
                <text x={259} y={577} fill="#35384C" fontSize={27} fontWeight={500} style={T}>
                  potwierdzenie zamówienia.
                </text>
              </Bubble>
              <Bubble reveal={st.b2} lift={st.lift.b2} ax={966} ay={780}>
                <rect x={399} y={680} width={567} height={100} rx={26} fill="#CFF8EA" />
                <text x={430} y={741} fill="#1D554A" fontSize={27} fontWeight={500} style={T}>
                  Jasne, już wysyłam!
                </text>
              </Bubble>
              <Bubble reveal={st.b3} lift={st.lift.b3} ax={228} ay={1073}>
                <rect x={228} y={848} width={707} height={225} rx={25} fill="#E7E9F3" />
                <text x={259} y={907} fill="#383B4D" fontSize={28} fontWeight={500} style={T}>
                  Mój numer telefonu:
                </text>
                <rect x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} rx={13} fill="#FFFFFF" />
                <text x={284} y={996} fill="#1F2434" fontSize={41} fontWeight={700} letterSpacing={1} style={T}>
                  000 000 000
                </text>
                {!st.cover.hidden && <Cover cover={st.cover} idp={idp} />}
              </Bubble>
              <Bubble reveal={st.b4} lift={st.lift.b4} ax={229} ay={1270}>
                <rect x={229} y={1165} width={715} height={105} rx={22} fill="#E9ECF4" />
                <text x={258} y={1229} fill="#444A58" fontSize={26} fontWeight={500} style={T}>
                  Dziękuję! Miłego dnia.
                </text>
              </Bubble>
            </g>
          </g>
          {/* header */}
          {st.lift.h < 0.999 && (
            <g opacity={1 - st.lift.h}>
              <rect x={177} y={283} width={854} height={120} rx={47} fill="#FFFFFF" />
              <rect x={177} y={366} width={854} height={38} fill="#FFFFFF" />
              <circle cx={245} cy={344} r={35} fill="#F1DEFA" />
              <text x={244} y={357} fill="#9B3E9A" fontSize={33} fontWeight={800} textAnchor="middle" style={T}>
                K
              </text>
              <text x={304} y={336} fill="#202332" fontSize={27} fontWeight={700} style={T}>
                Klient testowy
              </text>
              <text x={304} y={370} fill="#848B99" fontSize={19} fontWeight={500} style={T}>
                Przykład edukacyjny
              </text>
              <path d="M177 402 H1031" stroke="#DDE1E9" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
};

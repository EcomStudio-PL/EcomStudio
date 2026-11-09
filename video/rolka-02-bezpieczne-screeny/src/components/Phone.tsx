import React from "react";
import { Img, staticFile } from "remotion";
import { clamp01 } from "../lib/anim";
import { FONT_DISPLAY, FONT_MONO } from "../lib/fonts";
import { C } from "../lib/theme";
import { Cover, FIELD, FIELD_CY, ScreenSVG, ScreenState, defaultScreen } from "./ScreenSVG";

/**
 * Camera-aware pose. (fx, fy) is a point in phone/SVG units that is pinned to the
 * stage point (tx, ty); rotation and scale happen around it. Animating fx/fy/tx/ty
 * gives true "camera follows a detail" moves instead of a flat screenshot zoom.
 */
export type Pose = {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
};

export const PHONE_CX = 604;
export const PHONE_CY = 830;

export type PhoneState = {
  on: number;
  pose: Pose;
  body: number;
  shadow: number;
  screen: ScreenState;
  /** Brightness/contrast demo applied to the image pixels, visible between SVG x0..x1. */
  filter: { b: number; c: number; x0: number; x1: number; y0?: number; y1?: number } | null;
  dim: number;
  explode: number;
  flip: { pop: number; angle: number } | null;
  focus: number;
  divider: { on: number; x: number } | null;
  toolbar: number;
  tool: number;
  toolBan: number;
  finger: { on: number; x: number; y: number; press: number } | null;
  outline: number;
  check: number;
  flash: number;
  crop: { on: number; top: number; bottom: number; left: number; right: number; cut: number; dimBelow: number; confirmed: number } | null;
  /** Scan bar (hook) at SVG x. */
  scan: { on: number; x: number } | null;
  /** Flattened-file look: thin layer planes collapsing. */
  layers: number;
};

export const defaultPhone = (): PhoneState => ({
  on: 1,
  pose: { fx: PHONE_CX, fy: PHONE_CY, tx: 540, ty: 960, z: 0, rx: 0, ry: 0, rz: 0, s: 0.8 },
  body: 1,
  shadow: 1,
  screen: defaultScreen(),
  filter: null,
  dim: 0,
  explode: 0,
  flip: null,
  focus: 0,
  divider: null,
  toolbar: 0,
  tool: 0,
  toolBan: 0,
  finger: null,
  outline: 0,
  check: 0,
  flash: 0,
  crop: null,
  scan: null,
  layers: 0,
});

/** World perspective (see Rolka02: perspective 2400px, origin 50% 48%). */
export const PERSPECTIVE = 2400;
export const PERSP_ORIGIN = { x: 540, y: 1920 * 0.48 };
/** Stage position of an SVG point for a FLAT pose (rx = ry = rz = 0), including depth z. */
export const project = (p: Pose, sx: number, sy: number) => {
  const k = PERSPECTIVE / (PERSPECTIVE - p.z);
  return {
    x: PERSP_ORIGIN.x + (p.tx + (sx - p.fx) * p.s - PERSP_ORIGIN.x) * k,
    y: PERSP_ORIGIN.y + (p.ty + (sy - p.fy) * p.s - PERSP_ORIGIN.y) * k,
    k,
  };
};

const ToolIcon: React.FC<{ kind: 0 | 1 | 2; x: number; y: number; active: number }> = ({ kind, x, y, active }) => {
  const col = active > 0.5 ? "#FFFFFF" : "#9AA1B8";
  if (kind === 0)
    return (
      <g transform={`translate(${x} ${y}) rotate(-35)`}>
        <rect x={-8} y={-22} width={16} height={32} rx={4} fill={col} />
        <path d="M-8 10 L0 22 L8 10 Z" fill={col} />
      </g>
    );
  if (kind === 1) return <rect x={x - 16} y={y - 12} width={32} height={24} rx={4} fill={col} />;
  return (
    <path
      d={`M${x - 14} ${y - 20} V${y + 12} H${x + 18} M${x - 20} ${y - 12} H${x + 12} V${y + 20}`}
      fill="none"
      stroke={col}
      strokeWidth={5}
      strokeLinecap="round"
    />
  );
};

const Overlays: React.FC<{ st: PhoneState; idp: string }> = ({ st, idp }) => {
  const sy = st.screen.scrollY;
  const fy = FIELD.y + sy;
  const fcy = FIELD_CY + sy;
  const crop = st.crop;
  return (
    <svg width={900} height={1210} viewBox="154 225 900 1210" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <clipPath id={`${idp}-ov`}>
          <rect x={177} y={283} width={854} height={1085} rx={47} />
        </clipPath>
      </defs>
      {st.flash > 0 && <rect x={177} y={283} width={854} height={1085} rx={47} fill="#FFFFFF" opacity={st.flash} />}
      {st.dim > 0 && (
        <path
          clipPath={`url(#${idp}-ov)`}
          fillRule="evenodd"
          fill={C.bg0}
          opacity={st.dim * 0.55}
          d={`M177 283 H1031 V1368 H177 Z M${FIELD.x - 14} ${fy - 14} H${FIELD.x + FIELD.w + 14} V${fy + FIELD.h + 14} H${FIELD.x - 14} Z`}
        />
      )}
      {st.scan && st.scan.on > 0 && (
        <g opacity={st.scan.on}>
          <rect x={st.scan.x - 3} y={fy - 70} width={6} height={FIELD.h + 140} rx={3} fill={C.pinkHot} />
          <rect x={st.scan.x - 26} y={fy - 70} width={52} height={FIELD.h + 140} fill={C.pinkHot} opacity={0.16} />
          <circle cx={st.scan.x} cy={fy - 78} r={11} fill={C.pinkHot} />
          <circle cx={st.scan.x} cy={fy + FIELD.h + 78} r={11} fill={C.pinkHot} />
          <g transform={`translate(${st.scan.x - 120 - 142 * clamp01((st.scan.x - 420) / 280)} ${fy - 150})`}>
            <rect width={240} height={52} rx={26} fill={C.pink} />
            <text x={30} y={35} fill="#FFFFFF" fontSize={25} fontWeight={700} style={{ fontFamily: FONT_MONO, letterSpacing: 1.5 }}>
              KONTRAST
            </text>
            <path d="M206 36 V16 M197 24 L206 15 L215 24" stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      )}
      {st.divider && st.divider.on > 0 && (
        <g opacity={st.divider.on}>
          <rect x={st.divider.x - 2.5} y={fy - 105} width={5} height={FIELD.h + 150} fill="#FFFFFF" />
          <circle cx={st.divider.x} cy={fcy} r={24} fill="#FFFFFF" />
          <path d={`M${st.divider.x - 9} ${fcy - 8} l-8 8 l8 8 M${st.divider.x + 9} ${fcy - 8} l8 8 l-8 8`} stroke="#1B1F2E" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <g transform={`translate(${(FIELD.x + st.divider.x) / 2} ${fy - 72})`}>
            <rect x={-74} y={-26} width={148} height={46} rx={23} fill="#1B1F2E" />
            <text y={7} textAnchor="middle" fill="#FFFFFF" fontSize={24} fontWeight={700} style={{ fontFamily: FONT_MONO, letterSpacing: 2 }}>
              PRZED
            </text>
          </g>
          <g transform={`translate(${(st.divider.x + FIELD.x + FIELD.w) / 2} ${fy - 72})`}>
            <rect x={-56} y={-26} width={112} height={46} rx={23} fill={C.pink} />
            <text y={7} textAnchor="middle" fill="#FFFFFF" fontSize={24} fontWeight={700} style={{ fontFamily: FONT_MONO, letterSpacing: 2 }}>
              PO
            </text>
          </g>
        </g>
      )}
      {st.focus > 0 && (
        <rect
          x={FIELD.x - 12}
          y={fy - 12}
          width={FIELD.w + 24}
          height={FIELD.h + 24}
          rx={18}
          fill="none"
          stroke={C.pinkHot}
          strokeWidth={6}
          strokeDasharray="44 16"
          strokeDashoffset={-st.focus * 160}
          opacity={clamp01(st.focus * 3)}
        />
      )}
      {st.outline > 0 && (
        <rect
          x={FIELD.x - 4}
          y={fy - 4}
          width={FIELD.w + 8}
          height={FIELD.h + 8}
          rx={12}
          fill="none"
          stroke={C.pinkHot}
          strokeWidth={4}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - clamp01(st.outline)}
        />
      )}
      {st.check > 0 && (
        <g transform={`translate(${FIELD.x + FIELD.w + 4} ${fcy}) scale(${0.25 + 0.75 * clamp01(st.check * 1.4)})`} opacity={clamp01(st.check * 3)}>
          {/* checkmark.svg (assets/objects) */}
          <circle r={40} fill="#0E493B" stroke="#4FF1C6" strokeWidth={5} />
          <path d="M-20 0 L-6 14 L22 -14" fill="none" stroke="#BEFFEB" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - clamp01((st.check - 0.3) / 0.7)} />
        </g>
      )}
      {crop && crop.on > 0 && (
        <g opacity={crop.on}>
          {crop.dimBelow > 0 && (
            <g clipPath={`url(#${idp}-ov)`}>
              <rect x={177} y={crop.bottom} width={854} height={1368 - crop.bottom + 4} fill={C.bg0} opacity={0.62 * crop.dimBelow} />
              <path d={`M177 ${crop.bottom} H1031`} stroke={C.pinkHot} strokeWidth={5} strokeDasharray="18 12" opacity={crop.dimBelow} />
            </g>
          )}
          <rect
            x={crop.left}
            y={crop.top}
            width={crop.right - crop.left}
            height={crop.bottom - crop.top}
            fill="none"
            stroke={C.pinkHot}
            strokeWidth={2.5}
            opacity={0.9}
          />
          {/* crop_corners.svg (assets/objects) — four L brackets */}
          <path
            d={[
              `M${crop.left} ${crop.top + 80} V${crop.top} H${crop.left + 80}`,
              `M${crop.right - 80} ${crop.top} H${crop.right} V${crop.top + 80}`,
              `M${crop.right} ${crop.bottom - 80} V${crop.bottom} H${crop.right - 80}`,
              `M${crop.left + 80} ${crop.bottom} H${crop.left} V${crop.bottom - 80}`,
            ].join(" ")}
            fill="none"
            stroke={C.pinkHot}
            strokeWidth={12}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {st.toolbar > 0 && (
        <g opacity={st.toolbar} transform={`translate(0 ${(1 - st.toolbar) * 40})`}>
          <rect x={604 - 170} y={1284} width={340} height={70} rx={35} fill="#151927" />
          <rect x={604 - 170} y={1284} width={340} height={70} rx={35} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
          <circle cx={604 - 104 + st.tool * 104} cy={1319} r={29} fill={C.pink} />
          <ToolIcon kind={0} x={500} y={1319} active={st.tool < 0.5 ? 1 : 0} />
          <ToolIcon kind={1} x={604} y={1319} active={st.tool >= 0.5 && st.tool < 1.5 ? 1 : 0} />
          <ToolIcon kind={2} x={708} y={1319} active={st.tool >= 1.5 ? 1 : 0} />
          {st.toolBan > 0 && (
            <path
              d="M478 1297 L522 1341 M522 1297 L478 1341"
              stroke={C.danger}
              strokeWidth={7}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - clamp01(st.toolBan)}
            />
          )}
        </g>
      )}
      {st.finger && st.finger.on > 0 && (
        <g transform={`translate(${st.finger.x} ${st.finger.y})`} opacity={st.finger.on}>
          <circle r={44 - 8 * st.finger.press} fill="rgba(255,255,255,0.22)" stroke="#FFFFFF" strokeWidth={4} />
          <circle r={12} fill="#FFFFFF" opacity={0.9} />
        </g>
      )}
    </svg>
  );
};

/** Exploded marker layer (alpha < 1) floating above the text pixels. */
const ExplodedLayer: React.FC<{ st: PhoneState; idp: string }> = ({ st, idp }) => {
  const e = clamp01(st.explode);
  const sy = st.screen.scrollY;
  const label = clamp01((e - 0.35) / 0.4);
  return (
    <>
      {[0.34, 0.67].map((k, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: FIELD.x - 154 - 18,
            top: FIELD.y + sy - 225 - 30,
            width: FIELD.w + 36,
            height: FIELD.h + 60,
            borderRadius: 18,
            border: `2px dashed rgba(249, 80, 225, ${0.5 * e})`,
            transform: `translateZ(${e * 300 * k}px)`,
          }}
        />
      ))}
      <div style={{ position: "absolute", left: 0, top: 0, width: 900, height: 1210, transform: `translateZ(${e * 300}px)` }}>
        <svg width={900} height={1210} viewBox="154 225 900 1210" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <rect x={FIELD.x - 18} y={FIELD.y + sy - 30} width={FIELD.w + 36} height={FIELD.h + 60} rx={18} fill="rgba(249,80,225,0.08)" stroke={C.pinkHot} strokeWidth={3} opacity={e} />
          <g transform={`translate(0 ${sy})`}>
            <Cover cover={{ ...st.screen.cover, hidden: false }} idp={idp} />
          </g>
        </svg>
        <div
          style={{
            position: "absolute",
            left: FIELD.x - 154 - 18,
            top: FIELD.y + sy - 225 - 30 - 92,
            opacity: label,
            transform: `translateY(${(1 - label) * 20}px)`,
            display: "flex",
            gap: 14,
            alignItems: "center",
            fontFamily: FONT_MONO,
            fontWeight: 700,
            fontSize: 34,
            color: "#fff",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ background: C.pink, borderRadius: 12, padding: "8px 18px" }}>MARKER</span>
          <span style={{ background: "rgba(10,12,24,0.92)", borderRadius: 12, padding: "8px 18px", border: "2px solid rgba(255,255,255,0.18)" }}>
            KRYCIE 78%
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: FIELD.x - 154 - 18,
          top: FIELD.y + sy - 225 + FIELD.h + 42,
          opacity: label,
          transform: `translateZ(2px) translateY(${(1 - label) * -16}px)`,
          fontFamily: FONT_MONO,
          fontWeight: 700,
          fontSize: 32,
          color: "#fff",
          background: "rgba(10,12,24,0.92)",
          border: "2px solid rgba(255,255,255,0.18)",
          borderRadius: 12,
          padding: "8px 18px",
          whiteSpace: "nowrap",
        }}
      >
        TEKST NADAL W PIKSELACH
      </div>
    </>
  );
};

/** "NIEKONIECZNIE!" — the marker itself flips over and becomes the warning card. */
const FlipCard: React.FC<{ pop: number; angle: number; tilt: number }> = ({ pop, angle, tilt }) => {
  const W = 700;
  const H = 190;
  return (
    <div
      style={{
        position: "absolute",
        left: FIELD.x + FIELD.w / 2 - 154 - W / 2,
        top: FIELD_CY - 225 - H / 2,
        width: W,
        height: H,
        transformStyle: "preserve-3d",
        transform: `translateZ(${pop * 340}px) translateX(${pop * (PHONE_CX - FIELD.x - FIELD.w / 2)}px) translateY(${-pop * 250}px) rotateX(${-tilt * pop}deg) scale(${1 + pop * 0.75}) rotateX(${angle}deg)`,
      }}
    >
      <svg
        width={W}
        height={H}
        viewBox={`${FIELD.x + FIELD.w / 2 - W / 2} ${FIELD_CY - H / 2} ${W} ${H}`}
        style={{ position: "absolute", left: 0, top: 0, backfaceVisibility: "hidden", overflow: "visible" }}
      >
        <Cover cover={{ draw: 1, morph: 0, alpha: 0.78 }} idp="flip" />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backfaceVisibility: "hidden",
          transform: "rotateX(180deg)",
          borderRadius: 34,
          background: "linear-gradient(180deg, #3B0F22 0%, #22091A 100%)",
          border: `5px solid ${C.danger}`,
          boxShadow: `0 30px 80px rgba(0,0,0,0.55), 0 0 60px rgba(255,77,125,0.25)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
        }}
      >
        <svg width={86} height={86} viewBox="0 0 256 256">
          {/* warning_triangle.svg (assets/objects) */}
          <path d="M128 20 L244 221 H12 Z" fill="#402138" stroke="#FF6589" strokeWidth={13} strokeLinejoin="round" />
          <rect x={117} y={85} width={22} height={66} rx={11} fill="#FFDFE7" />
          <circle cx={128} cy={185} r={12} fill="#FFDFE7" />
        </svg>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 78, color: "#FFFFFF", letterSpacing: -2.5, lineHeight: 1 }}>
          NIEKONIECZNIE!
        </div>
      </div>
    </div>
  );
};

export const Phone: React.FC<{ st: PhoneState; idp: string }> = ({ st, idp }) => {
  if (st.on <= 0.001) return null;
  const p = st.pose;
  const ox = p.fx - 154;
  const oy = p.fy - 225;
  const f = st.filter;
  const crop = st.crop;
  // Kept image area (crop confirmed) and the falling cut-away strip.
  const keepClip = crop && crop.confirmed > 0 ? `inset(${crop.top - 225}px ${1054 - crop.right}px ${1435 - crop.bottom}px ${crop.left - 154}px round 26px)` : undefined;
  const sheen = 0.5 + 0.5 * Math.sin(((p.ry + p.rx) * Math.PI) / 90);
  return (
    <div
      style={{
        position: "absolute",
        left: p.tx - ox,
        top: p.ty - oy,
        width: 900,
        height: 1210,
        transformOrigin: `${ox}px ${oy}px`,
        transform: `translateZ(${p.z}px) rotateX(${p.rx}deg) rotateY(${p.ry}deg) rotateZ(${p.rz}deg) scale(${p.s})`,
        transformStyle: "preserve-3d",
        opacity: st.on,
      }}
    >
      {st.shadow > 0 && (
        <Img
          src={staticFile("textures/phone_shadow.png")}
          style={{
            position: "absolute",
            left: -170 + 46,
            top: -170 + 70,
            width: 1240,
            height: 1550,
            opacity: st.shadow * (0.35 + 0.65 * st.body),
            transform: "translateZ(-90px)",
          }}
        />
      )}
      {st.layers > 0 &&
        [3, 2, 1].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 177 - 154,
              top: 283 - 225,
              width: 854,
              height: (crop && crop.confirmed > 0 ? crop.bottom : 1368) - 283,
              borderRadius: crop && crop.confirmed > 0 ? 26 : 47,
              border: `3px solid rgba(249,80,225,${0.55 * st.layers})`,
              background: `rgba(244,246,250,${0.08 * st.layers})`,
              transform: `translateZ(${-i * 70 * st.layers}px)`,
            }}
          />
        ))}
      {st.body > 0 && (
        <svg width={900} height={1210} viewBox="154 225 900 1210" style={{ position: "absolute", left: 0, top: 0, opacity: st.body, overflow: "visible" }}>
          <defs>
            <linearGradient id={`${idp}-glass`} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#2A3050" stopOpacity={0.96} />
              <stop offset="1" stopColor="#10131F" stopOpacity={0.99} />
            </linearGradient>
            <linearGradient id={`${idp}-rim`} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#8E8FC0" />
              <stop offset="0.45" stopColor="#3F4163" />
              <stop offset="1" stopColor="#6B5C8F" />
            </linearGradient>
          </defs>
          {/* phone body from 01_screen_original.svg */}
          <rect x={154} y={225} width={900} height={1210} rx={82} fill={`url(#${idp}-glass)`} stroke={`url(#${idp}-rim)`} strokeWidth={5} />
          <rect x={474} y={243} width={258} height={32} rx={16} fill="#02030B" />
        </svg>
      )}
      <div style={{ position: "absolute", left: 0, top: 0, width: 900, height: 1210, transform: "translateZ(1px)", clipPath: keepClip }}>
        <ScreenSVG st={st.screen} idp={`${idp}-a`} />
        {f && f.x1 > f.x0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 900,
              height: 1210,
              filter: `brightness(${f.b}) contrast(${f.c})`,
              clipPath: `inset(${Math.max(0, (f.y0 ?? 225) - 225)}px ${Math.max(0, 1054 - f.x1)}px ${Math.max(0, 1435 - (f.y1 ?? 1435))}px ${Math.max(0, f.x0 - 154)}px)`,
            }}
          >
            <ScreenSVG st={st.screen} idp={`${idp}-b`} />
          </div>
        )}
      </div>
      {crop && crop.cut > 0 && crop.cut < 1 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 900,
            height: 1210,
            clipPath: `inset(${crop.bottom - 225}px 23px ${1435 - 1368}px 23px round 0 0 47px 47px)`,
            transformOrigin: `450px ${crop.bottom - 225}px`,
            transform: `translateZ(${2 + crop.cut * 80}px) translateY(${crop.cut * crop.cut * 520}px) rotateX(${-crop.cut * 38}deg)`,
            opacity: 1 - crop.cut,
          }}
        >
          <ScreenSVG st={st.screen} idp={`${idp}-c`} />
          <div style={{ position: "absolute", left: 0, top: 0, width: 900, height: 1210, background: "rgba(5,6,13,0.62)" }} />
        </div>
      )}
      {/* glass sheen follows the light as the phone turns */}
      {st.body > 0.05 && (
        <div
          style={{
            position: "absolute",
            left: 23,
            top: 58,
            width: 854,
            height: 1085,
            borderRadius: 47,
            transform: "translateZ(2px)",
            background: `linear-gradient(${115 + p.ry * 1.5}deg, rgba(255,255,255,0) ${30 + sheen * 10}%, rgba(255,255,255,${0.1 * st.body}) ${42 + sheen * 10}%, rgba(255,255,255,0) ${56 + sheen * 10}%)`,
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "absolute", left: 0, top: 0, width: 900, height: 1210, transform: "translateZ(4px)", transformStyle: "preserve-3d" }}>
        <Overlays st={st} idp={idp} />
      </div>
      {st.explode > 0.001 && <ExplodedLayer st={st} idp={idp} />}
      {st.flip && <FlipCard pop={st.flip.pop} angle={st.flip.angle} tilt={p.rx} />}
    </div>
  );
};

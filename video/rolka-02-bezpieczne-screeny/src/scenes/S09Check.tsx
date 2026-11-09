import React from "react";
import { AbsoluteFill } from "remotion";
import { E, clamp01, spr, track, tw } from "../lib/anim";
import { CUE } from "../timing";
import { CROP_Y, getPhoneA, getPhoneB } from "../phoneTrack";
import { Pose, project } from "../components/Phone";
import { ScreenSVG } from "../components/ScreenSVG";
import { Chip, Kinetic } from "../components/Kinetic";
import { CardShadow, CheckBadge } from "../components/Bits";
import { FONT_MONO } from "../lib/fonts";
import { C } from "../lib/theme";

/**
 * 35.85–40.00 s — check the SAVED (flattened) files. The loupe applies the same
 * brightness/contrast boost as the marker demo: on the 100% opaque rectangle and
 * on the cropped edge there is nothing left to bring back.
 */
const rectOf = (pose: Pose, bottom: number) => {
  const a = project(pose, 177, 283);
  const b = project(pose, 1031, bottom);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
};

export const CheckBack: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 1064 || frame > 1210) return null;
  const A = getPhoneA(frame);
  const B = getPhoneB(frame);
  const ra = rectOf(A.pose, 1368);
  const rb = rectOf(B.pose, CROP_Y);
  const on = tw(frame, 1080, 1096) * (1 - tw(frame, 1192, 1200));
  return (
    <AbsoluteFill>
      <CardShadow x={ra.x} y={ra.y} w={ra.w} h={ra.h} opacity={on * A.on} />
      <CardShadow x={rb.x} y={rb.y} w={rb.w} h={rb.h} opacity={on * B.on} />
    </AbsoluteFill>
  );
};

/** Lives inside the CTA flip group (it turns away with the files). */
export const CheckGroup: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 1064 || frame > 1210) return null;
  const A = getPhoneA(frame);
  const B = getPhoneB(frame);
  const ra = rectOf(A.pose, 1368);
  const rb = rectOf(B.pose, CROP_Y);
  const lab = spr(frame, 1088, { damping: 16 });
  return (
    <AbsoluteFill>
      <Chip x={ra.x + ra.w / 2} y={ra.y + ra.h + 44} p={lab} size={27}>
        <FileIcon /> zakryty.png
      </Chip>
      <Chip x={rb.x + rb.w / 2} y={rb.y + rb.h + 44} p={spr(frame, 1094, { damping: 16 })} size={27}>
        <FileIcon /> wykadrowany.png
      </Chip>
      <Loupe frame={frame} />
      <CheckBadge x={ra.x + ra.w - 8} y={ra.y + 8} p={tw(frame, 1150, 1166, 0, 1, E.out)} size={104} />
      <CheckBadge x={rb.x + rb.w - 8} y={rb.y + 8} p={tw(frame, 1160, 1176, 0, 1, E.out)} size={104} />
      <StepChips frame={frame} />
    </AbsoluteFill>
  );
};

const FileIcon: React.FC = () => (
  <svg width={24} height={30} viewBox="0 0 24 30">
    <path d="M3 2 H15 L21 8 V28 H3 Z" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinejoin="round" />
    <path d="M15 2 V8 H21" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinejoin="round" />
  </svg>
);

export const STEP_CHIPS = [
  { label: "ZAKRYJ", at: 1172 },
  { label: "WYKADRUJ", at: 1178 },
  { label: "SPRAWDŹ", at: 1184 },
] as const;
export const STEP_Y = 1398;
/** x-centre of each chip (measured layout: fixed widths keep it deterministic). */
export const STEP_W = [250, 300, 280];
export const stepX = (i: number) => {
  const total = STEP_W.reduce((a, b) => a + b, 0) + 2 * 22;
  let x = 540 - total / 2;
  for (let k = 0; k < i; k++) x += STEP_W[k] + 22;
  return x + STEP_W[i] / 2;
};

const StepChips: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    {STEP_CHIPS.map((c, i) => {
      const p = spr(frame, c.at, { damping: 14, stiffness: 160 });
      if (p <= 0.01) return null;
      return (
        <div
          key={c.label}
          style={{
            position: "absolute",
            left: stepX(i) - STEP_W[i] / 2,
            top: STEP_Y - 40,
            width: STEP_W[i],
            height: 80,
            borderRadius: 40,
            background: "rgba(14,73,59,0.9)",
            border: "2px solid #4FF1C6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            transform: `translateY(${(1 - p) * 40}px) scale(${0.8 + 0.2 * p})`,
            opacity: clamp01(p * 1.6),
            fontFamily: FONT_MONO,
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: 1,
            color: C.safeSoft,
          }}
        >
          {i < 2 || frame < 1196 ? (
            <svg width={30} height={30} viewBox="0 0 30 30">
              <path d="M5 15 L12 22 L25 8" fill="none" stroke="#8DFFE1" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <div style={{ width: 30 }} />
          )}
          {c.label}
        </div>
      );
    })}
  </>
);

const Loupe: React.FC<{ frame: number }> = ({ frame }) => {
  const on = Math.min(tw(frame, 1098, 1106), 1 - tw(frame, 1160, 1168));
  if (on <= 0.001) return null;
  const onA = frame < 1128;
  const A = getPhoneA(frame);
  const B = getPhoneB(frame);
  const st = onA ? A : B;
  // SVG point under the loupe centre
  const px = onA ? track(frame, [[1100, 360], [1124, 760, E.inOut]]) : track(frame, [[1130, 420], [1156, 780, E.inOut]]);
  const py = onA ? 982 : CROP_Y - 12;
  const c = project(st.pose, px, py);
  const R = 118;
  const Ms = 1.2;
  const travel = frame >= 1124 && frame < 1132 ? tw(frame, 1124, 1132, 0, 1, E.inOut) : -1;
  let cx = c.x;
  let cy = c.y;
  if (travel >= 0) {
    const a = project(A.pose, 760, 982);
    const b = project(B.pose, 420, CROP_Y - 12);
    cx = a.x + (b.x - a.x) * travel;
    cy = a.y + (b.y - a.y) * travel - Math.sin(travel * Math.PI) * 90;
  }
  const boost = tw(frame, 1104, 1114);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: cx - R,
          top: cy - R,
          width: 2 * R,
          height: 2 * R,
          borderRadius: "50%",
          overflow: "hidden",
          background: "#0A0C18",
          opacity: on,
          transform: `scale(${0.6 + 0.4 * on})`,
          boxShadow: "0 30px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: R - (px - 154) * Ms,
            top: R - (py - 225) * Ms,
            width: 900,
            height: 1210,
            transformOrigin: "0 0",
            transform: `scale(${Ms})`,
            filter: `brightness(${1 + 1.4 * boost}) contrast(${1 + 1.9 * boost})`,
            clipPath: onA ? undefined : `inset(0px 0px ${1210 - (CROP_Y - 225)}px 0px)`,
          }}
        >
          <ScreenSVG st={st.screen} idp={onA ? "loupe-a" : "loupe-b"} />
        </div>
        {/* pixel grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(249,80,225,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(249,80,225,0.16) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        />
      </div>
      <svg
        width={2 * R + 60}
        height={2 * R + 60}
        style={{ position: "absolute", left: cx - R - 30, top: cy - R - 30, opacity: on, overflow: "visible" }}
      >
        <circle cx={R + 30} cy={R + 30} r={R} fill="none" stroke="#FFFFFF" strokeWidth={7} />
        <circle cx={R + 30} cy={R + 30} r={R + 9} fill="none" stroke={C.pinkHot} strokeWidth={3} opacity={0.8} />
        <path d={`M${R + 30 + R * 0.72} ${R + 30 + R * 0.72} L${R + 30 + R * 1.15} ${R + 30 + R * 1.15}`} stroke="#FFFFFF" strokeWidth={16} strokeLinecap="round" />
      </svg>
      <Chip x={Math.min(Math.max(cx, 300), 780)} y={cy - R - 46} p={on * boost} tone="pink" size={25}>
        JASNOŚĆ + KONTRAST: MAX
      </Chip>
    </>
  );
};

export const CheckFront: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 1068 || frame > 1210) return null;
  const out = tw(frame, 1192, 1202, 0, 1, E.in);
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <Kinetic
        frame={frame}
        x={100}
        y={278}
        lines={[
          { size: 56, weight: 800, words: [{ t: "NA", at: CUE.naKoniec }, { t: "KONIEC", at: CUE.naKoniec + 4 }] },
          { size: 116, weight: 900, gap: 6, words: [{ t: "SPRAWDŹ", at: CUE.sprawdz, grad: true }] },
          { size: 70, weight: 900, gap: 4, words: [{ t: "ZAPISANY", at: CUE.zapisanyObraz }, { t: "OBRAZ", at: CUE.zapisanyObraz + 6 }] },
        ]}
      />
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 612,
          fontFamily: FONT_MONO,
          fontWeight: 500,
          fontSize: 26,
          letterSpacing: 1,
          color: C.inkDim,
          opacity: tw(frame, CUE.zapisanyObraz + 8, CUE.zapisanyObraz + 18),
        }}
      >
        eksport: spłaszczony PNG / JPG
      </div>
      <Chip x={540} y={1510} p={spr(frame, CUE.nicNie + 22, { damping: 15 })} tone="safe" size={30}>
        NIC NIE PRZEŚWITUJE
      </Chip>
    </AbsoluteFill>
  );
};

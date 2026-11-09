import React from "react";
import { AbsoluteFill } from "remotion";
import { E, clamp01, impact, rand, spr, track, tw } from "../lib/anim";
import { CUE } from "../timing";
import { Kinetic, NotEqual } from "../components/Kinetic";
import { AlertEmblem, FlashRing, MiniShot, Scrim } from "../components/Bits";
import { FONT_DISPLAY } from "../lib/fonts";
import { C } from "../lib/theme";

/**
 * 0.00–4.90 s — HOOK 3Z (image + headline + voice + sound in the first 3 s):
 * marker stroke from frame 0 → contrast scan reveals digits under the
 * semi-transparent marker → camera dives through a revealed digit → alert
 * "ZAMAZANE ≠ BEZPIECZNE" → the screenshot spreads "to the whole internet" →
 * the copies re-form the phone for the story.
 */
export const HookFront: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame > 150) return null;
  const iris = Math.min(tw(frame, 45, 54, 0, 1, E.in), tw(frame, 57, 66, 1, 0, E.out));
  return (
    <AbsoluteFill>
      {frame < 60 && (
        <>
          <Scrim top={0} height={860} opacity={1 - tw(frame, 46, 54)} />
          <Kinetic
            frame={frame}
            x={100}
            y={292}
            exitAt={33}
            exitDur={6}
            driftX={tw(frame, 0, 56, 0, -18, E.linear)}
            lines={[
              { size: 132, weight: 900, words: [{ t: "ZAMAZUJESZ", at: CUE.zamazujesz - 5 }] },
              { size: 112, weight: 900, gap: 6, words: [{ t: "DANE", at: CUE.dane, grad: true }, { t: "NA", at: CUE.naScreenach }] },
              { size: 112, weight: 900, gap: 6, words: [{ t: "SCREENACH?", at: CUE.naScreenach + 3 }] },
            ]}
          />
        </>
      )}
      {frame >= 47 && <Alert frame={frame} />}
      {iris > 0 && <AbsoluteFill style={{ background: "#07050C", opacity: iris }} />}
    </AbsoluteFill>
  );
};

const Alert: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 55 || frame > 142) return null;
  const a = spr(frame, CUE.uwazaj + 4, { damping: 14, stiffness: 160 });
  const shake = impact(frame, CUE.uwazaj + 4, 14);
  const push = tw(frame, 60, 98, 1, 1.05, E.soft);
  // "pokazać całemu internetowi": the alert recedes, the screenshot spreads.
  const recede = tw(frame, CUE.pokazac, CUE.pokazac + 16, 0, 1, E.inOut);
  const out = tw(frame, 128, 140, 0, 1, E.in);
  const pulse = 0.5 + 0.5 * Math.sin(frame * 0.35);
  return (
    <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.4}px)` }}>
      <FlashRing x={540} y={700} p={tw(frame, CUE.uwazaj + 4, CUE.uwazaj + 26, 0, 1, E.out)} r0={140} r1={620} />
      <FlashRing x={540} y={700} p={tw(frame, CUE.uwazaj + 12, CUE.uwazaj + 38, 0, 1, E.out)} r0={140} r1={560} color={C.danger} />
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 0,
          width: 0,
          transform: `scale(${push})`,
          transformOrigin: "0px 700px",
          opacity: 1 - out,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -230,
            top: 700 - 230,
            width: 460,
            height: 460,
            transform: `translateY(${-recede * 160}px) scale(${(0.6 + 0.4 * a) * (1 - 0.6 * recede)})`,
            opacity: 1 - recede,
          }}
        >
          <AlertEmblem p={clamp01(a)} pulse={pulse} size={460} />
        </div>
        <div
          style={{
            position: "absolute",
            left: -440,
            top: 990,
            width: 880,
            transformOrigin: "440px 0px",
            transform: `translateY(${-recede * 680}px) scale(${1 - 0.36 * recede})`,
          }}
        >
          <Kinetic
            frame={frame}
            x={440}
            y={0}
            align="center"
            width={880}
            lines={[
              { size: 128, weight: 900, words: [{ t: "ZAMAZANE", at: CUE.uwazaj + 6 }] },
            ]}
          />
          <div
            style={{
              position: "absolute",
              top: 150,
              left: 0,
              width: 880,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 18,
            }}
          >
            <div style={{ transform: `scale(${spr(frame, CUE.uwazaj + 10)})` }}>
              <NotEqual size={104} p={tw(frame, CUE.uwazaj + 10, CUE.uwazaj + 26, 0, 1, E.out)} />
            </div>
            <div style={{ position: "relative", width: 660, height: 120 }}>
              <Kinetic
                frame={frame}
                x={0}
                y={0}
                width={660}
                lines={[{ size: 108, weight: 900, words: [{ t: "BEZPIECZNE", at: CUE.uwazaj + 12, color: C.dangerSoft }] }]}
              />
            </div>
          </div>
        </div>
      </div>
      <Spread frame={frame} />
    </AbsoluteFill>
  );
};

/** The fictional screenshot is copied out into a network — then gathered back into one phone. */
const Spread: React.FC<{ frame: number }> = ({ frame }) => {
  const start = CUE.pokazac + 2;
  if (frame < start) return null;
  const appear = spr(frame, start, { damping: 15, stiffness: 150 });
  const fly = tw(frame, CUE.internetowi - 14, CUE.internetowi + 8, 0, 1, E.out);
  const gather = tw(frame, 126, 140, 0, 1, E.in);
  const N = 16;
  const cx = 540;
  const cy = 1110;
  const items = new Array(N).fill(0).map((_, i) => {
    const ang = (i / N) * Math.PI * 2 + 0.3;
    const ring = i % 2 === 0 ? 1 : 0.72;
    const rx = Math.cos(ang) * 470 * ring;
    const ry = Math.sin(ang) * 430 * ring;
    const z = -200 - rand(i) * 500;
    const k = fly * (1 - gather);
    return { x: cx + rx * k, y: cy + ry * k, z: z * k, rot: (rand(i + 7) - 0.5) * 40 * k, i };
  });
  const mainW = 270 * (0.4 + 0.6 * appear);
  return (
    <AbsoluteFill style={{ perspective: 1600 }}>
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
        {items.map((it) => (
          <line
            key={it.i}
            x1={cx}
            y1={cy}
            x2={cx + (it.x - cx) * 0.92}
            y2={cy + (it.y - cy) * 0.92}
            stroke={C.pinkHot}
            strokeOpacity={0.28 * fly * (1 - gather)}
            strokeWidth={2.5}
            strokeDasharray="6 10"
            strokeDashoffset={-frame * 3}
          />
        ))}
      </svg>
      {items.map((it) => (
        <div
          key={it.i}
          style={{
            position: "absolute",
            left: it.x - 60,
            top: it.y - 81,
            transform: `translateZ(${it.z}px) rotateY(${it.rot}deg) rotateZ(${it.rot * 0.3}deg)`,
            opacity: fly > 0 ? Math.min(1, fly * 3) * (1 - gather) * (0.55 + 0.45 * rand(it.i + 3)) : 0,
            filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.5))",
          }}
        >
          <MiniShot w={120} />
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: cx - mainW / 2,
          top: cy - (mainW * 1210) / 900 / 2,
          opacity: clamp01(appear * 2) * (1 - tw(frame, 136, 141)),
          transform: `rotateY(${track(frame, [[start, -30], [start + 20, 0, E.out], [126, 0], [140, 40, E.in]])}deg)`,
          filter: "drop-shadow(0 26px 40px rgba(0,0,0,0.6))",
        }}
      >
        <MiniShot w={mainW} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          width: 1080,
          top: 512,
          textAlign: "center",
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 50,
          letterSpacing: -1,
          color: C.ink,
          opacity: Math.min(tw(frame, CUE.internetowi - 4, CUE.internetowi + 6), 1 - gather),
          transform: `translateY(${(1 - tw(frame, CUE.internetowi - 4, CUE.internetowi + 10, 0, 1, E.out)) * 30}px)`,
        }}
      >
        jeden zrzut ekranu
        <svg width={64} height={30} viewBox="0 0 64 30" style={{ margin: "0 18px", verticalAlign: "middle" }}>
          <path d="M4 15 H56 M44 4 L58 15 L44 26" fill="none" stroke={C.pinkHot} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ color: C.pinkHot }}>cały internet</span>
      </div>
    </AbsoluteFill>
  );
};

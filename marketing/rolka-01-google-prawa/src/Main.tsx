import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, FPS, HEIGHT, SAFE, WIDTH } from "./config";
import { T } from "./data/timeline";
import { useT } from "./lib/anim";
import { cameraAt, cameraSpeed } from "./world/camera";
import { World } from "./world/World";
import { Background, Finishing } from "./overlay/Background";
import { Captions } from "./overlay/Captions";
import { Headline } from "./overlay/Headline";
import { NotEqual } from "./components/Icons";
import { Soundtrack } from "./audio/Soundtrack";
import { StepsHud } from "./overlay/StepsHud";
import { CTA, CtaWash } from "./overlay/CTA";
import { loadBrandFonts } from "./fonts";
import { FrameSettle } from "./FrameSettle";

loadBrandFonts();

export type MainProps = { showSafeZones?: boolean; withMusic?: boolean };

export const Main: React.FC<MainProps> = ({ showSafeZones = false, withMusic = true }) => {
  const t = useT();
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg0, overflow: "hidden" }}>
      <SpaceWithBlur t={t} />
      {/* Screen-space layers are rebuilt every frame (keyed by frame): the headless compositor can keep a
          stale texture of an overlay that shrank or unmounted; fresh DOM nodes make that impossible. */}
      <AbsoluteFill key={frame}>
        <CtaWash t={t} />
        <Finishing t={t} />
        <Headlines t={t} />
        <StepsHud t={t} />
        <CTA t={t} />
        <Captions t={t} />
      </AbsoluteFill>
      <Soundtrack withMusic={withMusic} />
      {showSafeZones ? <SafeZones /> : null}
      <FrameSettle />
    </AbsoluteFill>
  );
};

/**
 * Camera motion blur only where the camera really whips: N sub-frame samples centred on the frame
 * (180° shutter). Every sample is OPAQUE (background + world) and they are averaged with plain
 * "over" compositing (sample k at opacity 1/(k+1)) — no blend modes, so Chrome never reads a stale
 * backdrop. Slow moves render a single sharp frame.
 */
const SpaceWithBlur: React.FC<{ t: number }> = ({ t }) => {
  const speed = cameraSpeed(t);
  if (speed < 22) {
    const cam = cameraAt(t);
    return (
      <>
        <Background t={t} cam={cam} />
        <World t={t} cam={cam} />
      </>
    );
  }
  const shutter = 0.5 / FPS;
  const n = Math.max(4, Math.min(12, Math.ceil((speed * 0.5) / 18)));
  return (
    <AbsoluteFill>
      {Array.from({ length: n }).map((_, k) => {
        const ts = t + (k / (n - 1) - 0.5) * shutter;
        const cam = cameraAt(ts);
        return (
          <AbsoluteFill key={k} style={{ opacity: 1 / (k + 1) }}>
            <Background t={ts} cam={cam} />
            <World t={ts} cam={cam} />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

const Headlines: React.FC<{ t: number }> = ({ t }) => (
  <>
    <Headline
      t={t}
      t0={T.uwazaj}
      t1={T.hookEnd + 0.12}
      y={330}
      mode="slam"
      plate="rgba(30,6,16,0.86)"
      glow={C.red}
      lines={[{ text: "UWAŻAJ!", color: "#FF4D6A", size: 168 }]}
    />
    <Headline
      t={t}
      t0={T.wyszukuje + 0.05}
      t1={T.swobodnie - 0.15}
      y={330}
      mode="mask"
      lines={[
        { text: "WYSZUKIWARKA", color: C.white, size: 104 },
        {
          text: "LICENCJA",
          color: C.pink,
          size: 104,
          node: <NotEqual size={92} color={C.pink} progress={Math.min(1, Math.max(0, (t - T.wyszukuje - 0.25) / 0.45))} />,
        },
      ]}
    />
    <Headline t={t} t0={T.jak - 0.05} t1={T.wejdz - 0.15} y={300} mode="flip" lines={[{ text: "JAK TO SPRAWDZIĆ?", color: C.white, size: 88 }]} />
    <Headline
      t={t}
      t0={T.sprawdzic - 0.05}
      t1={T.komercyjnie - 0.1}
      y={262}
      mode="mask"
      glow={C.pink}
      lines={[{ text: "SPRAWDŹ LICENCJĘ", color: C.white, size: 86 }]}
    />
    <Headline
      t={t}
      t0={T.komercyjnie - 0.08}
      t1={T.licEnd + 0.25}
      y={262}
      mode="slam"
      glow={C.pink}
      lines={[{ text: "KOMERCYJNIE?", color: C.pink, size: 90 }]}
    />
  </>
);

const SafeZones: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: WIDTH, height: SAFE.top, background: "rgba(255,0,0,0.25)" }} />
    <div style={{ position: "absolute", left: 0, bottom: 0, width: WIDTH, height: SAFE.bottom, background: "rgba(255,0,0,0.25)" }} />
    <div style={{ position: "absolute", left: 0, top: 0, width: SAFE.side, height: HEIGHT, background: "rgba(255,0,0,0.25)" }} />
    <div style={{ position: "absolute", right: 0, top: 0, width: SAFE.side, height: HEIGHT, background: "rgba(255,0,0,0.25)" }} />
  </AbsoluteFill>
);

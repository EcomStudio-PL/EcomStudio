import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ensureFonts } from "./lib/fonts";
import { E, impact, track, tw } from "./lib/anim";
import { CUE } from "./timing";
import { getPhoneA, getPhoneB } from "./phoneTrack";
import { Phone } from "./components/Phone";
import { Background, BrandMark, FilmFinish } from "./components/Background";
import { HookFront } from "./scenes/S01Hook";
import { SafeBack, StoryFront } from "./scenes/S02S03Story";
import { DemoFront } from "./scenes/S04Demo";
import { DataFront } from "./scenes/S05S06Data";
import { Solution1Front, Solution2Front } from "./scenes/S07S08Solutions";
import { CheckBack, CheckFront, CheckGroup } from "./scenes/S09Check";
import { CtaFront, ctaGroupFlip } from "./scenes/S10S11Cta";
import { Soundtrack } from "./audio/Soundtrack";

ensureFonts();

/**
 * GrovBase — Rolka #2 "Bezpieczne screeny".
 * Layer order: background → back overlays → 3D world (phones, flip group) →
 * front overlays (kinetic type, panels, cards) → brand → film finish.
 */
export const Rolka02: React.FC = () => {
  const frame = useCurrentFrame();
  const A = getPhoneA(frame);
  const B = getPhoneB(frame);
  const flip = ctaGroupFlip(frame);
  const shake = impact(frame, CUE.niekoniecznie + 6, 9) + impact(frame, 470, 4);
  const danger = Math.max(
    tw(frame, 40, 60) * (1 - tw(frame, 140, 170)),
    tw(frame, CUE.niekoniecznie - 4, CUE.niekoniecznie + 6) * (1 - tw(frame, 610, 640)),
  );
  const safe = tw(frame, 890, 930) * (1 - tw(frame, 1190, 1230));
  const brand = frame < 1192 ? 1 - tw(frame, 1186, 1196) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#05060D" }}>
      <Background frame={frame} camX={A.pose.tx - 540} camRY={A.pose.ry} danger={danger} safe={safe} />
      <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.5}px)` }}>
        <SafeBack frame={frame} />
        <CheckBack frame={frame} />
        <AbsoluteFill style={{ perspective: 2400, perspectiveOrigin: "50% 48%" }}>
          <AbsoluteFill
            style={{
              transformStyle: "preserve-3d",
              transformOrigin: "540px 1000px",
              transform: `rotateY(${flip}deg)`,
              opacity: flip <= -89 ? 0 : 1,
            }}
          >
            <Phone st={A} idp="pa" />
            <Phone st={B} idp="pb" />
          </AbsoluteFill>
        </AbsoluteFill>
        {/* labels/loupe of the check scene: same flip, but always painted in front of the 3D files */}
        <AbsoluteFill style={{ perspective: 2400, perspectiveOrigin: "50% 48%" }}>
          <AbsoluteFill style={{ transformOrigin: "540px 1000px", transform: `rotateY(${flip}deg)`, opacity: flip <= -89 ? 0 : 1 }}>
            <CheckGroup frame={frame} />
          </AbsoluteFill>
        </AbsoluteFill>
        <HookFront frame={frame} />
        <StoryFront frame={frame} />
        <DemoFront frame={frame} />
        <DataFront frame={frame} />
        <Solution1Front frame={frame} />
        <Solution2Front frame={frame} />
        <CheckFront frame={frame} />
        <CtaFront frame={frame} />
      </AbsoluteFill>
      <BrandMark frame={frame} opacity={brand * (1 - 0.6 * track(frame, [[44, 0], [52, 1, E.linear], [130, 1], [140, 0]]))} />
      <FilmFinish frame={frame} />
      <Soundtrack />
    </AbsoluteFill>
  );
};

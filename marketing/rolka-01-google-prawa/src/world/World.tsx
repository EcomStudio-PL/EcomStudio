import React from "react";
import { AbsoluteFill } from "remotion";
import { HEIGHT, WIDTH } from "../config";
import { Cam } from "./camera";
import { HookStations } from "./stations/HookStations";
import { Bench } from "./stations/Bench";
import { Source } from "./stations/Source";
import { Tools } from "./stations/Tools";
import { T } from "../data/timeline";
import { E, ramp } from "../lib/anim";

export const World: React.FC<{ t: number; cam: Cam; children?: React.ReactNode }> = ({ t, cam, children }) => {
  const transform = `translate3d(${WIDTH / 2}px, ${HEIGHT / 2}px, 0) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) rotateZ(${cam.rz}deg) scale3d(${cam.s}, ${cam.s}, ${cam.s}) translate3d(${-cam.x}px, ${-cam.y}px, 0)`;
  // CTA: the whole journey keeps drifting behind the call to action, softly out of focus
  const defocus = 5 * ramp(t, T.narzedziEnd + 0.05, T.zapisz + 0.4, E.inOut);
  return (
    <AbsoluteFill style={{ perspective: 2200, perspectiveOrigin: `${WIDTH / 2}px ${HEIGHT / 2}px`, overflow: "hidden", filter: defocus > 0.05 ? `blur(${defocus}px)` : undefined }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transformStyle: "preserve-3d", transform }}>
        <HookStations t={t} />
        <Bench t={t} />
        <Source t={t} />
        <Tools t={t} />
        {children}
      </div>
    </AbsoluteFill>
  );
};

import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../config";
import { T } from "../data/timeline";
import { pulse, window01 } from "../lib/anim";
import { Cam } from "../world/camera";

/** Deep navy space, soft brand glows with camera parallax, and a far dot field that sells the camera motion. */
export const Background: React.FC<{ t: number; cam: Cam }> = ({ t, cam }) => {
  const px = -cam.x * cam.s * 0.08;
  const py = -cam.y * cam.s * 0.08;
  const alarm = Math.max(window01(t, T.uwazaj - 0.05, T.hookEnd + 0.4, 0.1, 0.5) * 0.85, pulse(t, T.iUwaga + 0.1, 0.35) * 0.6, window01(t, T.nieOznacza, T.editEnd + 0.2, 0.2, 0.4) * 0.4);
  const ok = window01(t, T.masz, T.narzedziEnd, 0.4, 0.4) * 0.5;
  const brand = Math.max(0.55, window01(t, T.grovbase - 0.3, T.toolsEnd + 0.6, 0.4, 0.6));
  // far dot field
  const gs = 64 * (0.45 + cam.s * 0.55);
  const gx = (-cam.x * cam.s * 0.45) % gs;
  const gy = (-cam.y * cam.s * 0.45) % gs;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 38%, ${C.bg1} 0%, ${C.bg0} 70%)` }}>
      <div
        style={{
          position: "absolute",
          inset: -200,
          backgroundImage: "radial-gradient(circle, rgba(160,180,255,0.16) 1.6px, transparent 2px)",
          backgroundSize: `${gs}px ${gs}px`,
          backgroundPosition: `${gx}px ${gy}px`,
          transform: `rotate(${cam.rz * 0.5}deg)`,
          maskImage: "radial-gradient(70% 60% at 50% 45%, black 20%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 45%, black 20%, transparent 85%)",
        }}
      />
      <div style={{ position: "absolute", left: 620 + px, top: -260 + py, width: 900, height: 900, borderRadius: "50%", background: `radial-gradient(circle, rgba(214,40,207,${0.32 * brand}) 0%, transparent 65%)` }} />
      <div style={{ position: "absolute", left: -520 + px * 1.4, top: 1100 + py * 1.4, width: 1100, height: 1100, borderRadius: "50%", background: "radial-gradient(circle, rgba(70,90,255,0.22) 0%, transparent 65%)" }} />
      <div style={{ position: "absolute", left: -200, top: 300, width: 1500, height: 1400, borderRadius: "50%", background: `radial-gradient(circle, rgba(255,40,80,${0.42 * alarm}) 0%, transparent 62%)` }} />
      <div style={{ position: "absolute", left: -200, top: 300, width: 1500, height: 1400, borderRadius: "50%", background: `radial-gradient(circle, rgba(114,233,194,${0.3 * ok}) 0%, transparent 62%)` }} />
    </AbsoluteFill>
  );
};

/** Screen-space finishing: vignette, bottom caption shade, alarm edge glow. */
export const Finishing: React.FC<{ t: number }> = ({ t }) => {
  const alarmEdge = Math.max(pulse(t, T.uwazaj + 0.12, 0.3), pulse(t, T.slono + 0.35, 0.5) * 0.55, pulse(t, T.kosztownego + 0.3, 0.45) * 0.35);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "radial-gradient(130% 95% at 50% 45%, transparent 55%, rgba(2,5,12,0.75) 100%)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 620, background: "linear-gradient(to bottom, transparent 0%, rgba(4,8,20,0.4) 50%, rgba(4,8,20,0.7) 100%)" }} />
      {alarmEdge > 0.01 ? <AbsoluteFill style={{ boxShadow: `inset 0 0 ${140 + 60 * alarmEdge}px rgba(255,40,80,${0.85 * alarmEdge})` }} /> : null}
    </AbsoluteFill>
  );
};

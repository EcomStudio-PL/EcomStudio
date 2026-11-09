import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { rand, tw, E } from "../lib/anim";
import { C } from "../lib/theme";

/**
 * Living background: never a static empty plate. Layers (back → front):
 * base gradient, drifting light orbs (parallax with the camera), a perspective
 * floor grid that slides with camera moves, and depth dust.
 */
export const Background: React.FC<{
  frame: number;
  /** Camera parallax input (px / deg). */
  camX: number;
  camRY: number;
  /** 0..1 warm danger tint, 0..1 safe tint. */
  danger: number;
  safe: number;
}> = ({ frame, camX, camRY, danger, safe }) => {
  const t = frame / 30;
  const par = camRY * 6 + camX * 0.08;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg0, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(120% 80% at 62% 28%, #241033 0%, #111424 46%, #060811 100%)",
        }}
      />
      {/* orbs */}
      <div
        style={{
          position: "absolute",
          left: 620 + Math.sin(t * 0.45) * 60 - par * 0.6,
          top: 120 + Math.cos(t * 0.38) * 50,
          width: 900,
          height: 900,
          marginLeft: -450,
          marginTop: -450,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(249,80,225,${0.2 + 0.06 * Math.sin(t)}) 0%, rgba(214,40,207,0.06) 40%, rgba(214,40,207,0) 68%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 120 + Math.cos(t * 0.33) * 70 - par * 0.3,
          top: 1500 + Math.sin(t * 0.41) * 60,
          width: 1000,
          height: 1000,
          marginLeft: -500,
          marginTop: -500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(118,52,255,0.2) 0%, rgba(118,52,255,0.05) 42%, rgba(118,52,255,0) 70%)",
        }}
      />
      {danger > 0 && (
        <div
          style={{
            position: "absolute",
            left: 540 - par,
            top: 820,
            width: 1400,
            height: 1400,
            marginLeft: -700,
            marginTop: -700,
            borderRadius: "50%",
            opacity: danger,
            background: "radial-gradient(circle, rgba(255,77,125,0.20) 0%, rgba(255,77,125,0.05) 40%, rgba(255,77,125,0) 66%)",
          }}
        />
      )}
      {safe > 0 && (
        <div
          style={{
            position: "absolute",
            left: 540 - par,
            top: 900,
            width: 1400,
            height: 1400,
            marginLeft: -700,
            marginTop: -700,
            borderRadius: "50%",
            opacity: safe,
            background: "radial-gradient(circle, rgba(43,203,159,0.13) 0%, rgba(43,203,159,0.03) 42%, rgba(43,203,159,0) 66%)",
          }}
        />
      )}
      {/* perspective floor */}
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 1180,
          width: 3000,
          height: 2200,
          marginLeft: -1500,
          transformOrigin: "50% 0%",
          transform: `perspective(900px) rotateX(74deg) translateX(${-par * 2.2}px)`,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.075) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.075) 2px, transparent 2px)",
          backgroundSize: "120px 120px",
          backgroundPosition: `${(-par * 3) % 120}px ${(frame * 1.6) % 120}px`,
          WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.9) 30%, rgba(0,0,0,0) 85%)",
          maskImage: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.9) 30%, rgba(0,0,0,0) 85%)",
          opacity: 0.55,
        }}
      />
      {/* depth dust */}
      {new Array(28).fill(0).map((_, i) => {
        const depth = 0.3 + rand(i) * 0.9;
        const x = ((rand(i + 50) * 1300 - par * depth * 2 + t * 8 * depth) % 1300 + 1300) % 1300 - 110;
        const y = ((rand(i + 90) * 2100 - t * 22 * depth) % 2100 + 2100) % 2100 - 90;
        const size = 2 + depth * 4;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: i % 3 === 0 ? C.pinkHot : "#FFFFFF",
              opacity: 0.08 + 0.18 * depth * (0.6 + 0.4 * Math.sin(t * 2 + i)),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Film finish: vignette, safe-zone scrims, fine animated grain. */
export const FilmFinish: React.FC<{ frame: number }> = ({ frame }) => {
  const ox = Math.floor(rand(frame) * 384);
  const oy = Math.floor(rand(frame + 999) * 384);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(130% 90% at 50% 48%, rgba(0,0,0,0) 55%, rgba(2,3,8,0.55) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(3,4,10,0.55) 0px, rgba(3,4,10,0) 250px, rgba(3,4,10,0) 1660px, rgba(3,4,10,0.6) 1920px)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile("textures/grain.png")})`,
          backgroundPosition: `${ox}px ${oy}px`,
          backgroundSize: "384px 384px",
          mixBlendMode: "overlay",
          opacity: 0.09,
        }}
      />
    </AbsoluteFill>
  );
};

/** Discreet GrovBase lockup (original PNG, never stretched: width-only sizing). */
export const BrandMark: React.FC<{ frame: number; opacity: number }> = ({ frame, opacity }) => {
  const enter = tw(frame, 4, 22, 0, 1, E.out);
  if (opacity * enter <= 0.001) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 540,
        top: 178,
        transform: `translate(-50%, -50%) translateY(${(1 - enter) * -16}px)`,
        opacity: opacity * enter * 0.92,
      }}
    >
      <Img src={staticFile("brand/grovbase_pink_white.png")} style={{ width: 210, height: "auto", display: "block" }} />
    </div>
  );
};

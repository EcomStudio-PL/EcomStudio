import React from "react";
import { E, lin, mix } from "../lib/anim";
import { Pointer } from "../components/Icons";
import { LOOKS, Vase, VaseLook } from "../components/Vase";
import { Rect } from "./layout";

/** Centre-based absolutely positioned 3D node in world space. */
export const Place: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  s?: number;
  opacity?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ x, y, w, h, z = 0, rx = 0, ry = 0, rz = 0, s = 1, opacity = 1, children, style }) => (
  <div
    style={{
      position: "absolute",
      left: x - w / 2,
      top: y - h / 2,
      width: w,
      height: h,
      transformStyle: "preserve-3d",
      transform: `translate3d(0,0,${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`,
      opacity,
      ...style,
    }}
  >
    {children}
  </div>
);

export type Flight = {
  t0: number; // leaves origin
  t1: number; // lands
  from: Rect;
  to: Rect;
  arc?: { x: number; y: number };
  lift?: number; // z at mid flight
  lean?: number; // deg of banking at mid flight
  pre?: number; // seconds of pick-up before t0
  post?: number; // seconds of settle after t1
  ease?: (x: number) => number;
};

export const flightState = (f: Flight, t: number) => {
  const pre = f.pre ?? 0.12;
  const post = f.post ?? 0.14;
  if (t < f.t0 - pre || t > f.t1 + post) return null;
  const p = (f.ease ?? E.whip)(lin(t, f.t0, f.t1));
  const pick = lin(t, f.t0 - pre, f.t0);
  const settle = lin(t, f.t1, f.t1 + post);
  const q = 1 - p;
  const ax = f.arc?.x ?? (f.from.x + f.to.x) / 2;
  const ay = f.arc?.y ?? (f.from.y + f.to.y) / 2;
  const x = q * q * f.from.x + 2 * q * p * ax + p * p * f.to.x;
  const y = q * q * f.from.y + 2 * q * p * ay + p * p * f.to.y;
  const w = mix(f.from.w, f.to.w, p);
  const h = mix(f.from.h, f.to.h, p);
  const arcUp = Math.sin(Math.PI * p);
  const z = (f.lift ?? 220) * arcUp + 40 * E.out(pick) * (1 - p) + 20 * (1 - settle) * (p >= 1 ? 1 : 0);
  const dir = Math.sign(f.to.x - f.from.x) || 1;
  const rz = (f.lean ?? 8) * arcUp * dir + (pick < 1 ? -3 * E.out(pick) : 0) * (1 - p);
  const s = 1 + 0.06 * E.out(pick) * (1 - p) + 0.04 * Math.sin(Math.PI * settle);
  return { x, y, w, h, z, rz, s, p, arcUp };
};

export const PhotoCard: React.FC<{ id: string; w: number; h: number; look?: VaseLook; shadow?: number; radius?: number; bgAlpha?: number; ai?: number }> = ({
  id,
  w,
  h,
  look = LOOKS.hero,
  shadow = 1,
  radius = 26,
  bgAlpha,
  ai,
}) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      width: w,
      height: h,
      borderRadius: radius,
      overflow: "hidden",
      background: "#fff",
      boxShadow: `0 ${30 * shadow}px ${70 * shadow}px rgba(0,0,0,${0.5 * shadow}), 0 0 0 3px rgba(255,255,255,0.9)`,
    }}
  >
    <Vase id={id} look={look} bgAlpha={bgAlpha} ai={ai} />
  </div>
);

export const FlyingPhoto: React.FC<{ id: string; flights: Flight[]; t: number }> = ({ id, flights, t }) => {
  return (
    <>
      {flights.map((f, i) => {
        const st = flightState(f, t);
        if (!st) return null;
        return (
          <Place key={i} x={st.x} y={st.y} w={st.w} h={st.h} z={st.z + 2} rz={st.rz} s={st.s}>
            <PhotoCard id={`${id}-${i}`} w={st.w} h={st.h} shadow={0.6 + 0.8 * st.arcUp} />
          </Place>
        );
      })}
    </>
  );
};

/** World-space pointer with click ripple. */
export const Cursor: React.FC<{ x: number; y: number; z?: number; opacity: number; pressed: number; ripple?: number; size?: number }> = ({
  x,
  y,
  z = 120,
  opacity,
  pressed,
  ripple = 0,
  size = 70,
}) =>
  opacity <= 0 ? null : (
    <div style={{ position: "absolute", left: x, top: y, width: 0, height: 0, transform: `translateZ(${z}px)`, opacity, transformStyle: "preserve-3d" }}>
      {ripple > 0 && ripple < 1 ? (
        <div
          style={{
            position: "absolute",
            left: -60 * ripple - 10,
            top: -60 * ripple - 10,
            width: 120 * ripple + 20,
            height: 120 * ripple + 20,
            borderRadius: "50%",
            border: `${6 * (1 - ripple) + 1}px solid rgba(249,80,225,${1 - ripple})`,
          }}
        />
      ) : null}
      <div style={{ position: "absolute", left: -6, top: -4 }}>
        <Pointer size={size} pressed={pressed} />
      </div>
    </div>
  );

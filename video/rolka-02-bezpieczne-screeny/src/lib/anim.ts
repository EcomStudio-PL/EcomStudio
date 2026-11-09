import { Easing, interpolate, spring } from "remotion";
import { FPS } from "../timing";

/** House easing curves — one vocabulary for the whole film. */
export const E = {
  /** Expo-out: confident arrivals. */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Smooth in-out for camera moves. */
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /** Gentle in-out (sine-like). */
  soft: Easing.bezier(0.37, 0, 0.63, 1),
  /** Accelerating exits / camera-through moves. */
  in: Easing.bezier(0.7, 0, 0.84, 0),
  /** Small overshoot (≈5%) for snaps. */
  back: Easing.bezier(0.34, 1.45, 0.64, 1),
  linear: Easing.linear,
};

export type EasingFn = (t: number) => number;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Clamped tween between two frames. */
export const tw = (
  frame: number,
  f0: number,
  f1: number,
  from = 0,
  to = 1,
  easing: EasingFn = E.out,
) =>
  interpolate(frame, [f0, f1], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

/** Keyframe = [frame, value, easing used to ARRIVE at this key]. */
export type Key = readonly [number, number, EasingFn?];

/** Piecewise keyframe track with per-segment easing, clamped at both ends. */
export const track = (frame: number, keys: readonly Key[]): number => {
  if (keys.length === 0) return 0;
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1, e] = keys[i];
    const [f0, v0] = keys[i - 1];
    if (frame <= f1) {
      if (f1 === f0) return v1;
      const t = (e ?? E.inOut)((frame - f0) / (f1 - f0));
      return v0 + (v1 - v0) * t;
    }
  }
  return keys[keys.length - 1][1];
};

/** Spring progress 0→1 starting at `start` (frame). */
export const spr = (
  frame: number,
  start: number,
  config: { damping?: number; stiffness?: number; mass?: number } = {},
  durationInFrames?: number,
) =>
  spring({
    frame: frame - start,
    fps: FPS,
    config: { damping: 18, stiffness: 140, mass: 1, ...config },
    durationInFrames,
  });

/** 0→1→0 window: fades in over `fin`, holds, fades out over `fout`. */
export const win = (
  frame: number,
  a: number,
  b: number,
  fin = 8,
  fout = 8,
  easing: EasingFn = E.out,
) => Math.min(tw(frame, a, a + fin, 0, 1, easing), tw(frame, b - fout, b, 1, 0, E.inOut));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Quadratic bezier point — used for arc ("spline") relayouts. */
export const qbez = (p0: number, c: number, p1: number, t: number) =>
  (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * c + t * t * p1;

/** Damped micro-shake (for impacts), returns px offset. */
export const impact = (frame: number, at: number, amp = 10, decay = 0.22, freq = 1.9) => {
  const t = frame - at;
  if (t < 0 || t > 40) return 0;
  return amp * Math.exp(-decay * t) * Math.sin(t * freq);
};

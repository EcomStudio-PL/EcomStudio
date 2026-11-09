import { createContext, useContext } from "react";
import { Easing, spring, useCurrentFrame } from "remotion";
import { FPS } from "../config";

export type EaseFn = (x: number) => number;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
/** Linear 0..1 progress of t between a and b (clamped). */
export const lin = (t: number, a: number, b: number) => (b === a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));

const outBackFn = (s: number) => (x: number) => {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
};

export const E = {
  linear: (x: number) => x,
  out: Easing.bezier(0.16, 1, 0.3, 1),
  soft: Easing.bezier(0.33, 1, 0.68, 1),
  in: Easing.bezier(0.55, 0, 0.9, 0.3),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  // Long whip: slow start, strong acceleration, long smooth deceleration.
  whip: Easing.bezier(0.7, 0, 0.1, 1),
  glide: Easing.bezier(0.45, 0, 0.2, 1),
  outBack: outBackFn(1.7),
  outBackSoft: outBackFn(1.1),
} satisfies Record<string, EaseFn>;

/** Eased 0..1 progress. */
export const ramp = (t: number, a: number, b: number, ease: EaseFn = E.out) => ease(lin(t, a, b));

/** Fade in over [a, a+fin], hold, fade out over [b-fout, b]. */
export const window01 = (t: number, a: number, b: number, fin = 0.2, fout = 0.2, ease: EaseFn = E.soft) =>
  Math.min(ramp(t, a, a + fin, ease), 1 - ramp(t, b - fout, b, ease));

/** Remotion physics spring starting at time t0 (seconds). */
export const sp = (t: number, t0: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) =>
  t < t0
    ? 0
    : spring({
        frame: (t - t0) * FPS,
        fps: FPS,
        config: { damping: 14, stiffness: 160, mass: 1, ...config },
      });

/** A one-shot pulse 0→1→0 centred on t0 with given half-width (seconds). */
export const pulse = (t: number, t0: number, half = 0.18) => {
  const d = Math.abs(t - t0) / half;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(d * Math.PI);
};

/** Damped oscillation after t0 — for impact shakes. */
export const shake = (t: number, t0: number, amp: number, freq = 22, decay = 9) => {
  if (t < t0) return 0;
  const d = t - t0;
  return amp * Math.exp(-d * decay) * Math.sin(d * freq * Math.PI * 2);
};

/** Deterministic pseudo random in [0,1). */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------------------
// Keyframe tracks
// ---------------------------------------------------------------------------
export type Key<V> = { t: number; v: V; e?: EaseFn };

export const track = (keys: Key<number>[], t: number): number => {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t <= k.t) {
      const p = keys[i - 1];
      return mix(p.v, k.v, (k.e ?? E.inOut)(lin(t, p.t, k.t)));
    }
  }
  return keys[keys.length - 1].v;
};

export type Pose = Record<string, number>;
/** Multi-channel keyframes. A key may carry `arc` = control point for x/y (quadratic Bézier). */
export type PoseKey<P extends Pose> = { t: number; v: P; e?: EaseFn; arc?: { x: number; y: number } };

export const trackPose = <P extends Pose>(keys: PoseKey<P>[], t: number): P => {
  if (t <= keys[0].t) return { ...keys[0].v };
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t <= k.t) {
      const a = keys[i - 1];
      const p = (k.e ?? E.inOut)(lin(t, a.t, k.t));
      const out: Pose = {};
      for (const key of Object.keys(k.v)) out[key] = mix(a.v[key] ?? k.v[key], k.v[key], p);
      if (k.arc && "x" in k.v && "y" in k.v) {
        const q = 1 - p;
        out.x = q * q * a.v.x + 2 * q * p * k.arc.x + p * p * k.v.x;
        out.y = q * q * a.v.y + 2 * q * p * k.arc.y + p * p * k.v.y;
      }
      return out as P;
    }
  }
  return { ...keys[keys.length - 1].v };
};

// ---------------------------------------------------------------------------
// Time context: every component reads absolute seconds so that all choreography
// is keyed to the voice timeline (src/data/timeline.ts), not to local sequences.
// ---------------------------------------------------------------------------
export const TimeCtx = createContext<number | null>(null);
export const useT = () => {
  const frame = useCurrentFrame();
  const override = useContext(TimeCtx);
  return override ?? frame / FPS;
};

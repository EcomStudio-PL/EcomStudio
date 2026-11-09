import { getLength, getPointAtLength } from "@remotion/paths";
import { E, EasingFn, clamp01, track, tw } from "./lib/anim";
import { CUE } from "./timing";
import { PHONE_CX, PHONE_CY, PhoneState, Pose, defaultPhone } from "./components/Phone";
import { FIELD, MARKER_D1, MARKER_D2, strokeSplit } from "./components/ScreenSVG";

/**
 * ONE continuous choreography. The phone is a single persistent object from the
 * first frame to the check scene; every scene inherits its pose from the
 * previous one (the keyframe lists below are shared across scene borders).
 */

type PK = readonly [number, Pose, EasingFn?];
const P = (p: Partial<Pose>): Pose => ({ fx: PHONE_CX, fy: PHONE_CY, tx: 540, ty: 960, z: 0, rx: 0, ry: 0, rz: 0, s: 0.8, ...p });
const poseAt = (frame: number, keys: readonly PK[]): Pose => {
  const out = {} as Pose;
  (Object.keys(keys[0][1]) as (keyof Pose)[]).forEach((k) => {
    out[k] = track(
      frame,
      keys.map(([f, p, e]) => [f, p[k], e] as const),
    );
  });
  return out;
};

const L1 = getLength(MARKER_D1);
const L2 = getLength(MARKER_D2);
/** Gesture position for a given marker draw progress (follows the stroke tip). */
const pt = (d: string, len: number) => getPointAtLength(d, len) ?? { x: 0, y: 0 };
export const gesturePoint = (draw: number): { x: number; y: number } => {
  const { p1, p2 } = strokeSplit(draw);
  if (draw <= 0.5) return pt(MARKER_D1, L1 * Math.min(1, p1 * 1.05));
  if (draw < 0.58) {
    const a = pt(MARKER_D1, L1);
    const b = pt(MARKER_D2, 0);
    const k = (draw - 0.5) / 0.08;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 40 };
  }
  return pt(MARKER_D2, L2 * Math.min(1, p2 * 1.05));
};

/** Field centre in SVG units. */
const FX = FIELD.x + FIELD.w / 2; // 547
const FY = 982;

const POSE_A: PK[] = [
  // HOOK — close, angled, already moving; marker draws from frame 0.
  [0, P({ fx: FX, fy: FY, tx: 556, ty: 1170, s: 1.16, rx: 15, ry: -24, rz: -4 })],
  [40, P({ fx: 520, fy: FY, tx: 540, ty: 1150, s: 1.36, rx: 9, ry: -12, rz: -2 }), E.soft],
  // camera-through-element: dive into the revealed digit
  [56, P({ fx: 322, fy: 981, tx: 540, ty: 960, s: 6.5, rx: 0, ry: 0, rz: 0 }), E.in],
  [57, P({ fx: PHONE_CX, fy: PHONE_CY, tx: 540, ty: 1000, s: 0.3, rx: 8, ry: 55, rz: 6 }), E.linear],
  // STORY — re-forms from the shared copies and orbits in 2.5D
  [136, P({ tx: 540, ty: 1000, s: 0.3, rx: 8, ry: 55, rz: 6 })],
  [174, P({ tx: 540, ty: 1000, s: 0.8, rx: 6, ry: -14, rz: 0 }), E.out],
  [232, P({ tx: 540, ty: 1000, s: 0.82, rx: 4, ry: 10 }), E.soft],
  [262, P({ fx: FX, fy: FY, tx: 540, ty: 1010, s: 1.24, rx: 6, ry: -4 }), E.inOut],
  [302, P({ fx: 560, fy: FY, tx: 540, ty: 1000, s: 1.3, rx: 5, ry: 4 }), E.soft],
  // BEZPIECZNE? — pull back, tilt the phone into the floor plane
  [308, P({ fx: 560, fy: FY, tx: 540, ty: 1000, s: 1.3, rx: 5, ry: 4 })],
  [344, P({ fx: PHONE_CX, fy: 900, tx: 540, ty: 1170, s: 0.64, rx: 22, ry: 0 }), E.inOut],
  [372, P({ fx: PHONE_CX, fy: 900, tx: 540, ty: 1178, s: 0.63, rx: 23, ry: -2 }), E.soft],
  [388, P({ fx: PHONE_CX, fy: 900, tx: 540, ty: 1178, s: 0.63, rx: 23, ry: -2 })],
  // DEMO — dolly into the field, exploded layers, recombine, sliders, push-in
  [418, P({ fx: FX, fy: FY, tx: 540, ty: 900, s: 1.5, rx: 8, ry: -10 }), E.inOut],
  [434, P({ fx: FX, fy: FY, tx: 540, ty: 905, s: 1.46, rx: 9, ry: -14 }), E.soft],
  [458, P({ fx: FX, fy: FY, tx: 560, ty: 940, s: 1.2, rx: 16, ry: -40 }), E.inOut],
  [480, P({ fx: FX, fy: FY, tx: 540, ty: 860, s: 1.45, rx: 6, ry: -6 }), E.out],
  [546, P({ fx: FX, fy: FY, tx: 540, ty: 860, s: 1.5, rx: 4, ry: 4 }), E.soft],
  [598, P({ fx: FX, fy: FY, tx: 540, ty: 900, s: 1.85, rx: 2, ry: -2 }), E.inOut],
  [610, P({ fx: FX, fy: FY, tx: 540, ty: 900, s: 1.87, rx: 2, ry: -2 }), E.soft],
  // DATA — pull back to a flat, centred phone; bubbles lift off as cards
  [640, P({ tx: 540, ty: 1000, s: 0.76, rx: 0, ry: 0 }), E.inOut],
  [664, P({ tx: 540, ty: 1000, s: 0.76, rx: 0, ry: 0 }), E.soft],
  [722, P({ tx: 540, ty: 1010, s: 0.74, z: -520, rx: 0, ry: 0 }), E.inOut],
  [762, P({ tx: 540, ty: 1010, s: 0.6, z: -900, rx: 0, ry: 0 }), E.in],
  [796, P({ tx: 330, ty: 1130, s: 0.28, rx: 0, ry: 0 }), E.linear],
  // SOLUTION 1 — reborn from the "100% ZAKRYJ" button
  [797, P({ tx: 330, ty: 1130, s: 0.28 })],
  [824, P({ tx: 540, ty: 1010, s: 0.8, rx: 6, ry: -10 }), E.out],
  [848, P({ fx: FX, fy: FY, tx: 540, ty: 1000, s: 1.36, rx: 6, ry: -8 }), E.inOut],
  [905, P({ fx: FX, fy: FY, tx: 540, ty: 1010, s: 1.42, rx: 4, ry: 4 }), E.soft],
  [944, P({ fx: 590, fy: FY, tx: 540, ty: 1000, s: 1.42, rx: 2, ry: -3 }), E.soft],
  // camera rides the rectangle's right edge, then parks the result to the left
  [966, P({ fx: 842, fy: FY, tx: 700, ty: 960, s: 1.3, rx: 0, ry: -16 }), E.inOut],
  [992, P({ tx: -330, ty: 900, s: 0.45, z: -300, rx: 0, ry: 35 }), E.inOut],
  // CHECK — comes back as a flattened saved file (left card)
  [1060, P({ tx: -330, ty: 952, s: 0.48, z: 0, ry: 30 })],
  [1090, P({ tx: 315, ty: 952, s: 0.48, rx: 0, ry: 0 }), E.out],
  [1196, P({ tx: 315, ty: 952, s: 0.48, rx: 0, ry: 0 }), E.soft],
];

export const getPhoneA = (frame: number): PhoneState => {
  const st = defaultPhone();
  st.pose = poseAt(frame, POSE_A);
  const scr = st.screen;

  // Visibility
  if (frame >= 57 && frame < 136) st.on = 0;
  else if (frame >= 136 && frame < 141) st.on = tw(frame, 136, 141, 0, 1, E.linear);
  else if (frame >= 742 && frame < 797) st.on = 0;
  else if (frame >= 797 && frame < 805) st.on = tw(frame, 797, 803, 0, 1, E.linear);
  else if (frame >= 984 && frame < 1060) st.on = tw(frame, 984, 992, 1, 0, E.linear);
  else if (frame >= 1060 && frame < 1068) st.on = tw(frame, 1060, 1066, 0, 1, E.linear);
  else if (frame >= 1208) st.on = 0; // CTA group flip (1194–1206) carries the exit
  if (st.on <= 0) return st;

  // ---------- HOOK ----------
  if (frame < 57) {
    scr.cover = { draw: tw(frame, -3, 14, 0, 1, E.soft), morph: 0, alpha: 0.78 };
    const scanX = tw(frame, 24, 46, 230, 800, E.inOut);
    const sOn = Math.min(tw(frame, 22, 26), tw(frame, 46, 52, 1, 0));
    st.scan = { on: sOn, x: scanX };
    if (frame >= 22) st.filter = { b: 1.9, c: 2.2, x0: 154, x1: frame >= 46 ? 1054 : scanX, y0: 848, y1: 1073 };
    const g = clamp01(1 - tw(frame, 14, 22, 0, 1));
    const gp = gesturePoint(scr.cover.draw);
    st.finger = { on: g, x: gp.x, y: gp.y, press: 1 };
    st.shadow = 1;
    return st;
  }

  // ---------- STORY ----------
  if (frame < 308) {
    scr.b3 = tw(frame, 168, 184, 0, 1, E.back);
    scr.b4 = tw(frame, 186, 200, 0, 1, E.back);
    scr.scrollY = track(frame, [
      [150, 150],
      [184, 70, E.out],
      [200, 0, E.out],
    ]);
    st.flash = Math.max(0, tw(frame, CUE.zrzutEkranu, CUE.zrzutEkranu + 12, 0.85, 0, E.out)) * (frame >= CUE.zrzutEkranu ? 1 : 0);
    scr.capture = frame >= CUE.zrzutEkranu ? Math.sin(clamp01((frame - CUE.zrzutEkranu) / 18) * Math.PI) : 0;
    st.toolbar = Math.min(tw(frame, 222, 236, 0, 1, E.out), tw(frame, 300, 308, 1, 0));
    st.tool = 0;
    const draw = track(frame, [
      [262, 0],
      [275, 0.5, E.soft],
      [279, 0.58, E.linear],
      [294, 1, E.soft],
    ]);
    scr.cover = { draw, morph: 0, alpha: 0.78 };
    // gesture: approach → press → two swipes → lift
    const fingerOn = Math.min(tw(frame, 238, 246), tw(frame, 296, 306, 1, 0));
    if (fingerOn > 0) {
      let fx: number;
      let fy: number;
      if (frame < 262) {
        const k = tw(frame, 238, 260, 0, 1, E.inOut);
        fx = 900 + (268 - 900) * k;
        fy = 1250 + (989 - 1250) * k - Math.sin(k * Math.PI) * 120;
      } else if (frame < 296) {
        const gp = gesturePoint(draw);
        fx = gp.x;
        fy = gp.y;
      } else {
        const k = tw(frame, 296, 306);
        fx = 854 + 90 * k;
        fy = 1007 - 120 * k;
      }
      st.finger = { on: fingerOn, x: fx, y: fy, press: frame >= 258 && frame < 296 ? 1 : tw(frame, 252, 258) };
    }
    return st;
  }

  // ---------- BEZPIECZNE? / NIEKONIECZNIE ----------
  if (frame < 396) {
    scr.cover = { draw: 1, morph: 0, alpha: 0.78 };
    const pop = track(frame, [
      [CUE.niekoniecznie - 4, 0],
      [CUE.niekoniecznie + 8, 1, E.out],
      [388, 1],
      [400, 0, E.inOut],
    ]);
    const angle = track(frame, [
      [CUE.niekoniecznie - 4, 0],
      [CUE.niekoniecznie + 6, 180, E.out],
      [388, 180],
      [400, 360, E.inOut],
    ]);
    if (pop > 0.001 || (angle > 0 && angle < 360)) {
      st.flip = { pop, angle };
      scr.cover = { ...scr.cover, hidden: true };
    }
    return st;
  }

  // ---------- DEMO ----------
  if (frame < 640) {
    scr.cover = { draw: 1, morph: 0, alpha: 0.78 };
    if (frame < 400) {
      st.flip = { pop: track(frame, [[388, 1], [400, 0, E.inOut]]), angle: track(frame, [[388, 180], [400, 360, E.inOut]]) };
      scr.cover = { ...scr.cover, hidden: true };
    }
    st.dim = Math.min(tw(frame, 404, 420), tw(frame, 606, 626, 1, 0)) * 0.9;
    st.explode = track(frame, [
      [430, 0],
      [452, 1, E.out],
      [462, 1],
      [474, 0, E.back],
    ]);
    if (st.explode > 0.001) scr.cover = { ...scr.cover, hidden: true };
    const b = track(frame, [
      [CUE.jasnosc, 1],
      [CUE.jasnosc + 22, 2.0, E.inOut],
      [606, 2.0],
      [622, 1, E.inOut],
    ]);
    const c = track(frame, [
      [CUE.kontrast, 1],
      [CUE.kontrast + 26, 2.4, E.inOut],
      [606, 2.4],
      [622, 1, E.inOut],
    ]);
    const wipeX = track(frame, [
      [CUE.zebyUkryty, 154],
      [CUE.zebyUkryty + 20, FX, E.inOut],
      [604, FX],
      [616, 154, E.inOut],
    ]);
    if (frame >= CUE.jasnosc && frame < 622) st.filter = { b, c, x0: wipeX, x1: 1054, y0: 848, y1: 1073 };
    const dOn = Math.min(tw(frame, CUE.zebyUkryty, CUE.zebyUkryty + 10), tw(frame, 600, 610, 1, 0));
    if (dOn > 0) st.divider = { on: dOn, x: wipeX };
    st.focus = frame >= 570 && frame < 612 ? tw(frame, 570, 612, 0, 1, E.linear) * Math.min(1, tw(frame, 600, 612, 1, 0) * 3) : 0;
    return st;
  }

  // ---------- DATA (bubbles lift off as cards) ----------
  if (frame < 797) {
    scr.cover = { draw: 1, morph: 0, alpha: 0.78 };
    const lift = (at: number) => tw(frame, at, at + 3, 0, 1, E.linear);
    scr.lift = {
      b3: lift(DATA_LAUNCH.telefon),
      b4: lift(DATA_LAUNCH.adres),
      h: lift(DATA_LAUNCH.klient),
      b2: lift(DATA_LAUNCH.email),
      b1: lift(DATA_LAUNCH.bank),
    };
    st.on = 1 - tw(frame, 662, 700, 0, 0.72, E.inOut) - tw(frame, 718, 734, 0, 0.28, E.in);
    return st;
  }

  // ---------- SOLUTION 1 ----------
  if (frame < 1060) {
    scr.cover = {
      draw: 1,
      morph: track(frame, [
        [850, 0],
        [866, 1, E.inOut],
        [884, 2, E.inOut],
      ]),
      alpha: track(frame, [
        [882, 0.78],
        [902, 1, E.inOut],
      ]),
    };
    st.toolbar = Math.min(tw(frame, 812, 826), tw(frame, 952, 962, 1, 0));
    st.tool = track(frame, [
      [CUE.uzyj, 0],
      [CUE.uzyj + 8, 1, E.out],
    ]);
    st.toolBan = tw(frame, 812, 826, 0, 1, E.out) * (1 - tw(frame, CUE.uzyj, CUE.uzyj + 6));
    st.outline = Math.min(tw(frame, CUE.prostokata, CUE.prostokata + 16, 0, 1, E.inOut), tw(frame, 984, 992, 1, 0));
    st.check = tw(frame, CUE.zakryjeDane - 2, CUE.zakryjeDane + 14, 0, 1, E.out) * (1 - tw(frame, 984, 992));
    return st;
  }

  // ---------- CHECK (saved file, flattened) ----------
  scr.cover = { draw: 1, morph: 2, alpha: 1 };
  st.body = 0;
  st.shadow = 0.8;
  st.layers = track(frame, [
    [1072, 0],
    [1078, 1, E.out],
    [1096, 0, E.inOut],
  ]);
  return st;
};

/** Bubble → card launch frames (synced to "telefonów / adresów / danych klientów / informacji bankowych"). */
export const DATA_LAUNCH = {
  telefon: CUE.telefonow - 6,
  adres: CUE.adresow - 4,
  klient: CUE.klientow - 6,
  email: CUE.klientow + 10,
  bank: CUE.bankowych - 14,
} as const;

/** Phone B — a fresh copy of the ORIGINAL screenshot used for the crop alternative. */
const POSE_B: PK[] = [
  [966, P({ tx: 1450, ty: 960, s: 0.62, ry: -35, z: -200 })],
  [994, P({ tx: 540, ty: 990, s: 0.7, rx: 0, ry: 0, z: 0 }), E.out],
  [1030, P({ tx: 540, ty: 1000, s: 0.72 }), E.soft],
  [1064, P({ fy: 555, tx: 540, ty: 860, s: 0.72 }), E.inOut],
  [1092, P({ fy: 555, tx: 765, ty: 821, s: 0.48 }), E.out],
  [1196, P({ fy: 555, tx: 765, ty: 821, s: 0.48 }), E.soft],
];

export const CROP_Y = 830;

export const getPhoneB = (frame: number): PhoneState => {
  const st = defaultPhone();
  if (frame < 966 || frame >= 1208) {
    st.on = 0;
    return st;
  }
  st.pose = poseAt(frame, POSE_B);
  st.on = tw(frame, 966, 972, 0, 1, E.linear);
  const scr = st.screen;
  scr.cover = { draw: 0, morph: 0, alpha: 0.78 };
  const grow = tw(frame, 990, 1004, 0, 1, E.out);
  const bottom = track(frame, [
    [1004, 1368],
    [1028, CROP_Y, E.inOut],
  ]);
  const confirmed = frame >= CUE.ktoregoNie ? 1 : 0;
  const cut = tw(frame, CUE.ktoregoNie, CUE.ktoregoNie + 24, 0, 1, E.in);
  st.crop = {
    on: Math.min(tw(frame, 988, 996), tw(frame, 1044, 1056, 1, 0)),
    left: FIELD.x + (177 - FIELD.x) * grow,
    top: FIELD.y + (283 - FIELD.y) * grow,
    right: FIELD.x + FIELD.w + (1031 - FIELD.x - FIELD.w) * grow,
    bottom: frame < 1004 ? FIELD.y + FIELD.h + (1368 - FIELD.y - FIELD.h) * grow : bottom,
    dimBelow: confirmed ? 0 : tw(frame, 1004, 1014),
    cut,
    confirmed,
  };
  if (confirmed) {
    st.crop.top = 283;
    st.crop.left = 177;
    st.crop.right = 1031;
    st.crop.bottom = CROP_Y;
  }
  st.body = 1 - tw(frame, CUE.ktoregoNie, CUE.ktoregoNie + 18, 0, 1, E.inOut);
  st.shadow = 1 - 0.2 * tw(frame, CUE.ktoregoNie, CUE.ktoregoNie + 18);
  st.layers = track(frame, [
    [1072, 0],
    [1078, 1, E.out],
    [1096, 0, E.inOut],
  ]);
  return st;
};

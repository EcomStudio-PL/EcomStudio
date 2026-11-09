import { E, PoseKey, pulse, shake, trackPose } from "../lib/anim";
import { T } from "../data/timeline";
import { slotCenter, ST } from "./layout";

// Virtual camera: x/y = world point at screen centre, s = zoom, rx/ry/rz = orbit (deg).
export type Cam = { x: number; y: number; s: number; rx: number; ry: number; rz: number };

const www = slotCenter("www");
const social = slotCenter("social");
const B = ST.bench;
const S = ST.source;
const TL = ST.tools;

export const CAMERA: PoseKey<Cam>[] = [
  // HOOK — start in motion over the results, push to the thumbnail
  { t: 0, v: { x: 90, y: 20, s: 1.12, rx: 16, ry: -14, rz: 3 } },
  { t: T.grab, v: { x: 175, y: 140, s: 1.16, rx: 9, ry: -7, rz: 1 }, e: E.soft },
  // drag: whip down with the photo to the website
  { t: T.drop, v: { x: -150, y: 1430, s: 1.02, rx: 6, ry: 8, rz: -1.5 }, e: E.whip, arc: { x: 260, y: 820 } },
  { t: T.uwazaj + 0.06, v: { x: -190, y: 1490, s: 1.08, rx: 5, ry: 5, rz: -1 }, e: E.soft },
  // camera stops on the red risk frame
  { t: T.hookEnd - 0.1, v: { x: www.x, y: www.y - 40, s: 1.5, rx: 2, ry: -3, rz: 0 }, e: E.glide },
  // GOOGLE TYLKO WYSZUKUJE — pull far back: the whole world (search engine above, publishing below)
  { t: T.wyszukuje + 0.35, v: { x: 40, y: -60, s: 0.56, rx: 20, ry: -12, rz: -3 }, e: E.whip },
  { t: T.toNie, v: { x: 20, y: -20, s: 0.6, rx: 18, ry: -4, rz: -2 }, e: E.soft },
  // RYZYKO — dive into the publishing stack
  { t: T.swobodnie + 0.4, v: { x: 0, y: 1980, s: 0.74, rx: 12, ry: 9, rz: 1 }, e: E.whip },
  { t: T.stronie + 0.05, v: { x: -80, y: 1660, s: 0.9, rx: 8, ry: 6, rz: 0.5 }, e: E.inOut },
  { t: T.sklepie + 0.12, v: { x: 110, y: 2150, s: 0.92, rx: 7, ry: -5, rz: -0.5 }, e: E.inOut },
  { t: T.social + 0.12, v: { x: -100, y: 2640, s: 0.92, rx: 7, ry: 5, rz: 0.5 }, e: E.inOut },
  { t: T.iUwaga - 0.02, v: { x: 0, y: 2270, s: 0.68, rx: 12, ry: -8, rz: -1 }, e: E.inOut },
  // ZWROT "I uwaga" — punch-in and freeze on the copied photo
  { t: T.iUwaga + 0.14, v: { x: social.x, y: social.y, s: 1.62, rx: 0, ry: 0, rz: 0 }, e: E.out },
  { t: T.uwagaEnd, v: { x: social.x + 4, y: social.y - 3, s: 1.66, rx: 0, ry: 0, rz: 0 }, e: E.linear },
  // EDYCJA — whip to the edit bench, then read the three forms row by row
  { t: T.nawet + 0.3, v: { x: B.x, y: B.y + 60, s: 0.95, rx: 6, ry: -10, rz: 1 }, e: E.whip, arc: { x: 600, y: 2500 } },
  { t: T.przytniesz + 0.4, v: { x: B.x + 20, y: B.y - 300, s: 1.15, rx: 4, ry: -6, rz: 0.5 }, e: E.inOut },
  { t: T.usuniesz + 0.35, v: { x: B.x + 20, y: B.y + 60, s: 1.15, rx: 4, ry: 4, rz: -0.5 }, e: E.inOut },
  { t: T.przerobisz + 0.45, v: { x: B.x + 20, y: B.y + 420, s: 1.15, rx: 4, ry: -4, rz: 0.5 }, e: E.inOut },
  { t: T.nieOznacza + 0.05, v: { x: B.x + 10, y: B.y + 90, s: 0.98, rx: 5, ry: 6, rz: 0 }, e: E.inOut },
  { t: T.editEnd, v: { x: B.x, y: B.y + 70, s: 1.0, rx: 4, ry: -4, rz: 0 }, e: E.linear },
  // JAK TO SPRAWDZIĆ — card flips into the search interface
  { t: T.jakEnd, v: { x: B.x, y: B.y - 20, s: 0.98, rx: 6, ry: 4, rz: 0 }, e: E.inOut },
  // GOOGLE UI KROKI — camera visits every control (panel kept below the step HUD)
  { t: T.grafike + 0.15, v: { x: B.x - 70, y: B.y - 220, s: 1.22, rx: 4, ry: -3, rz: 0 }, e: E.inOut },
  { t: T.narzedzia + 0.2, v: { x: B.x + 120, y: B.y - 220, s: 1.28, rx: 4, ry: 3, rz: 0 }, e: E.inOut },
  { t: T.prawaUz + 0.15, v: { x: B.x + 100, y: B.y - 180, s: 1.24, rx: 4, ry: -2, rz: 0 }, e: E.inOut },
  { t: T.pamietaj + 0.1, v: { x: B.x, y: B.y - 140, s: 1.02, rx: 5, ry: 2, rz: 0 }, e: E.inOut },
  { t: T.pamietaj + 0.75, v: { x: B.x + 30, y: B.y + 20, s: 1.02, rx: 5, ry: -2, rz: 0 }, e: E.inOut },
  // LICENCJA U ŹRÓDŁA — whip to the source page
  { t: T.sprawdzic, v: { x: S.x, y: S.y - 120, s: 0.97, rx: 5, ry: -6, rz: 0.5 }, e: E.whip, arc: { x: 1980, y: 2700 } },
  { t: T.zrodla + 0.35, v: { x: S.x, y: S.y - 40, s: 1.0, rx: 4, ry: 4, rz: 0 }, e: E.glide },
  { t: T.szczegolnie + 0.6, v: { x: S.x, y: S.y + 170, s: 1.04, rx: 4, ry: -2, rz: 0 }, e: E.inOut },
  { t: T.komercyjnie + 0.1, v: { x: S.x, y: S.y + 230, s: 1.12, rx: 3, ry: -2, rz: 0 }, e: E.inOut },
  { t: T.licEnd + 0.05, v: { x: S.x, y: S.y + 230, s: 1.14, rx: 3, ry: -2, rz: 0 }, e: E.linear },
  // TRZY NARZĘDZIA AI — drop down to the tools station
  { t: T.aJesli + 0.55, v: { x: TL.x, y: TL.y - 300, s: 1.04, rx: 6, ry: 5, rz: -0.5 }, e: E.whip },
  { t: T.mozesz + 0.3, v: { x: TL.x, y: TL.y - 250, s: 1.06, rx: 5, ry: -2, rz: 0 }, e: E.glide },
  { t: T.gemini + 0.2, v: { x: TL.x, y: TL.y + 110, s: 0.94, rx: 5, ry: 3, rz: 0 }, e: E.inOut },
  { t: T.specjalizuje + 0.3, v: { x: TL.x, y: TL.y + 210, s: 1.0, rx: 4, ry: -3, rz: 0 }, e: E.inOut },
  { t: T.produktowych + 0.2, v: { x: TL.x, y: TL.y + 40, s: 1.0, rx: 3, ry: 2, rz: 0 }, e: E.inOut },
  // PRAWA MATERIAŁÓW WEJŚCIOWYCH — same station, layout morphs; camera reads top → bottom
  { t: T.korzystac, v: { x: TL.x, y: TL.y - 130, s: 0.98, rx: 5, ry: 4, rz: 0 }, e: E.inOut },
  { t: T.prawaIn + 0.25, v: { x: TL.x, y: TL.y - 90, s: 1.0, rx: 4, ry: -3, rz: 0 }, e: E.glide },
  { t: T.sprawdzac + 0.45, v: { x: TL.x, y: TL.y + 250, s: 1.0, rx: 4, ry: 3, rz: 0 }, e: E.inOut },
  { t: T.narzedziEnd, v: { x: TL.x, y: TL.y + 270, s: 1.03, rx: 3, ry: -2, rz: 0 }, e: E.linear },
  // CTA — the camera lifts off: the whole journey keeps drifting behind the call to action
  { t: T.zapisz + 0.45, v: { x: 1280, y: 2350, s: 0.27, rx: 20, ry: -14, rz: -5 }, e: E.whip },
  { t: T.aTy, v: { x: 1300, y: 2400, s: 0.285, rx: 16, ry: -4, rz: -2 }, e: E.linear },
  { t: T.aTyEnd + 0.1, v: { x: 1300, y: 2420, s: 0.31, rx: 14, ry: -2, rz: -1.5 }, e: E.out },
  { t: 55, v: { x: 1320, y: 2480, s: 0.33, rx: 10, ry: 10, rz: 1.5 }, e: E.soft },
];

export const cameraAt = (t: number): Cam => {
  const c = trackPose(CAMERA, t);
  // living camera: very small continuous float
  const fx = Math.sin(t * 0.9) * 6 + Math.sin(t * 2.3) * 2;
  const fy = Math.cos(t * 0.7) * 5;
  // impacts
  const hit = shake(t, T.uwazaj, 1.2, 18, 7) + shake(t, T.iUwaga + 0.12, 0.45, 20, 12) + shake(t, T.aTy, 0.35, 16, 10);
  // accents on the words: "słono kosztować", "A ty?"
  const punch = 1 + 0.045 * pulse(t, T.slono + 0.12, 0.28) + 0.03 * pulse(t, T.kosztowac + 0.15, 0.3);
  return { ...c, s: c.s * punch, x: c.x + fx / c.s, y: c.y + fy / c.s, rz: c.rz + hit, rx: c.rx + hit * 0.4 };
};

/** Screen-space speed of the camera in px per frame (translation + zoom + orbit), used to drive motion blur. */
export const cameraSpeed = (t: number, fps = 30): number => {
  const a = trackPose(CAMERA, t);
  const b = trackPose(CAMERA, t + 1 / fps);
  const s = (a.s + b.s) / 2;
  const tr = Math.hypot((b.x - a.x) * s, (b.y - a.y) * s);
  const zoom = Math.abs(Math.log(b.s / a.s)) * 1100;
  const orbit = (Math.abs(b.rx - a.rx) + Math.abs(b.ry - a.ry) + Math.abs(b.rz - a.rz)) * 18;
  return tr + zoom + orbit;
};

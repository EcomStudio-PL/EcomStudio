import React from "react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../config";
import { E, lin, mix, pulse, ramp, sp, window01 } from "../../lib/anim";
import { T } from "../../data/timeline";
import { GoogleUI, GW, GH, thumbRect } from "../../components/GoogleUI";
import { LOOKS, Vase } from "../../components/Vase";
import { IconCrop, IconEraser, IconSparkle } from "../../components/Icons";
import { benchPoint, GOOGLE_TARGETS, slotCenter, ST, tl } from "../layout";
import { Cursor, Flight, FlyingPhoto, Place } from "../primitives";

// EDYCJA_NIE_DAJE_PRAW → JAK_SPRAWDZIC → GOOGLE_UI_KROKI → start of LICENCJA_U_ZRODLA.
// One photo card lands on the edit bench, splits into crop / background removal / AI edit,
// every form gets "TO NIE NADAJE PRAW", the forms merge back and the card flips into the search interface.

const B = ST.bench;
const O = tl(B);
const ROW_Y = [330, 720, 1110];
const IMG = 340;
const IMG_X = 230;
const CENTER = { x: 470, y: 700 };

export const TO_BENCH: Flight = {
  t0: T.uwagaEnd + 0.02,
  t1: T.nawet + 0.32,
  from: slotCenter("social"),
  to: { x: O.x + CENTER.x, y: O.y + CENTER.y, w: 500, h: 500 },
  arc: { x: 560, y: 2420 },
  lift: 320,
  lean: 10,
  pre: 0.1,
  post: 0.12,
};

// split choreography
const SPLIT = {
  aMove: [T.przytniesz - 0.02, T.przytniesz + 0.36],
  crop: [T.przytniesz + 0.2, T.przytniesz + 0.75],
  bOut: [T.usuniesz - 0.04, T.usuniesz + 0.34],
  erase: [T.usuniesz + 0.18, T.usuniesz + 0.85],
  cOut: [T.przerobisz - 0.04, T.przerobisz + 0.34],
  ai: [T.przerobisz + 0.3, T.ai + 0.35],
  stamps: [T.nieOznacza + 0.02, T.nieOznacza + 0.27, T.nieOznacza + 0.52],
  merge: [T.editEnd + 0.02, T.jak + 0.12],
  flip: [T.jak + 0.05, T.jakEnd + 0.02],
  grow: [T.jak + 0.25, T.wejdz + 0.05],
};

export const STAMP_TIMES = SPLIT.stamps;
export const FLIP_TIME = SPLIT.flip[0];

// Google steps
const STEP = {
  cursorIn: T.wejdz - 0.1,
  clickGrafika: T.grafike + 0.12,
  clickNarzedzia: T.narzedzia + 0.08,
  clickRights: T.prawaUz + 0.05,
  clickCC: T.pamietaj + 0.12,
  linkIn: T.pamietaj + 0.45,
  clickLink: T.pamietaj + 0.78,
};
export const BENCH_CLICKS = STEP;

const LINK_THUMB = 1;

const cardRect = (t: number, k: 0 | 1 | 2) => {
  // card k position in local coords (centre) + size
  if (t < SPLIT.merge[0]) {
    if (k === 0) {
      const p = E.inOut(lin(t, SPLIT.aMove[0], SPLIT.aMove[1]));
      return { x: mix(CENTER.x, IMG_X, p), y: mix(CENTER.y, ROW_Y[0], p), s: mix(500, IMG, p), v: 1 };
    }
    const win = k === 1 ? SPLIT.bOut : SPLIT.cOut;
    const p = E.out(lin(t, win[0], win[1]));
    const fromY = ROW_Y[k - 1];
    return { x: IMG_X + Math.sin(Math.PI * p) * 70, y: mix(fromY, ROW_Y[k], p), s: IMG, v: t >= win[0] ? 1 : 0 };
  }
  // merge: B and C fly into A, then A rises to the centre
  const pm = E.inOut(lin(t, SPLIT.merge[0], SPLIT.merge[0] + 0.3));
  if (k > 0) return { x: IMG_X, y: mix(ROW_Y[k], ROW_Y[0], pm), s: IMG, v: 1 - lin(t, SPLIT.merge[0] + 0.22, SPLIT.merge[0] + 0.32) };
  const pc = E.inOut(lin(t, SPLIT.merge[0] + 0.18, SPLIT.merge[1]));
  return { x: mix(IMG_X, CENTER.x, pc), y: mix(ROW_Y[0], CENTER.y, pc), s: mix(IMG, 560, pc), v: 1 };
};

export const Bench: React.FC<{ t: number }> = ({ t }) => {
  const showEdit = t > T.uwagaEnd - 0.2 && t < SPLIT.flip[1] + 0.2;
  const flipStarted = t >= SPLIT.flip[0];
  const panelLive = t >= SPLIT.grow[1];
  const inCTA = t > T.zapisz - 0.2;
  if (!(showEdit || (t >= SPLIT.flip[0] && t < T.aJesli + 0.6) || inCTA)) return <FlyingPhoto id="tb" flights={[TO_BENCH]} t={t} />;

  // ------------------------------------------------------------- edit window
  const winIn = sp(t, T.uwagaEnd - 0.1, { damping: 18, stiffness: 120 });
  const winOut = ramp(t, SPLIT.merge[0] + 0.1, SPLIT.flip[0] + 0.3, E.inOut);
  const tool = (i: number) =>
    i === 0 ? window01(t, SPLIT.crop[0] - 0.2, SPLIT.crop[1] + 0.2, 0.1, 0.2) : i === 1 ? window01(t, SPLIT.erase[0] - 0.2, SPLIT.erase[1] + 0.2, 0.1, 0.2) : window01(t, SPLIT.ai[0] - 0.2, SPLIT.ai[1] + 0.2, 0.1, 0.2);

  const editWindow =
    showEdit && winOut < 1 ? (
      <Place x={B.x} y={B.y} w={940} h={1400} z={-30 - 260 * winOut} opacity={Math.min(1, winIn * 1.4) * (1 - winOut)} s={mix(0.92, 1, winIn)}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 40,
            background: "linear-gradient(160deg, #14203F 0%, #0C1530 100%)",
            border: "2px solid rgba(255,255,255,0.08)",
            boxShadow: "0 60px 140px rgba(0,0,0,0.6)",
            fontFamily: FONT_BODY,
          }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 100, borderBottom: "2px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", padding: "0 40px", gap: 18 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 38, color: C.white, whiteSpace: "nowrap" }}>Edycja zdjęcia</div>
            <div style={{ flex: 1 }} />
            {[IconCrop, IconEraser, IconSparkle].map((Ic, i) => (
              <div
                key={i}
                style={{
                  width: 70,
                  height: 70,
                  borderRadius: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: tool(i) > 0.05 ? `rgba(249,80,225,${0.25 * tool(i)})` : "rgba(255,255,255,0.06)",
                  border: `2px solid rgba(249,80,225,${0.9 * tool(i)})`,
                  transform: `scale(${1 + 0.12 * tool(i)})`,
                }}
              >
                <Ic size={36} color={tool(i) > 0.5 ? C.pink : "#AEB8D6"} />
              </div>
            ))}
          </div>
        </div>
      </Place>
    ) : null;

  // labels per row
  const labels = ["PRZYCIĘCIE", "USUNIĘCIE TŁA", "PRZERÓBKA AI"];
  const labelIn = [sp(t, T.przytniesz + 0.08, { damping: 16 }), sp(t, T.usuniesz + 0.06, { damping: 16 }), sp(t, T.przerobisz + 0.06, { damping: 16 })];
  const fadeRows = 1 - ramp(t, SPLIT.merge[0], SPLIT.merge[0] + 0.25);

  const rows =
    showEdit && t < SPLIT.flip[0] ? (
      <>
        {[0, 1, 2].map((k) => {
          const stampT = SPLIT.stamps[k];
          const st = sp(t, stampT, { damping: 12, stiffness: 300 });
          const p = benchPoint(500, ROW_Y[k]);
          return (
            <React.Fragment key={k}>
              <Place x={p.x + 190} y={p.y - 30} w={420} h={120} z={10} opacity={Math.min(1, labelIn[k] * 1.5) * fadeRows}>
                <div style={{ transform: `translateX(${(1 - labelIn[k]) * 60}px)` }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 50, color: C.white, whiteSpace: "nowrap", lineHeight: 1 }}>{labels[k]}</div>
                  <div style={{ marginTop: 14, height: 6, width: 120 * labelIn[k], borderRadius: 3, background: C.pink }} />
                </div>
              </Place>
              {t >= stampT - 0.05 ? (
                <Place x={B.x - 10} y={O.y + ROW_Y[k] + 112} w={860} h={96} z={60} rz={-3} s={2.2 - 1.2 * st} opacity={Math.min(1, st * 2.5) * fadeRows}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 18,
                      border: `6px solid ${C.red}`,
                      background: "rgba(40,6,18,0.88)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: FONT_DISPLAY,
                      fontWeight: 700,
                      fontSize: 52,
                      letterSpacing: 2,
                      color: "#FF5A78",
                      boxShadow: `0 0 ${20 + 40 * pulse(t, T.prawaEdit + 0.1, 0.3)}px rgba(255,59,92,0.6)`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    TO NIE NADAJE PRAW
                  </div>
                </Place>
              ) : null}
            </React.Fragment>
          );
        })}
      </>
    ) : null;

  // photo cards (A crop, B background removal, C AI)
  const cards =
    showEdit && t >= TO_BENCH.t1 && !flipStarted
      ? ([2, 1, 0] as const).map((k) => {
          const r = cardRect(t, k);
          if (r.v <= 0) return null;
          const wp = benchPoint(r.x, r.y);
          return (
            <Place key={k} x={wp.x} y={wp.y} w={r.s} h={r.s} z={20 + k * 2} opacity={r.v}>
              <EditCard k={k} t={t} size={r.s} />
            </Place>
          );
        })
      : null;

  // ------------------------------------------------------------- flip card → Google panel
  const flipP = E.inOut(lin(t, SPLIT.flip[0], SPLIT.flip[1]));
  const growP = E.inOut(lin(t, SPLIT.grow[0], SPLIT.grow[1]));
  const fw = mix(560, GW, growP);
  const fh = mix(560, GH, growP);
  const center = benchPoint(CENTER.x, CENTER.y);
  const fcx = mix(center.x, B.x, growP);
  const fcy = mix(center.y, B.y, growP);

  const googleState = (live: boolean) => {
    const toolsOpen = ramp(t, STEP.clickNarzedzia + 0.04, STEP.clickNarzedzia + 0.4, E.out);
    const dropdown = ramp(t, STEP.clickRights + 0.05, STEP.clickRights + 0.32, E.out) * (1 - ramp(t, STEP.clickCC + 0.12, STEP.clickCC + 0.3));
    return {
      id: live ? "gp" : "gf",
      typed: 1,
      resultsIn: 1,
      grafikaActive: ramp(t, STEP.clickGrafika, STEP.clickGrafika + 0.25),
      hoverTab: window01(t, STEP.clickGrafika - 0.35, STEP.clickGrafika + 0.4, 0.15, 0.25),
      narzedziaActive: ramp(t, STEP.clickNarzedzia, STEP.clickNarzedzia + 0.18),
      toolsOpen,
      rightsActive: ramp(t, STEP.clickRights, STEP.clickRights + 0.18),
      dropdown,
      ccHover: window01(t, STEP.clickCC - 0.5, STEP.clickCC + 0.1, 0.15, 0.05),
      ccSelected: ramp(t, STEP.clickCC, STEP.clickCC + 0.12),
      ccResults: ramp(t, STEP.clickCC + 0.15, STEP.clickCC + 0.5),
      licenseLink: { i: LINK_THUMB, v: sp(t, STEP.linkIn, { damping: 14 }), hover: window01(t, STEP.clickLink - 0.25, STEP.clickLink + 0.3, 0.1, 0.2) },
      hoverThumb: { i: LINK_THUMB, v: window01(t, STEP.linkIn - 0.15, STEP.clickLink + 0.3, 0.15, 0.2) },
    };
  };

  const flipCard =
    flipStarted && !panelLive ? (
      <Place x={fcx} y={fcy} w={fw} h={fh} z={30 + 120 * Math.sin(Math.PI * flipP)} ry={180 * flipP} rx={-6 * Math.sin(Math.PI * flipP)}>
        {/* front: the photo */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 30, overflow: "hidden", boxShadow: "0 40px 90px rgba(0,0,0,0.55)" }}>
          <Vase id="flipfront" look={LOOKS.hero} />
        </div>
        {/* back: the search interface */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", borderRadius: 36, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: GW, height: GH, transform: `scale(${fw / GW})`, transformOrigin: "0 0" }}>
            <GoogleUI {...googleState(false)} />
          </div>
        </div>
      </Place>
    ) : null;

  const panel = panelLive ? (
    <Place x={B.x} y={B.y} w={GW} h={GH}>
      <GoogleUI {...googleState(true)} />
    </Place>
  ) : null;

  // ------------------------------------------------------------- callout: the filter is not a licence
  const callIn = sp(t, T.uzytkowaniaEnd - 0.35, { damping: 14 });
  const callout =
    panelLive && t < T.sprawdzic + 0.3 ? (
      <Place x={O.x + 262} y={O.y + 850} w={466} h={196} z={90} rz={-2} s={callIn} opacity={1 - ramp(t, STEP.clickLink - 0.1, STEP.clickLink + 0.2)}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 26,
            background: "rgba(10,16,36,0.95)",
            border: `2px solid ${C.pink}`,
            boxShadow: "0 30px 60px rgba(0,0,0,0.45), 0 0 40px rgba(249,80,225,0.35)",
            padding: "26px 30px",
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            lineHeight: 1.12,
          }}
        >
          <div style={{ fontSize: 41, color: C.pink, whiteSpace: "nowrap" }}>To filtr wyników,</div>
          <div style={{ fontSize: 41, color: C.white, whiteSpace: "nowrap" }}>nie gwarancja praw.</div>
        </div>
      </Place>
    ) : null;

  // ------------------------------------------------------------- cursor path over the controls
  const tgt = (k: keyof typeof GOOGLE_TARGETS, dx = 0, dy = 0) => benchPoint(GOOGLE_TARGETS[k].x + dx, GOOGLE_TARGETS[k].y + dy);
  const lr = thumbRect(LINK_THUMB, 1);
  const thumbLink = benchPoint(lr.x + 120, lr.y + lr.h - 38);
  const pts: { t: number; p: { x: number; y: number } }[] = [
    { t: STEP.cursorIn, p: benchPoint(760, 900) },
    { t: STEP.clickGrafika - 0.08, p: tgt("grafika", 10, 8) },
    { t: STEP.clickNarzedzia - 0.12, p: tgt("narzedzia", 10, 8) },
    { t: STEP.clickRights - 0.1, p: tgt("rights", 30, 8) },
    { t: STEP.clickCC - 0.1, p: tgt("cc", 0, 8) },
    { t: STEP.clickLink - 0.08, p: { x: thumbLink.x + 40, y: thumbLink.y + 6 } },
  ];
  let cp = pts[0].p;
  for (let i = 1; i < pts.length; i++) {
    if (t >= pts[i - 1].t) {
      const pp = E.inOut(lin(t, pts[i - 1].t + 0.05, pts[i].t));
      cp = { x: mix(pts[i - 1].p.x, pts[i].p.x, pp), y: mix(pts[i - 1].p.y, pts[i].p.y, pp) - 40 * Math.sin(Math.PI * pp) };
    }
  }
  const clicks = [STEP.clickGrafika, STEP.clickNarzedzia, STEP.clickRights, STEP.clickCC, STEP.clickLink];
  const lastClick = clicks.filter((c) => t >= c).pop() ?? -10;
  const cursor =
    panelLive && t < STEP.clickLink + 0.45 ? (
      <Cursor x={cp.x} y={cp.y} z={110} opacity={ramp(t, STEP.cursorIn, STEP.cursorIn + 0.2) * (1 - ramp(t, STEP.clickLink + 0.2, STEP.clickLink + 0.4))} pressed={Math.max(...clicks.map((c) => pulse(t, c, 0.07)))} ripple={lin(t, lastClick, lastClick + 0.35)} />
    ) : null;

  return (
    <>
      <FlyingPhoto id="tb" flights={[TO_BENCH]} t={t} />
      {editWindow}
      {cards}
      {rows}
      {flipCard}
      {panel}
      {callout}
      {cursor}
    </>
  );
};

/** One of the three edited forms of the same drawing. */
const EditCard: React.FC<{ k: 0 | 1 | 2; t: number; size: number }> = ({ k, t, size }) => {
  const crop = k === 0 ? E.inOut(lin(t, SPLIT.crop[0], SPLIT.crop[1])) : k > 0 ? 1 : 0;
  const cropApply = k === 0 ? E.inOut(lin(t, SPLIT.crop[1] - 0.05, SPLIT.crop[1] + 0.3)) : 1;
  const erase = k === 1 ? E.inOut(lin(t, SPLIT.erase[0], SPLIT.erase[1])) : k === 2 ? 1 : 0;
  const ai = k === 2 ? E.inOut(lin(t, SPLIT.ai[0], SPLIT.ai[1])) : 0;
  // crop rect (0..350 units)
  const cr = { x: mix(0, 62, crop), y: mix(0, 40, crop), w: mix(350, 226, crop), h: mix(350, 270, crop) };
  const zoomS = mix(1, 1.32, cropApply);
  const zoom = { s: zoomS, cx: mix(175, cr.x + cr.w / 2, cropApply), cy: mix(175, cr.y + cr.h / 2, cropApply) };
  const scale = size / 350;
  const sweep = k === 1 ? lin(t, SPLIT.erase[0], SPLIT.erase[1]) : k === 2 ? lin(t, SPLIT.ai[0], SPLIT.ai[1]) : -1;
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 26, overflow: "hidden", background: "#fff", boxShadow: "0 30px 70px rgba(0,0,0,0.5), 0 0 0 3px rgba(255,255,255,0.9)" }}>
      <Vase id={`ed${k}`} look={LOOKS.hero} bgAlpha={1 - erase} ai={ai} zoom={zoom} />
      {/* crop UI */}
      {k === 0 && crop > 0 && cropApply < 1 ? (
        <svg viewBox="0 0 350 350" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 1 - cropApply }}>
          <path d={`M0 0 H350 V350 H0Z M${cr.x} ${cr.y} V${cr.y + cr.h} H${cr.x + cr.w} V${cr.y}Z`} fill="rgba(8,12,28,0.55)" fillRule="evenodd" />
          <rect x={cr.x} y={cr.y} width={cr.w} height={cr.h} fill="none" stroke={C.pink} strokeWidth={5 / scale > 6 ? 6 : 5} />
          {[
            [cr.x, cr.y],
            [cr.x + cr.w, cr.y],
            [cr.x, cr.y + cr.h],
            [cr.x + cr.w, cr.y + cr.h],
          ].map(([x, y], i) => (
            <rect key={i} x={x - 9} y={y - 9} width={18} height={18} fill="#fff" stroke={C.pink} strokeWidth={4} />
          ))}
          <path d={`M${cr.x + cr.w / 3} ${cr.y} V${cr.y + cr.h} M${cr.x + (2 * cr.w) / 3} ${cr.y} V${cr.y + cr.h} M${cr.x} ${cr.y + cr.h / 3} H${cr.x + cr.w} M${cr.x} ${cr.y + (2 * cr.h) / 3} H${cr.x + cr.w}`} stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
        </svg>
      ) : null}
      {/* scan line for erase / AI */}
      {sweep > 0 && sweep < 1 ? (
        <div
          style={{
            position: "absolute",
            top: -20,
            bottom: -20,
            left: `${sweep * 120 - 10}%`,
            width: 36,
            background: k === 1 ? "linear-gradient(90deg, transparent, rgba(114,233,194,0.9), transparent)" : "linear-gradient(90deg, transparent, rgba(249,80,225,0.95), transparent)",
            transform: "skewX(-12deg)",
            boxShadow: k === 1 ? "0 0 30px rgba(114,233,194,0.8)" : "0 0 40px rgba(249,80,225,0.9)",
          }}
        />
      ) : null}
      {k === 2 && ai > 0 ? (
        <div
          style={{
            position: "absolute",
            right: 16,
            top: 16,
            width: 74,
            height: 74,
            borderRadius: 37,
            background: "linear-gradient(135deg,#F950E1,#8A3FFF)",
            color: "#fff",
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${E.outBack(Math.min(1, ai * 2))})`,
            boxShadow: "0 8px 20px rgba(138,63,255,0.5)",
          }}
        >
          AI
        </div>
      ) : null}
    </div>
  );
};

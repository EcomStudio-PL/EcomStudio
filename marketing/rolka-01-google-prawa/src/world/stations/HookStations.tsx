import React from "react";
import { C, FONT_DISPLAY } from "../../config";
import { E, lin, mix, pulse, ramp, rand, sp, window01 } from "../../lib/anim";
import { T } from "../../data/timeline";
import { GoogleUI, HERO_INDEX } from "../../components/GoogleUI";
import { EnvCard, SLOT } from "../../components/EnvCards";
import { LOOKS, Vase } from "../../components/Vase";
import { WarningObject } from "../../components/Icons";
import { browserThumb, slotCenter, ST } from "../layout";
import { Cursor, Flight, FlyingPhoto, flightState, Place } from "../primitives";

const wwwSlot = slotCenter("www");
const shopSlot = slotCenter("shop");
const socialSlot = slotCenter("social");
const heroThumb = browserThumb(HERO_INDEX);

export const DRAG: Flight = {
  t0: T.grab + 0.1,
  t1: T.drop,
  from: heroThumb,
  to: wwwSlot,
  arc: { x: 360, y: 700 },
  lift: 260,
  lean: 10,
  pre: 0.14,
  post: 0.12,
  ease: E.glide,
};
export const HOP_SHOP: Flight = { t0: T.sklepie - 0.26, t1: T.sklepie + 0.08, from: wwwSlot, to: shopSlot, arc: { x: 260, y: 1700 }, lift: 200, lean: 9 };
export const HOP_SOCIAL: Flight = { t0: T.social - 0.26, t1: T.social + 0.08, from: shopSlot, to: socialSlot, arc: { x: -260, y: 2300 }, lift: 200, lean: 9 };

const inCTA = (t: number) => t > T.zapisz - 0.2;

export const HookStations: React.FC<{ t: number }> = ({ t }) => {
  const showTop = t < 9.2 || inCTA(t);
  const showStack = t < 14.6 || inCTA(t);

  // --- Google Grafika browser
  const browser = showTop ? (
    <Place {...ST.browser} rx={0} opacity={1}>
      <GoogleUI
        id="br"
        typed={ramp(t, -0.35, 0.3, E.linear)}
        caret={t < 0.75 && Math.floor(t * 4) % 2 === 0}
        resultsIn={ramp(t, -0.25, 0.5, E.linear)}
        hoverThumb={{ i: HERO_INDEX, v: ramp(t, 0.5, 0.72) * (t < T.grab + 0.05 ? 1 : 0) }}
        heroSlotEmpty={t >= T.grab}
        detach={inCTA(t) ? 0.35 : ramp(t, T.googleOnly + 0.1, T.wyszukuje + 0.95, E.inOut)}
        dim={0.25 * ramp(t, T.toNie, T.swobodnie)}
        time={t}
      />
    </Place>
  ) : null;

  // --- Publishing environments
  const wwwRisk = ramp(t, T.uwazaj, T.uwazaj + 0.4, E.out);
  const stack = showStack ? (
    <>
      <Place {...ST.www}>
        <EnvCard
          kind="www"
          id="www"
          photo={t >= T.drop ? 1 : 0}
          risk={wwwRisk}
          riskPulse={pulse(t, T.uwazaj + 0.15, 0.35) + pulse(t, T.slono + 0.3, 0.45) * 0.8 + pulse(t, T.stronie + 0.1, 0.3)}
          badge={sp(t, T.stronie + 0.05, { damping: 11 })}
          focus={window01(t, T.stronie - 0.15, T.sklepie - 0.2, 0.15, 0.25)}
        />
      </Place>
      <Place {...ST.shop}>
        <EnvCard
          kind="shop"
          id="shop"
          photo={t >= HOP_SHOP.t1 ? 1 : 0}
          dropHint={window01(t, T.swobodnie - 0.1, HOP_SHOP.t1 + 0.1, 0.25, 0.15) * (0.75 + 0.25 * Math.sin(t * 9))}
          risk={ramp(t, HOP_SHOP.t1 + 0.04, HOP_SHOP.t1 + 0.4)}
          riskPulse={pulse(t, HOP_SHOP.t1 + 0.12, 0.3)}
          badge={sp(t, HOP_SHOP.t1 + 0.1, { damping: 11 })}
          focus={window01(t, T.sklepie - 0.15, T.social - 0.2, 0.15, 0.25)}
        />
      </Place>
      <Place {...ST.social}>
        <EnvCard
          kind="social"
          id="social"
          photo={t >= HOP_SOCIAL.t1 ? 1 : 0}
          dropHint={window01(t, T.swobodnie + 0.15, HOP_SOCIAL.t1 + 0.1, 0.25, 0.15) * (0.75 + 0.25 * Math.sin(t * 9 + 1))}
          risk={ramp(t, HOP_SOCIAL.t1 + 0.04, HOP_SOCIAL.t1 + 0.4)}
          riskPulse={pulse(t, HOP_SOCIAL.t1 + 0.12, 0.3) + pulse(t, T.iUwaga + 0.14, 0.2) * 1.2}
          badge={sp(t, HOP_SOCIAL.t1 + 0.1, { damping: 11 })}
          focus={window01(t, T.social - 0.15, T.iUwaga + 0.6, 0.15, 0.25)}
        />
      </Place>
    </>
  ) : null;

  // --- HOOK: alarm accents on the website copy
  const alarmIn = sp(t, T.uwazaj, { damping: 9, stiffness: 220 });
  const tagIn = sp(t, T.wykorzystanie - 0.05, { damping: 12, stiffness: 200 });
  const hookExtras =
    t > T.uwazaj - 0.05 && t < T.zdjeciaEnd ? (
      <>
        {/* warning object from the package */}
        <Place x={wwwSlot.x + SLOT / 2 + 4} y={wwwSlot.y - SLOT / 2 - 6} w={150} h={150} z={70} s={alarmIn * (1 + 0.08 * Math.sin(t * 14) * (t < T.hookEnd ? 1 : 0))} rz={-8 + 8 * alarmIn}>
          <WarningObject size={150} />
        </Place>
        {/* PRAWA AUTORSKIE? tag hanging from the frame */}
        <Place x={wwwSlot.x - 18} y={wwwSlot.y - SLOT / 2 - 66} w={380} h={78} z={60} rz={-5} s={tagIn} opacity={window01(t, T.wykorzystanie - 0.05, T.zdjeciaEnd, 0.05, 0.4)}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 18,
              background: C.red,
              color: "#fff",
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 40,
              letterSpacing: 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 18px 40px rgba(255,59,92,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            PRAWA AUTORSKIE?
          </div>
        </Place>
        <Glitch t={t} />
      </>
    ) : null;

  // --- cursor (hook): enters, hovers, grabs, drags, releases
  const drag = flightState(DRAG, t);
  const cursorPos = (() => {
    const start = { x: heroThumb.x + 330, y: heroThumb.y + 520 };
    const target = { x: heroThumb.x + 30, y: heroThumb.y + 20 };
    if (t < T.grab) {
      const p = E.out(lin(t, 0.0, 0.72));
      return { x: mix(start.x, target.x, p), y: mix(start.y, target.y, p) - 60 * Math.sin(Math.PI * p) };
    }
    if (drag) return { x: drag.x + 30, y: drag.y + 20 };
    const p = E.out(lin(t, T.drop + 0.12, T.drop + 0.7));
    return { x: wwwSlot.x + 30 + 220 * p, y: wwwSlot.y + 20 + 160 * p };
  })();
  const cursor = (
    <Cursor
      x={cursorPos.x}
      y={cursorPos.y}
      z={drag ? (drag.z ?? 0) + 30 : 60}
      opacity={t < 0.12 ? lin(t, -0.05, 0.12) : 1 - lin(t, T.drop + 0.35, T.drop + 0.7)}
      pressed={drag ? 1 : pulse(t, T.grab, 0.08)}
      ripple={lin(t, T.grab, T.grab + 0.35)}
    />
  );

  return (
    <>
      {browser}
      {stack}
      <FlyingPhoto id="fly" flights={[DRAG, HOP_SHOP, HOP_SOCIAL]} t={t} />
      {hookExtras}
      {t < T.drop + 0.8 ? cursor : null}
    </>
  );
};

/** RGB split + slice displacement on the website photo — only at the alarm (spec: glitch only at the alarm). */
const Glitch: React.FC<{ t: number }> = ({ t }) => {
  const g = lin(t, T.uwazaj - 0.02, T.uwazaj + 0.32);
  if (g <= 0 || g >= 1) return null;
  const amp = Math.sin(Math.PI * g) * 26;
  const k = Math.floor(t * 30);
  const slices = [0, 1, 2, 3, 4].map((i) => ({ top: rand(k * 7 + i) * 0.85, h: 0.04 + rand(k * 3 + i) * 0.12, dx: (rand(k * 11 + i) - 0.5) * amp * 2.4 }));
  return (
    <Place x={wwwSlot.x} y={wwwSlot.y} w={SLOT} h={SLOT} z={4}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 26, overflow: "hidden" }}>
        {/* RGB split without blend modes: tinted copies offset left/right */}
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${amp}px)`, opacity: 0.55 }}>
          <Vase id="gl-r" look={LOOKS.hero} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,32,80,0.55)" }} />
        </div>
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${-amp}px)`, opacity: 0.4 }}>
          <Vase id="gl-c" look={LOOKS.hero} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(32,224,255,0.5)" }} />
        </div>
        {slices.map((s, i) => (
          <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${s.top * 100}%`, height: `${s.h * 100}%`, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: s.dx, top: `${-s.top * SLOT}px`, width: SLOT, height: SLOT }}>
              <Vase id={`gl-s${i}`} look={LOOKS.hero} />
            </div>
          </div>
        ))}
        <div style={{ position: "absolute", inset: 0, background: `rgba(255,40,80,${0.25 * Math.sin(Math.PI * g)})` }} />
      </div>
    </Place>
  );
};

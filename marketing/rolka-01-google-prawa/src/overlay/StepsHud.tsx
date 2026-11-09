import React from "react";
import { C, FONT_DISPLAY, WIDTH } from "../config";
import { T } from "../data/timeline";
import { E, ramp, sp } from "../lib/anim";
import { BENCH_CLICKS } from "../world/stations/Bench";

// GOOGLE_UI_KROKI — the verified path, step by step: Grafika → Narzędzia → Prawa użytkowania.
const STEPS = [
  { label: "GRAFIKA", t0: BENCH_CLICKS.clickGrafika - 0.25 },
  { label: "NARZĘDZIA", t0: BENCH_CLICKS.clickNarzedzia - 0.12 },
  { label: "PRAWA UŻYTKOWANIA", t0: BENCH_CLICKS.clickRights - 0.12 },
];

export const StepsHud: React.FC<{ t: number }> = ({ t }) => {
  const t0 = T.wejdz - 0.1;
  const t1 = T.pamietaj + 0.25;
  if (t < t0 || t > t1) return null;
  const inP = ramp(t, t0, t0 + 0.3, E.out);
  const outP = ramp(t, t1 - 0.25, t1, E.in);
  let cur = 0;
  STEPS.forEach((s, i) => {
    if (t >= s.t0) cur = i;
  });
  return (
    <div style={{ position: "absolute", left: 0, width: WIDTH, top: 196, display: "flex", flexDirection: "column", alignItems: "center", opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * -30 - outP * 30}px)` }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 22px", borderRadius: 40, background: "rgba(6,11,26,0.8)", boxShadow: "0 12px 30px rgba(0,0,0,0.4)" }}>
        {STEPS.map((s, i) => {
          const done = t >= s.t0;
          const fill = ramp(t, s.t0, s.t0 + 0.3, E.out);
          return (
            <React.Fragment key={s.label}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 28,
                  color: done ? "#fff" : "#7F89A6",
                  background: done ? "linear-gradient(135deg,#F950E1,#8A3FFF)" : "rgba(255,255,255,0.06)",
                  border: done ? "none" : "2px solid rgba(255,255,255,0.15)",
                  transform: `scale(${1 + 0.18 * (i === cur ? Math.sin(Math.PI * Math.min(1, fill)) : 0)})`,
                }}
              >
                {i + 1}
              </div>
              {i < 2 ? (
                <div style={{ width: 70, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                  <div style={{ width: `${100 * ramp(t, STEPS[i + 1].t0 - 0.2, STEPS[i + 1].t0 + 0.1)}%`, height: "100%", background: C.pink }} />
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ position: "relative", marginTop: 18, height: 104, width: WIDTH, perspective: 800 }}>
        {STEPS.map((s, i) => {
          const a = sp(t, s.t0, { damping: 16, stiffness: 180 });
          const next = STEPS[i + 1];
          const out = next ? ramp(t, next.t0 - 0.05, next.t0 + 0.2, E.in) : 0;
          if (t < s.t0 - 0.02 || out >= 1) return null;
          const isRights = i === 2;
          return (
            <div
              key={s.label}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                display: "flex",
                justifyContent: "center",
                transform: `rotateX(${(1 - a) * -70 + out * 70}deg) translateY(${out * -20}px)`,
                transformOrigin: "50% 50%",
                opacity: Math.min(1, a * 1.6) * (1 - out),
              }}
            >
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: isRights ? 80 : 74,
                  lineHeight: 1.1,
                  color: isRights ? C.pink : C.white,
                  padding: "4px 28px 10px",
                  borderRadius: 26,
                  background: "rgba(6,11,26,0.78)",
                  textShadow: isRights ? "0 0 30px rgba(249,80,225,0.55)" : "none",
                  whiteSpace: "nowrap",
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};


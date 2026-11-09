import React from "react";
import { AbsoluteFill } from "remotion";
import { E, clamp01, spr, track, tw } from "../lib/anim";
import { CUE } from "../timing";
import { Kinetic, NotEqual } from "../components/Kinetic";
import { Scrim } from "../components/Bits";
import { FONT_DISPLAY, FONT_MONO } from "../lib/fonts";
import { C } from "../lib/theme";

/**
 * 13.40–20.40 s — why the marker fails. The brightness/contrast filter is a REAL
 * CSS filter applied to the rendered pixels of the screenshot + marker layer
 * (alpha 0.78): the digits re-appear only because they are still in the pixels.
 */
export const DemoFront: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 392 || frame > 640) return null;
  const panelIn = spr(frame, 466, { damping: 17, stiffness: 120 });
  const panelOut = tw(frame, 604, 620, 0, 1, E.in);
  const bright = Math.round(track(frame, [[CUE.jasnosc, 0], [CUE.jasnosc + 22, 60, E.inOut], [606, 60], [620, 0]]));
  const contr = Math.round(track(frame, [[CUE.kontrast, 0], [CUE.kontrast + 26, 85, E.inOut], [606, 85], [620, 0]]));
  const neq = tw(frame, CUE.widoczny, CUE.widoczny + 16, 0, 1, E.out);
  return (
    <AbsoluteFill>
      <Scrim top={0} height={700} opacity={Math.min(tw(frame, 396, 410), 1 - tw(frame, 612, 630))} />
      <Kinetic
        frame={frame}
        x={100}
        y={290}
        exitAt={552}
        lines={[
          {
            size: 60,
            weight: 800,
            words: [
              { t: "NIEKTÓRE", at: CUE.niektore },
              { t: "MARKERY", at: CUE.markerySa },
              { t: "SĄ", at: CUE.markerySa + 7 },
            ],
          },
          { size: 86, weight: 900, gap: 10, words: [{ t: "PÓŁPRZEZROCZYSTE", at: CUE.polprzezroczyste, grad: true }] },
        ]}
      />
      {/* MARKER ≠ USUNIĘCIE DANYCH */}
      {frame >= CUE.widoczny - 2 && (
        <div style={{ position: "absolute", left: 100, top: 292, width: 880, opacity: 1 - tw(frame, 610, 624) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Kinetic frame={frame} x={0} y={0} width={420} lines={[{ size: 92, weight: 900, words: [{ t: "MARKER", at: CUE.widoczny }] }]} />
            <div style={{ position: "absolute", left: 400, top: -4, transform: `scale(${0.6 + 0.4 * neq})` }}>
              <NotEqual size={100} p={neq} />
            </div>
          </div>
          <div style={{ position: "absolute", top: 108, left: 0 }}>
            <Kinetic
              frame={frame}
              x={0}
              y={0}
              width={880}
              lines={[{ size: 80, weight: 900, words: [{ t: "USUNIĘCIE", at: CUE.widoczny + 6, grad: true }, { t: "DANYCH", at: CUE.widoczny + 10, grad: true }] }]}
            />
          </div>
          <div
            style={{
              position: "absolute",
              top: 214,
              left: 0,
              fontFamily: FONT_MONO,
              fontWeight: 500,
              fontSize: 27,
              letterSpacing: 1,
              color: C.inkDim,
              opacity: tw(frame, CUE.widoczny + 12, CUE.widoczny + 22),
            }}
          >
            * w niektórych przypadkach · dane fikcyjne
          </div>
        </div>
      )}
      {/* Demo adjustment panel — generic, not a real app */}
      {panelIn > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: 110,
            top: 1318,
            width: 860,
            height: 300,
            borderRadius: 40,
            background: "linear-gradient(180deg, rgba(30,34,56,0.94) 0%, rgba(16,18,32,0.96) 100%)",
            border: "2px solid rgba(255,255,255,0.12)",
            boxShadow: "0 40px 90px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)",
            transform: `perspective(1400px) translateY(${(1 - panelIn) * 380 + panelOut * 420}px) rotateX(${(1 - panelIn) * 28}deg)`,
            opacity: clamp01(panelIn * 2) * (1 - panelOut),
            padding: "30px 46px",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 25, letterSpacing: 3, color: C.inkMute }}>EDYCJA ZDJĘCIA · DEMO</div>
          <Slider label="JASNOŚĆ" value={bright} max={100} active={frame >= CUE.jasnosc && frame < CUE.jasnosc + 26} y={30} />
          <Slider label="KONTRAST" value={contr} max={100} active={frame >= CUE.kontrast && frame < CUE.kontrast + 30} y={30} />
        </div>
      )}
    </AbsoluteFill>
  );
};

const Slider: React.FC<{ label: string; value: number; max: number; active: boolean; y: number }> = ({ label, value, max, active, y }) => {
  const k = value / max;
  const W = 390;
  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: y, height: 70 }}>
      <div style={{ width: 250, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 42, letterSpacing: -0.5, color: C.ink }}>{label}</div>
      <div style={{ position: "relative", width: W, height: 70 }}>
        <div style={{ position: "absolute", left: 0, top: 31, width: W, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.14)" }} />
        <div style={{ position: "absolute", left: 0, top: 31, width: W * k, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${C.pink}, ${C.pinkHot})` }} />
        <div
          style={{
            position: "absolute",
            left: W * k - 22,
            top: 13,
            width: 44,
            height: 44,
            borderRadius: 22,
            background: "#FFFFFF",
            boxShadow: active ? `0 0 0 10px rgba(249,80,225,0.28), 0 6px 16px rgba(0,0,0,0.5)` : "0 6px 16px rgba(0,0,0,0.5)",
          }}
        />
      </div>
      <div style={{ width: 110, textAlign: "right", fontFamily: FONT_MONO, fontWeight: 700, fontSize: 36, color: value > 0 ? C.pinkHot : C.inkMute }}>
        +{value}
      </div>
    </div>
  );
};

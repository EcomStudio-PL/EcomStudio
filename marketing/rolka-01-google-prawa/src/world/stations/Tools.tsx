import React from "react";
import { Img, staticFile } from "remotion";
import { C, FONT_BODY, FONT_DISPLAY } from "../../config";
import { E, lin, mix, pulse, ramp, sp, window01 } from "../../lib/anim";
import { T } from "../../data/timeline";
import { LOOKS, Vase } from "../../components/Vase";
import { IconCamera, IconCheck, IconDoc, IconSearch, IconSparkle, IconX, LicenseCheckObject } from "../../components/Icons";
import { ST, tl } from "../layout";
import { Place } from "../primitives";

// TRZY_NARZEDZIA_AI → PRAWA_MATERIALOW_WEJSCIOWYCH (one station, layout morphs).
// Equal cards for ChatGPT / Gemini / GrovBase (names as text; GrovBase = the ORIGINAL logo file).

const S = ST.tools;
const O = tl(S);
const P = (lx: number, ly: number) => ({ x: O.x + lx, y: O.y + ly });
const LOGO_RATIO = 3256 / 706;

const PROMPT = "zdjęcie produktowe: wazon, jasne studio";

const TOOLS = [
  { name: "ChatGPT", sub: "Generowanie obrazów", t0: T.chatgpt },
  { name: "Gemini", sub: "Tworzenie grafik AI", t0: T.gemini },
  { name: "GrovBase", sub: "Zdjęcia produktowe", t0: T.grovbase },
];
const CARD_Y = [810, 1015, 1220];

// phase times
const PH = {
  promptIn: T.aJesli + 0.05,
  typing: [T.aJesli + 0.3, T.wlasnych + 0.55],
  send: T.mozesz - 0.05,
  gen: [T.mozesz + 0.05, T.chatgpt - 0.1],
  focusGB: T.specjalizuje - 0.1,
  logo: [T.produktowych - 0.05, T.toolsEnd + 0.25],
  toDiagram: [T.toolsEnd + 0.3, T.pamietajTylko + 0.55],
  inputs: T.pamietajTylko + 0.55,
  okA: T.masz + 0.05,
  okB: T.odpowiednie + 0.08,
  noC: T.prawaIn - 0.02,
  terms: T.sprawdzac - 0.25,
  ticks: [T.warunkiUz + 0.05, T.warunkiUz + 0.42, T.narzedziEnd - 0.45],
};
export const TOOLS_PH = PH;

export const Tools: React.FC<{ t: number }> = ({ t }) => {
  const inCTA = t > T.zapisz - 0.2;
  if (t < T.licEnd - 0.2) return null;
  const tt = inCTA ? T.narzedziEnd : t; // frozen final state in the CTA overview
  const toolsPhase = tt < PH.toDiagram[1];
  const diag = ramp(tt, PH.toDiagram[0], PH.toDiagram[1], E.inOut);
  return (
    <>
      {toolsPhase ? <ToolsLayer t={tt} /> : null}
      {diag > 0 ? <DiagramLayer t={tt} v={diag} /> : null}
      <LogoFlight t={tt} />
    </>
  );
};

// ---------------------------------------------------------------- phase 1: prompt, own graphic, 3 tools
const ToolsLayer: React.FC<{ t: number }> = ({ t }) => {
  const exitP = ramp(t, PH.logo[0], PH.logo[0] + 0.35, E.inOut);
  const leave = ramp(t, PH.toDiagram[0], PH.toDiagram[1], E.in);
  const dimOthers = 1 - 0.75 * exitP;
  const promptIn = sp(t, PH.promptIn, { damping: 16 });
  const typed = Math.round(PROMPT.length * lin(t, PH.typing[0], PH.typing[1]));
  const gen = lin(t, PH.gen[0], PH.gen[1]);
  const reveal = E.out(lin(t, PH.gen[1] - 0.15, PH.gen[1] + 0.35));
  const gb = window01(t, PH.focusGB, PH.logo[0] + 0.2, 0.3, 0.2);
  const labelIn = sp(t, T.aJesli + 0.1, { damping: 16 });
  return (
    <>
      {/* label */}
      <Place {...P(470, 66)} w={520} h={72} z={20} s={labelIn} opacity={dimOthers * (1 - leave)}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 36, background: "rgba(249,80,225,0.14)", border: `2px solid ${C.pink}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 36, color: C.white, whiteSpace: "nowrap" }}>
          <IconSparkle size={30} color={C.pink} />
          WŁASNE GRAFIKI
        </div>
      </Place>
      {/* prompt bar with horizon glow */}
      <Place {...P(470, 180)} w={860} h={100} z={10} opacity={Math.min(1, promptIn * 1.4) * dimOthers * (1 - leave)} s={mix(0.9, 1, promptIn)}>
        <div style={{ position: "absolute", left: 40, right: 40, top: 70, height: 90, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(249,80,225,0.55), transparent)", filter: "blur(18px)" }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 50,
            background: "rgba(12,18,40,0.92)",
            border: "2px solid rgba(249,80,225,0.6)",
            boxShadow: "0 0 40px rgba(214,40,207,0.35), inset 0 0 30px rgba(138,63,255,0.15)",
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "0 26px",
            fontFamily: FONT_BODY,
          }}
        >
          <span style={{ fontSize: 40, color: "#AEB8D6", fontWeight: 300 }}>+</span>
          <span style={{ fontSize: 33, color: C.white, whiteSpace: "nowrap", flex: 1, overflow: "hidden" }}>
            {PROMPT.slice(0, typed)}
            {t < PH.send && Math.floor(t * 4) % 2 === 0 ? <span style={{ display: "inline-block", width: 3, height: 32, background: C.pink, marginLeft: 3, verticalAlign: -5 }} /> : null}
          </span>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              background: "linear-gradient(135deg,#F950E1,#8A3FFF)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `scale(${1 - 0.15 * pulse(t, PH.send, 0.08)})`,
              boxShadow: `0 0 ${20 + 30 * pulse(t, PH.send, 0.2)}px rgba(249,80,225,0.7)`,
            }}
          >
            <IconSparkle size={30} color="#fff" />
          </div>
        </div>
      </Place>
      {/* own graphic canvas */}
      <Place {...P(470, 470)} w={430} h={430} z={20} opacity={Math.min(1, promptIn * 1.4) * dimOthers * (1 - leave)}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 30, overflow: "hidden", background: "rgba(255,255,255,0.04)", border: reveal < 1 ? "3px dashed rgba(174,184,214,0.5)" : "none", boxShadow: reveal > 0 ? `0 30px 70px rgba(0,0,0,${0.5 * reveal})` : undefined }}>
          {gen > 0 && reveal < 1 ? (
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(120deg, transparent ${gen * 140 - 40}%, rgba(249,80,225,0.35) ${gen * 140 - 20}%, transparent ${gen * 140}%)` }} />
          ) : null}
          {gen > 0 && reveal < 1 ? (
            <svg viewBox="0 0 100 100" style={{ position: "absolute", left: 160, top: 160, width: 110, height: 110 }}>
              <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
              <circle cx="50" cy="50" r="36" fill="none" stroke={C.pink} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${226 * gen} 226`} transform="rotate(-90 50 50)" />
            </svg>
          ) : null}
          {reveal > 0 ? (
            <div style={{ position: "absolute", inset: 0, clipPath: `circle(${reveal * 75}% at 50% 50%)` }}>
              <Vase id="own" look={LOOKS.studio} ai={0.55} />
            </div>
          ) : null}
        </div>
      </Place>
      {/* tool cards */}
      {TOOLS.map((tool, i) => {
        const v = sp(t, tool.t0 - 0.04, { damping: 15, stiffness: 150 });
        if (v <= 0) return null;
        const isGB = i === 2;
        const focus = isGB ? gb : 0;
        const fade = isGB ? 1 : dimOthers;
        const gbExit = isGB ? exitP : 0;
        return (
          <Place key={tool.name} {...P(470, CARD_Y[i])} w={860} h={180} z={-300 * (1 - v) + 50 * focus} rx={-60 * (1 - v)} s={1 + 0.03 * focus} opacity={Math.min(1, v * 1.5) * fade * (1 - leave)}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 30,
                background: "linear-gradient(150deg, #19264A 0%, #111B36 100%)",
                border: `2px solid ${focus > 0.05 ? `rgba(249,80,225,${0.4 + 0.6 * focus})` : "rgba(120,140,190,0.35)"}`,
                boxShadow: `0 30px 60px rgba(0,0,0,0.45)${focus > 0 ? `, 0 0 ${50 * focus}px rgba(249,80,225,${0.45 * focus})` : ""}`,
                fontFamily: FONT_BODY,
              }}
            >
              {isGB ? (
                <div style={{ position: "absolute", left: 40, top: 32, height: 66, width: 66 * LOGO_RATIO, opacity: 1 - gbExit }}>
                  <Img src={staticFile("brand/grovbase_pink_white.png")} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
              ) : (
                <div style={{ position: "absolute", left: 40, top: 26, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 66, color: C.white, whiteSpace: "nowrap", lineHeight: 1.1 }}>{tool.name}</div>
              )}
              <div style={{ position: "absolute", left: 42, top: 112, fontSize: 32, color: focus > 0.4 ? C.pink : "#A3AECB", fontWeight: focus > 0.4 ? 700 : 500, whiteSpace: "nowrap" }}>{tool.sub}</div>
              {isGB && focus > 0 ? (
                <div style={{ position: "absolute", right: 30, top: 30, display: "flex", gap: 12 }}>
                  {[LOOKS.hero, LOOKS.blush, LOOKS.mint].map((lk, j) => {
                    const a = sp(t, PH.focusGB + 0.15 + j * 0.1, { damping: 14 });
                    return (
                      <div key={j} style={{ width: 120, height: 120, borderRadius: 18, overflow: "hidden", transform: `translateY(${(1 - a) * 30}px) scale(${a})`, boxShadow: "0 10px 24px rgba(0,0,0,0.4)", opacity: 1 - gbExit }}>
                        <Vase id={`gbp${j}`} look={lk} vaseScale={1.1} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ position: "absolute", right: 34, top: 56, height: 68, width: 120, borderRadius: 16, background: isGB ? "#4A2D57" : "#26355A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 34, color: C.pink }}>AI</div>
              )}
            </div>
          </Place>
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------- GrovBase logo: card → hero lockup → tool chip
const LogoFlight: React.FC<{ t: number }> = ({ t }) => {
  if (t < PH.logo[0] || t > T.narzedziEnd + 1) return null;
  const up = E.inOut(lin(t, PH.logo[0], PH.logo[0] + 0.45));
  const down = E.inOut(lin(t, PH.toDiagram[0], PH.toDiagram[1]));
  const card = { x: 80 + (66 * LOGO_RATIO) / 2, y: CARD_Y[2] - 90 + 32 + 33, w: 66 * LOGO_RATIO };
  const hero = { x: 470, y: 640, w: 780 };
  const chip = { x: 740, y: 700, w: 190 };
  const x = down > 0 ? mix(hero.x, chip.x, down) : mix(card.x, hero.x, up);
  const y = down > 0 ? mix(hero.y, chip.y, down) : mix(card.y, hero.y, up);
  const w = down > 0 ? mix(hero.w, chip.w, down) : mix(card.w, hero.w, up);
  const shine = lin(t, PH.logo[0] + 0.35, PH.logo[0] + 0.95);
  const p = P(x, y);
  const glow = (1 - down) * up;
  return (
    <Place x={p.x} y={p.y} w={w} h={w / LOGO_RATIO} z={80 + 120 * Math.sin(Math.PI * up) * (1 - down)}>
      {glow > 0.02 ? <div style={{ position: "absolute", left: "-15%", right: "-15%", top: "-60%", bottom: "-60%", borderRadius: "50%", background: `radial-gradient(closest-side, rgba(214,40,207,${0.45 * glow}), transparent)` }} /> : null}
      <Img src={staticFile("brand/grovbase_pink_white.png")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
      {shine > 0 && shine < 1 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            WebkitMaskImage: `url(${staticFile("brand/grovbase_pink_white.png")})`,
            WebkitMaskSize: "100% 100%",
            maskImage: `url(${staticFile("brand/grovbase_pink_white.png")})`,
            maskSize: "100% 100%",
            background: `linear-gradient(105deg, transparent ${shine * 160 - 50}%, rgba(255,255,255,0.85) ${shine * 160 - 35}%, transparent ${shine * 160 - 20}%)`,
          }}
        />
      ) : null}
    </Place>
  );
};

// ---------------------------------------------------------------- phase 2: inputs → tool → terms
const INPUTS = [
  { label: "Twoje zdjęcie", look: LOOKS.hero, ok: true, icon: "cam" as const },
  { label: "Z licencją", look: LOOKS.sage, ok: true, icon: "doc" as const },
  { label: "Nieznane źródło", look: LOOKS.lavender, ok: false, icon: "q" as const },
];
const IN_X = [175, 470, 765];
const IN_Y = 250;

const DiagramLayer: React.FC<{ t: number; v: number }> = ({ t, v }) => {
  const labelIn = sp(t, PH.toDiagram[0] + 0.1, { damping: 16 });
  const rowIn = sp(t, PH.toDiagram[0] + 0.05, { damping: 16 });
  const termsIn = sp(t, PH.terms, { damping: 16, stiffness: 140 });
  const arrowsA = E.inOut(lin(t, PH.noC + 0.15, PH.noC + 0.6));
  const arrowsB = E.inOut(lin(t, PH.terms + 0.05, PH.terms + 0.45));
  const scan = lin(t, PH.ticks[0] - 0.45, PH.ticks[2]);
  return (
    <>
      {/* section label */}
      <Place {...P(470, 72)} w={600} h={64} z={10} opacity={Math.min(1, labelIn * 1.4) * v}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 40, letterSpacing: 1, color: C.white, whiteSpace: "nowrap" }}>MATERIAŁY WEJŚCIOWE</div>
      </Place>
      {/* inputs */}
      {INPUTS.map((inp, i) => {
        const a = sp(t, PH.inputs + i * 0.12, { damping: 14, stiffness: 170 });
        const okT = i === 0 ? PH.okA : i === 1 ? PH.okB : PH.noC;
        const mark = sp(t, okT, { damping: 10, stiffness: 260 });
        const fall = inp.ok ? 0 : E.in(lin(t, PH.noC + 0.3, PH.noC + 0.85));
        const p = P(IN_X[i], IN_Y + 420 * fall);
        return (
          <Place key={i} x={p.x} y={p.y} w={250} h={300} z={-200 * (1 - a)} rz={fall * 24} opacity={Math.min(1, a * 1.5) * (1 - fall) * v}>
            <div style={{ position: "absolute", left: 0, top: 0, width: 250, height: 250, borderRadius: 26, overflow: "hidden", boxShadow: `0 24px 50px rgba(0,0,0,0.45), 0 0 0 ${4 * mark}px ${inp.ok ? C.green : C.red}`, filter: inp.ok ? undefined : `grayscale(${0.3 + 0.7 * mark})` }}>
              <Vase id={`in${i}`} look={inp.look} vaseScale={0.95} />
              <div style={{ position: "absolute", left: 14, top: 14, width: 56, height: 56, borderRadius: 16, background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {inp.icon === "cam" ? <IconCamera size={34} /> : inp.icon === "doc" ? <IconDoc size={34} /> : <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 36, color: C.ink }}>?</span>}
              </div>
            </div>
            <div style={{ position: "absolute", left: -20, right: -20, top: 262, textAlign: "center", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 28, color: inp.ok ? C.white : "#FF8BA0", whiteSpace: "nowrap" }}>{inp.label}</div>
            {mark > 0 ? (
              <div style={{ position: "absolute", right: -26, top: -26, transform: `scale(${mark})` }}>
                {inp.ok ? (
                  <LicenseCheckObject size={96} />
                ) : (
                  <div style={{ width: 96, height: 96, borderRadius: 48, background: C.redDeep, border: `6px solid ${C.redSoft}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <IconX size={54} color={C.redSoft} stroke={3.6} />
                  </div>
                )}
              </div>
            ) : null}
          </Place>
        );
      })}
      {/* arrows inputs → tool, tool → terms */}
      <Place {...P(470, 560)} w={940} h={160} z={0} opacity={v}>
        <svg width={940} height={160} style={{ overflow: "visible" }}>
          {[175, 470].map((x, i) => (
            <path key={i} d={`M${x} 10 C ${x} 80, 470 70, 470 ${150}`} fill="none" stroke={C.green} strokeWidth={6} strokeLinecap="round" pathLength={100} strokeDasharray={`${100 * arrowsA} 100`} opacity={0.9} />
          ))}
        </svg>
      </Place>
      {/* tool row */}
      <Place {...P(470, 700)} w={860} h={130} z={20} s={mix(0.85, 1, rowIn)} opacity={Math.min(1, rowIn * 1.4) * v}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 34, background: "linear-gradient(150deg, #19264A 0%, #111B36 100%)", border: "2px solid rgba(120,140,190,0.4)", boxShadow: "0 30px 60px rgba(0,0,0,0.45)" }} />
        <div style={{ position: "absolute", left: 0, top: -50, width: 860, textAlign: "center", fontFamily: FONT_BODY, fontWeight: 800, fontSize: 24, letterSpacing: 2, color: "#A3AECB" }}>NARZĘDZIE AI</div>
        {["ChatGPT", "Gemini"].map((n, i) => (
          <div key={n} style={{ position: "absolute", left: 40 + i * 270, top: 25, width: 240, height: 80, borderRadius: 20, background: "rgba(255,255,255,0.06)", border: "2px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 40, color: C.white, whiteSpace: "nowrap" }}>
            {n}
          </div>
        ))}
        <div style={{ position: "absolute", left: 580, top: 25, width: 240, height: 80, borderRadius: 20, background: "rgba(249,80,225,0.08)", border: "2px solid rgba(249,80,225,0.35)" }} />
      </Place>
      <Place {...P(470, 830)} w={940} h={100} z={0} opacity={v}>
        <svg width={940} height={100} style={{ overflow: "visible" }}>
          <path d="M470 0 V90" fill="none" stroke={C.pink} strokeWidth={6} strokeLinecap="round" pathLength={100} strokeDasharray={`${100 * arrowsB} 100`} />
        </svg>
      </Place>
      {/* terms of the tool */}
      <Place {...P(470, 1110)} w={860} h={430} z={-200 * (1 - termsIn)} rx={-25 * (1 - termsIn)} opacity={Math.min(1, termsIn * 1.5) * v}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 34, background: C.paper, boxShadow: "0 40px 90px rgba(0,0,0,0.5)", fontFamily: FONT_BODY, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 36, top: 30, display: "flex", alignItems: "center", gap: 16 }}>
            <IconDoc size={44} color={C.magenta} />
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 40, color: C.ink, whiteSpace: "nowrap" }}>Warunki korzystania z narzędzia</span>
          </div>
          {["Warunki używania", "Użycie komercyjne", "Prawa do materiałów"].map((r, i) => {
            const tk = sp(t, PH.ticks[i], { damping: 12, stiffness: 260 });
            return (
              <div key={r} style={{ position: "absolute", left: 36, top: 120 + i * 96, display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, border: `4px solid ${tk > 0.5 ? "#1FAF84" : "#B9C2D6"}`, background: tk > 0.5 ? "#1FAF84" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ transform: `scale(${tk})` }}>
                    <IconCheck size={38} color="#fff" stroke={3.6} />
                  </div>
                </div>
                <span style={{ fontWeight: 800, fontSize: 38, color: C.ink, whiteSpace: "nowrap" }}>{r}</span>
              </div>
            );
          })}
          {/* magnifier scanning the terms */}
          {scan > 0 && scan < 1 ? (
            <div style={{ position: "absolute", left: 560 + 80 * Math.sin(scan * Math.PI * 2), top: 110 + 240 * scan, width: 110, height: 110, borderRadius: 55, background: "rgba(249,80,225,0.12)", border: `5px solid ${C.magenta}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <IconSearch size={54} color={C.magenta} stroke={2.8} />
            </div>
          ) : null}
        </div>
      </Place>
    </>
  );
};

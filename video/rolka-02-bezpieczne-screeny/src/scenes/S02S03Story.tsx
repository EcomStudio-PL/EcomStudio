import React from "react";
import { AbsoluteFill } from "remotion";
import { E, spr, tw } from "../lib/anim";
import { CUE } from "../timing";
import { Chip, Kinetic } from "../components/Kinetic";
import { Scrim } from "../components/Bits";
import { FONT_DISPLAY } from "../lib/fonts";
import { C } from "../lib/theme";

/**
 * 4.90–10.30 s — the story: you send a screenshot and cover your number with a
 * black marker. 10.30–13.30 s — "Bezpieczne?" → the marker flips into
 * "NIEKONIECZNIE!" (the card lives inside the phone — see Phone/FlipCard).
 */
export const StoryFront: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 150 || frame > 330) return null;
  const shot = spr(frame, CUE.zrzutEkranu, { damping: 15 });
  const shotOut = tw(frame, 238, 248, 0, 1, E.in);
  const pewno = spr(frame, 294, { damping: 13, stiffness: 150 });
  const pewnoOut = tw(frame, 318, 328, 0, 1, E.in);
  return (
    <AbsoluteFill>
      <Scrim top={0} height={620} opacity={Math.min(tw(frame, 160, 172), 1 - tw(frame, 312, 324))} />
      <Kinetic
        frame={frame}
        x={100}
        y={300}
        exitAt={236}
        lines={[
          { size: 64, weight: 800, words: [{ t: "WYSYŁASZ", at: CUE.zeWysylasz + 4 }, { t: "KOMUŚ", at: CUE.zeWysylasz + 12 }] },
          { size: 96, weight: 900, gap: 8, words: [{ t: "ZRZUT", at: CUE.zrzutEkranu - 2, grad: true }, { t: "EKRANU", at: CUE.zrzutEkranu + 2, grad: true }] },
        ]}
      />
      <Kinetic
        frame={frame}
        x={100}
        y={318}
        exitAt={306}
        lines={[
          { size: 64, weight: 800, words: [{ t: "ZAKRYWASZ", at: CUE.iZakrywasz + 6 }, { t: "NUMER", at: CUE.swojNumer + 6 }] },
          {
            size: 80,
            weight: 900,
            gap: 10,
            words: [
              { t: "CZARNYM", at: CUE.czarnymMarkerem, bar: "rgba(13,15,24,0.78)" },
              { t: "MARKEREM", at: CUE.czarnymMarkerem + 6, bar: "rgba(13,15,24,0.78)" },
            ],
          },
        ]}
      />
      {/* camera shutter chip */}
      <Chip x={540} y={1590} p={shot * (1 - shotOut)} tone="pink" size={34}>
        <svg width={40} height={32} viewBox="0 0 40 32">
          <rect x={2} y={7} width={36} height={23} rx={6} fill="none" stroke="#fff" strokeWidth={3.5} />
          <path d="M13 7 L16 2 H24 L27 7" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinejoin="round" />
          <circle cx={20} cy={18} r={6.5} fill="none" stroke="#fff" strokeWidth={3.5} />
        </svg>
        ZAPISANO ZRZUT EKRANU
      </Chip>
      {/* "Zakryte… na pewno?" */}
      {pewno > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: 540,
            top: 1340,
            transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * pewno}) rotate(${(1 - pewno) * -6 - 2}deg)`,
            opacity: Math.min(1, pewno * 1.6) * (1 - pewnoOut),
            background: "rgba(10,12,24,0.92)",
            border: "2px solid rgba(255,255,255,0.16)",
            borderRadius: 34,
            padding: "26px 44px",
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: 66,
            letterSpacing: -1.5,
            color: C.ink,
            whiteSpace: "nowrap",
            boxShadow: "0 30px 70px rgba(0,0,0,0.5)",
          }}
        >
          Zakryte… <span style={{ color: C.pinkHot }}>na pewno?</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Big question behind the phone (the phone body occludes it — depth, not a slide). */
export const SafeBack: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 300 || frame > 410) return null;
  const strike = tw(frame, CUE.niekoniecznie, CUE.niekoniecznie + 10, 0, 1, E.out);
  const out = tw(frame, 392, 404, 0, 1, E.in);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 60}px)` }}>
      <Kinetic
        frame={frame}
        x={540}
        y={330}
        align="center"
        lines={[
          { size: 66, weight: 800, words: [{ t: "MYŚLISZ,", at: CUE.myslisz }, { t: "ŻE", at: CUE.myslisz + 10 }, { t: "DANE", at: CUE.myslisz + 16 }, { t: "SĄ", at: CUE.myslisz + 22 }] },
          { size: 132, weight: 900, gap: 14, words: [{ t: "BEZPIECZNE?", at: CUE.bezpieczne, color: strike > 0 ? "rgba(250,247,252,0.42)" : C.ink }] },
        ]}
      />
      {strike > 0 && (
        <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M150 528 L930 498" stroke={C.danger} strokeWidth={16} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - strike} />
        </svg>
      )}
    </AbsoluteFill>
  );
};

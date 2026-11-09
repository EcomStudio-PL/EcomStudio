import React from "react";
import { AbsoluteFill } from "remotion";
import { E, spr, track, tw } from "../lib/anim";
import { CUE } from "../timing";
import { Chip, Kinetic } from "../components/Kinetic";
import { Scrim } from "../components/Bits";
import { C } from "../lib/theme";

/**
 * 26.60–32.30 s — SOLUTION 1: the same screenshot, the brush stroke straightens
 * and becomes a geometric, fully opaque rectangle (stroke → shape). The pixels of
 * the number are gone from the flattened result; a check confirms it.
 */
export const Solution1Front: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 796 || frame > 980) return null;
  const strike = tw(frame, CUE.markera - 2, CUE.markera + 10, 0, 1, E.out);
  const krycie = Math.round(track(frame, [[882, 78], [902, 100, E.inOut]]));
  const meterIn = spr(frame, 874, { damping: 16 });
  const meterOut = tw(frame, 936, 948, 0, 1, E.in);
  return (
    <AbsoluteFill>
      <Scrim top={0} height={760} opacity={Math.min(tw(frame, 820, 834), 1 - tw(frame, 952, 966))} />
      <div style={{ position: "absolute", left: 0, top: 0 }}>
        <Kinetic
          frame={frame}
          x={100}
          y={300}
          exitAt={846}
          lines={[
            { size: 60, weight: 800, words: [{ t: "ZAMIAST", at: CUE.zamiast + 2 }] },
            { size: 84, weight: 900, gap: 8, words: [{ t: "ZWYKŁEGO", at: CUE.zamiast + 10 }, { t: "MARKERA", at: CUE.markera }] },
          ]}
        />
        {strike > 0 && frame < 856 && (
          <svg width={1080} height={700} style={{ position: "absolute", left: 0, top: 0, opacity: 1 - tw(frame, 846, 854) }}>
            <path d="M92 428 L940 400" stroke={C.danger} strokeWidth={14} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - strike} />
          </svg>
        )}
      </div>
      <Kinetic
        frame={frame}
        x={100}
        y={286}
        exitAt={940}
        lines={[
          { size: 176, weight: 900, tracking: -6, words: [{ t: "100%", at: CUE.pelnego, grad: true }] },
          { size: 66, weight: 900, gap: 4, words: [{ t: "NIEPRZEZROCZYSTOŚCI", at: CUE.nieprzezroczystego }] },
        ]}
      />
      <Chip x={540} y={1268} p={meterIn * (1 - meterOut)} tone={krycie >= 100 ? "safe" : "dark"} size={36}>
        KRYCIE <span style={{ color: krycie >= 100 ? "#8DFFE1" : C.pinkHot }}>{krycie}%</span>
      </Chip>
      <Chip x={540} y={1268} p={tw(frame, 944, 954) * (1 - tw(frame, 962, 972))} tone="safe" size={36}>
        DANE CAŁKOWICIE ZAKRYTE
      </Chip>
    </AbsoluteFill>
  );
};

/**
 * 32.50–35.60 s — SOLUTION 2: real cropping. The corners grow out of the
 * number field's frame, the bottom edge moves above the number and the cut
 * strip physically falls away: the saved image no longer contains it.
 */
export const Solution2Front: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < 960 || frame > 1084) return null;
  const chip = spr(frame, CUE.ktoregoNie + 14, { damping: 15 });
  return (
    <AbsoluteFill>
      <Kinetic
        frame={frame}
        x={100}
        y={290}
        exitAt={1068}
        lines={[
          { size: 128, weight: 900, words: [{ t: "WYKADRUJ", at: CUE.mozeszTez + 4, grad: true }] },
          { size: 74, weight: 900, gap: 10, words: [{ t: "WRAŻLIWY", at: CUE.wyciac + 2 }, { t: "FRAGMENT", at: CUE.fragment + 2 }] },
        ]}
      />
      <Chip x={540} y={1230} p={chip * (1 - tw(frame, 1068, 1078))} tone="pink" size={32}>
        NUMER POZA KADREM
      </Chip>
    </AbsoluteFill>
  );
};

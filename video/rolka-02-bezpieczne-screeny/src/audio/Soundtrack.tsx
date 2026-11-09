import React from "react";
import { Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { CUE, DURATION_IN_FRAMES, FPS, PHRASES } from "../timing";
import { tw, E } from "../lib/anim";

/**
 * MIX
 * - Voice: voice_final_spedup.mp3 played 1:1 (no playbackRate / atempo / trimming).
 * - Music: original instrumental, ducked under speech (smoothed side-chain style
 *   envelope from the measured phrase map), slight swell in the tail.
 * - SFX: the 4 original pack sounds, synced to on-screen actions, kept low.
 * Final loudness (-14 LUFS, true peak ≤ -1.5 dBTP) is set on the whole mix by
 * scripts/render.sh — gain/limiting only, the timing is never touched.
 */

const speech = (f: number) => {
  const t = f / FPS;
  return PHRASES.some((p) => t >= p.from - 0.08 && t <= p.to + 0.12) ? 1 : 0;
};
/** Smoothed speech activity (≈0.4 s window) so the music never pumps between words. */
const speechEnv = (f: number) => {
  let acc = 0;
  let n = 0;
  for (let d = -6; d <= 6; d++) {
    acc += speech(f + d);
    n++;
  }
  return acc / n;
};

export const musicVolume = (f: number) => {
  const duck = speechEnv(f);
  const base = 0.34 + 0.2 * (1 - duck); // ≈ -9.4 dB under speech, ≈ -4.7 dB in gaps
  const intro = tw(f, 0, 6, 0.6, 1, E.linear);
  const tail = tw(f, CUE.voiceEnd, CUE.voiceEnd + 6, 1, 1.35, E.out);
  const fade = tw(f, DURATION_IN_FRAMES - 14, DURATION_IN_FRAMES, 1, 0, E.soft);
  return base * intro * tail * fade;
};

const SFX: { at: number; src: string; vol: number }[] = [
  { at: CUE.zamazujesz, src: "audio/sfx/whoosh.wav", vol: 0.55 }, // marker swipe, frame 0 (hook layer 4: sound)
  { at: CUE.uwazaj + 3, src: "audio/sfx/danger.wav", vol: 0.42 }, // alert hit
  { at: 126, src: "audio/sfx/whoosh.wav", vol: 0.28 }, // copies gather back into the phone
  { at: CUE.zrzutEkranu, src: "audio/sfx/tap.wav", vol: 0.5 }, // screenshot
  { at: 262, src: "audio/sfx/whoosh.wav", vol: 0.32 }, // marker stroke 1
  { at: 279, src: "audio/sfx/whoosh.wav", vol: 0.24 }, // marker stroke 2
  { at: CUE.niekoniecznie - 2, src: "audio/sfx/danger.wav", vol: 0.34 }, // warning card flip
  { at: 470, src: "audio/sfx/tap.wav", vol: 0.34 }, // layers snap back
  { at: CUE.jasnosc, src: "audio/sfx/tap.wav", vol: 0.38 }, // brightness slider
  { at: CUE.kontrast, src: "audio/sfx/tap.wav", vol: 0.38 }, // contrast slider
  { at: 750, src: "audio/sfx/whoosh.wav", vol: 0.36 }, // cards converge
  { at: CUE.uzyj + 1, src: "audio/sfx/tap.wav", vol: 0.38 }, // tool switch → rectangle
  { at: CUE.zakryjeDane, src: "audio/sfx/done.wav", vol: 0.42 }, // check
  { at: 966, src: "audio/sfx/whoosh.wav", vol: 0.26 }, // pan to the crop alternative
  { at: 1004, src: "audio/sfx/tap.wav", vol: 0.32 }, // crop handle
  { at: CUE.ktoregoNie, src: "audio/sfx/whoosh.wav", vol: 0.32 }, // cut strip falls away
  { at: 1152, src: "audio/sfx/done.wav", vol: 0.36 }, // file checks
  { at: 1194, src: "audio/sfx/whoosh.wav", vol: 0.3 }, // CTA flip
  { at: CUE.zapisz + 1, src: "audio/sfx/tap.wav", vol: 0.42 }, // bookmark
  { at: 1306, src: "audio/sfx/tap.wav", vol: 0.26 }, // comment chip
];

export const Soundtrack: React.FC = () => (
  <>
    <Audio src={staticFile("audio/voice_final_spedup.mp3")} volume={1} />
    <Audio src={staticFile("audio/music_original_minimal_tech.mp3")} volume={(f) => musicVolume(f)} />
    {SFX.map((s, i) => (
      <Sequence key={i} from={s.at} durationInFrames={20} layout="none" name={`sfx ${s.src.split("/").pop()} @${s.at}`}>
        <Audio src={staticFile(s.src)} volume={s.vol} />
      </Sequence>
    ))}
  </>
);

import React from "react";
import { Audio } from "@remotion/media";
import { Sequence, staticFile } from "remotion";
import { FPS } from "../config";
import { SFX } from "../data/sfx";

/**
 * Voice: the package's voice_1.2x.mp3, untouched (no re-speed, no pitch, no trimming).
 * Music: original composition rendered by scripts/compose_audio.py, already side-chain ducked under the voice.
 * SFX: original synthesised one-shots placed on the exact motion cues of src/data/sfx.ts.
 */
export const Soundtrack: React.FC<{ withMusic: boolean }> = ({ withMusic }) => (
  <>
    <Audio src={staticFile("audio/voice_1.2x.mp3")} volume={1} />
    {withMusic ? <Audio src={staticFile("audio/music_ducked.wav")} volume={1} /> : null}
    {SFX.map((s, i) => (
      <Sequence key={i} from={Math.round(s.t * FPS)} layout="none" name={`sfx:${s.file}`}>
        <Audio src={staticFile(`audio/sfx/${s.file}.wav`)} volume={s.gain} />
      </Sequence>
    ))}
  </>
);

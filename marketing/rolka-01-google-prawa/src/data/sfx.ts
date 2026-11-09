import { T } from "./timeline";
import { DRAG, HOP_SHOP, HOP_SOCIAL } from "../world/stations/HookStations";
import { BENCH_CLICKS, FLIP_TIME, STAMP_TIMES, TO_BENCH } from "../world/stations/Bench";
import { SOURCE_TICKS } from "../world/stations/Source";
import { TOOLS_PH } from "../world/stations/Tools";

// SFX cue sheet — every sound sits under a specific on-screen action (spec §5: sparse, no whoosh spam).
// Files: public/audio/sfx/*.wav, synthesised by scripts/compose_audio.py (original, no third-party audio).
export type Sfx = { t: number; file: string; gain: number };

export const SFX: Sfx[] = [
  // HOOK 3Z
  { t: 0.0, file: "typing", gain: 0.22 },
  { t: T.grab - 0.01, file: "grab", gain: 0.4 },
  { t: DRAG.t0 + 0.04, file: "whoosh", gain: 0.3 },
  { t: T.drop - 0.02, file: "drop", gain: 0.5 },
  { t: T.uwazaj - 0.02, file: "alarm", gain: 0.42 },
  { t: T.wykorzystanie - 0.05, file: "pop", gain: 0.22 },
  // GOOGLE TYLKO WYSZUKUJE
  { t: T.hookEnd - 0.05, file: "whoosh_long", gain: 0.26 },
  { t: T.wyszukuje + 0.05, file: "pop", gain: 0.2 },
  // RYZYKO
  { t: T.toNie + 0.25, file: "whoosh", gain: 0.22 },
  { t: T.stronie + 0.05, file: "tick", gain: 0.28 },
  { t: HOP_SHOP.t0, file: "whoosh", gain: 0.16 },
  { t: HOP_SHOP.t1 - 0.02, file: "drop", gain: 0.3 },
  { t: HOP_SOCIAL.t0, file: "whoosh", gain: 0.16 },
  { t: HOP_SOCIAL.t1 - 0.02, file: "drop", gain: 0.3 },
  // ZWROT UWAGA
  { t: T.iUwaga - 0.01, file: "impulse", gain: 0.42 },
  // EDYCJA
  { t: TO_BENCH.t0 + 0.02, file: "whoosh", gain: 0.26 },
  { t: T.przytniesz + 0.2, file: "snip", gain: 0.34 },
  { t: T.usuniesz + 0.18, file: "erase", gain: 0.3 },
  { t: T.przerobisz + 0.3, file: "sparkle", gain: 0.3 },
  ...STAMP_TIMES.map((t, i) => ({ t: t - 0.01, file: "stamp", gain: i === 1 ? 0.36 : 0.42 })),
  // JAK SPRAWDZIĆ
  { t: FLIP_TIME + 0.02, file: "flip", gain: 0.36 },
  // GOOGLE UI KROKI
  { t: BENCH_CLICKS.clickGrafika, file: "click", gain: 0.4 },
  { t: BENCH_CLICKS.clickNarzedzia, file: "click", gain: 0.4 },
  { t: BENCH_CLICKS.clickNarzedzia + 0.05, file: "select", gain: 0.24 },
  { t: BENCH_CLICKS.clickRights, file: "click", gain: 0.4 },
  { t: BENCH_CLICKS.clickRights + 0.05, file: "select", gain: 0.28 },
  { t: BENCH_CLICKS.clickCC, file: "click", gain: 0.36 },
  { t: BENCH_CLICKS.clickLink, file: "click", gain: 0.36 },
  { t: BENCH_CLICKS.clickLink + 0.06, file: "whoosh", gain: 0.28 },
  // LICENCJA U ŹRÓDŁA
  ...SOURCE_TICKS.map((t) => ({ t: t - 0.01, file: "tick", gain: 0.24 })),
  { t: T.komercyjnie - 0.08, file: "pop", gain: 0.3 },
  // TRZY NARZĘDZIA AI
  { t: T.licEnd - 0.02, file: "whoosh_long", gain: 0.24 },
  { t: TOOLS_PH.typing[0], file: "typing", gain: 0.16 },
  { t: TOOLS_PH.send, file: "click", gain: 0.3 },
  { t: TOOLS_PH.gen[0] + 0.05, file: "sparkle", gain: 0.22 },
  { t: T.chatgpt - 0.05, file: "pop", gain: 0.24 },
  { t: T.gemini - 0.05, file: "pop", gain: 0.24 },
  { t: T.grovbase - 0.05, file: "pop", gain: 0.26 },
  { t: TOOLS_PH.logo[0] + 0.05, file: "shine", gain: 0.32 },
  // PRAWA MATERIAŁÓW WEJŚCIOWYCH
  { t: TOOLS_PH.toDiagram[0], file: "whoosh", gain: 0.18 },
  { t: TOOLS_PH.okA - 0.01, file: "chime", gain: 0.22 },
  { t: TOOLS_PH.okB - 0.01, file: "chime", gain: 0.22 },
  { t: TOOLS_PH.noC - 0.01, file: "reject", gain: 0.3 },
  ...TOOLS_PH.ticks.map((t) => ({ t: t - 0.01, file: "tick", gain: 0.24 })),
  // CTA
  { t: T.narzedziEnd + 0.08, file: "whoosh_long", gain: 0.28 },
  { t: T.zapisz - 0.02, file: "bookmark", gain: 0.42 },
  { t: T.kosztownego + 0.04, file: "pop", gain: 0.2 },
  { t: T.aTy - 0.02, file: "hit", gain: 0.42 },
  { t: T.sprawdzales + 0.03, file: "pop", gain: 0.26 },
  { t: T.czy - 0.07, file: "pop", gain: 0.26 },
];

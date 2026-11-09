import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/** Local font files (SIL OFL, from @fontsource) — renders work offline and are reproducible. */
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

export const DISPLAY = "Inter Tight";
export const MONO = "JetBrains Mono";

let started = false;
export const ensureFonts = () => {
  if (started) return;
  started = true;
  // Variable display face: every weight 100–900 from one file per subset.
  loadFont({ family: DISPLAY, url: staticFile("fonts/inter-tight-latin-wght-normal.woff2"), weight: "100 900", unicodeRange: LATIN });
  loadFont({ family: DISPLAY, url: staticFile("fonts/inter-tight-latin-ext-wght-normal.woff2"), weight: "100 900", unicodeRange: LATIN_EXT });
  for (const w of ["500", "700"]) {
    loadFont({ family: MONO, url: staticFile(`fonts/jetbrains-mono-latin-${w}-normal.woff2`), weight: w, unicodeRange: LATIN });
    loadFont({ family: MONO, url: staticFile(`fonts/jetbrains-mono-latin-ext-${w}-normal.woff2`), weight: w, unicodeRange: LATIN_EXT });
  }
};

export const FONT_DISPLAY = `"${DISPLAY}", "Inter", system-ui, sans-serif`;
export const FONT_MONO = `"${MONO}", ui-monospace, monospace`;

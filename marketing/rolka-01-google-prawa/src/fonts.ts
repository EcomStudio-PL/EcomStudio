import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Brand fonts (same as the GrovBase app): Inter + Space Grotesk, both OFL, both cover ą ć ę ł ń ó ś ź ż.
// Fontsource splits each weight into "latin" + "latin-ext" files; both are loaded with their unicode ranges.
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const faces: { family: string; file: string; weights: number[] }[] = [
  { family: "Inter", file: "inter", weights: [400, 500, 600, 700, 800, 900] },
  { family: "Space Grotesk", file: "space-grotesk", weights: [500, 600, 700] },
];

let started = false;
export const loadBrandFonts = () => {
  if (started) return;
  started = true;
  for (const f of faces) {
    for (const w of f.weights) {
      loadFont({
        family: f.family,
        url: staticFile(`fonts/${f.file}-latin-${w}-normal.woff2`),
        weight: String(w),
        unicodeRange: LATIN,
      });
      loadFont({
        family: f.family,
        url: staticFile(`fonts/${f.file}-latin-ext-${w}-normal.woff2`),
        weight: String(w),
        unicodeRange: LATIN_EXT,
      });
    }
  }
};

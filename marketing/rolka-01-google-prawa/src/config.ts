// Global production constants for "GrovBase — Rolka #1: Google Grafika / prawa".
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
// Voice = 54.648 s. 1650 frames = 55.0 s → 0.35 s sound tail after the last syllable (spec: ≤ ~0.5 s).
export const DURATION_FRAMES = 1650;

// Social safe zones (spec §4): text ≥ 90 px from the sides, ≥ 170 px from the top, ≥ 250 px from the bottom.
export const SAFE = { side: 90, top: 170, bottom: 250 } as const;

export const C = {
  bg0: "#050A16",
  bg1: "#0A1430",
  navy: "#0F1A33",
  navy2: "#16223F",
  line: "#25345A",
  ink: "#1C2541",
  inkSoft: "#4A5578",
  muted: "#8A94AE",
  paper: "#FFFFFF",
  paper2: "#F3F5FA",
  paper3: "#E6EAF3",
  magenta: "#D628CF",
  pink: "#F950E1",
  violet: "#8A3FFF",
  red: "#FF3B5C",
  redSoft: "#FF637D",
  redDeep: "#3F253D",
  green: "#72E9C2",
  greenDeep: "#153A39",
  amber: "#FFD16C",
  googleBlue: "#4285F4",
  white: "#F8FAFF",
} as const;

export const FONT_DISPLAY = "'Space Grotesk', 'Inter', sans-serif";
export const FONT_BODY = "'Inter', sans-serif";

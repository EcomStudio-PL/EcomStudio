/** GrovBase brand + film palette. Green is used ONLY as the "safe" signal. */
export const C = {
  pink: "#D628CF",
  pinkHot: "#F950E1",
  violet: "#7634FF",
  bg0: "#05060D",
  bg1: "#0A0C18",
  bg2: "#111424",
  ink: "#FAF7FC",
  inkDim: "#B9B3C9",
  inkMute: "#7E7896",
  danger: "#FF4D7D",
  dangerSoft: "#FFB9D4",
  dangerDeep: "#3A1226",
  safe: "#2BCB9F",
  safeSoft: "#BEFFEB",
  safeDeep: "#0E493B",
  marker: "#0D0F18",
  opaque: "#151924",
  glass: "rgba(22, 25, 42, 0.72)",
  glassLine: "rgba(255, 255, 255, 0.10)",
};

export const GRAD_PINK = `linear-gradient(100deg, ${C.pink} 0%, ${C.pinkHot} 100%)`;

/** Safe area (spec): key text x 100..980, avoid top/bottom 260 px. */
export const SAFE = { left: 100, right: 980, top: 260, bottom: 1660 };

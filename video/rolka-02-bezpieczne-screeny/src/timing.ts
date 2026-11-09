/**
 * TIMING MASTER — the voice (public/audio/voice_final_spedup.mp3, 45.384 s) is the
 * only source of truth. Every value below was measured on that exact file
 * (ffmpeg silencedetect at -38 dB/0.12 s for phrase borders and -30 dB/0.05 s for
 * the micro-pauses between words), NOT copied from timing/sceny_czasowe.json —
 * the JSON is approximate and e.g. puts "Jak tego uniknąć?" 1.5 s too early.
 *
 * The voice file is played untouched: no playbackRate, no atempo, no trimming.
 */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const VOICE_DURATION_S = 45.384;
/** 45.384 s of voice + ~0.2 s of breathing room at the end (spec: "kilka klatek wybrzmienia"). */
export const DURATION_IN_FRAMES = 1368;

export const s = (seconds: number) => Math.round(seconds * FPS);

/** Spoken phrases (seconds), measured on the final voice file. */
export const PHRASES = [
  { id: "p01", from: 0.0, to: 1.44, text: "Zamazujesz dane na skrinach?" },
  { id: "p02", from: 1.67, to: 4.7, text: "Uważaj, bo możesz je przypadkiem pokazać całemu internetowi!" },
  { id: "p03", from: 4.9, to: 7.48, text: "Wyobraź sobie, że wysyłasz komuś zrzut ekranu" },
  { id: "p04", from: 7.8, to: 10.08, text: "i zakrywasz swój numer telefonu czarnym markerem." },
  { id: "p05", from: 10.33, to: 11.81, text: "Myślisz, że dane są bezpieczne?" },
  { id: "p06", from: 12.21, to: 12.97, text: "Niekoniecznie!" },
  { id: "p07", from: 13.4, to: 15.13, text: "Niektóre markery są półprzezroczyste." },
  { id: "p08", from: 15.45, to: 20.36, text: "Wystarczy zwiększyć jasność lub kontrast zdjęcia, żeby ukryty tekst znów stał się widoczny!" },
  { id: "p09", from: 20.63, to: 22.64, text: "Dotyczy to numerów telefonów, adresów," },
  { id: "p10", from: 22.97, to: 23.65, text: "danych klientów," },
  { id: "p11", from: 24.0, to: 25.28, text: "a nawet informacji bankowych." },
  { id: "p12", from: 25.57, to: 26.32, text: "Jak tego uniknąć?" },
  { id: "p13", from: 26.62, to: 27.92, text: "Zamiast zwykłego markera" },
  { id: "p14", from: 28.21, to: 30.68, text: "użyj pełnego, nieprzezroczystego prostokąta," },
  { id: "p15", from: 30.9, to: 32.2, text: "który całkowicie zakryje dane." },
  { id: "p16", from: 32.5, to: 35.54, text: "Możesz też po prostu wyciąć fragment zdjęcia, którego nie chcesz pokazywać." },
  { id: "p17", from: 35.85, to: 36.19, text: "Na koniec" },
  { id: "p18", from: 36.5, to: 39.91, text: "sprawdź zapisany obraz, żeby upewnić się, że nic nie prześwituje." },
  { id: "p19", from: 40.1, to: 42.4, text: "Zapisz tę rolkę, zanim wyślesz kolejnego skrina!" },
  { id: "p20", from: 42.62, to: 42.89, text: "A Ty?" },
  { id: "p21", from: 43.09, to: 45.07, text: "Też wcześniej zamazywałeś dane zwykłym markerem?" },
] as const;

/**
 * Word / accent cues in FRAMES. Positions inside a phrase come from the
 * -30 dB micro-pauses cross-checked with the syllable count of the phrase.
 */
export const CUE = {
  // HOOK
  zamazujesz: 0,
  dane: 19,
  naScreenach: 29,
  uwazaj: 50,
  boMozesz: 73,
  pokazac: 99,
  internetowi: 120,
  // STORY
  wyobraz: 147,
  zeWysylasz: 166,
  zrzutEkranu: 200,
  iZakrywasz: 234,
  swojNumer: 254,
  czarnymMarkerem: 280,
  // BEZPIECZNE?
  myslisz: 310,
  bezpieczne: 340,
  niekoniecznie: 366,
  // DEMO
  niektore: 402,
  markerySa: 418,
  polprzezroczyste: 433,
  wystarczy: 464,
  jasnosc: 499,
  kontrast: 514,
  zdjecia: 528,
  zebyUkryty: 549,
  widoczny: 582,
  // DATA
  dotyczy: 619,
  telefonow: 645,
  adresow: 665,
  klientow: 689,
  bankowych: 734,
  // HOW
  jakUniknac: 767,
  // SOLUTION 1
  zamiast: 799,
  markera: 823,
  uzyj: 846,
  pelnego: 856,
  nieprzezroczystego: 871,
  prostokata: 902,
  ktory: 927,
  zakryjeDane: 948,
  // SOLUTION 2
  mozeszTez: 975,
  wyciac: 1001,
  fragment: 1010,
  ktoregoNie: 1032,
  // CHECK
  naKoniec: 1076,
  sprawdz: 1095,
  zapisanyObraz: 1110,
  upewnic: 1135,
  nicNie: 1165,
  // CTA
  zapisz: 1203,
  zanim: 1226,
  aTy: 1279,
  tezWczesniej: 1293,
  zwyklymMarkerem: 1332,
  voiceEnd: 1352,
} as const;

/** Visual sections (frames). Neighbouring sections overlap on purpose: transitions are carried by shared elements. */
export const SECTION = {
  hook: [0, 150],
  story: [140, 310],
  safe: [300, 400],
  demo: [394, 624],
  data: [606, 772],
  how: [748, 812],
  solution1: [790, 980],
  solution2: [960, 1080],
  check: [1060, 1206],
  ctaSave: [1192, 1286],
  ctaComment: [1270, DURATION_IN_FRAMES],
} as const;

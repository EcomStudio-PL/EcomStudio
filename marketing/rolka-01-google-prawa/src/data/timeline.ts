import { WORDS } from "./words";
import scenes from "./sceny_czasowe.json";

// Direction (reżyseria) — every cue is derived from the measured word timings of the voice,
// so pictures follow the voice, never the other way round.
const s = (i: number) => WORDS[i].s;
const e = (i: number) => WORDS[i].e;

export const SCENES = scenes.segments; // anchors from the production package (for reference / QA)

export const T = {
  // HOOK 3Z
  znalazles: s(0),
  zdjecie: s(1),
  google0: s(3),
  grab: 0.86,
  drop: 1.52,
  uwazaj: s(4),
  wykorzystanie: s(6),
  slono: s(10),
  kosztowac: s(11),
  hookEnd: e(11),
  // GOOGLE_TYLKO_WYSZUKUJE
  googleOnly: s(12),
  wyszukuje: s(14),
  zdjeciaEnd: e(15),
  // RYZYKO_STRONA_SKLEP_SOCIAL
  toNie: s(16),
  swobodnie: s(22),
  stronie: s(26),
  sklepie: s(28),
  social: s(30),
  riskEnd: e(31),
  // ZWROT_UWAGA
  iUwaga: s(32),
  uwagaEnd: e(33),
  // EDYCJA_NIE_DAJE_PRAW
  nawet: s(34),
  przytniesz: s(36),
  usuniesz: s(38),
  przerobisz: s(41),
  ai: s(44),
  nieOznacza: s(45),
  prawaEdit: s(52),
  editEnd: e(52),
  // JAK_SPRAWDZIC
  jak: s(53),
  jakEnd: e(55),
  // GOOGLE_UI_KROKI
  wejdz: s(56),
  grafike: s(58),
  kliknij: s(60),
  narzedzia: s(61),
  nastepnie: s(63),
  prawaUz: s(64),
  uzytkowaniaEnd: e(65),
  // LICENCJA_U_ZRODLA
  pamietaj: s(66),
  sprawdzic: s(70),
  warunki: s(71),
  licencji: s(72),
  zrodla: s(74),
  szczegolnie: s(75),
  komercyjnie: s(79),
  licEnd: e(79),
  // TRZY_NARZEDZIA_AI
  aJesli: s(80),
  wlasnych: s(83),
  mozesz: s(85),
  chatgpt: s(90),
  gemini: s(91),
  grovbase: s(93),
  specjalizuje: s(95),
  produktowych: s(99),
  toolsEnd: e(99),
  // PRAWA_MATERIALOW_WEJSCIOWYCH
  pamietajTylko: s(100),
  korzystac: s(103),
  materialow: s(105),
  masz: s(108),
  odpowiednie: s(109),
  prawaIn: s(110),
  sprawdzac: s(112),
  warunkiUz: s(113),
  narzedziEnd: e(115),
  // CTA
  zapisz: s(116),
  rolke: s(118),
  kosztownego: s(122),
  bleduEnd: e(123),
  aTy: s(124),
  aTyEnd: e(125),
  sprawdzales: s(126),
  zdjecQ: s(130),
  czy: s(131),
  pobierales: s(134),
  googleEnd: e(138),
} as const;

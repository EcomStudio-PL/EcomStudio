import React from "react";
import { C, FONT_BODY, FONT_DISPLAY } from "../config";
import { LOOKS, Vase } from "./Vase";
import { IconBookmark, IconCart, IconComment, IconHeart, IconShare } from "./Icons";

// Three fictional publishing environments (package assets/ui/04_demo_*): no third-party brands.
export const EW = 940;
export const EH = 560;
export const SLOT = 384;

export type EnvKind = "www" | "shop" | "social";
export const SLOT_POS: Record<EnvKind, { x: number; y: number }> = {
  www: { x: 40, y: 136 },
  shop: { x: 516, y: 136 },
  social: { x: 40, y: 136 },
};

const LABEL: Record<EnvKind, string> = { www: "STRONA WWW", shop: "SKLEP ONLINE", social: "SOCIAL MEDIA" };

type Props = {
  kind: EnvKind;
  id: string;
  photo: number; // 0..1 the copied photo is present in the slot
  dropHint?: number; // 0..1 "drop zone" pulse on an empty slot
  risk?: number; // 0..1 red risk frame
  riskPulse?: number; // 0..1 extra glow
  badge?: number; // 0..1 "©?" badge
  focus?: number; // 0..1 highlight of the whole card
  dim?: number;
};

const Bar: React.FC<{ x: number; y: number; w: number; h?: number; c?: string }> = ({ x, y, w, h = 16, c = "#DFE5EF" }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: h / 2, background: c }} />
);

export const RiskFrame: React.FC<{ v: number; pulse?: number; size?: number; radius?: number; thick?: number }> = ({ v, pulse = 0, size = SLOT, radius = 26, thick = 8 }) => {
  if (v <= 0) return null;
  const inset = -14;
  const per = 4 * (size - 2 * inset);
  return (
    <svg
      width={size - 2 * inset}
      height={size - 2 * inset}
      style={{ position: "absolute", left: inset, top: inset, overflow: "visible", filter: `drop-shadow(0 0 ${10 + 26 * pulse}px rgba(255,59,92,${0.55 + 0.4 * pulse}))` }}
    >
      <rect
        x={thick / 2}
        y={thick / 2}
        width={size - 2 * inset - thick}
        height={size - 2 * inset - thick}
        rx={radius}
        fill="none"
        stroke={C.red}
        strokeWidth={thick}
        strokeDasharray={per}
        strokeDashoffset={per * (1 - Math.min(1, v))}
        strokeLinecap="round"
      />
    </svg>
  );
};

export const CopyrightBadge: React.FC<{ v: number; size?: number }> = ({ v, size = 86 }) =>
  v <= 0 ? null : (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        background: C.red,
        border: "5px solid #FFFFFF",
        boxShadow: "0 10px 26px rgba(255,59,92,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: size * 0.42,
        transform: `scale(${v})`,
        whiteSpace: "nowrap",
      }}
    >
      ©?
    </div>
  );

export const EnvCard: React.FC<Props> = ({ kind, id, photo, dropHint = 0, risk = 0, riskPulse = 0, badge = 0, focus = 0, dim = 0 }) => {
  const slot = SLOT_POS[kind];
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 34,
        background: C.paper,
        fontFamily: FONT_BODY,
        boxShadow: `0 50px 100px rgba(0,0,0,0.5), 0 0 0 ${3 + 5 * focus}px rgba(249,80,225,${0.18 + 0.6 * focus})`,
      }}
    >
      {/* chrome */}
      <div style={{ position: "absolute", left: 0, top: 0, width: EW, height: 60, background: C.paper2, borderRadius: "34px 34px 0 0", borderBottom: `2px solid ${C.paper3}` }}>
        {[30, 54, 78].map((x) => (
          <div key={x} style={{ position: "absolute", left: x - 7, top: 23, width: 14, height: 14, borderRadius: 7, background: "#A8B0C4" }} />
        ))}
        <div
          style={{
            position: "absolute",
            right: 22,
            top: 11,
            height: 38,
            padding: "0 18px",
            borderRadius: 12,
            background: "#F1E4FB",
            color: "#7A2BA8",
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: 1,
            display: "flex",
            alignItems: "center",
            whiteSpace: "nowrap",
          }}
        >
          {LABEL[kind]}
        </div>
      </div>

      {kind === "www" ? (
        <>
          <div style={{ position: "absolute", left: 40, top: 78, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#9AB8C2,#5F7F8C)" }} />
            <span style={{ fontWeight: 800, fontSize: 26, color: C.ink, whiteSpace: "nowrap" }}>Twoja strona</span>
          </div>
          <Bar x={560} y={88} w={90} h={14} />
          <Bar x={670} y={88} w={90} h={14} />
          <Bar x={780} y={88} w={110} h={14} />
          <div style={{ position: "absolute", left: 464, top: 160, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 46, color: C.ink, lineHeight: 1.05, whiteSpace: "nowrap" }}>
            Wazon dekoracyjny
          </div>
          <Bar x={464} y={236} w={400} />
          <Bar x={464} y={266} w={360} />
          <Bar x={464} y={296} w={300} />
          <div style={{ position: "absolute", left: 464, top: 352, height: 66, width: 250, borderRadius: 33, border: `3px solid ${C.ink}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24, color: C.ink, whiteSpace: "nowrap" }}>
            Zobacz więcej
          </div>
          <div style={{ position: "absolute", left: 464, top: 470, fontSize: 21, color: C.muted, whiteSpace: "nowrap" }}>Przykładowa witryna · demo</div>
        </>
      ) : null}

      {kind === "shop" ? (
        <>
          <div style={{ position: "absolute", left: 40, top: 92, fontWeight: 700, fontSize: 22, color: C.muted, whiteSpace: "nowrap" }}>Dom › Dekoracje › Wazony</div>
          <div style={{ position: "absolute", left: 40, top: 140, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 44, color: C.ink, lineHeight: 1.05, whiteSpace: "nowrap" }}>
            Wazon ceramiczny
          </div>
          <div style={{ position: "absolute", left: 40, top: 200, display: "flex", gap: 6 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ width: 24, height: 24, background: i < 4 ? "#FFC94D" : "#E3E7EF", clipPath: "polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)" }} />
            ))}
          </div>
          <div style={{ position: "absolute", left: 40, top: 246, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 54, color: C.magenta, whiteSpace: "nowrap" }}>149,00 zł</div>
          <Bar x={40} y={330} w={380} />
          <Bar x={40} y={360} w={320} />
          <div style={{ position: "absolute", left: 40, top: 404, height: 74, width: 400, borderRadius: 20, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, color: "#fff", fontWeight: 800, fontSize: 27, whiteSpace: "nowrap" }}>
            <IconCart size={32} />
            Dodaj do koszyka
          </div>
          <div style={{ position: "absolute", left: 40, top: 496, fontSize: 21, color: C.muted, whiteSpace: "nowrap" }}>Przykładowy sklep · demo</div>
        </>
      ) : null}

      {kind === "social" ? (
        <>
          <div style={{ position: "absolute", left: 464, top: 136, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 66, height: 66, borderRadius: 33, background: "linear-gradient(135deg,#F950E1,#8A3FFF)", padding: 4 }}>
              <div style={{ width: 58, height: 58, borderRadius: 29, background: "#FFE9F8" }} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 28, color: C.ink, whiteSpace: "nowrap" }}>Twój profil</div>
              <div style={{ fontSize: 21, color: C.muted, whiteSpace: "nowrap" }}>2 min temu</div>
            </div>
          </div>
          <Bar x={464} y={238} w={420} />
          <Bar x={464} y={268} w={380} />
          <Bar x={464} y={298} w={260} />
          <div style={{ position: "absolute", left: 464, top: 352, display: "flex", gap: 30 }}>
            <IconHeart size={44} color={C.red} />
            <IconComment size={44} />
            <IconShare size={44} />
          </div>
          <div style={{ position: "absolute", left: 836, top: 352 }}>
            <IconBookmark size={44} />
          </div>
          <div style={{ position: "absolute", left: 464, top: 420, fontWeight: 800, fontSize: 26, color: C.ink, whiteSpace: "nowrap" }}>1 248 polubień</div>
          <div style={{ position: "absolute", left: 464, top: 496, fontSize: 21, color: C.muted, whiteSpace: "nowrap" }}>Przykładowy post · demo</div>
        </>
      ) : null}

      {/* photo slot */}
      <div style={{ position: "absolute", left: slot.x, top: slot.y, width: SLOT, height: SLOT }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 26,
            border: `3px dashed rgba(138,148,174,${0.8 - 0.8 * photo})`,
            background: `rgba(249,80,225,${0.06 + 0.1 * dropHint})`,
            boxShadow: dropHint > 0 ? `0 0 0 ${10 * dropHint}px rgba(249,80,225,${0.18 * dropHint})` : undefined,
          }}
        />
        {dropHint > 0 && photo < 1 ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: dropHint * (1 - photo) }}>
            <div style={{ fontSize: 110, fontWeight: 300, color: "#C468C0", lineHeight: 1 }}>+</div>
          </div>
        ) : null}
        {photo > 0 ? (
          <div style={{ position: "absolute", inset: 0, borderRadius: 26, overflow: "hidden", opacity: photo }}>
            <Vase id={`${id}-slot`} look={LOOKS.hero} />
          </div>
        ) : null}
        <RiskFrame v={risk} pulse={riskPulse} />
        <div style={{ position: "absolute", right: -34, top: -34 }}>
          <CopyrightBadge v={badge} />
        </div>
      </div>
      {dim > 0 ? <div style={{ position: "absolute", inset: 0, borderRadius: 34, background: `rgba(5,10,22,${dim})` }} /> : null}
    </div>
  );
};

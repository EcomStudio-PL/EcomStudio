/**
 * HERO ART — the dashboard's neon studio scene: a laptop in light
 * perspective running a chart, two floating glass panels and the magenta
 * energy waves behind them. Pure inline SVG (no bitmap, ~2 KB, themable via
 * currentColor-free gradients), absolutely positioned by the caller and
 * hidden on small screens where the greeting needs the width.
 */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 560 340"
      aria-hidden
      className={className}
      fill="none"
    >
      <defs>
        <linearGradient id="ha-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C014BE" />
          <stop offset="0.55" stopColor="#F03CE0" />
          <stop offset="1" stopColor="#FF5CE2" />
        </linearGradient>
        <linearGradient id="ha-wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#F03CE0" stopOpacity="0" />
          <stop offset="0.45" stopColor="#F03CE0" stopOpacity="0.75" />
          <stop offset="1" stopColor="#A855F7" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="ha-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(45 30 62)" />
          <stop offset="1" stopColor="rgb(26 17 37)" />
        </linearGradient>
        <linearGradient id="ha-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(255 255 255)" stopOpacity="0.14" />
          <stop offset="1" stopColor="rgb(255 255 255)" stopOpacity="0.04" />
        </linearGradient>
        <filter id="ha-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="ha-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Ambient glow pools. */}
      <ellipse cx="330" cy="200" rx="200" ry="110" fill="#F03CE0" opacity="0.16" filter="url(#ha-blur)" />
      <ellipse cx="470" cy="110" rx="110" ry="70" fill="#FF5CE2" opacity="0.14" filter="url(#ha-blur)" />
      <ellipse cx="180" cy="270" rx="120" ry="60" fill="#A855F7" opacity="0.12" filter="url(#ha-blur)" />

      {/* Energy waves sweeping behind the laptop. */}
      <path d="M20 250 C 120 240 160 150 260 168 S 430 260 560 150" stroke="url(#ha-wave)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M0 280 C 110 276 180 190 285 205 S 460 285 560 195" stroke="url(#ha-wave)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <path d="M60 305 C 160 302 210 235 305 245 S 470 305 560 240" stroke="url(#ha-wave)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />

      {/* Laptop — screen in light perspective. */}
      <g transform="translate(215 88)">
        <g transform="skewY(-4)">
          {/* Lid glow edge */}
          <rect x="-4" y="-4" width="208" height="138" rx="14" fill="#F03CE0" opacity="0.35" filter="url(#ha-soft)" />
          <rect x="0" y="0" width="200" height="130" rx="12" fill="url(#ha-screen)" stroke="rgb(255 255 255 / 0.18)" />
          {/* Screen content: header bar, bars, trend line */}
          <rect x="14" y="14" width="70" height="8" rx="4" fill="rgb(255 255 255 / 0.22)" />
          <rect x="14" y="30" width="44" height="6" rx="3" fill="rgb(255 255 255 / 0.10)" />
          <rect x="22" y="82" width="14" height="30" rx="3" fill="url(#ha-brand)" opacity="0.55" />
          <rect x="44" y="68" width="14" height="44" rx="3" fill="url(#ha-brand)" opacity="0.75" />
          <rect x="66" y="56" width="14" height="56" rx="3" fill="url(#ha-brand)" />
          <rect x="88" y="74" width="14" height="38" rx="3" fill="url(#ha-brand)" opacity="0.65" />
          <path d="M118 100 L 138 78 L 154 88 L 182 52" stroke="#FF5CE2" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="182" cy="52" r="4" fill="#FF5CE2" />
          <rect x="118" y="14" width="68" height="26" rx="6" fill="rgb(255 255 255 / 0.07)" stroke="rgb(255 255 255 / 0.10)" />
          <rect x="126" y="22" width="34" height="5" rx="2.5" fill="rgb(255 255 255 / 0.25)" />
          <rect x="126" y="31" width="22" height="4" rx="2" fill="#F03CE0" opacity="0.8" />
        </g>
        {/* Base */}
        <path d="M-26 138 L 226 128 L 252 164 L -48 178 Z" fill="rgb(35 23 49)" stroke="rgb(255 255 255 / 0.14)" />
        <path d="M-26 138 L 226 128 L 230 134 L -28 145 Z" fill="rgb(255 255 255 / 0.06)" />
        {/* Keyboard hint rows */}
        <path d="M-10 150 L 210 141" stroke="rgb(255 255 255 / 0.08)" strokeWidth="3" strokeLinecap="round" />
        <path d="M-18 160 L 218 150" stroke="rgb(255 255 255 / 0.06)" strokeWidth="3" strokeLinecap="round" />
        {/* Under-glow */}
        <ellipse cx="102" cy="182" rx="150" ry="16" fill="#F03CE0" opacity="0.25" filter="url(#ha-soft)" />
      </g>

      {/* Floating glass panel: image tile with checkmark. */}
      <g transform="translate(438 60) rotate(6)">
        <rect width="86" height="98" rx="12" fill="url(#ha-glass)" stroke="rgb(255 255 255 / 0.18)" />
        <rect x="10" y="10" width="66" height="52" rx="8" fill="url(#ha-brand)" opacity="0.85" />
        <circle cx="24" cy="26" r="6" fill="rgb(255 255 255 / 0.7)" />
        <path d="M14 54 L 34 38 L 50 50 L 66 32" stroke="rgb(255 255 255 / 0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="10" y="70" width="42" height="6" rx="3" fill="rgb(255 255 255 / 0.30)" />
        <rect x="10" y="82" width="28" height="5" rx="2.5" fill="rgb(255 255 255 / 0.16)" />
        <circle cx="68" cy="80" r="9" fill="#A855F7" opacity="0.9" />
        <path d="M64 80 L 67 83 L 72 76" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Floating glass panel: credits pill. */}
      <g transform="translate(140 92) rotate(-7)">
        <rect width="104" height="44" rx="12" fill="url(#ha-glass)" stroke="rgb(255 255 255 / 0.18)" />
        <circle cx="22" cy="22" r="10" fill="url(#ha-brand)" />
        <path d="M22 15 L 18 23 L 22 23 L 21 29 L 26 20 L 22.5 20 Z" fill="#fff" />
        <rect x="38" y="12" width="48" height="8" rx="4" fill="rgb(255 255 255 / 0.35)" />
        <rect x="38" y="26" width="30" height="6" rx="3" fill="rgb(255 255 255 / 0.15)" />
      </g>

      {/* Sparkles. */}
      <g fill="#FF5CE2">
        <path d="M120 60 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 Z" opacity="0.9" />
        <path d="M508 208 l2 4.5 4.5 2 -4.5 2 -2 4.5 -2 -4.5 -4.5 -2 4.5 -2 Z" opacity="0.7" />
        <path d="M96 200 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6 Z" opacity="0.55" />
      </g>
    </svg>
  );
}

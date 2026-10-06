"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A STACK OF GROVBASE CREDIT COINS — taller for a bigger pack.
 *
 * One inline SVG, no asset: `level` coins (1–5) stacked bottom-up, each a
 * magenta disc seen at an angle with the credit diamond stamped on the top
 * one. Colours come from the theme tokens (--accent, --accent-strong,
 * --accent-glow), so the same stack reads correctly in light and dark mode.
 * Decorative: `aria-hidden`, the pack's text says what it is.
 */
export function CreditCoinStack({ level, size = 40, className }: {
  level: number;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const coins = Math.max(1, Math.min(5, Math.round(level)));
  // Geometry in a 40×40 box: a coin is an ellipse face (rx 12, ry 4.2) on a
  // 3.4px-thick rim; each coin sits 4.6px above the one below it. The stack is
  // centred vertically so a short stack does not hug the bottom edge.
  const rx = 12;
  const ry = 4.2;
  const rim = 3.4;
  const gap = 4.6;
  const height = (coins - 1) * gap + rim + ry * 2;
  const bottom = 20 + height / 2 - ry;
  // A slight alternating offset reads as a hand-stacked pile, not a column.
  const dx = (i: number) => (i % 2 === 0 ? 0 : i % 4 === 1 ? 1.4 : -1.2);

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden
      className={cn("shrink-0 overflow-visible", className)}>
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "rgb(var(--accent-glow))" }} />
          <stop offset="55%" style={{ stopColor: "rgb(var(--accent))" }} />
          <stop offset="100%" style={{ stopColor: "rgb(var(--accent-strong))" }} />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: "rgb(var(--accent-strong))" }} />
          <stop offset="50%" style={{ stopColor: "rgb(var(--accent))" }} />
          <stop offset="100%" style={{ stopColor: "rgb(var(--accent-strong))" }} />
        </linearGradient>
      </defs>
      {Array.from({ length: coins }, (_, i) => {
        const cx = 20 + dx(i);
        const cy = bottom - i * gap;
        const top = i === coins - 1;
        return (
          <g key={i}>
            {/* rim: the band between the face and its lower edge */}
            <path
              d={`M ${cx - rx} ${cy} v ${rim} a ${rx} ${ry} 0 0 0 ${rx * 2} 0 v ${-rim} Z`}
              fill={`url(#${id}-rim)`} />
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id}-face)`}
              style={{ stroke: "rgb(255 255 255 / 0.35)" }} strokeWidth={0.6} />
            {top && (
              // The credit diamond, as on the wallet chip in the header.
              <path d={`M ${cx} ${cy - 2.3} L ${cx + 3.6} ${cy} L ${cx} ${cy + 2.3} L ${cx - 3.6} ${cy} Z`}
                fill="rgb(255 255 255 / 0.9)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * FLAG — inline SVG, never an emoji.
 *
 * Flag emoji (🇵🇱) are rendered by Windows as the bare letter pair "PL",
 * which is exactly the "language shows text instead of a flag" defect. An
 * SVG renders identically on every platform, scales with the control and
 * inherits nothing from the system emoji font.
 */
export function Flag({ code, size = 18 }: { code: string; size?: number }) {
  const h = Math.round(size * 0.7);
  const common = { width: size, height: h, viewBox: "0 0 24 16", "aria-hidden": true as const, className: "shrink-0 rounded-[3px] ring-1 ring-black/15" };
  if (code === "pl") {
    return (
      <svg {...common}>
        <rect width="24" height="8" fill="#fff" />
        <rect y="8" width="24" height="8" fill="#DC143C" />
      </svg>
    );
  }
  if (code === "de") {
    return (
      <svg {...common}>
        <rect width="24" height="5.34" fill="#000" />
        <rect y="5.34" width="24" height="5.33" fill="#DD0000" />
        <rect y="10.67" width="24" height="5.33" fill="#FFCE00" />
      </svg>
    );
  }
  if (code === "en" || code === "gb") {
    return (
      <svg {...common}>
        <rect width="24" height="16" fill="#012169" />
        <path d="M0 0l24 16M24 0L0 16" stroke="#fff" strokeWidth="3.2" />
        <path d="M0 0l24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.9" />
        <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5.3" />
        <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="3.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect width="24" height="16" fill="currentColor" opacity="0.2" />
    </svg>
  );
}

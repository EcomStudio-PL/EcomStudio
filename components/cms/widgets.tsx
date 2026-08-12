"use client";
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Scroll-reveal wrapper: fades content in on first intersection.
 *  Respects prefers-reduced-motion (CSS kills the transition). */
export function Reveal({ children, className, delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={cn("transition-all duration-500 ease-out", shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0", className)}>
      {children}
    </div>
  );
}

/** Before/after comparison. With media: draggable divider over two images.
 *  Without media: honest stylized placeholder panels. */
export function BeforeAfter({ beforeUrl, afterUrl, beforeLabel, afterLabel }: {
  beforeUrl?: string | null; afterUrl?: string | null; beforeLabel: string; afterLabel: string;
}) {
  const [pos, setPos] = useState(55);
  if (!beforeUrl || !afterUrl) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-raised">
          <div className="absolute inset-6 rounded-xl bg-gradient-to-br from-line/60 to-raised" />
          <div className="absolute bottom-10 left-1/2 h-24 w-20 -translate-x-1/2 rounded-lg bg-line/80" />
          <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">{beforeLabel}</span>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 via-raised to-accent2/15">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(24rem_16rem_at_70%_20%,rgb(var(--accent)/0.25),transparent_60%)]" />
          <div className="absolute bottom-8 left-1/2 h-28 w-24 -translate-x-1/2 rounded-lg bg-gradient-to-b from-accent/70 to-accent-strong/70 shadow-2xl" />
          <span className="brand-gradient absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">{afterLabel}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="relative aspect-[16/9] select-none overflow-hidden rounded-2xl border border-line">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={afterUrl} alt={afterLabel} className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={beforeUrl} alt={beforeLabel} className="h-full w-full object-cover" style={{ width: `${100 * (100 / pos)}%`, maxWidth: "none" }} />
      </div>
      <div aria-hidden className="absolute inset-y-0 w-0.5 bg-white/90" style={{ left: `${pos}%` }} />
      <input
        type="range" min={5} max={95} value={pos} aria-label={`${beforeLabel} / ${afterLabel}`}
        onChange={(e) => setPos(parseInt(e.target.value, 10))}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">{beforeLabel}</span>
      <span className="brand-gradient absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">{afterLabel}</span>
    </div>
  );
}

/** Click-to-play video: renders only the poster until the user opts in —
 *  nothing heavy downloads automatically. */
export function LazyVideo({ embed, posterUrl, label }: {
  embed: { kind: "iframe" | "file"; src: string } | null; posterUrl?: string | null; label: string;
}) {
  const [playing, setPlaying] = useState(false);
  if (!embed) {
    return (
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent/15 via-raised to-accent2/10">
        <div aria-hidden className="brand-gradient flex h-14 w-14 items-center justify-center rounded-full opacity-80">
          <Play size={22} className="ml-0.5 text-white" />
        </div>
      </div>
    );
  }
  if (!playing) {
    return (
      <button type="button" onClick={() => setPlaying(true)} aria-label={label}
        className="group relative block aspect-video w-full overflow-hidden rounded-2xl border border-line bg-raised">
        {posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-accent/15 via-raised to-accent2/10" />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="brand-gradient flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-transform duration-200 group-hover:scale-110">
            <Play size={22} className="ml-0.5 text-white" />
          </span>
        </span>
      </button>
    );
  }
  return embed.kind === "file" ? (
    <video src={embed.src} poster={posterUrl ?? undefined} controls autoPlay playsInline
      className="aspect-video w-full rounded-2xl border border-line bg-black" />
  ) : (
    <iframe src={`${embed.src}?autoplay=1`} title={label} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
      className="aspect-video w-full rounded-2xl border border-line bg-black" />
  );
}

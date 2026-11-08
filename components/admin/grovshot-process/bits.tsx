"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small shared pieces of the process panel. */

export const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {});
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const str = (x: unknown): string => (typeof x === "string" ? x : "");
export const usd = (m: number | null | undefined) => (m === null || m === undefined ? "UNKNOWN" : `$${(m / 1_000_000).toFixed(4)}`);
export const secs = (ms: number | null | undefined) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);
export const kb = (b: unknown) => (typeof b === "number" ? b >= 1_048_576 ? `${(b / 1_048_576).toFixed(2)} MB` : `${Math.round(b / 1024)} KB` : "—");
export const short = (h: unknown) => (typeof h === "string" && h ? `${h.slice(0, 12)}…` : "—");

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}
      className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:bg-raised"
      aria-label={label}
    >
      {ok ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {ok ? done : label}
    </button>
  );
}

export function Block({ title, copy, children, tone }: {
  title: string; copy?: { text: string; label: string; done: string }; children: React.ReactNode; tone?: "danger" | "warning";
}) {
  return (
    <section className={cn("space-y-1.5 rounded-xl border p-2.5", tone === "danger" ? "border-danger/50 bg-[rgb(var(--danger)/0.06)]" : tone === "warning" ? "border-warning/50 bg-[rgb(var(--warning)/0.06)]" : "border-line")}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-semibold">{title}</h4>
        {copy && <CopyButton {...copy} />}
      </div>
      {children}
    </section>
  );
}

export const pre = "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-raised p-2 font-mono text-[11px] leading-relaxed";

export function Kv({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents"><dt className="truncate text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
      ))}
    </dl>
  );
}

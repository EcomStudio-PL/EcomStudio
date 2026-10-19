"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { SELLER_CHANNELS, type SellerChannel } from "@/lib/launch/fields";
import { cn } from "@/lib/utils";

/**
 * GDZIE SPRZEDAJESZ? — one optional tap after signing up.
 *
 * The answer is bound to THIS submission, not to an address: the signup
 * response hands the browser a short-lived opaque handle (`answer`), and only
 * that handle can set the channel — so nobody can label somebody else's
 * signup by typing their e-mail (review S7). The route answers the same 200
 * whether the handle was live, expired or a decoy, so this component cannot
 * tell either, and does not try: one tap, one thank-you, done. A network
 * failure lets the visitor tap again.
 */
export function ChannelQuestion({ answer, question, labels, thanks }: {
  answer: string;
  question: string;
  labels: Record<SellerChannel, string>;
  thanks: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [picked, setPicked] = useState<SellerChannel | null>(null);

  async function pick(channel: SellerChannel) {
    if (state !== "idle") return;
    setPicked(channel);
    setState("busy");
    try {
      const res = await fetch("/api/public/prelaunch/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, channel }),
      });
      setState(res.ok ? "done" : "idle");
    } catch {
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p data-channel-thanks role="status"
        className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-ink">
        <Check size={15} aria-hidden className="text-accent" />{thanks}
      </p>
    );
  }

  return (
    <fieldset data-channel-question className="mt-4 min-w-0">
      <legend className="text-[13px] font-semibold text-ink">{question}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {SELLER_CHANNELS.map((channel) => (
          <button key={channel} type="button" disabled={state === "busy"}
            onClick={() => pick(channel)} data-channel={channel}
            aria-pressed={picked === channel}
            className={cn(
              // 40px tall on their own — not `.tap`, whose negative margins
              // would pull neighbouring chips on top of each other.
              "h-10 rounded-full border px-3.5 text-[13px] font-semibold transition-colors [touch-action:manipulation]",
              picked === channel
                ? "border-[rgb(var(--accent)/0.6)] bg-[rgb(var(--accent)/0.18)] text-ink"
                : "border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--surface)/0.6)] text-ink hover:border-[rgb(var(--accent)/0.45)]",
              state === "busy" && "cursor-wait opacity-70",
            )}>
            {labels[channel]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

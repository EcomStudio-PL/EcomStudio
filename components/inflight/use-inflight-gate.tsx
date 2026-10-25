"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { activeOperations, useInflight } from "@/lib/inflight/store";
import { limitText } from "@/components/inflight/inflight-tile";

/** How long "Dodano ✓" stays on the button after the server accepted a click. */
const ADDED_MS = 1_100;

/**
 * THE GENERUJ BUTTON'S SIDE OF GENERACJE W TOKU V2, shared by every panel.
 *
 *   · `atLimit` — this workspace already runs as many generations as its
 *     plan allows (the server enforces it anyway; this only spares a click
 *     that would be refused).
 *   · `added` / `flash()` — "Dodano ✓" for about a second after the server
 *     ACCEPTED, then the button is itself again. The panel is never cleared:
 *     photos, their order, the prompt and the settings stay as they were.
 *   · `balance` — the wallet as the server last reported it (after a charge,
 *     after a refund), for the panel's own balance line.
 */
export function useInflightGate() {
  const { tiles, limit, balance, balanceAt } = useInflight();
  const ops = activeOperations(tiles);
  const atLimit = limit !== null && ops >= limit.max;
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), ADDED_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { atLimit, limit, ops, balance, balanceAt, added, flash };
}

/** "Masz 3 generacje w toku. To limit Twojego planu. …" + "Zwiększ limit"
 *  below Business (agency). */
export function LimitNote({ max, plan, className }: { max: number; plan: string; className?: string }) {
  const { t, locale } = useI18n();
  return (
    <p data-inflight-limit className={className ?? "mt-2 text-center text-[11px] leading-snug text-muted"}>
      {limitText(t, locale, max)}
      {plan !== "agency" && (
        <>
          {" "}
          <Link href="/plan" className="font-semibold text-accent hover:opacity-75">{t("inflight.raiseLimit")}</Link>
        </>
      )}
    </p>
  );
}

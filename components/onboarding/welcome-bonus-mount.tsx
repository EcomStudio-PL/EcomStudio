"use client";
import { useEffect, useState } from "react";
import { WelcomeBonusModal, type BonusModalProps } from "@/components/onboarding/welcome-bonus-modal";

/**
 * WHEN THE BONUS MODAL OPENS.
 *
 * Once per sign-in session, not once per page view. The app layout renders on
 * every navigation, so "show it when eligible" would have meant the modal
 * reappearing every time the customer clicked anything — the fastest way to
 * make a gift feel like an ad.
 *
 * The marker is a sessionStorage key tied to the offer: it survives navigation
 * and refresh within the tab, and is gone on the next fresh session, which is
 * exactly the "offer again on the next login" rule. It only ever SUPPRESSES a
 * popup, so a browser that blocks storage simply sees the modal once per load
 * rather than being handed anything it should not have.
 */
const seenKey = (expiresAt: string) => `grovbase_bonus_seen:${expiresAt}`;

export function WelcomeBonusMount(props: Omit<BonusModalProps, "autoOpen"> & {
  /** ?bonus=1 — the customer asked for it explicitly from the bell. */
  requested: boolean;
}) {
  const [decided, setDecided] = useState<boolean | null>(null);

  useEffect(() => {
    if (props.requested) { setDecided(true); return; }
    try {
      const key = seenKey(props.offer.expiresAt);
      if (window.sessionStorage.getItem(key) === "1") { setDecided(false); return; }
      window.sessionStorage.setItem(key, "1");
      setDecided(true);
    } catch {
      // Storage refused (private mode, blocked cookies): show it. Once per
      // page load is still far better than never telling them about it.
      setDecided(true);
    }
  }, [props.requested, props.offer.expiresAt]);

  // Nothing renders until the decision is made, so the modal cannot flash on
  // a navigation where it should have stayed shut.
  if (decided === null) return null;
  return <WelcomeBonusModal {...props} autoOpen={decided} />;
}

"use client";
import { useEffect } from "react";
import { browserStore, refCodeFromSearch, rememberRef } from "./referral";
import { launchTrack } from "./launch-analytics";

/** One page_view per document load, however often React mounts this. */
let reported = false;

/**
 * Two things the landing page does once, on arrival, and nothing else:
 *
 *  - REMEMBERS A REFERRAL. `?ref_code=` from a friend's link goes into
 *    localStorage for 30 days (components/launch/referral.ts), so the signup
 *    form can send it whenever the visitor gets round to it.
 *  - COUNTS THE VISIT as `prelaunch_page_view`, with the traffic source the
 *    server worked out from the first-touch cookie. Not inside a frame and not
 *    with ?preview (launch-analytics.ts) — an admin's preview is not a visit.
 *
 * Renders nothing.
 */
export function LaunchBeacon({ trafficSource }: { trafficSource: string }) {
  useEffect(() => {
    const code = refCodeFromSearch(window.location.search);
    if (code) rememberRef(browserStore(), code);
    if (reported) return;
    reported = true;
    launchTrack("prelaunch_page_view", { traffic_source: trafficSource });
  }, [trafficSource]);
  return null;
}

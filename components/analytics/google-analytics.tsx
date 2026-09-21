"use client";
import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import {
  GA_MEASUREMENT_ID, createTracker, gaEnabled, type DataLayer, type Tracker,
} from "@/lib/analytics/ga";

/**
 * GOOGLE ANALYTICS 4, IN ONE PLACE.
 *
 * The whole integration is this file plus lib/analytics/ga.ts — no gtag call
 * anywhere else in the application, no second script tag, no measurement ID
 * typed into a component.
 *
 * WHAT IS DIFFERENT FROM GOOGLE'S COPY-PASTE SNIPPET, AND WHY:
 *
 *  - NO INLINE BOOTSTRAP SCRIPT. The four lines that create `dataLayer` and
 *    the `gtag` shim run from React instead, which removes a race: `next/script`
 *    makes no promise about running before an effect, so a page_view that
 *    waits for `window.gtag` can fire into a function that does not exist yet.
 *    The shim is trivial and it is the queue — gtag.js replays whatever it
 *    finds when it loads, which is the mechanism that lets the tag be async at
 *    all.
 *
 *  - `send_page_view: false`. gtag.js would otherwise send its own page_view
 *    on `config`, and this router has to report navigations itself, so every
 *    first load would be counted twice. Now exactly one code path sends
 *    page_views and it sends the first one too.
 *
 *  - THE URL IS SANITISED. `page_location` is a full address, and this app
 *    puts recovery tokens, OAuth codes and newsletter tokens in addresses. See
 *    lib/analytics/ga.ts.
 *
 * NOTHING BLOCKS THE RENDER. `afterInteractive` means the tag is fetched once
 * the page is usable; until then the effect queues into an array, which costs
 * nothing and loses nothing.
 */

declare global {
  interface Window { dataLayer?: DataLayer }
}

/** One tracker per document. A module-level handle is what makes "initialise
 *  once" true across remounts and React's double-invoked effects in dev. */
let tracker: Tracker | null = null;

function trackerFor(): Tracker {
  if (!tracker) {
    window.dataLayer = window.dataLayer ?? [];
    tracker = createTracker(window.dataLayer, GA_MEASUREMENT_ID);
  }
  return tracker;
}

export function GoogleAnalytics() {
  // Not configured (any local build, any preview without the variable) means
  // no script, no tag, nothing in the document at all.
  if (!gaEnabled()) return null;
  return (
    <>
      <Script
        id="ga-gtag"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      {/*
        useSearchParams() opts its subtree out of prerendering, so it is
        isolated behind Suspense: the rest of the document still renders
        statically where it did before, and this boundary resolves on the
        client. The fallback is deliberately nothing — analytics has no UI.
      */}
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
    </>
  );
}

/** One page_view per address, including the first. */
function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    const ga = trackerFor();
    if (!started.current) {
      started.current = true;
      ga.init();
    }
    // The live address rather than a rebuilt one: `pathname` loses the query
    // and rebuilding it from `searchParams` loses nothing but is one more way
    // to be subtly wrong about encoding. The sanitiser is what makes reading
    // the real URL safe.
    ga.pageView(window.location.href, document.title);
    // `searchParams` is a new object each render; its STRING is the identity
    // that matters, and the tracker de-duplicates anything that slips past.
  }, [pathname, searchParams]);

  return null;
}

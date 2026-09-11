"use client";
import { Toaster } from "sonner";
import { CheckCircle2, AlertTriangle, RotateCcw, Info } from "lucide-react";

/**
 * APP TOASTER — the single surface every transient message is drawn on.
 *
 * Mounted exactly once, in the root layout. What each message SAYS and how long
 * it stays belongs to lib/notify; this file owns where it appears and what it
 * looks like.
 *
 * WHY IT SITS AT THE BOTTOM. The previous mount was `position="top-center"`
 * with `richColors`, and on a phone that put a full-width, system-styled slab
 * across the top of the screen — under the iOS status bar, over the page
 * header, nothing to do with the rest of the product. Messages are feedback on
 * something the thumb just did, so they belong where the thumb already is.
 *
 * THE MOBILE OFFSET COMES FROM THE NAV'S OWN TOKEN. `--toast-bottom` in
 * globals.css is `--dock-h + safe-area + 14px`, and `--dock-h` is the same
 * constant six other docked surfaces already position against (the action bar,
 * the bulk-select bar, the generator toolbar, the editor bar). So the toast
 * cannot drift away from the navigation: if the dock's height changes, both
 * move together. It never covers the navigation, and on a notched iPhone it
 * rides up with the home indicator instead of sitting on top of it.
 *
 * A screen that docks a SECOND bar above the nav will have the toast pass in
 * front of that bar for the few seconds it is up. That is deliberate — a
 * message about what the bar just did should not be hidden behind it.
 *
 * DESKTOP has no dock at all (`lg:hidden`), so it only needs to clear the
 * window edge.
 *
 * `unstyled` turns off sonner's own skin completely — richColors is what made
 * the old box look like a browser alert. Everything below is GrovBase tokens:
 * the same glass, border and shadow as the rest of the app, with one accent
 * stripe carrying the severity.
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      // No width override. sonner sizes the container and then insets each
      // toast by mobileOffset again (`width: calc(100% - offset*2)`), so
      // constraining the container as well shrank the phone toast twice —
      // measured 342px where the default gives 366px.
      // Desktop: just off the window edge. Mobile: above the dock, computed above.
      offset={{ bottom: "24px" }}
      mobileOffset={{ bottom: "var(--toast-bottom)", left: "12px", right: "12px" }}
      // Three at once is a stack; more is a wall of text nobody reads. Older
      // messages fall off the top rather than pushing the newest out of view.
      visibleToasts={3}
      gap={8}
      closeButton
      // No `theme` prop on purpose: every colour below is a GrovBase CSS
      // variable that already flips with .dark, so sonner has no theme
      // decision left to make and hardcoding one would only fight next-themes.
      icons={{
        success: <CheckCircle2 aria-hidden className="h-[18px] w-[18px]" />,
        error: <AlertTriangle aria-hidden className="h-[18px] w-[18px]" />,
        warning: <RotateCcw aria-hidden className="h-[18px] w-[18px]" />,
        info: <Info aria-hidden className="h-[18px] w-[18px]" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            "grov-toast group pointer-events-auto flex w-full items-center gap-3",
            "rounded-2xl border px-3.5 py-3",
            // OPAQUE, not glassy-transparent. At 0.96 the toast behind the front
            // one showed its text through, so a stack read as one smudged
            // message. The backdrop blur below still does the glass work
            // against the page.
            "border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--glass))]",
            "text-[13px] leading-[1.35] text-ink backdrop-blur-2xl",
            "shadow-[0_18px_44px_-18px_rgb(0_0_0/0.75),inset_0_1px_0_rgb(190_200_255/0.06)]",
          ].join(" "),
          title: "min-w-0 flex-1 font-medium",
          description: "mt-0.5 text-[12px] text-muted",
          icon: "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl",
          closeButton: [
            "!left-auto !right-2 !top-1/2 !-translate-y-1/2 !translate-x-0",
            "!h-6 !w-6 !rounded-lg !border-[rgb(var(--glass-border)/0.25)]",
            "!bg-[rgb(var(--surface)/0.7)] !text-faint hover:!text-ink",
          ].join(" "),
          // One stripe and one icon tint per severity. The body stays the same
          // GrovBase glass in all four, so a message never stops looking like
          // part of the product.
          success: "grov-toast--success",
          error: "grov-toast--error",
          warning: "grov-toast--warning",
          info: "grov-toast--info",
        },
      }}
    />
  );
}

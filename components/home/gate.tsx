"use client";
import Link from "next/link";
import { useAuthDialog } from "@/components/auth/auth-dialog-context";
import type { AuthMode } from "@/lib/auth-routes";

/**
 * THE ONE PLACE A STRANGER IS ASKED TO SIGN IN.
 *
 * "/" shows the whole product to everyone. Looking is free: the catalogue, the
 * examples, the prices, the names of every tool. What is NOT free is starting
 * work — a generation costs credits, and credits belong to a workspace, and a
 * workspace belongs to an account.
 *
 * So every destination inside the application is wrapped in this. A signed-in
 * customer gets an ordinary <Link> and nothing changes. A visitor gets the
 * SAME element — still an <a> with a real href, so middle-click, "open in new
 * tab" and a crawler all behave — but a left click opens the existing auth
 * dialog instead of navigating.
 *
 * WHY NOT JUST LET THEM CLICK. Because the route would bounce them: every page
 * under app/(app) redirects to /login. The bounce works, and it is a terrible
 * first experience — a full page load, a flash of nothing, and an arrival at a
 * form with no memory of what they wanted. Asking on the spot is the same
 * outcome, one tick sooner, without losing the intent.
 *
 * THE INTENT IS THE POINT. `next` carries the destination through the dialog;
 * `safeReturnTo` inside the provider refuses anything that is not a path on
 * this site, so the parameter cannot be turned into an open redirect. After a
 * successful sign-in the customer lands on the tool they pressed, not on a
 * dashboard they have to navigate out of.
 *
 * THIS IS NOT A SECURITY BOUNDARY AND DOES NOT PRETEND TO BE ONE. The real
 * gate is the (app) layout, the middleware and RLS. This is courtesy: it makes
 * the product legible to somebody who has not signed up yet.
 */
export function Gate({
  href, signedIn, children, className, ariaLabel, onGated, mode = "login",
}: {
  href: string;
  signedIn: boolean;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Extra work on the gated click — analytics, closing a sheet. Optional. */
  onGated?: () => void;
  /** Which side of the SAME dialog a visitor lands on. "Wypróbuj za darmo" is
   *  an invitation to open an account, so it opens on registration; opening a
   *  tool asks a returning customer to sign in. */
  mode?: AuthMode;
}) {
  const auth = useAuthDialog();

  if (signedIn) {
    return <Link href={href} className={className} aria-label={ariaLabel}>{children}</Link>;
  }

  return (
    <a
      href={href}
      className={className}
      aria-label={ariaLabel}
      data-gated="1"
      onClick={(e) => {
        // A modified click is the customer asking the BROWSER for something —
        // a new tab, a new window, a download. Hijacking it would be rude and
        // the target still bounces to /login, which is the correct place for a
        // new tab to land.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onGated?.();
        auth.open(mode, href);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The same gate for something that is a BUTTON rather than a destination — the
 * upload box, "Utwórz". There is no href to fall back on, so a visitor gets a
 * button that opens the dialog and a customer gets one that runs `onRun`.
 */
export function GateButton({
  signedIn, next, onRun, children, className, type = "button", disabled,
}: {
  signedIn: boolean;
  /** Where the dialog should return to. */
  next: string;
  onRun?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const auth = useAuthDialog();
  return (
    <button
      type={type}
      disabled={disabled}
      data-gated={signedIn ? undefined : "1"}
      className={className}
      onClick={() => { if (signedIn) onRun?.(); else auth.open("login", next); }}
    >
      {children}
    </button>
  );
}

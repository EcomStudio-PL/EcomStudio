"use client";
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import Image from "next/image";
import { Check, Loader2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { LoginForm } from "@/components/auth/login-form";
import { ForgotForm } from "@/components/auth/forgot-form";
import { RegisterForm } from "@/components/auth/register-form";
import { registrationFormConfig, type RegistrationFormConfig } from "@/app/actions/registration-config";
import { accessViewAction, type AccessView } from "@/app/actions/platform-access";
import { AccessNotice } from "@/components/auth/access-notice";
import { useAuthDialog } from "@/components/auth/auth-dialog-context";
import { cn } from "@/lib/utils";

/**
 * THE AUTH DIALOG — one modal for signing in, signing up and recovering a
 * password, opened over whatever page the visitor is already reading.
 *
 * Opening is a state change (see auth-dialog-context.tsx), never a navigation:
 * the panel paints in the same tick as the click, and the URL follows. The
 * page underneath keeps its scroll position and is never re-rendered.
 *
 * What this is NOT: a second auth implementation. Sign-in is still the native
 * POST to /auth/sign-in, registration is still the same server action with the
 * same captcha, consents, IP cap and anti-multiaccount checks, and OAuth is
 * still Supabase's own redirect. Only the surface changed.
 */

export function AuthModal() {
  const { mode, next, error, email, close, switchTo } = useAuthDialog();
  const { t } = useI18n();

  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Where focus came from, so it can go back there on close (a11y). */
  const opener = useRef<HTMLElement | null>(null);
  const [registration, setRegistration] = useState<RegistrationFormConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [access, setAccess] = useState<AccessView | null>(null);

  // Whether the platform is open is asked ONCE, when the dialog first opens —
  // not on every button (§32). It only decides what to DRAW: the server
  // re-checks the real answer on every sign-in and sign-up attempt, so a
  // stale "open" here cannot let anyone through.
  useEffect(() => {
    if (!mode || access) return;
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    void accessViewAction(mobile).then(setAccess);
  }, [mode, access]);

  // The registration form needs two server-known things: the PUBLIC captcha
  // site key and which optional fields the admin asks for. Fetched the first
  // time the dialog opens in ANY mode — so switching login → register is
  // instant — and never on page load, so a visitor who never signs up pays
  // nothing for it.
  useEffect(() => {
    if (!mode || registration || loadingConfig) return;
    setLoadingConfig(true);
    void registrationFormConfig().then((config) => {
      setRegistration(config);
      setLoadingConfig(false);
    });
  }, [mode, registration, loadingConfig]);

  // Remember the opener, lock the body, restore both on close. The lock uses
  // position-independent overflow so the page underneath never jumps or loses
  // its scroll offset.
  useEffect(() => {
    if (!mode) return;
    opener.current = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const { overflow, paddingRight } = document.body.style;
    const htmlOverflow = html.style.overflow;
    // Compensating for the scrollbar keeps the page underneath from jumping
    // sideways the moment the dialog opens.
    const gap = window.innerWidth - html.clientWidth;
    // BOTH elements: on this layout the document element is the scrolling box,
    // so hiding overflow on <body> alone left the page behind the dialog fully
    // scrollable — which is what let a touch drag move the page instead of the
    // form on a small screen.
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      html.style.overflow = htmlOverflow;
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      opener.current?.focus?.();
    };
  }, [mode]);

  /**
   * CENTRE IT IN WHAT IS ACTUALLY VISIBLE.
   *
   * `100dvh` accounts for Safari's collapsing toolbar but NOT for the software
   * keyboard: with the keyboard up, the layout viewport is unchanged and only
   * the VISUAL viewport shrinks, so a "centred" card is centred behind the
   * keyboard. The dialog is fixed, so the page cannot scroll to rescue it
   * either — which is why the card looked like it sat at the bottom of the
   * screen. Sizing the overlay to visualViewport fixes both: no keyboard, the
   * card is centred on screen; keyboard up, the box shrinks, the card rides
   * above it and the form scrolls inside itself.
   */
  useEffect(() => {
    if (!mode) return;
    const vv = window.visualViewport;
    const root = rootRef.current;
    if (!vv || !root) return;
    const sync = () => {
      root.style.height = `${vv.height}px`;
      root.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.height = "";
      root.style.transform = "";
    };
  }, [mode]);

  // ESC closes; Tab is trapped inside the panel.
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, close]);

  // Focus the panel itself on open, so a screen reader announces the dialog
  // instead of leaving the caret on the page behind it.
  useEffect(() => {
    if (mode) panelRef.current?.focus();
  }, [mode]);

  const copy = useMemo(() => ({
    login: { title: t("auth.loginTitle"), sub: t("auth.loginSub") },
    register: { title: t("auth.registerTitle"), sub: t("auth.registerSub") },
    forgot: { title: t("auth.resetTitle"), sub: t("auth.resetSub") },
  }), [t]);

  if (!mode) return null;

  // Registration earns the extra width — it is what lets first/last name and
  // e-mail/phone sit side by side instead of stacking into a long column.
  const wide = mode === "register";

  /**
   * Is this mode shut? Undecided (`access === null`) is treated as OPEN so the
   * form paints immediately — the instant-open behaviour must not regress into
   * "wait for a settings fetch". If the answer comes back closed a moment
   * later the notice replaces the form, and the server would have refused the
   * submission anyway.
   */
  const blocked = mode === "login" ? (access?.loginBlocked ?? null)
    : mode === "register" ? (access?.signupBlocked ?? null)
      : null;

  /** The waiting list is the EXISTING flow: the launch page's own form when we
   *  are on it, otherwise the launch page itself. No second waitlist. */
  const goToWaitlist = () => {
    close();
    const form = document.querySelector("[data-waitlist-form]");
    if (form) {
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.querySelector("input")?.focus?.();
      return;
    }
    window.location.href = "/";
  };

  return (
    <div
      ref={rootRef}
      className="auth-modal-root fixed inset-x-0 top-0 z-[100] flex h-[100dvh] items-center justify-center p-2.5 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      {/* BACKDROP — the page stays readable underneath: a light dim plus a
          restrained blur, not a blackout. Clicking it closes. */}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={close}
        className="auth-backdrop absolute inset-0 cursor-default bg-[rgb(var(--bg)/0.72)] backdrop-blur-[8px]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "auth-panel panel relative flex w-full flex-col overflow-hidden rounded-3xl outline-none lg:flex-row",
          wide ? "max-w-[880px]" : "max-w-[560px] lg:max-w-[900px]",
        )}
        style={{
          // Relative to the OVERLAY, which is sized to the visual viewport —
          // so the cap follows Safari's toolbar and the keyboard instead of
          // guessing at them the way 100vh does.
          maxHeight: "min(100%, 800px)",
        }}
      >
        {/* The orbiting light. Decorative and CSS-only — see .auth-panel. */}
        <span aria-hidden className="auth-orbit" />

        <BrandPane wide={wide} />

        <div className={cn(
          "relative flex min-h-0 w-full flex-col",
          wide ? "lg:w-[560px] lg:shrink-0" : "lg:w-[460px] lg:shrink-0",
        )}>
          <div className="flex items-start justify-between gap-3 px-4 pb-1.5 pt-5 sm:px-6 sm:pt-6">
            <div className="min-w-0">
              {/* The mark, on mobile too — the dialog has to say whose it is
                  even when the page behind it is blurred out. */}
              <span className="brand-gradient mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl lg:hidden">
                <Image src="/brand/icon-on-dark.png" alt="" width={20} height={20} className="h-5 w-5" />
              </span>
              <h2 id="auth-modal-title" className="font-display text-[19px] font-semibold leading-tight tracking-tight sm:text-xl">
                {copy[mode].title}
              </h2>
              <p className="mt-1 text-[13px] leading-snug text-muted sm:text-sm">{copy[mode].sub}</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t("common.close")}
              className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X size={18} aria-hidden />
            </button>
          </div>

          <ModeBody mode={`${mode}:${blocked ?? ""}`}>
            {/* A closed door gets an invitation, not an error. The form is not
                rendered at all — there is nothing to submit. */}
            {blocked ? (
              <AccessNotice
                reason={blocked}
                copy={access!.copy}
                waitlistEnabled={access!.waitlistEnabled}
                onWaitlist={goToWaitlist}
                onSwitchToLogin={
                  // Only offered when signup is the thing that is shut and
                  // existing customers can still get in.
                  mode === "register" && !access!.loginBlocked
                    ? () => switchTo("login")
                    : undefined
                }
              />
            ) : (
              <>
                {mode === "login" && (
                  <LoginForm next={next} error={error} email={email} onSwitch={switchTo} />
                )}
                {mode === "forgot" && (
                  <ForgotForm onBack={() => switchTo("login")} />
                )}
                {mode === "register" && (
                  registration
                    ? <RegisterForm
                        bare
                        next={next}
                        captchaSiteKey={registration.captchaSiteKey}
                        onSwitch={switchTo}
                      />
                    : <div className="flex h-56 items-center justify-center text-muted">
                        <Loader2 className="animate-spin" aria-hidden />
                      </div>
                )}
              </>
            )}
          </ModeBody>
        </div>
      </div>
    </div>
  );
}

/**
 * The scroller, with an animated height.
 *
 * Login is short and registration is long, and jumping between the two looked
 * like a reload. So the box measures its content and transitions to the new
 * height, capped by the panel — past the cap it simply scrolls, which is what
 * a long registration form does on a phone. The measurement is a
 * ResizeObserver, not a rAF loop: it fires when the content actually changes
 * size and at no other time.
 */
function ModeBody({ mode, children }: { mode: string; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    const box = boxRef.current;
    if (!el || !box) return;
    // border-box: the height we set INCLUDES the scroller's own padding, so
    // the content's height alone would leave the box permanently short by
    // that much — and a login form that fits would still show a scrollbar.
    const measure = () => {
      const cs = getComputedStyle(box);
      const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setHeight(el.offsetHeight + padding);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Transition only AFTER the first measurement, so opening the dialog does
    // not animate from zero height.
    const id = window.setTimeout(() => setReady(true), 60);
    return () => { ro.disconnect(); window.clearTimeout(id); };
  }, []);

  return (
    <div
      ref={boxRef}
      className={cn(
        "auth-modal-body min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1.5 sm:px-6",
        ready && "auth-modal-body-animated",
      )}
      style={height === null ? undefined : { height }}
    >
      <div ref={contentRef}>
        {/* Keyed on the mode: React swaps the subtree and the crossfade makes
            the swap read as one card changing, not a page reloading. */}
        <div key={mode} className="auth-mode-enter pb-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * The left pane: GrovBase's own promise, not a stock image and not anyone
 * else's product shot. Desktop only — on a phone the form is the whole point
 * and this would push it below the fold.
 */
function BrandPane({ wide }: { wide: boolean }) {
  const { t } = useI18n();
  const benefits = ["auth.benefit1", "auth.benefit2", "auth.benefit3"];
  return (
    <div
      className={cn(
        "relative hidden shrink-0 flex-col justify-between overflow-hidden p-7 lg:flex",
        wide ? "lg:w-[320px]" : "lg:w-[440px]",
      )}
      style={{
        background:
          "radial-gradient(28rem 20rem at 12% 8%, rgb(var(--accent) / 0.22), transparent 68%)," +
          "radial-gradient(24rem 18rem at 92% 92%, rgb(var(--violet) / 0.18), transparent 70%)," +
          "rgb(var(--raised))",
      }}
    >
      <div className="relative flex items-center gap-2.5">
        <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl">
          <Image src="/brand/icon-on-dark.png" alt="" width={22} height={22} className="h-[22px] w-[22px]" />
        </span>
        <span className="font-display text-lg font-bold tracking-tight">GrovBase</span>
      </div>

      <div className="relative">
        <p className={cn(
          "font-display font-semibold leading-[1.2] tracking-tight",
          wide ? "text-[21px]" : "text-[26px]",
        )}>
          {t("auth.paneTitle")}
        </p>
        <ul className="mt-4 space-y-2.5">
          {benefits.map((key) => (
            <li key={key} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted">
              <span aria-hidden className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent)/0.18)] text-accent">
                <Check size={11} strokeWidth={3} />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-[12px] text-faint">{t("auth.paneFooter")}</p>
    </div>
  );
}

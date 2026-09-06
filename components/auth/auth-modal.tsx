"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { LoginForm } from "@/components/auth/login-form";
import { ForgotForm } from "@/components/auth/forgot-form";
import { RegisterForm } from "@/components/auth/register-form";
import { registrationFormConfig, type RegistrationFormConfig } from "@/app/actions/registration-config";
import { parseAuthMode, safeReturnTo, type AuthMode } from "@/lib/auth-routes";

/**
 * THE AUTH DIALOG — one modal for signing in, signing up and recovering a
 * password, opened over whatever page the visitor is already reading.
 *
 * State lives in the URL (`?auth=login|register|forgot`), not in a pile of
 * booleans. That is what makes the browser's Back button behave: opening and
 * switching mode PUSH history entries, so Back walks register → login →
 * closed, and a link to /?auth=register is shareable. `next` rides along as
 * the returnTo and is validated everywhere it is consumed.
 *
 * What this is NOT: a second auth implementation. Sign-in is still the native
 * POST to /auth/sign-in, registration is still the same server action with the
 * same captcha, consents, IP cap and anti-multiaccount checks, and OAuth is
 * still Supabase's own redirect. Only the surface changed.
 */


export function AuthModal() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  const urlMode = parseAuthMode(params.get("auth"));
  const next = safeReturnTo(params.get("next"));
  const error = params.get("error") ?? undefined;
  const email = params.get("email") ?? undefined;

  /**
   * The URL is the source of truth, but the dialog does not WAIT for it.
   *
   * Closing used to be a router.replace and nothing else — which means an RSC
   * round trip for the page underneath before the panel disappears. On a slow
   * connection (or a hung request) Escape did nothing visible for seconds.
   * So: local state mirrors the URL, closing clears it immediately, and the
   * URL is tidied up behind it.
   */
  const urlKey = `${pathname}?${params.toString()}`;
  const [mode, setMode] = useState<AuthMode | null>(urlMode);
  useEffect(() => { setMode(urlMode); }, [urlMode, urlKey]);

  const panelRef = useRef<HTMLDivElement>(null);
  /** Where focus came from, so it can go back there on close (a11y). */
  const opener = useRef<HTMLElement | null>(null);
  const [registration, setRegistration] = useState<RegistrationFormConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  /** Query string for a given mode, keeping the returnTo and dropping the
   *  one-shot error/email of a previous attempt. */
  const href = useCallback((to: AuthMode) => {
    const q = new URLSearchParams();
    q.set("auth", to);
    if (next) q.set("next", next);
    return `${pathname}?${q.toString()}`;
  }, [next, pathname]);

  const close = useCallback(() => {
    // Panel first, URL second — see the note on `mode` above.
    setMode(null);
    const q = new URLSearchParams(params.toString());
    for (const key of ["auth", "error", "email"]) q.delete(key);
    const rest = q.toString();
    // replace, not back(): Back may not lead anywhere (a fresh tab opened on
    // /?auth=login), and closing must never navigate off the site.
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const switchTo = useCallback((to: AuthMode) => {
    router.push(href(to), { scroll: false });
  }, [href, router]);

  // The registration form needs two server-known things: the PUBLIC captcha
  // site key and which optional fields the admin asks for. Fetched once, the
  // first time the register mode is opened — never on page load, so a visitor
  // who never signs up pays nothing for it.
  useEffect(() => {
    if (mode !== "register" || registration || loadingConfig) return;
    setLoadingConfig(true);
    void registrationFormConfig().then((config) => {
      setRegistration(config);
      setLoadingConfig(false);
    });
  }, [mode, registration, loadingConfig]);

  // Remember the opener, lock the body, restore both on close.
  useEffect(() => {
    if (!mode) return;
    opener.current = document.activeElement as HTMLElement | null;
    const { overflow, paddingRight } = document.body.style;
    // Compensating for the scrollbar keeps the page underneath from jumping
    // sideways the moment the dialog opens.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      opener.current?.focus?.();
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6"
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
        className="absolute inset-0 cursor-default bg-[rgb(var(--bg)/0.72)] backdrop-blur-[8px] animate-fade"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="panel animate-pop relative flex w-full max-w-[1040px] flex-col overflow-hidden rounded-t-3xl outline-none sm:rounded-3xl lg:flex-row"
        style={{
          // dvh, not vh: on a phone the browser chrome and the keyboard both
          // change the visible height, and 100vh would push the submit button
          // under the fold exactly when it is needed.
          maxHeight: "min(92dvh, 780px)",
        }}
      >
        <BrandPane />

        <div className="flex min-h-0 w-full flex-col lg:w-[520px] lg:shrink-0">
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5 sm:px-7 sm:pt-6">
            <div className="min-w-0">
              {/* The mark, on mobile too — the dialog has to say whose it is
                  even when the page behind it is blurred out. */}
              <span className="brand-gradient mb-3 flex h-10 w-10 items-center justify-center rounded-xl lg:hidden">
                <Image src="/brand/icon-on-dark.png" alt="" width={22} height={22} className="h-[22px] w-[22px]" />
              </span>
              <h2 id="auth-modal-title" className="font-display text-xl font-semibold tracking-tight">
                {copy[mode].title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{copy[mode].sub}</p>
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

          {/* The scroller: registration is a long form, and on a phone the
              dialog must scroll INSIDE itself rather than growing past the
              viewport. The bottom padding clears the home indicator. */}
          <div
            className="auth-modal-body min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 sm:px-7"
          >
            <div key={mode} className="animate-fade">
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
                      fields={registration.fields}
                      onSwitch={switchTo}
                    />
                  : <div className="flex h-40 items-center justify-center text-muted">
                      <Loader2 className="animate-spin" aria-hidden />
                    </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The left pane: GrovBase's own promise, not a stock image and not anyone
 * else's product shot. Desktop only — on a phone the form is the whole point
 * and this would push it below the fold.
 */
function BrandPane() {
  const { t } = useI18n();
  const benefits = ["auth.benefit1", "auth.benefit2", "auth.benefit3"];
  return (
    <div
      className="relative hidden shrink-0 flex-col justify-between overflow-hidden p-8 lg:flex lg:w-[440px]"
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
        <p className="font-display text-[26px] font-semibold leading-[1.2] tracking-tight">
          {t("auth.paneTitle")}
        </p>
        <ul className="mt-5 space-y-2.5">
          {benefits.map((key) => (
            <li key={key} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-muted">
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

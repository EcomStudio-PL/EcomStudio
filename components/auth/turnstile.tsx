"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Cloudflare Turnstile, explicit-render mode.
 *
 * Renders nothing while `siteKey` is empty (captcha not configured), so the
 * form can mount it unconditionally. The solved token lands in a hidden
 * `cf-turnstile-response` input the server action reads from FormData —
 * state-driven here (with the widget's own injected copy disabled) so a
 * reset reliably clears it too.
 */

/** The slice of the Turnstile JS API this component touches — typed locally
 *  because the plain <script> build ships no types. */
type TurnstileTheme = "light" | "dark" | "auto";
interface TurnstileApi {
  render(container: HTMLElement, params: {
    sitekey: string;
    callback(token: string): void;
    "expired-callback"(): void;
    "error-callback"(): void;
    theme: TurnstileTheme;
    size: "flexible";
    "response-field": boolean;
  }): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Module-level, so remounts (route back-and-forth, strict-mode double mount)
// share one load instead of injecting the script tag again.
let loading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      loading = null; // let the next mount retry after a transient failure
      reject(new Error("turnstile script failed to load"));
    });
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileHandle {
  /** Turnstile tokens are SINGLE-USE: after any failed submit the widget must
   *  be reset, or the next attempt replays a consumed token and fails. */
  reset(): void;
}

export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string }>(
  function Turnstile({ siteKey }, ref) {
    const { resolvedTheme } = useTheme();
    const [token, setToken] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    // "auto" until next-themes has resolved (and for any unexpected value).
    const theme: TurnstileTheme =
      resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto";

    useImperativeHandle(ref, () => ({
      reset() {
        setToken("");
        if (widgetIdRef.current !== null) window.turnstile?.reset(widgetIdRef.current);
      },
    }), []);

    useEffect(() => {
      if (!siteKey) return;
      let cancelled = false;
      loadTurnstile()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme,
            // Stretches to the container instead of the fixed 300px, so the
            // widget is full width on mobile.
            size: "flexible",
            // We render the hidden input ourselves (state-driven, so reset
            // clears it) — stop the widget from injecting a duplicate.
            "response-field": false,
            callback: (t) => setToken(t),
            "expired-callback": () => setToken(""),
            "error-callback": () => setToken(""),
          });
        })
        .catch(() => {
          // Script blocked or offline: the form still submits and the server
          // reports the failure through its normal captcha error path.
        });
      return () => {
        cancelled = true;
        setToken(""); // a token belongs to the widget being torn down
        if (widgetIdRef.current !== null) {
          window.turnstile?.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [siteKey, theme]);

    if (!siteKey) return null;

    return (
      <div className="w-full">
        <div ref={containerRef} />
        <input type="hidden" name="cf-turnstile-response" value={token} />
      </div>
    );
  }
);

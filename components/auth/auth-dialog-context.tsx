"use client";
import {
  Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { parseAuthMode, safeReturnTo, type AuthMode } from "@/lib/auth-routes";

/**
 * WHO DECIDES THE DIALOG IS OPEN.
 *
 * It used to be the URL, read through useSearchParams(). That reads well but
 * it is wrong for the click path: useSearchParams() cannot change until Next's
 * router COMMITS a navigation, and committing needs the RSC payload for the
 * page underneath. The landing page is dynamic (it asks Supabase which front
 * door is live and loads its CMS blocks), so pressing "Zaloguj się" fired
 * `GET /?auth=login&_rsc=…` and the dialog waited for the server to re-render
 * the whole page — measured at ~300 ms on a throttled phone against a warm
 * local server, and far worse against a cold lambda. That wait is the empty
 * dark screen.
 *
 * So: React state is the truth, and it changes on the click, in the same tick.
 * The URL is brought into line afterwards with history.pushState — which Next's
 * router listens to, so the address bar, Back and useSearchParams all stay
 * correct WITHOUT fetching anything. Deep links still work: the state seeds
 * itself from location.search on mount, and popstate re-reads it.
 */

export type AuthDialogState = {
  mode: AuthMode | null;
  /** Validated returnTo — never an absolute or protocol-relative URL. */
  next: string;
  /** One-shot error code bounced back by /auth/sign-in. */
  error?: string;
  /** Address to prefill after an "unconfirmed" bounce. */
  email?: string;
};

type AuthDialogApi = AuthDialogState & {
  open: (mode: AuthMode, next?: string) => void;
  /** Change mode inside the open dialog; pushes history so Back steps back. */
  switchTo: (mode: AuthMode) => void;
  close: () => void;
};

const CLOSED: AuthDialogState = { mode: null, next: "" };

const AuthDialogContext = createContext<AuthDialogApi | null>(null);

/** What the current address says the dialog should show. */
function readLocation(): AuthDialogState {
  if (typeof window === "undefined") return CLOSED;
  const p = new URLSearchParams(window.location.search);
  return {
    mode: parseAuthMode(p.get("auth")),
    next: safeReturnTo(p.get("next")),
    error: p.get("error") ?? undefined,
    email: p.get("email") ?? undefined,
  };
}

/** The address for a state — the same shape /login and the middleware produce,
 *  so a shared link and a click land on identical URLs. */
function urlFor(state: AuthDialogState): string {
  const p = new URLSearchParams(window.location.search);
  for (const key of ["auth", "error", "email"]) p.delete(key);
  if (state.mode) p.set("auth", state.mode);
  if (state.next) p.set("next", state.next); else p.delete("next");
  const q = p.toString();
  return `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
}

export function AuthDialogProvider({ children }: { children: React.ReactNode }) {
  // Server render starts closed — there is no location to read. A deep link
  // opens on the first client paint (the dialog is in the main bundle, so
  // there is nothing to download), and every click opens synchronously.
  const [state, setState] = useState<AuthDialogState>(CLOSED);

  useEffect(() => {
    const fromUrl = readLocation();
    if (fromUrl.mode) setState(fromUrl);
  }, []);

  // Back/forward: the browser has already changed the address, so read it.
  useEffect(() => {
    const onPop = () => setState(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /**
   * URLs that change for reasons OTHER than a click here.
   *
   * This is the half that was missing, and it is what made the launch page's
   * "Zaloguj się" do nothing: that link navigates to /login, which
   * server-redirects to /?auth=login. The address changes, but the provider
   * lives in the root layout — it is not remounted, and a client navigation
   * fires no popstate — so state-as-truth never learned the URL had asked for
   * a dialog. The customer saw the address bar update and nothing else.
   *
   * The watcher below closes that gap without reopening the one it replaced:
   * clicks still set state synchronously and never wait for a router commit,
   * and this only confirms afterwards or catches a URL nobody clicked (a deep
   * link, a redirect, a middleware bounce).
   */
  const adopt = useCallback((fromUrl: AuthDialogState) => {
    setState((prev) => {
      if (fromUrl.mode === prev.mode && fromUrl.next === prev.next
        && fromUrl.error === prev.error && fromUrl.email === prev.email) return prev;
      // A URL asking for a mode always wins. A URL with no mode only closes
      // the dialog if we are not mid-click — `open()` pushes the mode into the
      // address in the same tick, so a stale empty read cannot slam it shut.
      if (!fromUrl.mode && prev.mode) {
        return readLocation().mode ? prev : { ...prev, mode: null };
      }
      return fromUrl;
    });
  }, []);

  const open = useCallback((mode: AuthMode, next?: string) => {
    const resolved: AuthDialogState = {
      mode,
      // An explicit returnTo wins; otherwise keep the one already in the URL
      // (the middleware puts it there when it bounces a protected route).
      next: safeReturnTo(next) || readLocation().next,
    };
    setState(resolved);                       // paints now
    window.history.pushState(null, "", urlFor(resolved));  // no server request
  }, []);

  const switchTo = useCallback((mode: AuthMode) => {
    setState((prev) => {
      // The previous attempt's error and prefill belong to that attempt.
      const nextState: AuthDialogState = { mode, next: prev.next };
      window.history.pushState(null, "", urlFor(nextState));
      return nextState;
    });
  }, []);

  const close = useCallback(() => {
    setState((prev) => {
      const nextState: AuthDialogState = { mode: null, next: prev.next };
      // replace, not back(): Back may lead off the site entirely on a tab
      // opened straight at /?auth=login, and closing must never navigate.
      window.history.replaceState(null, "", urlFor({ mode: null, next: "" }));
      return nextState;
    });
  }, []);

  const api = useMemo<AuthDialogApi>(
    () => ({ ...state, open, switchTo, close }),
    [state, open, switchTo, close],
  );

  return (
    <AuthDialogContext.Provider value={api}>
      {/* Suspense-wrapped because useSearchParams() opts its subtree into
          client rendering: without the boundary it would drag every page out
          of static generation. Rendering null while it settles costs nothing —
          the dialog itself lives below. */}
      <Suspense fallback={null}><AuthUrlWatcher onUrl={adopt} /></Suspense>
      {children}
    </AuthDialogContext.Provider>
  );
}

/** Reads the address through Next's router, so it updates on every client
 *  navigation as well as on a fresh load. Renders nothing. */
function AuthUrlWatcher({ onUrl }: { onUrl: (state: AuthDialogState) => void }) {
  const params = useSearchParams();
  const mode = parseAuthMode(params.get("auth"));
  const next = safeReturnTo(params.get("next"));
  const error = params.get("error") ?? undefined;
  const email = params.get("email") ?? undefined;
  // The callback is stable, but keeping it in a ref means a future caller
  // passing an inline function cannot turn this into a render loop.
  const cb = useRef(onUrl);
  cb.current = onUrl;
  useEffect(() => { cb.current({ mode, next, error, email }); }, [mode, next, error, email]);
  return null;
}

export function useAuthDialog(): AuthDialogApi {
  const ctx = useContext(AuthDialogContext);
  if (!ctx) throw new Error("useAuthDialog must be used inside AuthDialogProvider");
  return ctx;
}

/** For links that must render before the provider exists (none today, but a
 *  link in a server-rendered CMS block is one edit away). */
export function useOptionalAuthDialog(): AuthDialogApi | null {
  return useContext(AuthDialogContext);
}

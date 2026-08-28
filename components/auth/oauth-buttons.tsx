"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Social login via Supabase OAuth (PKCE — the browser client generates the
 * verifier, /auth/callback exchanges the code server-side and the session
 * cookies ride the redirect like every other login).
 *
 * Buttons render ONLY for providers named in NEXT_PUBLIC_AUTH_PROVIDERS
 * (comma list, e.g. "google,apple"). A provider that is not configured in
 * Supabase would produce a dead button and a raw error page — an honest
 * absence beats a broken promise, so until the dashboard side is configured
 * the section simply does not exist.
 */
const ENABLED = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const PROVIDERS: { id: "google" | "apple"; labelKey: string; icon: React.ReactNode }[] = [
  {
    id: "google",
    labelKey: "auth.continueGoogle",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.68 2.86C6.73 7.31 9.14 5.38 12 5.38z" />
        <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
        <path fill="#FBBC05" d="M5.86 14.07a6.55 6.55 0 0 1 0-4.14L2.18 7.07a11.02 11.02 0 0 0 0 9.86l3.68-2.86z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.86-3c-1.01.68-2.31 1.08-3.42 1.08-2.86 0-5.27-1.93-6.14-4.55l-3.68 2.86C3.99 20.53 7.7 23 12 23z" />
      </svg>
    ),
  },
  {
    id: "apple",
    labelKey: "auth.continueApple",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.52-3.2 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
    ),
  },
];

export function OAuthButtons() {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const active = PROVIDERS.filter((p) => ENABLED.includes(p.id));
  if (active.length === 0) return null;

  async function start(provider: "google" | "apple") {
    setBusy(provider);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser navigates away; only a failure returns here.
    if (error) setBusy(null);
  }

  return (
    <div className="space-y-2">
      {active.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={busy !== null}
          onClick={() => start(p.id)}
          className="plate flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-sm font-semibold text-ink transition-colors duration-200 hover:border-[rgb(var(--accent)/0.4)] hover:bg-raised disabled:opacity-60"
        >
          {busy === p.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : p.icon}
          {t(p.labelKey)}
        </button>
      ))}
      <div className="flex items-center gap-3 pt-1" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("auth.orDivider")}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

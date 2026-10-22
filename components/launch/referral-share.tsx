"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { FacebookIcon, MessengerIcon, WhatsAppIcon } from "./social-icons";
import { launchTrack } from "./launch-analytics";

/**
 * ZAPROŚ INNEGO SPRZEDAWCĘ — the referral link and the ways to pass it on.
 *
 * Shown after a signup (in the form's success state) and again on the
 * confirmation page, which is the one place the REAL code always appears: the
 * signup response carries a decoy for an address that was already on the list
 * (review S7), so nobody can learn somebody else's code by typing their e-mail.
 *
 * Every way out is a plain link or a browser API — no SDK, nothing the CSP has
 * to allow, nothing that runs eval:
 *
 *  - COPY — the clipboard API, with the field selected as the fallback where
 *    the API is refused (an insecure context, an old WebView).
 *  - FACEBOOK — the sharer URL.
 *  - WHATSAPP — wa.me with the sentence and the link as the text.
 *  - MESSENGER — `fb-messenger://share`, which only means something on a phone
 *    with the app; on a desktop it is a link to nowhere, so it is shown only
 *    on a touch device (decided after mount — the server cannot know).
 *  - SHARE… — navigator.share, the phone's own share sheet, where it exists.
 *
 * Each press is one GA event naming the method, never the link (the code is
 * personal; lib/analytics/ga.ts would refuse it anyway).
 *
 * Styled with the theme's own tokens, so it reads correctly inside the always-
 * dark landing page and on the confirmation page in either theme.
 */
export function ReferralShare({ url, title, body, copyLabel, rewardNote }: {
  url: string;
  /** "Zaproś innego sprzedawcę." */
  title: string;
  /** The resolved referral line — the credits sentence, or the plain one. */
  body: string;
  /** "Kopiuj link". */
  copyLabel: string;
  /** "Kredyty dopiszemy…" — only when `body` promised credits. */
  rewardNote?: string | null;
}) {
  const { t } = useI18n();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [touch, setTouch] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    try { setTouch(window.matchMedia("(pointer: coarse)").matches); } catch { setTouch(false); }
    setNative(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(id);
  }, [copied]);

  const text = t("prelaunchUi.shareText");
  const encoded = encodeURIComponent(url);
  const links = [
    { method: "facebook", name: "Facebook", Icon: FacebookIcon, href: `https://www.facebook.com/sharer/sharer.php?u=${encoded}` },
    { method: "whatsapp", name: "WhatsApp", Icon: WhatsAppIcon, href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
    ...(touch ? [{ method: "messenger", name: "Messenger", Icon: MessengerIcon, href: `fb-messenger://share/?link=${encoded}` }] : []),
  ];

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // No clipboard permission: select the link so a long-press or Ctrl+C
      // finishes the job, and say nothing that is not true.
      field.current?.focus();
      field.current?.select();
    }
    if (ok) setCopied(true);
    launchTrack("prelaunch_referral_shared", { method: "copy" });
  }

  async function share() {
    launchTrack("prelaunch_referral_shared", { method: "native" });
    try { await navigator.share({ title, text, url }); } catch { /* dismissed — nothing to do */ }
  }

  // 40px controls in a wrapping row: their own size is the target, so no
  // `.tap` (its negative margins would overlap the neighbours).
  const button = "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--surface)/0.7)] px-3 text-[13px] font-semibold text-ink transition-colors hover:border-[rgb(var(--accent)/0.45)]";

  return (
    <div data-referral-card className="mt-4 rounded-2xl border border-[rgb(var(--glass-border)/0.18)] bg-[rgb(var(--sunken)/0.45)] p-4 text-left">
      <p className="font-display text-[15.5px] font-semibold tracking-tight text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
      <label className="mt-3 block">
        <span className="sr-only">{t("prelaunchUi.refLink")}</span>
        <input ref={field} readOnly value={url} data-referral-link
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 w-full min-w-0 rounded-xl border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--surface)/0.6)] px-3 text-base text-ink outline-none focus:border-[rgb(var(--accent)/0.6)] sm:text-[13.5px]" />
      </label>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={copy} data-referral-copy
          className={cn(button, "bg-[rgb(var(--accent)/0.16)]")}>
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied ? t("prelaunchUi.copied") : copyLabel}
        </button>
        {/* Buttons, not links: GA's outbound-click capture reads a clicked
            link's URL, and this one carries the personal code (S9). */}
        {links.map(({ method, name, Icon, href }) => (
          <button key={method} type="button"
            data-referral-share={method}
            aria-label={t("prelaunchUi.shareOn", { network: name })}
            onClick={() => {
              launchTrack("prelaunch_referral_shared", { method });
              if (method === "messenger") window.location.href = href;
              else window.open(href, "_blank", "noopener,noreferrer");
            }}
            className={cn(button, "w-10 px-0")}>
            <Icon size={16} />
          </button>
        ))}
        {native && (
          <button type="button" onClick={share} data-referral-share="native" className={button}>
            <Share2 size={15} aria-hidden />{t("prelaunchUi.share")}
          </button>
        )}
      </div>
      {/* Read by a screen reader the moment the copy succeeds. */}
      <span className="sr-only" role="status">{copied ? t("prelaunchUi.copied") : ""}</span>
      {rewardNote && <p className="mt-3 text-[12px] leading-relaxed text-muted">{rewardNote}</p>}
    </div>
  );
}

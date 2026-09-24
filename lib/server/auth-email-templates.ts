import "server-only";
import { renderEmailTemplate } from "@/lib/server/email-template";

/**
 * THE TWO RICH AUTH TEMPLATES — now built by the shared GrovBase card.
 *
 * ─── WHAT CHANGED, AND WHY IT MATTERS ───────────────────────────────────────
 *
 * These used to be two hand-written HTML documents with their own header, own
 * spacing, own card radius and their own light-only palette. That is how a
 * customer ended up receiving a white confirmation mail and, minutes later, a
 * near-black security code: three files each drawing their own idea of what a
 * GrovBase e-mail looks like.
 *
 * They are now composed from `renderEmailTemplate`, the same function every
 * other GrovBase message goes through, so the header, the gradient rule, the
 * card, the CTA, the footer, the mobile breakpoint and — the point of this
 * round — the light/dark behaviour are literally the same code. Change the
 * card once and all of it moves together.
 *
 * ─── THE GO MARKERS SURVIVE ON PURPOSE ──────────────────────────────────────
 *
 * `{{ .TokenHash }}` and `{{ .Data.first_name }}` are GoTrue template
 * variables. They pass through `escapeHtml` untouched — none of `& < > " '`
 * appears in them — so they can be written straight into the copy and the
 * renderer never mangles them.
 *
 * At send time `renderGoTemplate` (lib/server/auth-mail.ts) substitutes them,
 * exactly as before. The Send Email Hook is what actually renders these today;
 * the files under supabase/templates/ hold the identical HTML for the
 * dashboard paste and for version control, and scripts/template-tests.ts
 * asserts the two never drift. Regenerate them with:
 *
 *     npx tsx scripts/write-auth-templates.ts
 *
 * ─── AND THE CONTENT IS SHORTER ─────────────────────────────────────────────
 *
 * The signup mail carried a four-item "what you get after activating" box.
 * A confirmation mail has exactly one job, and every element that is not that
 * job competes with the button. Title, one sentence, the button, the paste-
 * able link, the expiry and the "wasn't you" line — nothing else.
 */

const CONFIRM_URL = "https://grovbase.com/auth/confirm?token_hash={{ .TokenHash }}&type=email";
const RECOVERY_URL = "https://grovbase.com/auth/confirm?token_hash={{ .TokenHash }}&type=recovery";

/** The greeting, with GoTrue's conditional intact for the no-name case. */
const HELLO = "{{ if .Data.first_name }}Cześć {{ .Data.first_name }}! {{ else }}{{ end }}";

export const AUTH_EMAIL_TEMPLATES: Record<string, { subject: string; html: string }> = {
  "auth.confirm_signup": {
    subject: "Potwierdź swój adres e-mail — GrovBase",
    html: renderEmailTemplate({
      title: "Potwierdź swój adres e-mail",
      intro: `${HELLO}Potwierdź adres, aby aktywować konto GrovBase.`,
      cta: { label: "Potwierdź adres e-mail", url: CONFIRM_URL },
      fallbackUrl: CONFIRM_URL,
      note: "Link jest ważny przez 24 godziny.\nJeśli to nie Ty zakładałeś konto, możesz zignorować tę wiadomość.",
      preheader: "Potwierdź adres e-mail i aktywuj swoje konto GrovBase.",
    }).html,
  },
  "auth.reset_password": {
    subject: "Zresetuj hasło — GrovBase",
    html: renderEmailTemplate({
      title: "Zresetuj hasło",
      intro: `${HELLO}Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta GrovBase. Kliknij przycisk poniżej, aby ustawić nowe.`,
      cta: { label: "Ustaw nowe hasło", url: RECOVERY_URL },
      fallbackUrl: RECOVERY_URL,
      note: "Link jest ważny przez 1 godzinę.\nJeżeli to nie Ty prosiłeś o zmianę hasła, zignoruj tę wiadomość — Twoje hasło pozostanie bez zmian.",
      preheader: "Ustaw nowe hasło do swojego konta GrovBase.",
    }).html,
  },
};

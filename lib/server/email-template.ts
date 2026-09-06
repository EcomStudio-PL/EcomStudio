import "server-only";

/**
 * THE ONE EMAIL LAYOUT — the GrovBase Notification Card.
 *
 * Every e-mail the APP sends (admin notifications, template-editor messages)
 * renders through this single function, so ten events do not mean ten copies
 * of table soup. The auth e-mails (confirm signup, reset password) are the one
 * exception: GoTrue renders those from its own template store, and their HTML
 * lives in supabase/templates/ — same visual language, different renderer.
 *
 * Layout, in email-safe primitives only (tables, inline CSS, bgcolor):
 *
 *   header   logo + wordmark, event badge, timestamp
 *   card     title, intro, a real <table> of fields, optional CTA button
 *   footer   grovbase.com · © GrovBase
 *
 * Light theme on purpose — dark canvases get inverted unpredictably by mail
 * clients; a white card with the brand gradient survives Gmail, Apple Mail and
 * Outlook alike. Every interpolated value passes through escapeHtml here, so a
 * hostile display name cannot inject markup into an inbox.
 */

export type EmailField = { label: string; value: string; mono?: boolean };

export type EmailTemplateInput = {
  /** Short badge over the title, e.g. "REJESTRACJA". Optional. */
  badge?: string;
  title: string;
  /** Paragraph under the title. Optional. */
  intro?: string;
  /** The compact field table. Empty values are dropped, never rendered blank. */
  fields?: EmailField[];
  cta?: { label: string; url: string };
  /** Footer line above the standard sign-off, e.g. "GrovBase Admin". */
  footer?: string;
  /** Pre-formatted timestamp shown in the header. Optional. */
  timestamp?: string;
  showLogo?: boolean;
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Only http(s) links may become a button — "javascript:" from a stored
 *  template must die here, not in the reader's mail client. */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function renderEmailTemplate(input: EmailTemplateInput): { html: string; text: string } {
  const fields = (input.fields ?? []).filter((f) => f.value.trim() !== "");
  const cta = input.cta && safeUrl(input.cta.url)
    ? { label: input.cta.label, url: safeUrl(input.cta.url)! }
    : null;
  const showLogo = input.showLogo !== false;

  const fieldRows = fields.map((f, i) => `
        <tr>
          <td style="padding:9px 14px; border-top:${i === 0 ? "0" : "1px solid #F0E9F7"}; font-family:${FONT}; font-size:13px; line-height:19px; color:#8A7E99; white-space:nowrap; vertical-align:top;">${escapeHtml(f.label)}</td>
          <td style="padding:9px 14px; border-top:${i === 0 ? "0" : "1px solid #F0E9F7"}; font-family:${f.mono ? MONO : FONT}; font-size:13px; line-height:19px; color:#1A1127; font-weight:600; word-break:break-word; vertical-align:top;" align="right">${escapeHtml(f.value)}</td>
        </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="pl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.title)}</title></head>
<body style="margin:0; padding:0; background-color:#F4EFF9;" bgcolor="#F4EFF9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4EFF9" style="background-color:#F4EFF9;">
<tr><td align="center" style="padding:36px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:560px;">

  <tr><td style="padding:0 4px 18px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="font-family:${FONT}; font-size:19px; line-height:24px; font-weight:800; letter-spacing:-0.4px; color:#1A1127;">
        ${showLogo ? `<img src="https://grovbase.com/brand/icon-on-light.png" width="26" height="20" alt="" style="vertical-align:-4px; border:0; margin-right:7px;">` : ""}Grov<span style="color:#D628CF;">Base</span>
      </td>
      <td align="right" style="font-family:${FONT}; font-size:12px; line-height:18px; color:#8A7E99;">
        ${input.badge ? `<span style="display:inline-block; padding:3px 10px; border-radius:999px; background-color:#FAEBFA; color:#B21FAD; font-size:11px; font-weight:700; letter-spacing:0.5px;">${escapeHtml(input.badge)}</span>` : ""}
        ${input.timestamp ? `${input.badge ? "&nbsp; " : ""}${escapeHtml(input.timestamp)}` : ""}
      </td>
    </tr></table>
  </td></tr>

  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td height="4" bgcolor="#D628CF" style="background-color:#D628CF; background-image:linear-gradient(90deg,#D628CF,#F950E1); height:4px; line-height:4px; font-size:4px; border-radius:12px 12px 0 0;">&nbsp;</td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF; border:1px solid #EBE2F3; border-top:0; border-radius:0 0 12px 12px; padding:30px 30px 28px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:0 0 ${input.intro ? "8" : "16"}px 0; font-family:${FONT}; font-size:19px; line-height:26px; font-weight:800; letter-spacing:-0.3px; color:#1A1127;">${escapeHtml(input.title)}</td></tr>
      ${input.intro ? `<tr><td style="padding:0 0 18px 0; font-family:${FONT}; font-size:14px; line-height:22px; color:#4A4058;">${escapeHtml(input.intro)}</td></tr>` : ""}
      ${fields.length ? `<tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FBF8FD" style="background-color:#FBF8FD; border:1px solid #F0E9F7; border-radius:10px;">${fieldRows}
        </table>
      </td></tr>` : ""}
      ${cta ? `<tr><td align="center" style="padding:22px 0 4px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="#D628CF" style="background-color:#D628CF; background-image:linear-gradient(135deg,#D628CF,#F950E1); border-radius:9px;">
            <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block; padding:13px 32px; font-family:${FONT}; font-size:13px; line-height:17px; font-weight:700; letter-spacing:0.5px; color:#FFFFFF; text-decoration:none; border-radius:9px;">${escapeHtml(cta.label)}</a>
          </td>
        </tr></table>
      </td></tr>` : ""}
    </table>
  </td></tr>

  <tr><td align="center" style="padding:22px 0 0 0; font-family:${FONT}; font-size:12px; line-height:19px; color:#8A7E99;">
    ${input.footer ? `${escapeHtml(input.footer)}<br>` : ""}<a href="https://grovbase.com" target="_blank" style="color:#6F6382; text-decoration:none; font-weight:600;">grovbase.com</a> · © GrovBase
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    input.badge ? `[${input.badge}]` : "",
    input.title,
    input.intro ?? "",
    "",
    ...fields.map((f) => `${f.label}: ${f.value}`),
    cta ? `\n${cta.label}: ${cta.url}` : "",
    "",
    input.footer ?? "",
    "grovbase.com · © GrovBase",
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");

  return { html, text };
}

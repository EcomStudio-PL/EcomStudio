import "server-only";

/**
 * THE ONE EMAIL LAYOUT — the GrovBase card, in light AND dark.
 *
 * ─── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 *
 * Three wrappers, three looks. This card was light-only; the auth mails had
 * their own hand-written light layout; the security-code mail hardcoded a
 * near-black canvas. A customer who received two GrovBase mails in one evening
 * got two different products. They all render through here now.
 *
 * ─── HOW LIGHT/DARK WORKS, AND WHY IT IS BUILT THIS WAY ─────────────────────
 *
 * Every colour is written TWICE:
 *
 *   1. inline, as the LIGHT value, on the element itself;
 *   2. in one <style> block, as the DARK override, behind
 *      `@media (prefers-color-scheme: dark)`, matched on `data-gb` attributes.
 *
 * Inline first is not a stylistic choice — it is the fallback. A client that
 * strips <style> (Gmail's web client does for some senders), or that has no
 * dark mode at all, simply keeps the light design, complete and correct. The
 * dark theme is an enhancement layered on top; nothing depends on it.
 *
 * `color-scheme` and `supported-color-schemes` are declared `light dark`,
 * which is what stops Apple Mail and Outlook from INVENTING their own
 * inversion. A message that does not declare them gets its colours flipped
 * algorithmically, which is how you end up with grey-on-grey text and an
 * invisible logo. Declaring both says "we handle this", and the clients that
 * honour it hand the job back to the stylesheet below.
 *
 * Attribute selectors (`[data-gb="card"]`) rather than classes, because some
 * clients rewrite class names; `!important` because the inline light value
 * would otherwise always win.
 *
 * NO JavaScript. No web fonts. No backdrop-filter, no grid, no flex. Tables,
 * inline CSS, `bgcolor` on every painted cell, and one media query — which is
 * the entire set of things Gmail, Apple Mail and Outlook all agree on.
 *
 * ─── AND NO EVENT KEYS ──────────────────────────────────────────────────────
 *
 * There is deliberately no `badge`. It used to print `USER.REGISTERED` in a
 * chip above the title, because the admin notifier passed `eventType` straight
 * into it. Those identifiers still exist in the database and the logs, where
 * they belong; they are not a thing to show a person who just signed up.
 */

export type EmailField = { label: string; value: string; mono?: boolean };

export type EmailTemplateInput = {
  title: string;
  /** Paragraph under the title. Optional. */
  intro?: string;
  /**
   * Further paragraphs, for a written message rather than an event report.
   * Each is escaped and rendered as its own block — a blank line typed by an
   * operator has to survive as a paragraph, and `intro` alone collapses it.
   */
  paragraphs?: string[];
  /**
   * A one-time code, shown large and spaced. Rendered as TEXT on a tinted
   * panel rather than as an image, so it stays selectable and survives a
   * client with images switched off — which is most of them, by default.
   */
  code?: string;
  /** The compact field table. Empty values are dropped, never rendered blank. */
  fields?: EmailField[];
  cta?: { label: string; url: string };
  /**
   * "If the button does not work, paste this address" — the plain URL, as a
   * real link, under the CTA. Every button in an e-mail is one over-zealous
   * corporate filter away from being stripped, and a confirmation mail whose
   * only route through is a button is a mail that strands people.
   */
  fallbackUrl?: string;
  /** Small print under the card body — expiry, "ignore this if it wasn't you". */
  note?: string;
  /** Footer line above the standard sign-off, e.g. "GrovBase Admin". */
  footer?: string;
  /** Pre-formatted timestamp shown in the header. Optional. */
  timestamp?: string;
  /** Hidden one-liner shown in the inbox list next to the subject. */
  preheader?: string;
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

/* ── The two palettes. Light is inline; dark is the media query. ───────────*/

const L = {
  canvas: "#F4EFF9", card: "#FFFFFF", border: "#EBE2F3", hair: "#F0E9F7",
  ink: "#1A1127", body: "#4A4058", faint: "#8A7E99", panel: "#FBF8FD",
  panelEdge: "#F0E9F7", accent: "#D628CF", link: "#6F6382",
};
const D = {
  canvas: "#0B0712", card: "#17121F", border: "#2E2440", hair: "#2A2038",
  ink: "#F5F2FA", body: "#C6BAD6", faint: "#9689A8", panel: "#100C19",
  panelEdge: "#2A2038", accent: "#F468E4", link: "#BCB1CC",
};

/**
 * The dark overrides. One block, attribute-matched, every rule !important so
 * it beats the inline light value. Clients that ignore <style> never see it
 * and keep the light design.
 *
 * The CTA is deliberately NOT re-coloured: the brand gradient reads correctly
 * on both canvases, and white-on-magenta is the one contrast pair that never
 * needs a second version.
 */
const DARK_STYLE = `
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (prefers-color-scheme: dark) {
      [data-gb="bg"] { background-color: ${D.canvas} !important; }
      [data-gb="card"] { background-color: ${D.card} !important; border-color: ${D.border} !important; }
      [data-gb="title"], [data-gb="strong"] { color: ${D.ink} !important; }
      [data-gb="body"] { color: ${D.body} !important; }
      [data-gb="faint"] { color: ${D.faint} !important; }
      [data-gb="panel"] { background-color: ${D.panel} !important; border-color: ${D.panelEdge} !important; }
      [data-gb="rule"] { border-color: ${D.hair} !important; }
      [data-gb="hr"] { background-color: ${D.hair} !important; }
      [data-gb="link"] { color: ${D.link} !important; }
      [data-gb="accent"] { color: ${D.accent} !important; }
      [data-gb="code"] { color: ${D.ink} !important; }
      /* THE MARK SWAPS, IT DOES NOT GET INVERTED.
         icon-on-light is drawn for a white card; left alone on a dark canvas
         it either disappears or keeps a white plate around it. Both variants
         ship in the message and the media query hides the wrong one, which is
         the only image swap mail clients reliably honour — there is no
         srcset, no <picture>, no JS. A client without the media query shows
         the light mark on the light canvas it is also still rendering, so the
         pairing can never come apart. */
      [data-gb="logo-light"] { display: none !important; }
      [data-gb="logo-dark"] { display: inline-block !important; width: 24px !important; height: 19px !important; overflow: visible !important; }
    }`;

export function renderEmailTemplate(input: EmailTemplateInput): { html: string; text: string } {
  const fields = (input.fields ?? []).filter((f) => f.value.trim() !== "");
  const paragraphs = (input.paragraphs ?? []).map((p) => p.trim()).filter(Boolean);
  const cta = input.cta && safeUrl(input.cta.url)
    ? { label: input.cta.label, url: safeUrl(input.cta.url)! }
    : null;
  const showLogo = input.showLogo !== false;
  const code = (input.code ?? "").trim();
  const fallback = input.fallbackUrl ? safeUrl(input.fallbackUrl) : null;

  /**
   * One row is one line: label left, value right.
   *
   * The CELL carries the separator colour and the SPAN inside carries the text
   * colour, because `data-gb` holds one value and a row after the first needs
   * both overridden in dark. Putting them on the same element would have left
   * every row but the first with light-mode text on a dark panel — legible in
   * the preview, unreadable in a real inbox.
   */
  const fieldRows = fields.map((f, i) => {
    const edge = i === 0 ? "0" : `1px solid ${L.hair}`;
    const cell = `padding:8px 14px; border-top:${edge}; font-size:13px; line-height:19px; vertical-align:top;`;
    return `
        <tr>
          <td data-gb="rule" style="${cell} font-family:${FONT}; white-space:nowrap;"><span data-gb="faint" style="color:${L.faint};">${escapeHtml(f.label)}</span></td>
          <td data-gb="rule" style="${cell} font-family:${f.mono ? MONO : FONT}; word-break:break-word;" align="right"><span data-gb="strong" style="color:${L.ink}; font-weight:600;">${escapeHtml(f.value)}</span></td>
        </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
<style>${DARK_STYLE}
    @media only screen and (max-width:620px) {
      [data-gb="card"] { padding:26px 22px 24px 22px !important; }
      [data-gb="pad"] { padding:24px 14px !important; }
    }
</style>
</head>
<body data-gb="bg" style="margin:0; padding:0; background-color:${L.canvas};" bgcolor="${L.canvas}">
${input.preheader ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${L.canvas};">${escapeHtml(input.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" data-gb="bg" bgcolor="${L.canvas}" style="background-color:${L.canvas};">
<tr><td align="center" data-gb="pad" style="padding:36px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;">

  <tr><td style="padding:0 4px 16px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" data-gb="title" style="font-family:${FONT}; font-size:18px; line-height:24px; font-weight:800; letter-spacing:-0.4px; color:${L.ink};">
        ${showLogo ? `<img data-gb="logo-light" src="https://grovbase.com/brand/icon-on-light.png" width="24" height="19" alt="" style="vertical-align:-3px; border:0; margin-right:7px;"><img data-gb="logo-dark" src="https://grovbase.com/brand/icon-on-dark.png" width="0" height="0" alt="" style="display:none; width:0; height:0; max-height:0; overflow:hidden; vertical-align:-3px; border:0; margin-right:7px; mso-hide:all;">` : ""}Grov<span data-gb="accent" style="color:${L.accent};">Base</span>
      </td>
      <td align="right" data-gb="faint" style="font-family:${FONT}; font-size:12px; line-height:18px; color:${L.faint};">${input.timestamp ? escapeHtml(input.timestamp) : ""}</td>
    </tr></table>
  </td></tr>

  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td height="4" bgcolor="${L.accent}" style="background-color:${L.accent}; background-image:linear-gradient(90deg,${L.accent},#F950E1); height:4px; line-height:4px; font-size:4px; border-radius:14px 14px 0 0;">&nbsp;</td></tr>
    </table>
  </td></tr>

  <tr><td data-gb="card" bgcolor="${L.card}" style="background-color:${L.card}; border:1px solid ${L.border}; border-top:0; border-radius:0 0 14px 14px; padding:30px 32px 28px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td data-gb="title" style="padding:0 0 ${input.intro || paragraphs.length ? "10" : "16"}px 0; font-family:${FONT}; font-size:21px; line-height:28px; font-weight:800; letter-spacing:-0.4px; color:${L.ink};">${escapeHtml(input.title)}</td></tr>
      ${input.intro ? `<tr><td data-gb="body" style="padding:0 0 18px 0; font-family:${FONT}; font-size:15px; line-height:23px; color:${L.body};">${escapeHtml(input.intro)}</td></tr>` : ""}
      ${paragraphs.map((p) => `<tr><td data-gb="body" style="padding:0 0 14px 0; font-family:${FONT}; font-size:15px; line-height:23px; color:${L.body};">${escapeHtml(p).replace(/\n/g, "<br>")}</td></tr>`).join("")}
      ${code ? `<tr><td align="center" data-gb="panel" bgcolor="${L.panel}" style="background-color:${L.panel}; border:1px solid ${L.panelEdge}; border-radius:12px; padding:20px 12px;">
        <div data-gb="code" style="font-family:${MONO}; font-size:32px; line-height:38px; font-weight:700; letter-spacing:9px; color:${L.ink}; white-space:nowrap;">${escapeHtml(code)}</div>
      </td></tr>` : ""}
      ${fields.length ? `<tr><td${code ? ' style="padding-top:18px;"' : ""}>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" data-gb="panel" bgcolor="${L.panel}" style="background-color:${L.panel}; border:1px solid ${L.panelEdge}; border-radius:10px;">${fieldRows}
        </table>
      </td></tr>` : ""}
      ${cta ? `<tr><td align="center" style="padding:24px 0 4px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${L.accent}" style="background-color:${L.accent}; background-image:linear-gradient(135deg,${L.accent},#F950E1); border-radius:10px;">
            <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block; min-height:20px; padding:15px 34px; font-family:${FONT}; font-size:14px; line-height:20px; font-weight:700; letter-spacing:0.4px; color:#FFFFFF; text-decoration:none; border-radius:10px;">${escapeHtml(cta.label)}</a>
          </td>
        </tr></table>
      </td></tr>` : ""}
      ${fallback ? `<tr><td align="center" data-gb="faint" style="padding:20px 0 0 0; font-family:${FONT}; font-size:12px; line-height:19px; color:${L.faint};">
        Jeśli przycisk nie działa, skopiuj i wklej ten adres do przeglądarki:<br>
        <a href="${escapeHtml(fallback)}" target="_blank" data-gb="accent" style="color:${L.accent}; text-decoration:underline; word-break:break-all;">${escapeHtml(fallback)}</a>
      </td></tr>` : ""}
      ${input.note ? `<tr><td data-gb="hr" height="1" bgcolor="${L.hair}" style="background-color:${L.hair}; height:1px; line-height:1px; font-size:1px; padding:0;">&nbsp;</td></tr>
      <tr><td data-gb="faint" style="padding:18px 0 0 0; font-family:${FONT}; font-size:12.5px; line-height:20px; color:${L.faint};">${escapeHtml(input.note).replace(/\n/g, "<br>")}</td></tr>` : ""}
    </table>
  </td></tr>

  <tr><td align="center" data-gb="faint" style="padding:22px 0 0 0; font-family:${FONT}; font-size:12px; line-height:19px; color:${L.faint};">
    ${input.footer ? `${escapeHtml(input.footer)}<br>` : ""}<a href="https://grovbase.com" target="_blank" data-gb="link" style="color:${L.link}; text-decoration:none; font-weight:600;">grovbase.com</a> · © GrovBase
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    input.title,
    input.intro ?? "",
    ...paragraphs.flatMap((p) => [p, ""]),
    code ? `\n${code}\n` : "",
    "",
    ...fields.map((f) => `${f.label}: ${f.value}`),
    cta ? `\n${cta.label}: ${cta.url}` : "",
    !cta && fallback ? `\n${fallback}` : "",
    input.note ? `\n${input.note}` : "",
    "",
    input.footer ?? "",
    "grovbase.com · © GrovBase",
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");

  return { html, text };
}

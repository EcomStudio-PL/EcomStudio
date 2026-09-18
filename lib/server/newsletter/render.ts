import "server-only";
import { escapeHtml } from "@/lib/server/email-template";
import { sanitizeMailHtml } from "@/lib/server/mail-html";
import { applyMerge, toBlocks, type MailBlock, type MergeValues } from "@/lib/newsletter";

/**
 * TURNING A CAMPAIGN INTO AN EMAIL.
 *
 * Two authoring modes arrive here and exactly one thing leaves: an email-safe
 * HTML document plus its plain-text twin. Everything a mail client is hostile
 * to — flexbox, grid, external stylesheets, script, web fonts — is either
 * impossible to express in the block vocabulary or removed by the sanitiser on
 * the HTML path, so the sender never has to know which mode was used.
 *
 * WHAT IS NOT NEGOTIABLE, whatever the author wrote:
 *
 *   · the unsubscribe line. It is appended after the body, always, for every
 *     marketing message. An author cannot delete it by editing blocks, and a
 *     pasted HTML document cannot omit it, because it is added here rather
 *     than being part of the body;
 *   · a text/plain alternative. A message with no text part is scored as spam
 *     by filters that have been doing this since 2003;
 *   · escaping. Every value that came from a contact — a first name from a
 *     public form, a source key — is escaped at the point it is interpolated,
 *     because a contact's name is attacker-controlled input that ends up in
 *     somebody else's inbox only if an operator previews it, and in this
 *     operator's own admin origin every time they preview.
 *
 * TRACKING IS OPTIONAL AND VISIBLY SO. With `tracking` absent nothing is
 * rewritten and no pixel is added: a test send to the operator is a clean
 * message, which is also what makes the preview honest.
 */

const FONT = "'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#1A1127";
const MUTED = "#4A4058";
const FAINT = "#8A7E99";
const LINE = "#F0E9F7";
const ACCENT = "#B21FAD";

export type RenderTracking = {
  /** Absolute, e.g. https://grovbase.com */
  origin: string;
  recipientId: string;
  /** Resolved at snapshot time: destination URL → newsletter_links.id. */
  links: Map<string, string>;
  trackOpens: boolean;
  trackClicks: boolean;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string };
};

export type RenderInput = {
  editor: "builder" | "html";
  blocks: unknown;
  bodyHtml: string;
  subject: string;
  preheader: string;
  merge: MergeValues;
  /** The one-click link. Also becomes the List-Unsubscribe header. */
  unsubscribeUrl: string;
  /** Polish is the product's default; the footer follows the contact. */
  locale?: string;
  tracking?: RenderTracking;
};

export type RenderedMail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** Destinations found in the body, for the caller to register as links. */
  urls: string[];
};

/* ── FOOTER COPY ─────────────────────────────────────────────────────────── */

const FOOTER: Record<string, { why: string; unsub: string }> = {
  pl: {
    why: "Otrzymujesz tę wiadomość, ponieważ zapisałeś się do newslettera GrovBase.",
    unsub: "Wypisz się",
  },
  en: {
    why: "You are receiving this because you subscribed to the GrovBase newsletter.",
    unsub: "Unsubscribe",
  },
  de: {
    why: "Du erhältst diese Nachricht, weil du den GrovBase-Newsletter abonniert hast.",
    unsub: "Abmelden",
  },
};

/* ── LINKS ───────────────────────────────────────────────────────────────── */

const HREF = /href\s*=\s*"([^"]*)"/gi;

/** http(s) only. A `mailto:` stays as typed — it is a destination a person
 *  chose, and a click on it is not a page view we could track anyway. */
function trackable(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function withUtm(url: string, utm: RenderTracking["utm"]): string {
  if (!utm) return url;
  try {
    const parsed = new URL(url);
    // AN EXISTING TAG WINS. An operator who hand-tagged a link meant it, and
    // silently overwriting their campaign name would corrupt their reporting.
    const set = (key: string, value?: string) => {
      if (value && !parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
    };
    set("utm_source", utm.source);
    set("utm_medium", utm.medium);
    set("utm_campaign", utm.campaign);
    set("utm_content", utm.content);
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Rewrite every trackable href through the redirect endpoint, and collect the
 * destinations so the caller can register them.
 *
 * THE REDIRECT CARRIES IDS, NOT A URL. `/r/<recipient>/<link>` looks the
 * destination up server-side; a tracker that takes `?to=https://…` is an open
 * redirect wearing our domain, which is a phishing kit somebody else gets to
 * use.
 */
function rewriteLinks(html: string, tracking: RenderTracking | undefined): { html: string; urls: string[] } {
  const urls: string[] = [];
  const out = html.replace(HREF, (whole, raw: string) => {
    const url = raw.trim();
    if (!trackable(url)) return whole;
    const tagged = withUtm(url, tracking?.utm);
    if (!urls.includes(tagged)) urls.push(tagged);
    if (!tracking?.trackClicks) return `href="${escapeHtml(tagged)}"`;
    const linkId = tracking.links.get(tagged);
    if (!linkId) return `href="${escapeHtml(tagged)}"`;
    return `href="${escapeHtml(`${tracking.origin}/r/${tracking.recipientId}/${linkId}`)}"`;
  });
  return { html: out, urls };
}

/* ── BLOCKS ──────────────────────────────────────────────────────────────── */

const row = (content: string, background?: string) =>
  `<tr><td style="padding:0;${background ? `background-color:${escapeHtml(background)};` : ""}">${content}</td></tr>`;

function blockHtml(b: MailBlock, merge: MergeValues): string {
  const text = (v: string | undefined) => escapeHtml(applyMerge(v ?? "", merge));
  const align = b.align ?? "left";

  switch (b.type) {
    case "logo":
      return row(`<div style="padding:24px 28px 8px 28px; text-align:${align};">
        <img src="https://grovbase.com/brand/logo-on-light.png" width="138" height="30" alt="GrovBase"
          style="display:inline-block; border:0; outline:none; text-decoration:none; height:30px; width:138px;"></div>`);

    case "heading":
      return row(`<div style="padding:8px 28px 6px 28px; font-family:${FONT}; font-size:23px; line-height:30px;
        font-weight:800; letter-spacing:-0.4px; color:${INK}; text-align:${align};">${text(b.text)}</div>`);

    case "text":
      // A blank line typed by an author is a paragraph break, and it has to
      // survive: collapsing it turns a written message into a wall.
      return row(`<div style="padding:6px 28px 12px 28px; font-family:${FONT}; font-size:15px; line-height:24px;
        color:${MUTED}; text-align:${align};">${text(b.text).replace(/\n{2,}/g, "</div><div style=\"height:12px\"></div><div>").replace(/\n/g, "<br>")}</div>`);

    case "image": {
      const src = (b.imageUrl ?? "").trim();
      if (!/^https?:\/\//i.test(src)) return "";
      return row(`<div style="padding:10px 28px; text-align:${align};">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(b.alt ?? "")}" width="544"
          style="display:block; width:100%; max-width:544px; height:auto; border:0; border-radius:12px;"></div>`);
    }

    case "button": {
      const url = (b.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return "";
      return row(`<div style="padding:14px 28px 18px 28px; text-align:${align === "left" ? "left" : align};">
        <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block; padding:13px 30px; background-color:${ACCENT};
          font-family:${FONT}; font-size:14px; line-height:18px; font-weight:700; color:#FFFFFF;
          text-decoration:none; border-radius:10px;">${text(b.label) || "Zobacz"}</a></div>`);
    }

    case "columns":
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="padding:6px 28px 12px 28px;"><tr>
        <td width="50%" valign="top" style="padding-right:10px; font-family:${FONT}; font-size:14px; line-height:22px; color:${MUTED};">${text(b.text).replace(/\n/g, "<br>")}</td>
        <td width="50%" valign="top" style="padding-left:10px; font-family:${FONT}; font-size:14px; line-height:22px; color:${MUTED};">${text(b.text2).replace(/\n/g, "<br>")}</td>
      </tr></table>`);

    case "divider":
      return row(`<div style="padding:10px 28px;"><div style="height:1px; background-color:${LINE};"></div></div>`);

    case "spacer":
      return row(`<div style="height:${Math.max(4, Math.min(b.size ?? 20, 96))}px; line-height:1px; font-size:1px;">&nbsp;</div>`);

    case "social": {
      // Only links the author actually filled in; an empty social row is a
      // row of dead icons.
      const url = (b.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return "";
      return row(`<div style="padding:8px 28px 14px 28px; text-align:${align};">
        <a href="${escapeHtml(url)}" target="_blank" style="font-family:${FONT}; font-size:13px; font-weight:600;
          color:${ACCENT}; text-decoration:none;">${text(b.label) || escapeHtml(url)}</a></div>`);
    }

    case "footer":
      return row(`<div style="padding:10px 28px 4px 28px; font-family:${FONT}; font-size:12px; line-height:19px;
        color:${FAINT}; text-align:${align};">${text(b.text).replace(/\n/g, "<br>")}</div>`);

    default:
      return "";
  }
}

/* ── PLAIN TEXT ──────────────────────────────────────────────────────────── */

function blockText(b: MailBlock, merge: MergeValues): string {
  const t = (v: string | undefined) => applyMerge(v ?? "", merge).trim();
  switch (b.type) {
    case "heading": return `${t(b.text)}\n`;
    case "text": return `${t(b.text)}\n`;
    case "columns": return `${t(b.text)}\n${t(b.text2)}\n`;
    case "button": return b.url ? `${t(b.label) || "Zobacz"}: ${b.url}\n` : "";
    case "social": return b.url ? `${t(b.label) || b.url}: ${b.url}\n` : "";
    case "footer": return `${t(b.text)}\n`;
    case "image": return b.alt ? `[${t(b.alt)}]\n` : "";
    case "divider": return "---\n";
    default: return "";
  }
}

/** Strip a rendered document down to something readable in a text-only client.
 *  Deliberately crude: it is a fallback, not a second rendering engine. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:br|\/p|\/div|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ── THE DOCUMENT ────────────────────────────────────────────────────────── */

function shell(inner: string, preheader: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>GrovBase</title></head>
<body style="margin:0; padding:0; background-color:#F7F4FB;">
<!-- The preheader is the grey line a client shows next to the subject. It is
     hidden in the body and padded, so the client does not follow it with the
     first words of the layout instead. -->
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">${escapeHtml(preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F4FB;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
    style="width:100%; max-width:600px; background-color:#FFFFFF; border-radius:16px; overflow:hidden;">
    ${inner}
  </table>
  ${footer}
</td></tr></table></body></html>`;
}

function footerHtml(unsubscribeUrl: string, locale: string): string {
  const copy = FOOTER[locale] ?? FOOTER.pl;
  const link = unsubscribeUrl.trim();
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
    style="width:100%; max-width:600px;"><tr><td align="center"
    style="padding:18px 16px 4px 16px; font-family:${FONT}; font-size:12px; line-height:19px; color:${FAINT};">
    ${escapeHtml(copy.why)}<br>
    ${link ? `<a href="${escapeHtml(link)}" target="_blank" style="color:${FAINT}; text-decoration:underline;">${escapeHtml(copy.unsub)}</a> · ` : ""}
    <a href="https://grovbase.com" target="_blank" style="color:${FAINT}; text-decoration:none;">grovbase.com</a>
  </td></tr></table>`;
}

/* ── THE ENTRY POINT ─────────────────────────────────────────────────────── */

export function renderCampaign(input: RenderInput): RenderedMail {
  const locale = FOOTER[input.locale ?? "pl"] ? (input.locale ?? "pl") : "pl";
  const merge: MergeValues = { ...input.merge, unsubscribe_url: input.unsubscribeUrl };

  let body: string;
  let text: string;

  if (input.editor === "html") {
    // A pasted document is the author's, not ours — but it still passes the
    // same allowlist a received message does. Remote images are allowed here
    // (a newsletter is expected to load its own artwork) and script, style,
    // iframe, object and form are not, whatever the paste contained.
    const clean = sanitizeMailHtml(applyMerge(input.bodyHtml, merge), { allowRemoteImages: true });
    body = `<tr><td style="padding:0;">${clean.html}</td></tr>`;
    text = htmlToText(clean.html);
  } else {
    const blocks = toBlocks(input.blocks);
    body = blocks.map((b) => blockHtml(b, merge)).join("\n");
    text = blocks.map((b) => blockText(b, merge)).filter(Boolean).join("\n");
  }

  const tracked = rewriteLinks(body, input.tracking);

  const pixel = input.tracking?.trackOpens
    // An open pixel is a request for a 1×1 image, and nothing more is read
    // from it than "this recipient's client fetched it". No IP is stored, no
    // user agent string; see newsletter_track.
    ? `<tr><td style="padding:0; font-size:1px; line-height:1px;"><img src="${escapeHtml(
      `${input.tracking.origin}/api/newsletter/open/${input.tracking.recipientId}.png`)}"
      width="1" height="1" alt="" style="display:block; width:1px; height:1px; border:0;"></td></tr>`
    : "";

  const html = shell(
    tracked.html + pixel,
    applyMerge(input.preheader, merge),
    footerHtml(input.unsubscribeUrl, locale),
  );

  const copy = FOOTER[locale] ?? FOOTER.pl;
  const textFooter = `\n\n—\n${copy.why}${input.unsubscribeUrl ? `\n${copy.unsub}: ${input.unsubscribeUrl}` : ""}`;

  return {
    subject: applyMerge(input.subject, merge).replace(/[\r\n]+/g, " ").trim().slice(0, 200),
    preheader: applyMerge(input.preheader, merge).replace(/[\r\n]+/g, " ").trim().slice(0, 200),
    html,
    text: `${text.trim()}${textFooter}`,
    urls: tracked.urls,
  };
}

/**
 * The destinations in a body, without rendering it for a particular person.
 * Used once per campaign at snapshot time so every recipient's links resolve
 * to the same ids — and so the link table is written before the first send
 * rather than racing it.
 *
 * IT MUST TAG THE URLS THE SAME WAY THE RENDERER DOES. The renderer looks a
 * link up by its FINAL, utm-tagged form; if this collected the untagged one,
 * every lookup would miss, every href would fall back to the plain
 * destination, and click tracking would be silently off for the whole
 * campaign while the settings screen still said it was on. Hence the shared
 * `withUtm`, and hence the utm argument being required rather than optional.
 */
export function collectUrls(
  input: Pick<RenderInput, "editor" | "blocks" | "bodyHtml">,
  utm: RenderTracking["utm"],
): string[] {
  const merge: MergeValues = {};
  const body = input.editor === "html"
    ? sanitizeMailHtml(input.bodyHtml, { allowRemoteImages: true }).html
    : toBlocks(input.blocks).map((b) => blockHtml(b, merge)).join("\n");
  const urls: string[] = [];
  for (const m of body.matchAll(HREF)) {
    const url = m[1].trim();
    if (!trackable(url)) continue;
    const tagged = withUtm(url, utm);
    if (!urls.includes(tagged)) urls.push(tagged);
  }
  return urls;
}

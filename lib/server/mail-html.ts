import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * MAIL HTML — the security boundary between a stranger's e-mail and our DOM.
 *
 * The app's CSP allows 'unsafe-inline' scripts (Next's bootstrap and the
 * next-themes snippet need it), so a <script> that survives this file EXECUTES
 * in an admin session. Nothing else stands between the two: the mail body is
 * rendered with dangerouslySetInnerHTML because that is the only way to show
 * an e-mail at all. So this is an allowlist, not a blocklist — a tag or an
 * attribute that is not named below simply does not reach the page.
 *
 * The second job is tracking. Every remote image in a marketing mail is a
 * pixel that reports "the admin opened this" the instant it renders. With
 * allowRemoteImages false the src is moved into a data attribute, counted, and
 * nothing is fetched until the admin explicitly asks for it.
 */

/** Structural and text tags only. Anything that loads, executes, submits or
 *  frames — script, style, iframe, object, embed, form, input, link, meta,
 *  base, svg, math — is absent, which is what discards it. */
const ALLOWED_TAGS = [
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br",
  "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "dfn", "div", "dl", "dt",
  "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre", "q", "s", "samp",
  "section", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
];

/**
 * Tags whose TEXT goes too, not just the tag. `disallowedTagsMode: "discard"`
 * drops the element but keeps what is inside it, which would paste a whole
 * stylesheet or the body of a script into the message as visible text.
 */
const NON_TEXT_TAGS = [
  "script", "style", "textarea", "option", "noscript", "head", "title", "iframe", "object",
  "embed", "applet", "svg", "math", "template",
];

/** Presentational attributes that carry no URL and no behaviour. */
const GLOBAL_ATTRIBUTES = ["style", "class", "title", "dir", "lang", "align"];

/**
 * A CSS value is allowed only when it matches one of these, so a declaration
 * can never contain "(" other than in a numeric rgb()/hsl() — which is exactly
 * what makes url(javascript:…) and the old IE expression() unrepresentable
 * here instead of something we have to hunt for.
 *
 * The leading lookahead caps the value length, so a hostile 100 KB
 * declaration cannot make the alternations backtrack for long.
 */
const LENGTH = String.raw`(?:-?\d{1,6}(?:\.\d{1,4})?(?:px|pt|pc|in|cm|mm|em|rem|ex|ch|%|vw|vh)?|auto|inherit|initial|normal|none)`;
const COLOR = String.raw`(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]{1,40}\)|hsla?\([\d\s.,%]{1,40}\)|[a-z]{3,20})`;
const BORDER = String.raw`(?:${LENGTH}|${COLOR}|solid|dashed|dotted|double|groove|ridge|inset|outset|hidden)`;

function values(token: string, max: number): RegExp {
  return new RegExp(`^(?=[\\s\\S]{0,140}$)${token}(?: +${token}){0,${max - 1}}$`, "i");
}

const LENGTHS = values(LENGTH, 4);
const COLORS = values(COLOR, 1);
const BORDERS = values(BORDER, 4);
const KEYWORD = values(String.raw`(?:[a-z][a-z-]{0,24})`, 3);
/** Font stacks are long and quoted, but still parenthesis-free. */
const FONT_FAMILY = /^(?=[\s\S]{0,200}$)[\w\s"',.\-]+$/;

/**
 * Note what is NOT here: `background`, `background-image` and anything else
 * that can name a URL. A CSS background is a tracking pixel with extra steps,
 * and blocking it in the sanitizer means the remote-image switch below cannot
 * be walked around with a stylesheet.
 */
const ALLOWED_STYLES: Record<string, RegExp[]> = {
  "color": [COLORS],
  "background-color": [COLORS],
  "font": [values(String.raw`(?:${LENGTH}|${COLOR}|bold|bolder|lighter|italic|oblique|small-caps)`, 5)],
  "font-family": [FONT_FAMILY],
  "font-size": [LENGTHS],
  "font-style": [KEYWORD],
  "font-variant": [KEYWORD],
  "font-weight": [values(String.raw`(?:\d{3}|[a-z]{4,8})`, 1)],
  "line-height": [LENGTHS],
  "letter-spacing": [LENGTHS],
  "text-align": [KEYWORD],
  "text-decoration": [values(String.raw`(?:${COLOR}|underline|overline|line-through|solid|wavy|dotted|dashed|double)`, 3)],
  "text-indent": [LENGTHS],
  "text-transform": [KEYWORD],
  "vertical-align": [LENGTHS],
  "white-space": [KEYWORD],
  "word-break": [KEYWORD],
  "overflow-wrap": [KEYWORD],
  "word-wrap": [KEYWORD],
  "direction": [KEYWORD],
  "display": [KEYWORD],
  "float": [KEYWORD],
  "clear": [KEYWORD],
  "opacity": [LENGTHS],
  "box-sizing": [KEYWORD],
  "list-style-type": [KEYWORD],
  "width": [LENGTHS],
  "min-width": [LENGTHS],
  "max-width": [LENGTHS],
  "height": [LENGTHS],
  "min-height": [LENGTHS],
  "max-height": [LENGTHS],
  "margin": [LENGTHS],
  "margin-top": [LENGTHS],
  "margin-right": [LENGTHS],
  "margin-bottom": [LENGTHS],
  "margin-left": [LENGTHS],
  "padding": [LENGTHS],
  "padding-top": [LENGTHS],
  "padding-right": [LENGTHS],
  "padding-bottom": [LENGTHS],
  "padding-left": [LENGTHS],
  "border": [BORDERS],
  "border-top": [BORDERS],
  "border-right": [BORDERS],
  "border-bottom": [BORDERS],
  "border-left": [BORDERS],
  "border-color": [values(COLOR, 4)],
  "border-style": [KEYWORD],
  "border-width": [LENGTHS],
  "border-radius": [LENGTHS],
  "border-collapse": [KEYWORD],
  "border-spacing": [LENGTHS],
};

/** Inline images that mailparser already embedded travel as data: URIs, so
 *  they cost no network request and are safe to keep. Anything that is not a
 *  real raster type is dropped — including svg+xml, which is a document. */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\s]+$/i;
const REMOTE_URL = /^(https?:)?\/\//i;

export type SanitizedMail = { html: string; blockedImages: number };

/**
 * Turn one mail body into HTML that is safe to inject.
 *
 * `blockedImages` counts remote images that were neutralised, so the reader
 * can offer "show images (3)" instead of silently changing the message.
 */
export function sanitizeMailHtml(html: string, opts: { allowRemoteImages: boolean }): SanitizedMail {
  if (!html.trim()) return { html: "", blockedImages: 0 };

  let blockedImages = 0;

  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    nonTextTags: NON_TEXT_TAGS,
    disallowedTagsMode: "discard",
    allowedAttributes: {
      "*": GLOBAL_ATTRIBUTES,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "data-blocked-src"],
      table: ["width", "height", "border", "cellpadding", "cellspacing", "bgcolor"],
      td: ["colspan", "rowspan", "width", "height", "valign", "bgcolor", "nowrap"],
      th: ["colspan", "rowspan", "width", "height", "valign", "bgcolor", "nowrap"],
      tr: ["valign", "bgcolor", "height"],
      tbody: ["valign", "bgcolor"],
      thead: ["valign", "bgcolor"],
      tfoot: ["valign", "bgcolor"],
      col: ["span", "width"],
      colgroup: ["span", "width"],
      font: ["color", "face", "size"],
      ol: ["start", "type"],
      blockquote: ["cite"],
      q: ["cite"],
      time: ["datetime"],
      del: ["cite", "datetime"],
      ins: ["cite", "datetime"],
    },
    allowedStyles: { "*": ALLOWED_STYLES },
    // No javascript:, no data: documents, and no "//host" that would inherit
    // https and load anyway. img gets data: back in the transform below, but
    // only after the payload has been matched against SAFE_DATA_IMAGE.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // data: is re-admitted for img alone, and only reaches this check after the
    // transform below has matched the payload against SAFE_DATA_IMAGE — a
    // data: document never gets this far.
    allowedSchemesByTag: { img: ["data", "http", "https"] },
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    // A deeply nested body is a parser bomb, not a newsletter.
    nestingLimit: 60,
    transformTags: {
      // Mail links open outside the app, and rel keeps the opener and our
      // referrer away from whoever the sender is linking to.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
      img: (tagName, attribs) => {
        const src = (attribs.src ?? "").trim();
        const rest = { ...attribs };
        delete rest.src;
        // Already inside the message: no request, nothing to block.
        if (SAFE_DATA_IMAGE.test(src)) return { tagName, attribs: { ...rest, src } };
        if (!REMOTE_URL.test(src)) return { tagName, attribs: rest };
        if (opts.allowRemoteImages) return { tagName, attribs: { ...rest, src } };
        blockedImages += 1;
        // Kept, not deleted, so "show images" can put it back without a
        // second round trip to the mail server.
        return { tagName, attribs: { ...rest, "data-blocked-src": src } };
      },
    },
  });

  return { html: clean, blockedImages };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]{1,6}|[a-z]{2,8});/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Lone surrogates and out-of-range code points throw in fromCodePoint.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * A one-line summary for a message list or a Telegram alert.
 *
 * The plaintext alternative is preferred when the sender provided one; HTML is
 * the fallback and is flattened by hand rather than by the sanitizer, because
 * the result is text — it is never injected anywhere, so tags are simply gone.
 */
export function previewText(html: string | null, text: string, max: number): string {
  const source = text.trim() ? text : stripTags(html ?? "");
  // U+FFFD turns up whenever a preview was cut mid-character upstream; it is
  // noise in a summary, not information.
  const flat = decodeEntities(source).replace(/\uFFFD/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;

  // Cut one character past the budget so a boundary that lands exactly on the
  // limit still counts as a whole word.
  let cut = flat.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  cut = space > Math.floor(max * 0.6) ? cut.slice(0, space) : cut.slice(0, max);
  // Never leave half a surrogate pair behind: it renders as a replacement
  // character in every mail client and in Telegram.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Tags out, and the content of the tags that only ever hold code out with
 *  them. Entities are decoded afterwards so "&lt;script&gt;" cannot become a
 *  tag on the way. */
function stripTags(html: string): string {
  return html
    .replace(/<(script|style|head|title|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ");
}

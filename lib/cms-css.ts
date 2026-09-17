/**
 * SCOPING CUSTOM CSS TO ONE SECTION.
 *
 * A custom block may carry its own stylesheet. Written plainly, `.title {
 * color: red }` is a rule about EVERY `.title` on the site — the header, the
 * footer, the admin panel, the twenty-nine other sections on the same page.
 * That is not a theoretical risk: `body { display: none }` in one marketing
 * block would blank the whole site, and nobody editing that block would
 * expect it to.
 *
 * So every selector is rewritten to sit under the section's own wrapper:
 *
 *     .hero-title { … }
 *       →  [data-cms-section="8f3e…"] .hero-title { … }
 *
 * The transform is a small tokenizer rather than a regular expression,
 * because a CSS file is nested (@media, @supports) and a regex over braces
 * gets that wrong in both directions.
 *
 * WHAT IS REFUSED OUTRIGHT (and why):
 *   @import   would fetch a stylesheet from anywhere on the internet, at
 *             render time, on our origin's behalf.
 *   expression(), javascript: and behavior:  are script in a `style` coat.
 *   </style>  would end the tag early and let the rest be parsed as markup.
 *
 * This is a CONTAINMENT boundary, not a validator: invalid CSS stays invalid
 * and simply does nothing, which is the browser's job, not ours.
 */

/** At-rules whose body is a block of normal rules and must be descended into. */
const NESTED_AT_RULES = /^@(media|supports|container|layer|scope)\b/i;
/** At-rules that carry their own private selector namespace (`from`, `0%`,
 *  `:root` inside `@font-face`) and must be copied through untouched. */
const OPAQUE_AT_RULES = /^@(keyframes|-webkit-keyframes|font-face|page|property|counter-style)\b/i;

/** Selectors that mean "everything" and would escape the section if kept. */
const ROOT_SELECTOR = /^(html|body|:root|\*)$/i;

/** Strip comments first: they can contain braces and would confuse the split. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Anything that turns a stylesheet into a fetch or a script. */
function isDangerous(css: string): boolean {
  return /@import|@charset|expression\s*\(|javascript\s*:|behavior\s*:|<\/style/i.test(css);
}

/**
 * Prefix one selector list. A selector already anchored at the section (an
 * admin who wrote the scope by hand) is left alone rather than doubled.
 */
function scopeSelectorList(selectors: string, scope: string): string {
  return selectors
    .split(",")
    .map((raw) => {
      const sel = raw.trim();
      if (!sel) return "";
      if (sel.startsWith(scope)) return sel;
      // `html`, `body`, `:root` and `*` are the four ways to say "the whole
      // document". Inside a section they can only mean "this section".
      if (ROOT_SELECTOR.test(sel)) return scope;
      // A leading combinator (`> p`) is relative to the scope already.
      if (/^[>+~]/.test(sel)) return `${scope} ${sel}`;
      // `&` is the nesting marker authors reach for; treat it as the scope.
      if (sel.includes("&")) return sel.replace(/&/g, scope);
      return `${scope} ${sel}`;
    })
    .filter(Boolean)
    .join(", ");
}

type Chunk = { prelude: string; body: string | null };

/** Split a stylesheet into top-level `prelude { body }` chunks and bare
 *  statements, tracking quotes and parentheses so a brace inside a string or
 *  a `url(…)` never ends a block. */
function chunks(css: string): Chunk[] {
  const out: Chunk[] = [];
  let prelude = "";
  let depth = 0;
  let body = "";
  let quote: string | null = null;
  let paren = 0;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    const target = depth > 0 ? "body" : "prelude";

    if (quote) {
      if (target === "body") body += ch; else prelude += ch;
      if (ch === quote && css[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      if (target === "body") body += ch; else prelude += ch;
      continue;
    }
    if (ch === "(") paren++;
    if (ch === ")") paren = Math.max(0, paren - 1);

    if (ch === "{" && paren === 0) {
      depth++;
      if (depth === 1) continue;
      body += ch;
      continue;
    }
    if (ch === "}" && paren === 0) {
      depth--;
      if (depth === 0) {
        out.push({ prelude: prelude.trim(), body });
        prelude = "";
        body = "";
        continue;
      }
      body += ch;
      continue;
    }
    if (ch === ";" && depth === 0 && paren === 0) {
      // A bare at-statement (@import, @charset). Refused above, dropped here.
      prelude = "";
      continue;
    }
    if (depth > 0) body += ch; else prelude += ch;
  }
  return out;
}

/**
 * Rewrite `css` so that nothing in it can match outside `[data-cms-section=
 * "<id>"]`. Returns an empty string for input that has no business being a
 * stylesheet at all.
 */
export function scopeCss(css: string | undefined, sectionId: string): string {
  const source = (css ?? "").trim();
  if (!source) return "";
  if (isDangerous(source)) return "";
  // A section id comes from the database as a uuid; quoting it defensively
  // costs nothing and means a malformed one cannot break out of the selector.
  const scope = `[data-cms-section="${sectionId.replace(/["\\]/g, "")}"]`;
  return render(stripComments(source), scope).trim();
}

function render(css: string, scope: string): string {
  return chunks(css)
    .map(({ prelude, body }) => {
      if (body === null) return "";
      if (prelude.startsWith("@")) {
        if (OPAQUE_AT_RULES.test(prelude)) return `${prelude} { ${body.trim()} }`;
        if (NESTED_AT_RULES.test(prelude)) {
          const inner = render(body, scope);
          return inner ? `${prelude} { ${inner} }` : "";
        }
        // An at-rule nobody recognised is dropped rather than guessed at.
        return "";
      }
      const selector = scopeSelectorList(prelude, scope);
      const declarations = body.trim();
      if (!selector || !declarations) return "";
      return `${selector} { ${declarations} }`;
    })
    .filter(Boolean)
    .join("\n");
}

/** CSS is printed inside a `<style>` element, where the only sequence that can
 *  end the element early is `</style`. It is already refused above; this is the
 *  belt to that braces. */
export function styleSafe(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

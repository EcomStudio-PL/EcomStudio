import type { CmsCode } from "@/lib/cms";
import { scopeCss, styleSafe } from "@/lib/cms-css";
import { sanitizeHtml } from "@/lib/cms-sanitize";
import { SandboxFrame } from "./sandbox-frame";

/**
 * THE ONE SECTION THAT IS CODE.
 *
 * Twenty-five section types cover the site; this exists for the twenty-sixth
 * thing nobody anticipated. It has two completely different execution models,
 * and which one applies is a checkbox the admin ticks:
 *
 *   JAVASCRIPT OFF — the default, and what almost every block should be.
 *   The HTML is sanitised against an allowlist and printed into the page; the
 *   CSS is rewritten so every selector sits under this section's own wrapper.
 *   Nothing can execute, nothing can style the header or the section above,
 *   and the content is real markup — indexable, selectable, fast.
 *
 *   JAVASCRIPT ON — a deliberate choice with a warning next to it. The whole
 *   block moves into a sandboxed iframe with no same-origin access, where it
 *   can do as it likes to itself and nothing at all to us. It is NOT indexed
 *   and it costs a frame, which is the honest price of running script.
 *
 * ERRORS ARE CONTAINED, NOT PROPAGATED. A block whose HTML sanitises down to
 * nothing renders as nothing on the public site — the page keeps its other
 * twenty-nine sections. In the admin preview the same case says so out loud,
 * because the person looking at it is the person who can fix it.
 */

export function CustomBlock({ code, sectionId, admin = false, label }: {
  code: CmsCode | undefined;
  /** The block's uuid — the scope every selector is rewritten under. */
  sectionId: string;
  /** Admin preview shows a broken block; production skips it silently. */
  admin?: boolean;
  /** Localized "Błąd sekcji" text, so this file holds no user-facing copy. */
  label: { title: string; body: string; frame: string };
}) {
  const html = sanitizeHtml(code?.html);
  const css = scopeCss(code?.css, sectionId);
  const js = (code?.js ?? "").trim();
  const runsJs = Boolean(code?.jsEnabled && js);

  if (!html && !css && !runsJs) {
    // Nothing survived, or nothing was written. Either way there is no block.
    return admin ? (
      <div className="cms-broken" data-cms-broken>
        <p className="font-semibold">{label.title}</p>
        <p className="mt-1">{label.body}</p>
      </div>
    ) : null;
  }

  if (runsJs) {
    return <SandboxFrame srcDoc={buildDocument(html, code?.css ?? "", js)} title={label.frame} />;
  }

  return (
    <>
      {/* The stylesheet is printed before the markup so the block never
          appears unstyled for a frame. It is already scoped and already
          refused anything that could fetch or execute. */}
      {css && <style dangerouslySetInnerHTML={{ __html: styleSafe(css) }} />}
      {/* Sanitised above against an allowlist: no script, no style attribute,
          no event handler, no javascript: URL. See lib/cms-sanitize.ts. */}
      {html && <div dangerouslySetInnerHTML={{ __html: html }} />}
    </>
  );
}

/** The document handed to the sandbox. The CSS is NOT scoped here — inside the
 *  frame there is nothing else to protect, and scoping it would break the
 *  author's own selectors for no gain. */
function buildDocument(html: string, css: string, js: string): string {
  // Inside the sandbox the parent is unreachable, so the only value that has
  // to cross the boundary is the height, and it crosses as a number.
  const measure = `
    (function () {
      function report() {
        var h = Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0
        );
        parent.postMessage({ type: "cms:height", height: h }, "*");
      }
      if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
      addEventListener("load", report);
      addEventListener("resize", report);
      report();
    })();
  `;
  // `</script` inside authored code would close the tag early and let the rest
  // be parsed as markup — the one escape this document has to make.
  const guard = (text: string) => text.replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;color-scheme:light dark}</style>
<style>${styleSafe(css)}</style>
</head><body>${html}
<script>${guard(js)}</script>
<script>${measure}</script>
</body></html>`;
}

import { Fragment } from "react";
import { parseLegalText, splitLinks, type LegalNode, type LegalOutline } from "@/lib/legal/document";

/**
 * A LEGAL DOCUMENT ON SCREEN — every line of the source, verbatim.
 *
 * Renders the nodes of parseLegalText (lib/legal/document.ts): one element per
 * source line, numbers and dashes kept as text (no <ol> renumbering), web and
 * e-mail addresses made clickable without changing what they say. A "\n" text
 * node follows every element so the DOM's textContent keeps the line breaks
 * the comparison test reads.
 *
 * No hooks, no server-only imports: the public page (server), the builder's
 * section preview and the admin editor's preview (client) all render this.
 */
export function LegalText({ text, outline, lang, className }: {
  /** The document text; parsed here unless `outline` is given. */
  text?: string;
  outline?: LegalOutline;
  lang?: string;
  className?: string;
}) {
  const parsed = outline ?? parseLegalText(text ?? "");
  return (
    <div lang={lang} data-legal-text
      className={`text-[15px] leading-[1.75] text-ink/90 [overflow-wrap:anywhere] sm:text-[15.5px] ${className ?? ""}`}>
      {parsed.nodes.map((node, i) => (
        <Fragment key={i}>
          <LegalLine node={node} />
          {"\n"}
        </Fragment>
      ))}
    </div>
  );
}

/** Magenta that is still readable: --accent is 3.65:1 on the light page, so
 *  the light theme draws addresses and bullets in --accent-strong (5.51:1)
 *  and the dark theme keeps --accent (6.06:1). */
const ACCENT_TEXT = "text-accent-strong dark:text-accent";

function Linked({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((s, i) => s.href
        ? (
          <a key={i} href={s.href}
            {...(s.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className={`font-medium ${ACCENT_TEXT} underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent`}>
            {s.text}
          </a>
        )
        : <Fragment key={i}>{s.text}</Fragment>)}
    </>
  );
}

function LegalLine({ node }: { node: LegalNode }) {
  switch (node.kind) {
    case "title":
      return (
        <h1 data-legal-title className="font-display text-[clamp(1.55rem,3.8vw,2.35rem)] font-semibold leading-[1.15] tracking-tight text-ink">
          {node.text}
        </h1>
      );
    case "meta":
      return <p data-legal-meta className="mt-1 text-[13px] leading-relaxed text-muted"><Linked text={node.text} /></p>;
    case "heading":
      return node.level === 2 ? (
        <h2 id={node.id} data-legal-heading="2"
          className="mt-10 scroll-mt-28 border-t border-line pt-7 font-display text-[clamp(1.15rem,2.4vw,1.4rem)] font-semibold leading-snug tracking-tight text-ink first:mt-0">
          {node.text}
        </h2>
      ) : (
        <h3 id={node.id} data-legal-heading="3"
          className="mt-7 scroll-mt-28 text-[1.04rem] font-semibold leading-snug text-ink">
          {node.text}
        </h3>
      );
    case "item":
      return (
        <p data-legal-item={node.depth}
          className="mt-2 flex gap-2.5"
          style={{ paddingLeft: `${node.depth * 1.6}rem` }}>
          <span className={`shrink-0 tabular-nums ${node.bullet ? ACCENT_TEXT : "min-w-[1.6rem] font-medium text-muted"}`}>{node.marker}</span>
          {" "}
          <span className="min-w-0 flex-1"><Linked text={node.text} /></span>
        </p>
      );
    case "para":
      return (
        <p data-legal-para className="mt-2"
          style={node.indent > 0 ? { paddingLeft: `${(Math.floor(node.indent / 4) * 1.6) + 2.1}rem` } : undefined}>
          <Linked text={node.text} />
        </p>
      );
    case "gap":
      return <span aria-hidden className="block h-2.5" />;
  }
}

import Link from "next/link";
import { faqMatchRanges, faqSplit, type FaqInline, type FaqRich } from "@/lib/faq";

/**
 * AN ANSWER OF THE FAQ BASE, drawn from its nodes (lib/faq.ts parseFaqRich):
 * paragraphs, bold, links — React elements only, never an HTML string, so a
 * search highlight is a <mark> around the visitor's own words and nothing
 * typed into an answer can become markup.
 *
 * No hooks: the same component serves the cennik's and O nas's accordions
 * (client components) and the /faq page.
 */

const LINK = "font-semibold text-[rgb(var(--accent-strong))] underline decoration-[rgb(var(--accent)/0.35)] underline-offset-2 transition-colors hover:decoration-current dark:text-[rgb(var(--accent-glow))]";
const MARK = "rounded-[4px] bg-[rgb(var(--accent)/0.16)] px-[1px] text-inherit";

/** A text with the stems of the visitor's search marked. */
export function Highlight({ text, stems }: { text: string; stems?: readonly string[] }) {
  if (!stems || stems.length === 0) return <>{text}</>;
  const parts = faqSplit(text, faqMatchRanges(text, stems));
  return <>{parts.map((p, i) => (p.hit ? <mark key={i} className={MARK} data-faq-hit>{p.v}</mark> : p.v))}</>;
}

function Node({ node, stems }: { node: FaqInline; stems?: readonly string[] }) {
  if (node.t === "b") return <strong className="font-semibold text-ink"><Highlight text={node.v} stems={stems} /></strong>;
  if (node.t === "a") {
    const inner = <Highlight text={node.v} stems={stems} />;
    return node.href.startsWith("/") || node.href.startsWith("#")
      ? <Link href={node.href} className={LINK}>{inner}</Link>
      : <a href={node.href} className={LINK} {...(node.href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inner}</a>;
  }
  return <Highlight text={node.v} stems={stems} />;
}

export function FaqRichText({ rich, stems, className }: { rich: FaqRich; stems?: readonly string[]; className?: string }) {
  return (
    <>
      {rich.map((p, i) => (
        <p key={i} className={className}>
          {p.map((n, j) => <Node key={j} node={n} stems={stems} />)}
        </p>
      ))}
    </>
  );
}

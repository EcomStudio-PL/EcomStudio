"use client";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Link2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { faqMatchRanges, faqMatches, faqQueryStems, type FaqPublicData, type FaqVote } from "@/lib/faq";
import { FaqRichText, Highlight } from "./faq-rich";

/**
 * THE /faq LIST (FAQ V1): the live search, the category pills, the questions.
 *
 * Everything here works on the questions the server already chose — the page
 * fetches nothing to search. Typing filters as you go: case and Polish
 * letters do not matter and a word finds its other forms ("fakturę" finds
 * "faktura", lib/faq.ts), the matching words are marked (<mark>, never HTML),
 * a question whose ANSWER matches opens so the mark can be seen, and a
 * category with nothing left disappears.
 *
 * Several answers may be open at once. Each question has its own address,
 * /faq#<slug>: opening one puts it in the address bar (replaceState — the
 * Back button leaves the page rather than walking through every question you
 * opened), and arriving with one — a link from Kontakt, a refresh, Back/
 * Forward — opens it and brings it into view.
 *
 * "Czy to pomogło?" sends one vote per question per browser (the server
 * keeps the first, app/api/public/faq/vote); the answer is remembered here
 * only to show the thank-you again, never sent anywhere else.
 */

export type FaqBrowserText = {
  placeholder: string; searchLabel: string; clear: string;
  empty: string; emptyHint: string; emptyCta: string;
  topics: string; results: string; resultsNone: string;
  voteQuestion: string; voteYes: string; voteNo: string; voteThanks: string; voteSorry: string;
  voteContact: string; voteError: string;
  copy: string; copied: string; copyFailed: string;
};

const VOTES_KEY = "gb.faq.votes";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent)/0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

function readVotes(): Record<string, FaqVote> {
  try {
    const raw = window.localStorage.getItem(VOTES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter((e): e is [string, FaqVote] => e[1] === "yes" || e[1] === "no"));
  } catch {
    return {};
  }
}

function writeVotes(votes: Record<string, FaqVote>) {
  try {
    window.localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  } catch {
    // Private mode or storage off: the vote is stored on the server anyway.
  }
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function FaqBrowser({ data, text, contactHref, contactTopics }: {
  data: FaqPublicData;
  text: FaqBrowserText;
  contactHref: string;
  /** Category slug → /kontakt?temat=… for "Nie pomogło → Napisz do nas". */
  contactTopics: Record<string, string>;
}) {
  const base = useId();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [votes, setVotes] = useState<Record<string, FaqVote>>({});
  const [active, setActive] = useState<string | null>(data.categories[0]?.slug ?? null);
  const slugs = useMemo(() => new Set(data.items.map((i) => i.slug)), [data.items]);

  const stems = useMemo(() => faqQueryStems(deferred), [deferred]);
  const shown = useMemo(
    () => (stems.length === 0 ? data.items : data.items.filter((i) => faqMatches([i.q, i.text], stems))),
    [data.items, stems],
  );
  const shownCategories = useMemo(
    () => data.categories.filter((c) => shown.some((i) => i.category === c.slug)),
    [data.categories, shown],
  );

  // A search opens the questions whose ANSWER matches, so the mark shows.
  const stemsKey = stems.join(" ");
  useEffect(() => {
    if (!stemsKey) return;
    const s = stemsKey.split(" ");
    setOpen(new Set(data.items.filter((i) => faqMatches([i.q, i.text], s) && faqMatchRanges(i.text, s).length > 0).map((i) => i.slug)));
  }, [stemsKey, data.items]);

  useEffect(() => setVotes(readVotes()), []);

  // /faq#<slug>: open it and bring it into view — on arrival, on a refresh,
  // on Back/Forward and on an in-page link to another question.
  useEffect(() => {
    const fromHash = () => {
      let slug = "";
      try { slug = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!slugs.has(slug)) return;
      setQuery("");
      setOpen((prev) => (prev.has(slug) ? prev : new Set(prev).add(slug)));
      window.requestAnimationFrame(() => {
        const el = document.getElementById(slug);
        if (!el) return;
        el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
        el.querySelector<HTMLElement>("button[aria-controls]")?.focus({ preventScroll: true });
      });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("popstate", fromHash);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("popstate", fromHash);
    };
  }, [slugs]);

  // Which category is on screen, for the pill that reads "you are here".
  const sections = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const slug = top?.target.getAttribute("data-faq-category");
      if (slug) setActive(slug);
    }, { rootMargin: "-140px 0px -55% 0px" });
    for (const el of sections.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [shownCategories]);

  const toggle = useCallback((slug: string) => {
    const isOpen = open.has(slug);
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(slug); else next.add(slug);
      return next;
    });
    const here = `${window.location.pathname}${window.location.search}`;
    if (!isOpen) window.history.replaceState(null, "", `${here}#${slug}`);
    else if (window.location.hash === `#${slug}`) window.history.replaceState(null, "", here);
  }, [open]);

  const goCategory = (slug: string) => {
    const el = sections.current.get(slug);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    setActive(slug);
  };

  const vote = useCallback((slug: string, value: FaqVote) => {
    setVotes((prev) => {
      const next = { ...prev, [slug]: value };
      writeVotes(next);
      return next;
    });
  }, []);

  const count = stems.length === 0 ? null : shown.length;

  return (
    <div className="mt-[clamp(1.75rem,4vw,2.5rem)]" data-faq-browser>
      <div role="search" className="relative">
        <Search size={20} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={text.placeholder} aria-label={text.searchLabel} maxLength={120}
          enterKeyHint="search" autoComplete="off" spellCheck={false} data-faq-search
          className={cn(
            "h-14 w-full rounded-2xl border border-line bg-surface pl-12 pr-12 text-[16px] text-ink shadow-[0_1px_2px_rgb(15_15_30/0.04),0_12px_32px_-22px_rgb(15_15_30/0.3)]",
            "placeholder:text-faint transition-[border-color,box-shadow] focus:border-[rgb(var(--accent)/0.55)] focus:outline-none focus:ring-4 focus:ring-[rgb(var(--accent)/0.14)]",
            "[&::-webkit-search-cancel-button]:hidden",
          )} />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label={text.clear}
            className={cn("absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink", FOCUS)}>
            <X size={18} aria-hidden />
          </button>
        )}
      </div>
      <p className="sr-only" aria-live="polite" data-faq-count>
        {count === null ? "" : count === 0 ? text.resultsNone : text.results.replace("{n}", String(count))}
      </p>

      {shownCategories.length > 1 && (
        <nav aria-label={text.topics}
          className="z-20 -mx-4 mt-5 bg-bg/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-bg/75 lg:sticky lg:top-[var(--header-h)] lg:mx-0 lg:px-0"
          data-faq-topics>
          <ul className="thin-scroll flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
            {shownCategories.map((c) => (
              <li key={c.slug} className="shrink-0">
                <a href={`#kategoria-${c.slug}`} onClick={(e) => { e.preventDefault(); goCategory(c.slug); }}
                  aria-current={active === c.slug ? "true" : undefined} data-faq-pill={c.slug}
                  className={cn(
                    "inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-4 text-[13.5px] font-semibold transition-colors",
                    active === c.slug
                      ? "border-[rgb(var(--accent)/0.4)] bg-accent-soft text-[rgb(var(--accent-strong))] dark:text-[rgb(var(--accent-glow))]"
                      : "border-line bg-surface text-muted hover:bg-raised hover:text-ink",
                    FOCUS,
                  )}>
                  {c.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {shown.length === 0 ? (
        <div className="mt-8 rounded-[24px] border border-dashed border-line bg-surface px-6 py-10 text-center" data-faq-empty>
          <p className="font-display text-[1.15rem] font-semibold text-ink">{text.empty}</p>
          <p className="mt-1.5 text-[14.5px] text-muted">{text.emptyHint}</p>
          <Link href={contactHref}
            className={cn("mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-[rgb(var(--accent-strong))] px-5 text-[14.5px] font-semibold text-white transition-colors hover:bg-[rgb(var(--accent))]", FOCUS)}>
            {text.emptyCta}
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          {shownCategories.map((c) => {
            const headingId = `${base}-cat-${c.slug}`;
            return (
              <section key={c.slug} id={`kategoria-${c.slug}`} data-faq-category={c.slug} aria-labelledby={headingId}
                ref={(el) => { if (el) sections.current.set(c.slug, el); else sections.current.delete(c.slug); }}
                className="scroll-mt-[calc(var(--header-h)+16px)] lg:scroll-mt-[calc(var(--header-h)+76px)]">
                <h2 id={headingId} tabIndex={-1}
                  className="mb-3 px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-muted focus:outline-none">
                  {c.name}
                </h2>
                <div className="divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-surface">
                  {shown.filter((i) => i.category === c.slug).map((item) => {
                    const expanded = open.has(item.slug);
                    const btn = `${base}-${item.slug}-q`;
                    const panel = `${base}-${item.slug}-a`;
                    return (
                      <div key={item.slug} id={item.slug} data-faq-item={item.slug}
                        className="scroll-mt-[calc(var(--header-h)+16px)] lg:scroll-mt-[calc(var(--header-h)+76px)]">
                        <h3>
                          <button type="button" id={btn} aria-expanded={expanded} aria-controls={panel}
                            onClick={() => toggle(item.slug)}
                            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-semibold text-ink transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--accent))] sm:px-6">
                            <span><Highlight text={item.q} stems={stems} /></span>
                            <ChevronDown size={18} aria-hidden
                              className={cn("shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none", expanded && "rotate-180")} />
                          </button>
                        </h3>
                        <div id={panel} role="region" aria-labelledby={btn} hidden={!expanded}
                          className="px-5 pb-5 text-[14.5px] leading-relaxed text-muted sm:px-6">
                          <div className="space-y-3"><FaqRichText rich={item.a} stems={stems} /></div>
                          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line pt-4">
                            <VoteRow slug={item.slug} voted={votes[item.slug]} onVoted={vote} text={text}
                              contactHref={contactTopics[item.category] ?? contactHref} />
                            <CopyLink slug={item.slug} text={text} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VoteRow({ slug, voted, onVoted, text, contactHref }: {
  slug: string;
  voted: FaqVote | undefined;
  onVoted: (slug: string, value: FaqVote) => void;
  text: FaqBrowserText;
  contactHref: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  const send = async (value: FaqVote) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/public/faq/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, vote: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onVoted(slug, value);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (voted) {
    return (
      <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-muted" data-faq-voted={voted}>
        <Check size={15} aria-hidden className="text-[rgb(var(--success))]" />
        <span>{voted === "yes" ? text.voteThanks : text.voteSorry}</span>
        {voted === "no" && (
          <Link href={contactHref} data-faq-vote-contact
            className={cn("rounded-sm font-semibold text-[rgb(var(--accent-strong))] underline decoration-[rgb(var(--accent)/0.35)] underline-offset-2 hover:decoration-current dark:text-[rgb(var(--accent-glow))]", FOCUS)}>
            {text.voteContact}
          </Link>
        )}
      </p>
    );
  }
  const chip = cn("inline-flex min-h-9 items-center rounded-full border border-line bg-bg px-3.5 text-[13px] font-semibold text-ink transition-colors hover:border-[rgb(var(--accent)/0.4)] hover:bg-raised disabled:cursor-wait disabled:opacity-60", FOCUS);
  return (
    <div className="flex flex-wrap items-center gap-2" data-faq-vote>
      <span className="text-[13.5px] text-muted" id={`vote-${slug}`}>{text.voteQuestion}</span>
      <div role="group" aria-labelledby={`vote-${slug}`} className="flex gap-2">
        <button type="button" className={chip} disabled={busy} onClick={() => void send("yes")} data-faq-vote-yes>{text.voteYes}</button>
        <button type="button" className={chip} disabled={busy} onClick={() => void send("no")} data-faq-vote-no>{text.voteNo}</button>
      </div>
      {failed && <span role="alert" className="text-[13px] text-[rgb(var(--danger))]">{text.voteError}</span>}
    </div>
  );
}

function CopyLink({ slug, text }: { slug: string; text: FaqBrowserText }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const id = window.setTimeout(() => setState("idle"), 2200);
    return () => window.clearTimeout(id);
  }, [state]);

  const copy = async () => {
    const url = `${window.location.origin}/faq#${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setState("done");
    } catch {
      setState("failed");
    }
  };
  return (
    <button type="button" onClick={() => void copy()} data-faq-copy
      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink", FOCUS)}>
      {state === "done" ? <Check size={15} aria-hidden className="text-[rgb(var(--success))]" /> : <Link2 size={15} aria-hidden />}
      <span aria-live="polite">{state === "done" ? text.copied : state === "failed" ? text.copyFailed : text.copy}</span>
    </button>
  );
}

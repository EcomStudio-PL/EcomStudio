import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { loadSlots } from "@/lib/server/media-slots";
import { getToolFaq } from "@/lib/server/faq";
import { faqJsonLd } from "@/lib/faq";
import { jsonLdScript } from "@/lib/grovnews-blog";
import { BEFORE_AFTER_SIZE, ratioOf, type MediaPair } from "@/lib/seller-home-config";
import {
  TOOL_EXAMPLE_PAIRS, TOOL_PAGE_SHARED_KEYS, toolExampleSlot, toolPageTextKeys, type PublicTool,
} from "@/lib/public-tools";
import { BeforeAfter } from "@/components/seller-home/before-after";
import { homeSlot, iceImage, type HomeSlots } from "@/components/seller-home/ice-slot-image";
import { AboutFaq } from "@/components/cms/about-faq";
import { TryFree } from "./try-free";

/**
 * THE TOOL'S PUBLIC BLOCK — under the panel, for visitors only (Public Tools
 * V1; ToolScope renders it in the visitor's branch, never for a member).
 *
 *   · a headline and a paragraph — the tool's own copy, edited in "Edytuj
 *     stronę", and also the page's <title> and description;
 *   · up to four 1:1 before/after examples — media slots filled in the same
 *     editor, compared with the home page's own slider. An unfilled pair is
 *     not drawn; none filled, no examples at all. Never a borrowed or invented
 *     result;
 *   · three questions from the FAQ base (0158: assigned to this tool there) —
 *     only what faq_public() lets a visitor read, with their FAQPage data;
 *   · "Wypróbuj za darmo", back up to the panel.
 *
 * In "Edytuj stronę" (`editing`, an admin on this page) every example frame
 * is drawn, empty ones as placeholders, so each pair can be filled where it
 * stands; the copy is marked by the dictionary layer like any page text.
 *
 * Lightweight on purpose: server-rendered text a crawler can read, two small
 * client islands (the slider, the accordion), no request of its own beyond
 * the cached slot and FAQ reads.
 */
export async function PublicToolSeo({ tool, editing = false }: { tool: PublicTool; editing?: boolean }) {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const text = toolPageTextKeys(tool.key);

  const defs = Array.from({ length: TOOL_EXAMPLE_PAIRS }, (_, i) => ({
    n: i + 1,
    before: toolExampleSlot(tool.key, i + 1, "before"),
    after: toolExampleSlot(tool.key, i + 1, "after"),
  }));
  const [slotMap, faq] = await Promise.all([
    loadSlots(supabase, defs.flatMap((d) => [d.before, d.after])),
    getToolFaq(tool.key, locale),
  ]);
  const home: HomeSlots = { slots: Object.fromEntries(slotMap), locale };
  const pairs = defs.flatMap((d) => {
    const before = homeSlot(home, d.before);
    const after = homeSlot(home, d.after);
    const complete = before?.mediaType === "image" && after?.mediaType === "image";
    // The slider compares two stills, and a half-filled pair would compare a
    // photo with a placeholder: both halves, both images, or nothing — for a
    // visitor. The editor sees every frame.
    if (!complete && !editing) return [];
    return [{
      ...d,
      beforeImg: before?.mediaType === "image" ? iceImage(before, locale) : undefined,
      afterImg: after?.mediaType === "image" ? iceImage(after, locale) : undefined,
    }];
  });
  const emptyPair = (n: number): MediaPair => ({
    before: { configKey: toolExampleSlot(tool.key, n, "before"), kind: "image", src: null, width: BEFORE_AFTER_SIZE.width, height: BEFORE_AFTER_SIZE.height },
    after: { configKey: toolExampleSlot(tool.key, n, "after"), kind: "image", src: null, width: BEFORE_AFTER_SIZE.width, height: BEFORE_AFTER_SIZE.height },
  });
  const ld = faq.length > 0 ? faqJsonLd(faq) : null;
  const headline = t(text.headline);

  return (
    <section data-public-tool-seo={tool.key} aria-labelledby="tool-seo-title"
      className="mx-auto mt-10 w-full max-w-[1100px] border-t border-line pt-10 lg:mt-12">
      <header className="mx-auto max-w-2xl text-center">
        <h2 id="tool-seo-title" className="font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-semibold leading-tight tracking-[-0.02em]">
          {headline}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{t(text.lead)}</p>
      </header>

      {pairs.length > 0 && (
        <div className="mt-8" data-tool-examples={pairs.length}>
          <h3 className="mb-4 text-center text-[13px] font-semibold uppercase tracking-[0.14em] text-faint">{t(TOOL_PAGE_SHARED_KEYS.examples)}</h3>
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
            {pairs.map((p, i) => (
              <div key={p.n} data-tool-example={p.n} className="overflow-hidden rounded-xl ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]">
                <BeforeAfter pair={emptyPair(p.n)} ratio={ratioOf(BEFORE_AFTER_SIZE)} tone={i * 2}
                  before={p.beforeImg} after={p.afterImg}
                  sizes="(max-width: 479px) 92vw, (max-width: 1023px) 46vw, 260px"
                  labels={{
                    before: t(TOOL_PAGE_SHARED_KEYS.before), after: t(TOOL_PAGE_SHARED_KEYS.after),
                    slider: t("publicTools.seo.slider", { name: headline }),
                    emptyBefore: t(TOOL_PAGE_SHARED_KEYS.before), emptyAfter: t(TOOL_PAGE_SHARED_KEYS.after),
                    hint: "",
                  }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {faq.length > 0 && (
        <div className="mx-auto mt-10 max-w-3xl" data-tool-faq={faq.length}>
          <h3 className="mb-4 text-center font-display text-[1.25rem] font-semibold">{t(TOOL_PAGE_SHARED_KEYS.faq)}</h3>
          <AboutFaq shared="tool" items={faq.map((f) => ({ slug: f.slug, q: f.q, a: f.a }))} />
          {ld && <script type="application/ld+json" data-tool-faq-ld dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
        </div>
      )}

      <div className="mt-10 flex flex-col items-center gap-2 text-center">
        <TryFree label={t(TOOL_PAGE_SHARED_KEYS.cta)} />
        <p className="text-[12.5px] text-muted">{t(TOOL_PAGE_SHARED_KEYS.ctaSub)}</p>
      </div>
    </section>
  );
}

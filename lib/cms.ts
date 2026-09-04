/** Structured CMS content. Blocks hold ONLY structured data (no raw HTML),
 *  so nothing executable can be injected through the CMS. Text is localized
 *  per field with PL fallback. */

export type LocaleText = { pl?: string; en?: string; de?: string };

export type CmsItem = {
  title?: LocaleText;
  description?: LocaleText;
  mediaUrl?: string;
  url?: string;
  value?: string;
};

export type CmsBlockContent = {
  badge?: LocaleText;
  title?: LocaleText;
  subtitle?: LocaleText;
  description?: LocaleText;
  ctaLabel?: LocaleText;
  ctaUrl?: string;
  cta2Label?: LocaleText;
  cta2Url?: string;
  mediaUrl?: string;
  media2Url?: string;
  posterUrl?: string;
  /** Alternative text for mediaUrl — localized, because a screen reader
   *  should hear the visitor's own language. */
  alt?: LocaleText;
  alignment?: "left" | "right" | "center";
  items?: CmsItem[];
  /**
   * Open bag for section types whose fields are their own vocabulary rather
   * than the shared title/subtitle/cta shape — today only the launch page,
   * whose 30-odd labelled fields would otherwise each need a column here.
   */
  fields?: Record<string, LocaleText>;
};

export type CmsBlock = {
  type: string;
  sort_order: number;
  visible: boolean;
  content: CmsBlockContent;
};

export const BLOCK_TYPES = [
  "hero", "showcase", "before_after", "video", "product_lock", "workflow",
  "use_cases", "features", "stats", "text_image", "cta", "faq", "pricing", "logo_cloud",
  // Added with the unified page editor.
  "text", "media", "benefits", "legal", "contact", "launch",
] as const;

/**
 * The section types an admin may actually add, in the order the picker shows
 * them. Deliberately NOT the same list as BLOCK_TYPES: `pricing` has no
 * renderer, and `launch` belongs to exactly one page and is created with it,
 * so neither is offered as "add a section".
 */
export const SECTION_TYPES = [
  "hero", "text", "media", "video", "benefits", "workflow", "features",
  "showcase", "before_after", "product_lock", "use_cases", "stats",
  "text_image", "cta", "faq", "legal", "contact", "logo_cloud",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export function lt(text: LocaleText | undefined, locale: string): string {
  if (!text) return "";
  return (text as Record<string, string | undefined>)[locale] ?? text.pl ?? text.en ?? "";
}

/** Only https URLs render at all; iframes additionally require an
 *  allowlisted host. Direct files render via <video>/<img>. */
const EMBED_HOSTS = new Set(["www.youtube.com", "youtube.com", "youtu.be", "player.vimeo.com", "vimeo.com"]);

export function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? url : null;
  } catch { return null; }
}

export function videoEmbedUrl(url: string): { kind: "iframe" | "file"; src: string } | null {
  const safe = safeUrl(url);
  if (!safe) return null;
  const u = new URL(safe);
  if (/\.(mp4|webm)(\?.*)?$/.test(u.pathname)) return { kind: "file", src: safe };
  if (!EMBED_HOSTS.has(u.hostname)) return null;
  if (u.hostname === "youtu.be") return { kind: "iframe", src: `https://www.youtube.com/embed/${u.pathname.slice(1)}` };
  if (u.hostname.endsWith("youtube.com")) {
    const id = u.searchParams.get("v");
    return id ? { kind: "iframe", src: `https://www.youtube.com/embed/${id}` } : null;
  }
  if (u.hostname === "vimeo.com") return { kind: "iframe", src: `https://player.vimeo.com/video/${u.pathname.slice(1)}` };
  if (u.hostname === "player.vimeo.com") return { kind: "iframe", src: safe };
  return null;
}

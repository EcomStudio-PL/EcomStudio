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
  alignment?: "left" | "right" | "center";
  items?: CmsItem[];
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
] as const;

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

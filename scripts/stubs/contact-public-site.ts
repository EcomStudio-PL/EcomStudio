/** Test stub for lib/server/public-site (Kontakt suite): the published page
 *  the suite installs on globalThis, never a network read. */
const g = globalThis as unknown as { __contactPage?: unknown; __contactSite?: unknown };

export const CMS_TAG = "cms-pages";
export async function getPublishedPage(_supabase: unknown, slug: string): Promise<never> {
  return (slug === "kontakt" ? g.__contactPage ?? null : null) as never;
}
export async function getPublicSite(): Promise<never> {
  return (g.__contactSite ?? { instagramUrl: "", facebookUrl: "", linkedinUrl: "", xUrl: "" }) as never;
}
export async function getGlobalSections(): Promise<never> { return {} as never; }
export async function getNavPages(): Promise<never> { return [] as never; }
export function toBlocks(snapshot: unknown): never { return (Array.isArray(snapshot) ? snapshot : []) as never; }

import "server-only";
import type { Client } from "@/lib/services/workspace";
import { getPublishedPage } from "@/lib/server/public-site";
import { isContactPageType, shownChannels, type ContactSite } from "@/lib/contact-page";
import type { FaqChannels } from "@/components/faq/faq-page";

/**
 * FAQ V1: the /faq closing tile's extra buttons — Instagram and Messenger —
 * taken from what the PUBLISHED Kontakt page really shows (its channel cards,
 * lib/contact-page.ts shownChannels). Nothing configured there, nothing here:
 * never an invented profile.
 */
export async function faqChannelsOf(supabase: Client, site: ContactSite): Promise<FaqChannels> {
  try {
    const page = await getPublishedPage(supabase, "kontakt");
    const block = page?.blocks.find((b) => b.visible && isContactPageType(b.type));
    if (!block) return {};
    const channels = shownChannels(block.content ?? {}, site, "pl");
    const instagram = channels.find((c) => c.kind === "instagram")?.href;
    const messenger = channels.find((c) => c.kind === "facebook")?.messenger;
    return { ...(instagram ? { instagram } : {}), ...(messenger ? { messenger } : {}) };
  } catch {
    return {};
  }
}

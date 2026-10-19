import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { getActiveHomepage } from "@/lib/server/homepage";
import { getPublishedPage } from "@/lib/server/public-site";
import { launchDefaultsFrom, launchFieldsFromBlocks, launchDefault, type LaunchField } from "@/lib/server/launch-page";
import { parsePublicConfig, type PrelaunchPublicConfig } from "@/lib/launch/campaign";
import type { Client } from "@/lib/services/workspace";
import { rpcPublicConfig } from "./rpc";
import { resolveConsent, type ResolvedConsent } from "./consent";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

/**
 * WHAT THE PUBLIC SIDE OF THE PRE-LAUNCH PAGE READS — shared by the page, the
 * signup route and the auth dialog, so all three agree on the same values.
 */

/** Cache tag: the campaign settings action revalidates it. */
export const PRELAUNCH_CONFIG_TAG = "prelaunch-config";

/**
 * The approved campaign values, for everybody. Read through the anonymous
 * client (prelaunch_public_config is granted to anon and returns ONLY approved
 * values), cached briefly: a countdown and a credits line do not need a
 * database round trip per visit, and a change in the admin revalidates the tag.
 */
const readConfig = unstable_cache(
  async (): Promise<unknown> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    return rpcPublicConfig(anon as unknown as Client);
  },
  ["prelaunch-public-config"],
  { revalidate: 60, tags: [PRELAUNCH_CONFIG_TAG] },
);

export async function getPrelaunchPublicConfig(): Promise<PrelaunchPublicConfig> {
  try {
    const cfg = parsePublicConfig(await readConfig());
    // The date is approved; whether it is still ahead is decided per request,
    // not at cache time (a cached "future" date must not outlive the moment).
    if (cfg.launchAt && Date.parse(cfg.launchAt) <= Date.now()) return { ...cfg, launchAt: null };
    return cfg;
  } catch {
    return parsePublicConfig(null);
  }
}

const DICTS: Record<string, Record<string, unknown>> = {
  pl: pl as Record<string, unknown>,
  en: en as Record<string, unknown>,
  de: de as Record<string, unknown>,
};

/** The shipped copy for a locale (launch.* with V2's prelaunch.* underneath). */
export function shippedLaunchCopy(locale: string) {
  return launchDefaultsFrom(DICTS[locale] ?? DICTS.pl);
}

/** The launch page's slug: the homepage when it is the launch page, else the
 *  seeded one. The signup form can be posted while another page is "/". */
export async function launchPageSlug(): Promise<string> {
  const home = await getActiveHomepage().catch(() => null);
  return home?.kind === "launch" ? home.slug : "premiera";
}

export type LaunchConsents = {
  terms: ResolvedConsent;
  marketing: ResolvedConsent;
  /** The legal documents the terms consent points at, by their publication
   *  moment — what "accepted the Terms" meant on the day it was ticked. */
  docVersions: { regulamin: string | null; polityka_prywatnosci: string | null };
};

/**
 * THE TWO CONSENT SENTENCES AS PUBLISHED, resolved on the server — by the page
 * when it renders the checkboxes and by the signup route when it records what
 * was accepted. Same function, same text, same version: a client can never
 * supply consent wording of its own.
 */
export async function getLaunchConsents(locale: string, supabase: Client): Promise<LaunchConsents> {
  const slug = await launchPageSlug();
  const [page, terms, privacy] = await Promise.all([
    getPublishedPage(supabase, slug),
    getPublishedPage(supabase, "regulamin"),
    getPublishedPage(supabase, "polityka-prywatnosci"),
  ]);
  const { fields } = launchFieldsFromBlocks(page?.blocks ?? [], locale);
  const defaults = shippedLaunchCopy(locale);
  const text = (key: LaunchField) => fields[key] ?? launchDefault(defaults, key);
  const labels = { terms: text("consent.termsLabel"), privacy: text("consent.privacyLabel") };
  return {
    terms: resolveConsent("terms_privacy", text("hero.consent"), locale, labels),
    marketing: resolveConsent("marketing_email", text("hero.consentMarketing"), locale, labels),
    docVersions: { regulamin: terms?.publishedAt ?? null, polityka_prywatnosci: privacy?.publishedAt ?? null },
  };
}

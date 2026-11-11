/**
 * PACKSHOT (formerly „Retusz zdjęć”) — its public address since the premiere.
 * The tool's technical id stays `retouch` (feature switch, ai_tools row,
 * library operation `image_retouch`, tool_mode, credits): only the name a
 * customer reads and the address changed. The old address answers 301 here
 * (next.config.mjs). Not to be confused with the separate, hidden e-commerce
 * workflow `ecommerce.packshot` at /k/ecommerce/packshot.
 */
export const PACKSHOT_PATH = "/narzedzia/packshot";
/** Where the tool lived before — a permanent redirect to PACKSHOT_PATH. */
export const LEGACY_RETOUCH_PATH = "/retusz";

/** Where „Pomoc” (the avatar menu, the phone drawer) goes: the contact page
 *  with its form — a CMS page, not the FAQ. */
export const HELP_HREF = "/kontakt";

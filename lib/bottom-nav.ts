import type { LucideIcon } from "lucide-react";
import { Home, Images, Sparkles, User, Wrench } from "lucide-react";
import { FEATURE_REGISTRY, type FeatureKey } from "./features";

/**
 * THE PHONE'S PRIMARY NAVIGATION — five slots, defined once, away from the
 * component that paints them.
 *
 * Which route is "current" is the part of a bottom bar that quietly breaks:
 * /generator has to light GENERUJ even though the slot points at /prompts,
 * /retusz belongs under NARZĘDZIA although it lives at the root, and /home
 * must NOT light up for /home-anything-else. None of that is visible in a
 * screenshot — an inactive slot looks like a design choice — so the rule lives
 * here as a plain function over a string and is tested route by route.
 *
 * Routes are taken from FEATURE_REGISTRY wherever the destination is a feature,
 * so a module that moves takes its dock slot with it. `/settings` is the one
 * exception, and deliberately: account settings are absent from the registry
 * precisely so they can never be switched off.
 */

export type DockSlot = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Extra route prefixes this slot lights up for. */
  owns?: readonly string[];
  /** Only the exact path counts — /home must not claim /homework. */
  exact?: boolean;
  /** The one primary action, rendered as the raised centre button. */
  primary?: boolean;
};

const path = (key: FeatureKey, fallback: string): string =>
  FEATURE_REGISTRY.find((f) => f.key === key)?.path ?? fallback;

/**
 * Start · Biblioteka · GENERUJ · Narzędzia · Profil.
 *
 * Every destination already existed before the dock changed shape: nothing new
 * was created to fill a slot. GENERUJ sits in the middle because it is the
 * middle of the product — the reason a seller opened GrovBase at all — and
 * points at the generator's front door, with the custom-prompt mode behind it
 * as a switch rather than beside it as a sixth slot.
 */
export const DOCK_SLOTS: readonly DockSlot[] = [
  { key: "home", href: path("home", "/home"), icon: Home, exact: true },
  { key: "library", href: path("library", "/library"), icon: Images },
  {
    key: "generate", href: path("prompts", "/prompts"), icon: Sparkles, primary: true,
    owns: [path("generator", "/generator"), "/k/"],
  },
  { key: "tools", href: path("tools", "/tools"), icon: Wrench, owns: [path("retouch", "/retusz")] },
  // The account screen. Not a registry feature — see the note above.
  { key: "profile", href: "/settings", icon: User },
] as const;

/**
 * Whether a slot owns the route currently on screen. Query strings and hashes
 * decide nothing: /library?tab=history is still the library, and a slot must
 * never light up or go dark because of something appended to the URL.
 */
export function dockSlotActive(slot: DockSlot, pathname: string): boolean {
  const route = pathname.split(/[?#]/, 1)[0] ?? "";
  if (slot.exact) return route === slot.href;
  const owns = (prefix: string) => route === prefix || route.startsWith(
    // "/k/" is already a prefix with its trailing slash; the rest are routes.
    prefix.endsWith("/") ? prefix : `${prefix}/`,
  );
  return owns(slot.href) || (slot.owns ?? []).some(owns);
}

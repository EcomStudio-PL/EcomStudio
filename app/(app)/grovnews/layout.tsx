import { FeatureGate } from "@/components/feature-gate";

/** Availability gate for GrovNews. The (app) layout above already
 *  authenticated the visitor; this decides whether the module renders, shows
 *  its coming-soon / maintenance screen, or 404s when it is disabled. Reading
 *  it additionally takes an active entitlement — checked by each page. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="grovnews">{children}</FeatureGate>;
}

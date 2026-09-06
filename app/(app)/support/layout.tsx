import { FeatureGate } from "@/components/feature-gate";

/** Availability gate for this module. The (app) layout above already
 *  authenticated the visitor; this decides whether the module renders, shows
 *  its coming-soon / maintenance screen, or 404s when it is disabled. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="support">{children}</FeatureGate>;
}

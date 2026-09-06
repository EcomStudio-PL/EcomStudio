import { FeatureGate } from "@/components/feature-gate";

/** Availability gate for this module (Task 11 C). The (app) layout above
 *  already authenticated the user; this decides whether the module renders,
 *  shows its coming-soon/maintenance screen, or 404s when disabled. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="inspirations">{children}</FeatureGate>;
}

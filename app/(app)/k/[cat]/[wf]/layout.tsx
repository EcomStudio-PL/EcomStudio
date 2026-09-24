import { notFound } from "next/navigation";
import { FeatureGate } from "@/components/feature-gate";
import { isFeatureKey } from "@/lib/features";

/**
 * Each image category is its own switchable module — Moda, E-commerce, Social
 * Media, Mailing, Inne and Matching can be taken down (or announced as coming
 * soon) one at a time, which is exactly what the admin panel offers.
 *
 * This is the same gate, on the same key, that used to wrap the whole /k/<slug>
 * segment; it moved here, around the workflow screens, when the category's own
 * landing page became a forward to its section of /tools. Every workflow is
 * therefore exactly as protected as before.
 *
 * The key is derived from the slug, so adding a category to lib/categories.ts
 * and to the registry is all it takes; a slug with no key is not a category.
 */
export default async function WorkflowLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;
  const key = `image_${cat}`;
  if (!isFeatureKey(key)) notFound();
  return <FeatureGate feature={key}>{children}</FeatureGate>;
}

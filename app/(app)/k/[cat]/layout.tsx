import { notFound } from "next/navigation";
import { isFeatureKey } from "@/lib/features";

/**
 * Only real categories live under /k — a slug with no feature key is not a
 * category, and gets the 404 it always got.
 *
 * The availability gate that used to sit here is one level down now, in
 * ./[wf]/layout.tsx, around the workflows it actually protects. The category
 * page itself only forwards to its section of /tools (see ./page.tsx), and a
 * gate in front of a forwarding address showed the old "Wkrótce" screen at an
 * address that no longer has a screen of its own.
 */
export default async function CategoryLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;
  if (!isFeatureKey(`image_${cat}`)) notFound();
  return <>{children}</>;
}

/**
 * next/navigation for npm run test:legaladmin: the shared no-op stub, plus
 * the one hook the legal document editor reads — the builder's route params
 * (/admin/www/<slug>), here always the Regulamin.
 */
export * from "./next-navigation";

export function useParams(): Record<string, string> {
  return { slug: "regulamin" };
}

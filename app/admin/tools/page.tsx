import { redirect } from "next/navigation";

/**
 * Image Tools split in two: the backends it listed are now in Modele, API i
 * koszty → Dostawcy, and each tool's economics live in that tool's own
 * Ekonomia tab under Narzędzia i silniki.
 */
export default function Moved() {
  redirect("/admin/ai/modele?tab=dostawcy");
}

import { redirect } from "next/navigation";

/**
 * DOSTĘPNOŚĆ FUNKCJI moved into Narzędzia i silniki (/admin/ai): every tool,
 * category and module now has its status and visibility on the same row as
 * its model and credits. The table, the server actions and the rules the
 * customer side reads are unchanged — only the screen moved — so a bookmark
 * lands on the screen that took the job over, never on a 404.
 */
export default function AdminFeatureAvailability() {
  redirect("/admin/ai");
}

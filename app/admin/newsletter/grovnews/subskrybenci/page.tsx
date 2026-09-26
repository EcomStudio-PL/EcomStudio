import { createClient } from "@/lib/supabase/server";
import { adminListEntitlements } from "@/lib/services/grovnews";
import { adminMailEligibility } from "@/lib/services/grovnews-research";
import { SubscribersManager } from "@/components/admin/grovnews/subscribers";

export const dynamic = "force-dynamic";

/** Access to GrovNews is not consent to e-mail: each row also says whether
 *  the newsletter would mail that person, by the newsletter's own rules. */
export default async function GrovNewsSubscribers() {
  const supabase = await createClient();
  const rows = await adminListEntitlements(supabase);
  const users = [...new Map(rows.map((r) => [r.userId, { id: r.userId, email: r.email }])).values()];
  const mail = await adminMailEligibility(supabase, users);
  return <SubscribersManager rows={rows.map((r) => ({ ...r, mail: mail.get(r.userId) ?? "no_contact" }))} />;
}

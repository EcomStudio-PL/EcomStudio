import { createClient } from "@/lib/supabase/server";
import { adminListEntitlements } from "@/lib/services/grovnews";
import { SubscribersManager } from "@/components/admin/grovnews/subscribers";

export const dynamic = "force-dynamic";

export default async function GrovNewsSubscribers() {
  const supabase = await createClient();
  return <SubscribersManager rows={await adminListEntitlements(supabase)} />;
}

import { createClient } from "@/lib/supabase/server";
import { listCategories } from "@/lib/services/grovnews";
import { CategoryManager } from "@/components/admin/grovnews/categories";

export const dynamic = "force-dynamic";

export default async function GrovNewsCategories() {
  const supabase = await createClient();
  return <CategoryManager categories={await listCategories(supabase)} />;
}

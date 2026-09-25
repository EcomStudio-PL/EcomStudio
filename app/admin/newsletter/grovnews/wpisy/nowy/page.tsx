import { createClient } from "@/lib/supabase/server";
import { listCategories } from "@/lib/services/grovnews";
import { PostEditor } from "@/components/admin/grovnews/post-editor";

export const dynamic = "force-dynamic";

export default async function NewGrovNewsPost() {
  const supabase = await createClient();
  const categories = await listCategories(supabase);
  return (
    <PostEditor categories={categories} post={{
      id: null, title: "", slug: "", excerpt: "", content: "", categoryId: null, tags: [], coverUrl: null,
      sources: [], readMinutes: null, language: "pl", status: "DRAFT", emailSummary: null, seoTitle: null, seoDescription: null,
    }} />
  );
}

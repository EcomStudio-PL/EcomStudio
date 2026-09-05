import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { toolCatalogue } from "@/lib/server/image-tools";
import { PageHeader } from "@/components/ui/page-header";
import { parseEntry } from "@/lib/images/editor-state";
import { ImageEditor } from "@/components/editor/image-editor";

export const dynamic = "force-dynamic";

/** The two private buckets a photo can arrive from — nothing else is signed. */
const BUCKETS = ["generation-assets", "product-images"] as const;

/**
 * EDYCJA OBRAZU — the editor's own screen.
 *
 * The page's whole job is to hand the workspace four true facts: whether the
 * editor is switched on, what the one paid step (the cutout) costs at the
 * currently connected provider, what the wallet holds, and — when the customer
 * arrived from the library — a signed link to the photo they picked, so they
 * never upload a file this workspace already stores.
 *
 * `?tool=` opens the matching section with its mode already selected; a photo
 * handed over with `?path=` is loaded without a re-upload. searchParams is a
 * promise in Next 15.
 */
export default async function ImageEditorPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [catalogue, wallet] = await Promise.all([
    toolCatalogue(supabase),
    getWallet(supabase, workspace.id),
  ]);
  const editor = catalogue.find((entry) => entry.slug === "editor");
  const cutout = catalogue.find((entry) => entry.slug === "remove_bg");

  // A photo from the library. The path is only signed when it sits inside this
  // workspace's own folder — storage RLS says the same thing, and this keeps a
  // guessed path from even reaching it.
  const path = first(params.path);
  const asked = first(params.bucket);
  const bucket = (BUCKETS as readonly string[]).includes(String(asked))
    ? (asked as (typeof BUCKETS)[number])
    : "generation-assets";
  let initialImage: { url: string; name: string } | null = null;
  if (path && path.startsWith(`${workspace.id}/`)) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      initialImage = { url: data.signedUrl, name: path.split("/").pop() || "photo.png" };
    }
  }

  return (
    // `gen-shell` binds the page to the viewport on desktop, so the canvas and
    // the settings column each scroll inside themselves and the page does not.
    <div className="workspace workspace-page gen-shell pt-1">
      <div>
        <Link href="/tools"
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> {t("nav.allTools")}
        </Link>
        <PageHeader className="mb-4 sm:mb-5" title={t("editor.title")} sub={t("editor.sub")} />
      </div>

      <ImageEditor
        entry={parseEntry(params.tool)}
        initialImage={initialImage}
        available={editor?.available ?? true}
        reason={editor?.reason ?? "maintenance"}
        cutout={{
          available: cutout?.available ?? false,
          credits: cutout?.credits ?? 0,
          reason: cutout?.reason ?? "no_provider",
        }}
        balance={wallet?.balance ?? 0}
      />
    </div>
  );
}

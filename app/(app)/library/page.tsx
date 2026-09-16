import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listJobs } from "@/lib/services/generator";
import { listGalleryItems } from "@/lib/server/gallery";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { LibraryBrowser } from "@/components/library/library-browser";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** How much of the shelf is rendered into the HTML. Enough to fill the first
 *  screen of a 2560px monitor at the default tile size; everything after it
 *  arrives by cursor as the customer scrolls. */
const FIRST_PAGE = 24;

const JOB_TONE = { queued: "neutral", processing: "info", completed: "success", failed: "danger", cancelled: "neutral" } as const;

/**
 * BIBLIOTEKA — everything the account has produced.
 *
 * THE FIRST PAGE IS RENDERED HERE, and only the first page. This route used to
 * read sixty generations with `listAssets`, sign every full-size original in
 * them in one call, and hand the lot to the client — several megabytes of
 * pictures before anything was on screen, on every single visit, whether or
 * not the customer scrolled past the first row.
 *
 * It now asks the SAME projection every other gallery in the product uses
 * (`listGalleryItems`) for 24 items with a cursor, and the browser component
 * pages the rest in as they are needed. The projection signs the small
 * derivative beside each original, so a tile downloads ~50KB instead of the
 * full render.
 *
 * `?tab=tools` and `?tab=history` are unchanged — different data, different
 * shape, and both still reachable from the library's own filter sheet.
 */
export default async function LibraryPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = tabParam === "history" ? "history" : tabParam === "tools" ? "tools" : "assets";
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  /* ── the shelves that are not the grid ───────────────────────────────── */

  if (tab === "history") {
    const jobs = await listJobs(supabase, workspace.id);
    return (
      <div>
        <PageHeader overline={t("nav.groups.assets")} title={t("library.history")} sub={t("library.sub")} />
        <BackToLibrary label={t("library.title")} />
        {jobs.length === 0 ? (
          <EmptyState title={t("history.emptyTitle")} body={t("history.emptyBody")} />
        ) : (
          <AdminTable
            headers={[t("history.product"), t("common.type"), t("common.status"), t("history.creditsCol"), t("common.date")]}
            empty={t("history.emptyBody")}
            rows={jobs.map((j) => [
              j.products?.name ?? "—",
              j.material_type ? t(`generator.mt.${j.material_type}`) : "—",
              <Badge key="s" tone={JOB_TONE[j.status as keyof typeof JOB_TONE] ?? "neutral"} dot>{t(`history.st.${j.status}`)}</Badge>,
              <span key="c" className="tabular-nums">{j.credits_charged}</span>,
              <span key="d" className="text-muted">{formatDate(j.created_at, locale)}</span>,
            ])}
          />
        )}
      </div>
    );
  }

  if (tab === "tools") {
    const { data: toolResults } = await supabase.from("tool_results")
      .select("id, tool_slug, storage_path, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(60);
    const rows = toolResults ?? [];
    // Tool outputs have no derivative of their own; they are signed as they
    // always were, and there are at most sixty of them.
    const urlMap = new Map<string, string>();
    if (rows.length > 0) {
      const { data: signed } = await supabase.storage
        .from("generation-assets").createSignedUrls(rows.map((r) => r.storage_path), 3600);
      signed?.forEach((s) => { if (s.signedUrl && s.path) urlMap.set(s.path, s.signedUrl); });
    }
    return (
      <div>
        <PageHeader overline={t("nav.groups.assets")} title={t("library.toolResults")} sub={t("library.sub")} />
        <BackToLibrary label={t("library.title")} />
        {rows.length === 0 ? (
          <EmptyState title={t("library.emptyTitle")} body={t("library.emptyBody")} />
        ) : (
          <div className="grid gap-2 [&>*]:min-w-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(210px, 100%), 1fr))" }}>
            {rows.map((r) => {
              const url = urlMap.get(r.storage_path);
              return url ? (
                <a key={r.id} href={url} target="_blank" rel="noreferrer noopener"
                  className="panel panel-interactive block overflow-hidden rounded-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" decoding="async"
                    className="aspect-square w-full bg-checker object-contain" />
                  <p className="truncate px-2 py-1.5 text-[11px] font-medium">{t(`tools.${r.tool_slug}.name`)}</p>
                </a>
              ) : null;
            })}
          </div>
        )}
      </div>
    );
  }

  /* ── the grid ────────────────────────────────────────────────────────── */

  // `assetType: "image"` is not decoration: the browser adopts this payload
  // verbatim as its default "Zdjęcia" shelf, so the server has to hand back
  // exactly what that shelf asks for — otherwise videos land on the photo
  // shelf on first paint and nothing ever corrects them.
  const first = await listGalleryItems(supabase, workspace.id, { limit: FIRST_PAGE, assetType: "image" });

  return (
    <div>
      <PageHeader overline={t("nav.groups.assets")} title={t("library.title")} sub={t("library.sub")} />
      <LibraryBrowser first={first} locale={locale} />
    </div>
  );
}

/** The two side shelves are pages of their own; this is the way back. */
function BackToLibrary({ label }: { label: string }) {
  return (
    <Link href="/library"
      className="mb-4 inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-sunken/60 px-3 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink">
      <ArrowLeft size={14} aria-hidden />
      {label}
    </Link>
  );
}

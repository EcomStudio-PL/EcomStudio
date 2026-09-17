"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Copy, ExternalLink, History, Plus, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  createPageAction, duplicatePageAction, deletePageAction, archivePageAction,
  seedPublicPagesAction,
} from "@/app/actions/cms";
import { slugify, slugProblem, type PageRow } from "@/lib/services/cms";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

/**
 * THE PAGE LIST.
 *
 * A table on a desktop, where the columns the brief asks for — name, slug,
 * type, language, status, modified, author — fit side by side; a stack of
 * cards below `lg`, where they do not. Same data, same actions, two shapes.
 *
 * Deliberately not a data grid. Seven pages today and maybe thirty in a year
 * is a list, and a list that can be read at a glance beats one that can be
 * sorted six ways.
 */

type Props = {
  pages: PageRow[];
  /** userId → display name, for the "Autor zmian" column. */
  editors: Record<string, string>;
  /** Which front door is live, so the active page can say so. */
  mode: string;
  locale: string;
};

const NAV_GROUPS = ["", "main", "product", "tools", "company", "help", "legal"];

export function PageList({ pages, editors, mode, locale }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [navGroup, setNavGroup] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [deleting, setDeleting] = useState<PageRow | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");

  const effectiveSlug = slugTouched ? slug : slugify(title);
  const problem = effectiveSlug ? slugProblem(effectiveSlug) : null;

  function create() {
    start(async () => {
      const res = await createPageAction({ title, slug: effectiveSlug, navGroup: navGroup || null });
      if (res.ok && res.data) {
        setCreating(false);
        setTitle(""); setSlug(""); setNavGroup(""); setSlugTouched(false);
        router.push(`/admin/www/${res.data.slug}`);
        return;
      }
      toast.error(t(`cms.err.${res.ok ? "generic" : res.error}`));
    });
  }

  const run = (p: Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { done?.(); router.refresh(); }
      else toast.error(t(`cms.err.${res.error ?? "generic"}`));
    });

  return (
    <div data-page-list>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        {/* Adds only what is missing and never overwrites a page somebody has
            already worked on, so it is safe to leave here permanently. */}
        <Button size="sm" variant="secondary" disabled={pending} data-cms-seed
          onClick={() => start(async () => {
            const res = await seedPublicPagesAction();
            if (!res.ok) { toast.error(t(`cms.err.${res.error}`)); return; }
            toast.success(t("cms.seedDone", {
              pages: res.data?.pages ?? 0, sections: res.data?.sections ?? 0,
            }));
            router.refresh();
          })}>
          {t("cms.seedPages")}
        </Button>
        <Button size="sm" onClick={() => setCreating(true)} data-cms-new>
          <Plus size={14} aria-hidden />{t("cms.newPage")}
        </Button>
      </div>

      {/* ── DESKTOP: one row per page ──────────────────────────────────── */}
      <div className="panel hidden overflow-hidden rounded-2xl lg:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-faint">
              <th scope="col" className="px-4 py-3 font-semibold">{t("cms.col.name")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("cms.col.slug")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("cms.col.type")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("cms.col.lang")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("cms.col.status")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("cms.col.modified")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("cms.col.author")}</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">{t("cms.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id} className="border-b border-line/60 last:border-0" data-page-row={p.slug}>
                <td className="px-4 py-3">
                  <Link href={`/admin/www/${p.slug}`} className="font-semibold hover:text-accent">
                    {p.title}
                  </Link>
                  {isHomeSlot(p, mode) && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10.5px] font-semibold text-accent">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                      {t("cms.activeBadge")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3"><code className="text-[12px] text-faint">{publicPath(p)}</code></td>
                <td className="px-4 py-3 text-[12.5px] text-muted">{t(`cms.kind.${p.kind}`)}</td>
                {/* Every page holds all three languages in the same sections —
                    there is no per-language copy of a page to list. */}
                <td className="px-4 py-3 text-[12.5px] text-muted">PL · EN · DE</td>
                <td className="px-4 py-3"><StatusBadge status={p.status} t={t} /></td>
                <td className="px-4 py-3 text-[12.5px] text-muted">{formatDate(p.updatedAt, locale)}</td>
                <td className="px-4 py-3 text-[12.5px] text-muted">
                  {p.updatedBy ? editors[p.updatedBy] ?? "—" : "—"}
                </td>
                <td className="px-4 py-3">
                  <Row page={p} mode={mode} t={t} pending={pending} run={run}
                    onDelete={() => { setDeleting(p); setConfirmSlug(""); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── MOBILE AND TABLET: a card per page ─────────────────────────── */}
      <ul className="space-y-2 lg:hidden">
        {pages.map((p) => (
          <li key={p.id} className="panel rounded-2xl" data-page-row={p.slug}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <Link href={`/admin/www/${p.slug}`} className="block truncate text-sm font-semibold">
                  {p.title}
                </Link>
                <code className="text-[11.5px] text-faint">{publicPath(p)}</code>
              </div>
              <StatusBadge status={p.status} t={t} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[11.5px] text-muted">
              <span>{formatDate(p.updatedAt, locale)}</span>
              {p.updatedBy && editors[p.updatedBy] && <span>· {editors[p.updatedBy]}</span>}
            </div>
            <div className="border-t border-line px-2 py-2">
              <Row page={p} mode={mode} t={t} pending={pending} run={run}
                onDelete={() => { setDeleting(p); setConfirmSlug(""); }} />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[12px] leading-relaxed text-muted">{t("cms.note")}</p>

      {/* ── NEW PAGE ───────────────────────────────────────────────────── */}
      <Modal open={creating} onClose={() => setCreating(false)} title={t("cms.newPage")}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="cms-new-title">{t("cms.col.name")}</Label>
            <Input id="cms-new-title" value={title} autoFocus
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cms-new-slug">{t("cms.col.slug")}</Label>
            <Input id="cms-new-slug" value={effectiveSlug} spellCheck={false}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} />
            <p className="mt-1.5 text-[11.5px] text-faint">
              {problem ? t(`cms.err.${problem}`) : `grovbase.com/${effectiveSlug}`}
            </p>
          </div>
          <div>
            <Label htmlFor="cms-new-nav">{t("cms.navGroup")}</Label>
            <Select id="cms-new-nav" value={navGroup} onChange={(e) => setNavGroup(e.target.value)}>
              {NAV_GROUPS.map((g) => (
                <option key={g || "none"} value={g}>
                  {g ? t(`cms.footerGroup.${g}`) : t("cms.navNone")}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button disabled={pending || !title.trim() || !!problem} onClick={create}>
              {t("common.create")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── DELETE ─────────────────────────────────────────────────────────
          The slug has to be typed back. A page is a URL people may already
          have bookmarked; deleting one should take a moment's thought, the
          same as deleting an account does. */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("cms.deletePage")}>
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t("cms.deletePageBody", { slug: deleting.slug })}</p>
            <div>
              <Label htmlFor="cms-del">{t("cms.deleteConfirmLabel")}</Label>
              <Input id="cms-del" value={confirmSlug} spellCheck={false} autoComplete="off"
                onChange={(e) => setConfirmSlug(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button variant="danger" disabled={pending || confirmSlug.trim() !== deleting.slug}
                onClick={() => run(deletePageAction(deleting.id, confirmSlug), () => setDeleting(null))}>
                {t("common.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** The actions available on one page, shared by the table and the cards. */
function Row({ page, mode, t, pending, run, onDelete }: {
  page: PageRow;
  mode: string;
  t: (k: string, v?: Record<string, string | number>) => string;
  pending: boolean;
  run: (p: Promise<{ ok: boolean; error?: string }>, done?: () => void) => void;
  onDelete: () => void;
}) {
  const archived = page.status === "archived";
  // The launch page has no URL of its own — it answers "/" when it is the
  // active homepage and is unreachable otherwise.
  const hasPublicUrl = page.kind === "launch" ? mode === "waitlist" : page.status === "published";
  const protectedPage = page.slug === "home" || page.kind === "launch";

  return (
    <div className="flex flex-wrap items-center justify-end gap-0.5">
      <Link href={`/admin/www/${page.slug}`}
        className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-semibold text-accent transition-colors hover:bg-raised">
        {t("common.edit")}
      </Link>
      <a href={`/podglad/${page.slug}`} target="_blank" rel="noreferrer" title={t("cms.preview")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
        {t("cms.preview")}<ExternalLink size={12} aria-hidden />
      </a>
      {hasPublicUrl && (
        <a href={publicPath(page)} target="_blank" rel="noreferrer" title={t("cms.openPublic")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
          <ExternalLink size={14} aria-hidden />
        </a>
      )}
      <Link href={`/admin/www/${page.slug}/historia`} title={t("cms.history")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
        <History size={14} aria-hidden />
      </Link>
      <IconBtn title={t("cms.duplicate")} disabled={pending}
        onClick={() => run(duplicatePageAction(page.id))}>
        <Copy size={14} />
      </IconBtn>
      <IconBtn title={archived ? t("cms.restore") : t("cms.archive")} disabled={pending || protectedPage}
        onClick={() => run(archivePageAction(page.id, !archived))}>
        {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
      </IconBtn>
      <IconBtn title={t("common.delete")} disabled={pending || protectedPage} onClick={onDelete}>
        <Trash2 size={14} />
      </IconBtn>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const tone = status === "published" ? "success"
    : status === "scheduled" ? "info"
    : status === "archived" ? "neutral" : "accent";
  return <Badge tone={tone}>{t(`cms.status.${status}`)}</Badge>;
}

function publicPath(page: PageRow): string {
  return page.slug === "home" || page.kind === "launch" ? "/" : `/${page.slug}`;
}

function isHomeSlot(page: PageRow, mode: string): boolean {
  return page.slug === "home" ? mode === "full" : page.kind === "launch" && mode === "waitlist";
}

function IconBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string;
}) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35">
      {children}
    </button>
  );
}

"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import {
  Archive, ArchiveRestore, Check, Copy, ExternalLink, History, Home, MoreHorizontal,
  Plus, Send, Trash2, Undo2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  createPageAction, duplicatePageAction, deletePageAction, archivePageAction,
  publishPageAction, unpublishPageAction, setHomepageAction, seedPublicPagesAction,
} from "@/app/actions/cms";
import { slugify, slugProblem, type PageRow } from "@/lib/services/cms";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { PAGE_TEMPLATES } from "@/lib/cms-templates";

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
 *
 * WHICH PAGE IS THE HOMEPAGE IS READ OFF THE ROW, not computed here. It used to
 * be `slug === 'home' ? mode === 'full' : kind === 'launch' && mode === 'waitlist'`
 * — a second, independent spelling of the same fact, sitting in a client
 * component, disagreeing with the public route. Now it is one boolean the
 * database allows exactly one row to carry.
 *
 * TWO TIERS OF ACTION, because a row with eight equal buttons has none.
 * "Edytuj" and "Podgląd" are what an admin came for and are spelled out in
 * words; everything that changes the site — making a page the homepage,
 * publishing, duplicating, archiving, deleting — is one press away behind a
 * 44px "•••" and then a 44px labelled row. No 15px icon decides anything.
 */

type Props = {
  pages: PageRow[];
  /** userId → display name, for the "Autor zmian" column. */
  editors: Record<string, string>;
  locale: string;
};

const NAV_GROUPS = ["", "main", "product", "tools", "company", "help", "legal"];

export function PageList({ pages, editors, locale }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [navGroup, setNavGroup] = useState("");
  const [template, setTemplate] = useState("blank");
  const [slugTouched, setSlugTouched] = useState(false);
  const [deleting, setDeleting] = useState<PageRow | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");

  const effectiveSlug = slugTouched ? slug : slugify(title);
  const problem = effectiveSlug ? slugProblem(effectiveSlug) : null;

  function create() {
    start(async () => {
      const res = await createPageAction({
        title, slug: effectiveSlug, navGroup: navGroup || null, template,
      });
      if (res.ok && res.data) {
        setCreating(false);
        setTitle(""); setSlug(""); setNavGroup(""); setSlugTouched(false); setTemplate("blank");
        router.push(`/admin/www/${res.data.slug}`);
        return;
      }
      toast.error(t(`cms.err.${res.ok ? "generic" : res.error}`));
    });
  }

  /** Every row action goes through here: run it, say what happened in words,
   *  and refresh so the badge and the status move in the same paint. */
  const run = (p: Promise<{ ok: boolean; error?: string }>, okMessage: string, done?: () => void) =>
    start(async () => {
      const res = await p;
      if (res.ok) { toast.success(t(okMessage)); done?.(); router.refresh(); }
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
      {/* `overflow-hidden` stays: it is what clips the table to the panel's
          rounded corners. It would have clipped the row menu too — which is
          why that menu is portalled to the body rather than drawn in place. */}
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
                  {p.isHomepage && <HomeBadge t={t} />}
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
                  <RowActions page={p} t={t} pending={pending} run={run}
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
            {p.isHomepage && (
              <div className="px-4 pb-2"><HomeBadge t={t} inline /></div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[11.5px] text-muted">
              <span>{formatDate(p.updatedAt, locale)}</span>
              {p.updatedBy && editors[p.updatedBy] && <span>· {editors[p.updatedBy]}</span>}
            </div>
            <div className="border-t border-line px-2 py-2">
              <RowActions page={p} t={t} pending={pending} run={run}
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
          {/* THE LAYOUT, CHOSEN BEFORE THE PAGE EXISTS.
              Picking "Promocja" here is the difference between a landing that
              takes two minutes and one that takes twenty: the sections arrive
              in the order that sells, with their anchors already set. The
              words stay yours — every section is created empty. */}
          <div>
            <Label>{t("cms.templateLabel")}</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5" data-template-picker>
              {PAGE_TEMPLATES.map((tpl) => {
                const on = template === tpl.key;
                return (
                  <button key={tpl.key} type="button" onClick={() => setTemplate(tpl.key)}
                    aria-pressed={on} data-template={tpl.key}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors duration-150",
                      on ? "is-selected" : "border-line hover:bg-raised",
                    )}>
                    <span className="block text-[12.5px] font-semibold">
                      {t(`cms.template.${tpl.key}`)}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                      {tpl.sections.length === 0
                        ? t("cms.templateEmpty")
                        : t("cms.templateSections", { n: tpl.sections.length })}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
              {t(`cms.templateHint.${template}`)}
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
                onClick={() => run(
                  deletePageAction(deleting.id, confirmSlug), "cms.deletedToast",
                  () => setDeleting(null),
                )}>
                {t("common.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

type T = (k: string, v?: Record<string, string | number>) => string;
type Run = (p: Promise<{ ok: boolean; error?: string }>, okMessage: string, done?: () => void) => void;

/**
 * The two things an admin came to do, then everything else behind one press.
 *
 * The secondary list is identical on a phone and on a desktop. An admin who
 * learns where "Ustaw jako stronę główną" lives on one should not have to
 * learn it again on the other, and a labelled 44px row beats a 36px icon on
 * both — the icon row this replaced put delete, archive and duplicate within
 * four pixels of one another.
 */
function RowActions({ page, t, pending, run, onDelete }: {
  page: PageRow;
  t: T;
  pending: boolean;
  run: Run;
  onDelete: () => void;
}) {
  const archived = page.status === "archived";
  const live = page.status === "published"
    || (page.status === "scheduled" && !!page.scheduledAt && Date.parse(page.scheduledAt) <= Date.now());
  // The launch page has no URL of its own — it answers "/" when it is the
  // active homepage and is unreachable otherwise.
  const hasPublicUrl = page.kind === "launch" ? page.isHomepage : live;
  const seeded = page.slug === "home" || page.kind === "launch";

  const items: MenuItem[] = [];

  // MAKING A PAGE THE HOMEPAGE. Offered only where it can actually work: the
  // page that already is one has nothing to do, and an unpublished page is
  // refused by the server anyway — saying so here beats an error toast.
  if (!page.isHomepage) {
    items.push({
      key: "home",
      icon: <Home size={15} />,
      label: t("cms.setHomepage"),
      hint: live ? undefined : t("cms.setHomepageNeedsPublish"),
      disabled: pending || !live,
      onClick: () => run(setHomepageAction(page.id), "cms.homepageSet"),
    });
  }

  if (hasPublicUrl) {
    items.push({
      key: "open",
      icon: <ExternalLink size={15} />,
      label: t("cms.openPublic"),
      href: publicPath(page),
      external: true,
    });
  }

  items.push({
    key: "duplicate",
    icon: <Copy size={15} />,
    label: t("cms.duplicate"),
    disabled: pending,
    onClick: () => run(duplicatePageAction(page.id), "cms.duplicated"),
  });

  items.push({
    key: "history",
    icon: <History size={15} />,
    label: t("cms.history"),
    href: `/admin/www/${page.slug}/historia`,
  });

  items.push(live
    ? {
      key: "unpublish",
      icon: <Undo2 size={15} />,
      label: t("cms.unpublish"),
      hint: page.isHomepage ? t("cms.homepageLocked") : undefined,
      disabled: pending || page.isHomepage,
      onClick: () => run(unpublishPageAction(page.id), "cms.unpublishedToast"),
    }
    : {
      key: "publish",
      icon: <Send size={15} />,
      label: t("cms.publish"),
      disabled: pending,
      onClick: () => run(publishPageAction(page.id), "cms.publishedToast"),
    });

  items.push({
    key: "archive",
    icon: archived ? <ArchiveRestore size={15} /> : <Archive size={15} />,
    label: archived ? t("cms.restore") : t("cms.archive"),
    hint: page.isHomepage ? t("cms.homepageLocked") : undefined,
    disabled: pending || seeded || page.isHomepage,
    onClick: () => run(
      archivePageAction(page.id, !archived),
      archived ? "cms.restoredToast" : "cms.archivedToast",
    ),
  });

  items.push({
    key: "delete",
    icon: <Trash2 size={15} />,
    label: t("common.delete"),
    hint: page.isHomepage ? t("cms.homepageLocked") : undefined,
    danger: true,
    disabled: pending || seeded || page.isHomepage,
    onClick: onDelete,
  });

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Link href={`/admin/www/${page.slug}`}
        className="inline-flex h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-accent transition-colors hover:bg-raised">
        {t("common.edit")}
      </Link>
      <a href={`/podglad/${page.slug}`} target="_blank" rel="noreferrer"
        className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
        {t("cms.preview")}<ExternalLink size={12} aria-hidden />
      </a>
      <RowMenu label={t("cms.moreActions", { page: page.title })} items={items} />
    </div>
  );
}

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** Why it is unavailable — shown under the label, not as a tooltip only. */
  hint?: string;
  href?: string;
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

/**
 * The "•••". Portalled, because the desktop table sits in a rounded panel that
 * clips its own overflow — an in-flow menu would be cut off by the container
 * it belongs to, which is the same trap components/ui/dropdown.tsx documents.
 */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const WIDTH = 248;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 8;
      const height = Math.min(items.length * 48 + 12, 420);
      const below = window.innerHeight - r.bottom;
      setPos({
        top: below < height + margin && r.top > below ? Math.max(margin, r.top - 6 - height) : r.bottom + 6,
        left: Math.min(Math.max(margin, r.right - WIDTH), window.innerWidth - WIDTH - margin),
      });
    };
    place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, items.length]);

  return (
    <>
      <button ref={triggerRef} type="button" data-row-menu
        aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink",
          open && "bg-raised text-ink",
        )}>
        <MoreHorizontal size={16} aria-hidden />
      </button>

      {open && pos && createPortal(
        <div ref={panelRef} role="menu" aria-label={label} data-row-menu-panel
          style={{ position: "fixed", top: pos.top, left: pos.left, width: WIDTH }}
          className="workspace overlay animate-pop z-[80] rounded-xl p-1">
          {items.map((item) => {
            const body = (
              <>
                <span className="flex w-5 shrink-0 items-center justify-center" aria-hidden>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                  {item.hint && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-faint">{item.hint}</span>
                  )}
                </span>
              </>
            );
            const shape = cn(
              "flex w-full min-h-[44px] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150",
              item.disabled ? "cursor-not-allowed opacity-40" : "hover:bg-raised",
              item.danger && !item.disabled && "text-danger hover:bg-[rgb(var(--danger)/0.10)]",
            );
            if (item.href && !item.disabled) {
              return item.external ? (
                <a key={item.key} role="menuitem" href={item.href} target="_blank" rel="noreferrer"
                  className={shape} onClick={() => setOpen(false)}>
                  {body}
                </a>
              ) : (
                <Link key={item.key} role="menuitem" href={item.href} className={shape}
                  onClick={() => setOpen(false)}>
                  {body}
                </Link>
              );
            }
            return (
              <button key={item.key} type="button" role="menuitem" disabled={item.disabled}
                data-menu-action={item.key}
                onClick={() => { setOpen(false); item.onClick?.(); }}
                className={shape}>
                {body}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

function HomeBadge({ t, inline }: { t: T; inline?: boolean }) {
  return (
    <span data-homepage-badge
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10.5px] font-semibold text-accent",
        inline ? "" : "ml-2",
      )}>
      <Check size={11} strokeWidth={3} aria-hidden />
      {t("cms.homepageBadge")}
    </span>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const tone = status === "published" ? "success"
    : status === "scheduled" ? "info"
    : status === "archived" ? "neutral" : "accent";
  return <Badge tone={tone}>{t(`cms.status.${status}`)}</Badge>;
}

/**
 * The address a visitor would type. "/" belongs to whichever page carries the
 * flag — not to a slug.
 *
 * Two pages have no address of their own: the launch page, which only ever
 * answers "/", and `home`, whose slug collides with the signed-in dashboard
 * route and is therefore never served from the CMS. Printing "/home" for the
 * second one would be a link to somebody else's page.
 */
function publicPath(page: PageRow): string {
  if (page.isHomepage) return "/";
  if (page.kind === "launch" || page.slug === "home") return "—";
  return `/${page.slug}`;
}

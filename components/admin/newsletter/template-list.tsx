"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Code2, Copy, Trash2, Wand2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import type { TemplateRow } from "@/lib/services/newsletter";
import {
  deleteTemplateAction, saveTemplateAction, useTemplateAction,
} from "@/app/actions/newsletter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/modal";
import { RowAction } from "@/components/ui/record";
import { SectionHeader } from "@/components/ui/section-header";

/**
 * SZABLONY — starting points, grouped by what they are for.
 *
 * THE LIST IS WHAT THE TABLE HOLDS. If `newsletter_templates` is empty this
 * screen says so and offers the one honest instruction — a template is made by
 * saving a finished campaign as one — rather than rendering three plausible
 * cards nobody can use. Seeded "examples" on a screen like this cost an
 * operator the ten minutes it takes to discover that "Promocja" is a name with
 * nothing behind it, and they cost this module its credibility for the rest of
 * the session.
 *
 * A BUILT-IN IS COPIED, NEVER EDITED OR DELETED. `deleteTemplateAction` refuses
 * one with the error "builtin", and the card hides the delete rather than
 * offering a button that always fails — but the rule lives in the action, not
 * here, because hiding a control is not enforcement.
 *
 * "UŻYJ" CREATES A CAMPAIGN AND NAVIGATES TO IT. `useTemplateAction` copies the
 * blocks into a new draft rather than pointing at the template, which is what
 * makes editing a template afterwards safe: no campaign — least of all a sent
 * one — is rewritten by a later change to the thing it started from.
 */

/** The order the categories read in, which is roughly the order a seller
 *  thinks in: the regular mailing first, then the things you send once. An
 *  unknown category sorts last rather than being hidden. */
const CATEGORY_ORDER = [
  "newsletter", "promo", "launch", "feature", "limited",
  "winback", "announcement", "minimal", "custom",
];

const categoryRank = (key: string) => {
  const i = CATEGORY_ORDER.indexOf(key);
  return i === -1 ? CATEGORY_ORDER.length : i;
};

export function TemplateList({ templates }: { templates: TemplateRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);

  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));

  /** Grouped in render rather than on the server: this is a presentation
   *  decision, and `listTemplates` already returns the rows in a stable order
   *  (built-ins first, then by name) that the grouping preserves inside each
   *  category. */
  const categories = [...new Set(templates.map((tpl) => tpl.category))]
    .sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b));

  function use(template: TemplateRow) {
    start(async () => {
      const res = await useTemplateAction({ templateId: template.id });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.templates.used"));
      if (res.data) router.push(`/admin/newsletter/kampanie/${res.data.campaignId}`);
      else router.refresh();
    });
  }

  /** A copy is a NEW template carrying the same body — which is also the only
   *  way to get a built-in one can edit. `is_builtin` is not settable from the
   *  panel, so the copy is always an ordinary template. */
  function duplicate(template: TemplateRow) {
    start(async () => {
      const res = await saveTemplateAction({
        name: `${template.name} (${t("newsletter.templates.copySuffix")})`.slice(0, 160),
        category: template.category,
        subject: template.subject,
        preheader: template.preheader,
        editor: template.editor,
        blocks: template.blocks,
        bodyHtml: template.bodyHtml,
      });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("newsletter.templates.duplicated"));
      router.refresh();
    });
  }

  function remove() {
    if (!deleting) return;
    const id = deleting.id;
    start(async () => {
      const res = await deleteTemplateAction(id);
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.deleted"));
      setDeleting(null);
      router.refresh();
    });
  }

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title={t("newsletter.templates.none")}
        body={t("newsletter.templates.noneHint")}
      />
    );
  }

  return (
    <div data-template-list className="space-y-8">
      <p className="text-[12.5px] leading-relaxed text-muted">{t("newsletter.templates.sub")}</p>

      {categories.map((category) => (
        <section key={category} className="space-y-3">
          <SectionHeader size="sm" title={t(`newsletter.templates.category.${category}`)} />

          {/* One column at 320px, two from `sm`, three on a wide desktop. The
              card itself never sets a width, so nothing pushes the page
              sideways on a phone. */}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.filter((tpl) => tpl.category === category).map((template) => (
              <li key={template.id} className="panel flex flex-col rounded-2xl p-4"
                data-template={template.id}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words text-sm font-semibold">{template.name}</h3>
                  {template.isBuiltin && (
                    <Badge tone="info">{t("newsletter.templates.builtin")}</Badge>
                  )}
                </div>

                <p className="mt-1.5 line-clamp-2 break-words text-[12.5px] leading-snug text-muted">
                  {template.subject.trim() || t("newsletter.templates.noSubject")}
                </p>

                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                  {template.editor === "html" ? (
                    <span className="inline-flex items-center gap-1">
                      <Code2 size={11} aria-hidden />{t("newsletter.templates.htmlBody")}
                    </span>
                  ) : (
                    <span className="tabular-nums">
                      {t("newsletter.templates.blocks", { n: template.blocks.length })}
                    </span>
                  )}
                </p>

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                  <Button size="sm" disabled={pending} onClick={() => use(template)}
                    data-template-use={template.id}>
                    <Wand2 size={14} aria-hidden />{t("newsletter.templates.use")}
                  </Button>
                  <RowAction label={t("newsletter.templates.duplicate")} icon={Copy}
                    disabled={pending} onClick={() => duplicate(template)}
                    data-template-duplicate={template.id} />
                  {!template.isBuiltin && (
                    <RowAction label={t("common.delete")} icon={Trash2} tone="danger"
                      disabled={pending} onClick={() => setDeleting(template)}
                      data-template-delete={template.id} />
                  )}
                </div>

                {template.isBuiltin && (
                  <p className="mt-2 text-[11px] leading-relaxed text-faint">
                    {t("newsletter.templates.builtinNote")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t("newsletter.templates.deleteTitle")}
        body={t("newsletter.templates.deleteBody")}
        confirmLabel={t("common.delete")}
        danger
        pending={pending}
      />
    </div>
  );
}

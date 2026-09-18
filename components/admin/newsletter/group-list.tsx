"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Filter, Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { formatDate } from "@/lib/utils";
import { toSegmentRules, type SegmentRules } from "@/lib/newsletter";
import type { GroupRow } from "@/lib/services/newsletter";
import {
  deleteGroupAction, previewSegmentAction, saveGroupAction,
} from "@/app/actions/newsletter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { RecordRow, RowAction } from "@/components/ui/record";
import { SectionHeader } from "@/components/ui/section-header";
import { SegmentBuilder, type PickerOption } from "@/components/admin/newsletter/segment-builder";

/**
 * GRUPY I SEGMENTY — two lists, one table, and the difference stated out loud.
 *
 * A static group has members. A dynamic segment has a filter, and its
 * membership is whatever that filter answers at the moment somebody uses it.
 * They live in the same table with the same key space, which is right — an
 * operator picking an audience does not care which kind they are picking — but
 * on THIS screen the difference is the whole content, so they are two sections
 * rather than one list with a type column.
 *
 * A SEGMENT'S SIZE IS NOT SHOWN UNTIL IT IS ASKED FOR, and that is the one
 * decision on this screen worth defending. `listGroups` returns members = -1
 * for a dynamic group because it does not know and will not guess; evaluating
 * every segment on page load would mean up to twelve contact-table queries per
 * segment before the screen paints. So a segment shows "Nie policzono" and a
 * "Przelicz" button, and the number that appears afterwards came from
 * `previewSegmentAction`, which runs the same `resolveSegment` the send will
 * run. A cached or estimated figure here would be a number an operator sizes a
 * campaign against, and it would be wrong in exactly the situation that
 * matters: right after the list changed.
 *
 * `is_dynamic` IS NOT EDITABLE, which is why creation has two buttons instead
 * of a type switch inside one form. `saveGroupAction` keeps the stored flag on
 * update and ignores whatever the form sends, so a switch here would be a
 * control that appears to work and does nothing.
 */

type Props = {
  groups: GroupRow[];
  /** For the builder's `source` conditions. */
  sources: PickerOption[];
  /** For the builder's opened/clicked/not-clicked conditions. */
  campaigns: PickerOption[];
  locale: string;
};

/** The form behind both modals. `id` absent means "being created". */
type Draft = {
  id?: string;
  key: string;
  name: string;
  description: string;
  isDynamic: boolean;
  rules: SegmentRules;
};

const emptyDraft = (isDynamic: boolean): Draft => ({
  key: "", name: "", description: "", isDynamic,
  rules: { match: "all", conditions: [] },
});

export function GroupList({ groups, sources, campaigns, locale }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<GroupRow | null>(null);
  /** group id → the count its last "Przelicz" produced. Deliberately not
   *  persisted and not pre-filled: an unasked segment has no number. */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [counting, setCounting] = useState<string | null>(null);

  const statics = groups.filter((g) => !g.isDynamic);
  const dynamics = groups.filter((g) => g.isDynamic);

  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));

  function save() {
    if (!draft) return;
    start(async () => {
      const res = await saveGroupAction({
        id: draft.id,
        key: draft.key,
        name: draft.name,
        description: draft.description || null,
        isDynamic: draft.isDynamic,
        rules: toSegmentRules(draft.rules),
      });
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.saved"));
      setDraft(null);
      router.refresh();
    });
  }

  function remove() {
    if (!deleting) return;
    const id = deleting.id;
    start(async () => {
      const res = await deleteGroupAction(id);
      if (!res.ok) { fail(res.error); return; }
      toast.success(t("common.deleted"));
      setDeleting(null);
      router.refresh();
    });
  }

  /** The real count, from the real evaluator, every single time it is pressed.
   *  `counting` is per-row rather than one global flag so recounting the third
   *  segment does not blank the button on the first. */
  function recount(group: GroupRow) {
    setCounting(group.id);
    start(async () => {
      const res = await previewSegmentAction(group.rules);
      setCounting(null);
      if (!res.ok) { fail(res.error); return; }
      const matched = res.data?.count;
      if (matched === undefined) { fail("generic"); return; }
      setCounts((prev) => ({ ...prev, [group.id]: matched }));
    });
  }

  const openEdit = (group: GroupRow) => setDraft({
    id: group.id,
    key: group.key,
    name: group.name,
    description: group.description ?? "",
    isDynamic: group.isDynamic,
    rules: group.rules,
  });

  /** A segment must not be able to name itself as a condition: `resolveSegment`
   *  reads `newsletter_group_members` for a `group` condition, so a self
   *  reference would silently resolve to nothing rather than recursing — a
   *  segment that quietly matches nobody is the worst of both outcomes. */
  const groupOptions = (exceptId?: string): PickerOption[] =>
    groups
      .filter((g) => g.id !== exceptId)
      .map((g) => ({ value: g.id, label: g.name }));

  return (
    <div data-group-list className="space-y-8">
      {/* ── STATIC GROUPS ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={Layers}
          title={t("newsletter.groups.static")}
          sub={t("newsletter.groups.staticHint")}
          action={
            <Button size="sm" data-group-new onClick={() => setDraft(emptyDraft(false))}>
              <Plus size={14} aria-hidden />{t("newsletter.groups.new")}
            </Button>
          }
        />

        {statics.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={t("newsletter.groups.none")}
            body={t("newsletter.groups.staticHint")}
            action={
              <Button size="sm" onClick={() => setDraft(emptyDraft(false))}>
                <Plus size={14} aria-hidden />{t("newsletter.groups.new")}
              </Button>
            }
          />
        ) : (
          <ul className="panel divide-y divide-line overflow-hidden rounded-2xl">
            {statics.map((group) => (
              <RecordRow
                key={group.id}
                title={group.name}
                meta={
                  <>
                    <code className="text-[11.5px]">{group.key}</code>
                    {" · "}
                    {formatDate(group.createdAt, locale)}
                    {group.description ? ` · ${group.description}` : ""}
                  </>
                }
                state={
                  <Badge tone="neutral">
                    <span className="tabular-nums">{group.members}</span>
                    &nbsp;{t("newsletter.groups.members")}
                  </Badge>
                }
                actions={
                  <>
                    <RowAction label={t("common.edit")} disabled={pending}
                      onClick={() => openEdit(group)} data-group-edit={group.key} />
                    <RowAction label={t("common.delete")} icon={Trash2} tone="danger"
                      disabled={pending} onClick={() => setDeleting(group)}
                      data-group-delete={group.key} />
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── DYNAMIC SEGMENTS ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={Filter}
          title={t("newsletter.groups.dynamic")}
          sub={t("newsletter.groups.dynamicHint")}
          action={
            <Button size="sm" data-segment-new onClick={() => setDraft(emptyDraft(true))}>
              <Plus size={14} aria-hidden />{t("newsletter.groups.newSegment")}
            </Button>
          }
        />

        {dynamics.length === 0 ? (
          <EmptyState
            icon={Filter}
            title={t("newsletter.groups.noSegments")}
            body={t("newsletter.groups.dynamicHint")}
            action={
              <Button size="sm" onClick={() => setDraft(emptyDraft(true))}>
                <Plus size={14} aria-hidden />{t("newsletter.groups.newSegment")}
              </Button>
            }
          />
        ) : (
          <ul className="panel divide-y divide-line overflow-hidden rounded-2xl">
            {dynamics.map((group) => {
              const known = counts[group.id];
              const busy = counting === group.id;
              return (
                <RecordRow
                  key={group.id}
                  title={group.name}
                  meta={
                    <>
                      <code className="text-[11.5px]">{group.key}</code>
                      {" · "}
                      {t("newsletter.segment.match")}:{" "}
                      {t(`newsletter.segment.${group.rules.match}`)}
                      {" ("}
                      <span className="tabular-nums">{group.rules.conditions.length}</span>
                      {")"}
                      {group.description ? ` · ${group.description}` : ""}
                    </>
                  }
                  state={
                    known === undefined ? (
                      <Badge tone="neutral">{t("newsletter.groups.notCounted")}</Badge>
                    ) : (
                      <Badge tone="accent">
                        <span className="tabular-nums">{known}</span>
                        &nbsp;{t("newsletter.groups.members")}
                      </Badge>
                    )
                  }
                  actions={
                    <>
                      <RowAction
                        label={busy ? t("common.loading") : t("newsletter.groups.recount")}
                        icon={RefreshCw} disabled={pending}
                        onClick={() => recount(group)} data-segment-recount={group.key}
                      />
                      <RowAction label={t("newsletter.groups.editSegment")} disabled={pending}
                        onClick={() => openEdit(group)} data-segment-edit={group.key} />
                      <RowAction label={t("common.delete")} icon={Trash2} tone="danger"
                        disabled={pending} onClick={() => setDeleting(group)}
                        data-segment-delete={group.key} />
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
      </section>

      {/* ── CREATE / EDIT ──────────────────────────────────────────────── */}
      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        wide={draft?.isDynamic}
        title={
          draft?.isDynamic
            ? (draft.id ? t("newsletter.groups.editSegment") : t("newsletter.groups.newSegment"))
            : (draft?.id ? t("common.edit") : t("newsletter.groups.new"))
        }
      >
        {draft && (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="grp-name">{t("common.name")}</Label>
                <Input id="grp-name" value={draft.name} autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="grp-key">{t("newsletter.groups.key")}</Label>
                <Input id="grp-key" value={draft.key} spellCheck={false} autoComplete="off"
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
                  {t("newsletter.groups.keyHint")}
                </p>
              </div>
              <div>
                <Label htmlFor="grp-desc">{t("common.description")}</Label>
                <Textarea id="grp-desc" value={draft.description} rows={2}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>

              {draft.isDynamic ? (
                <div className="border-t border-line pt-3">
                  <SegmentBuilder
                    value={draft.rules}
                    onChange={(rules) => setDraft({ ...draft, rules })}
                    groups={groupOptions(draft.id)}
                    sources={sources}
                    campaigns={campaigns}
                    disabled={pending}
                  />
                </div>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-faint">
                  {t("newsletter.groups.staticHint")}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
              <Button disabled={pending || !draft.name.trim() || !draft.key.trim()} onClick={save}
                data-group-save>
                {pending ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t("newsletter.groups.deleteTitle")}
        body={t("newsletter.groups.deleteBody")}
        confirmLabel={t("common.delete")}
        danger
        pending={pending}
      />
    </div>
  );
}

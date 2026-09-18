"use client";
import { useState, useTransition } from "react";
import { Plus, Users, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  LOCALES, SEGMENT_FIELDS,
  type SegmentCondition, type SegmentField, type SegmentRules,
} from "@/lib/newsletter";
import { previewSegmentAction } from "@/app/actions/newsletter";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";

/**
 * THE SEGMENT BUILDER — an AND/OR list, and deliberately nothing more.
 *
 * §10 asks for "dopasuj wszystkie / dowolny warunek" over a fixed vocabulary.
 * It does not ask for nested groups, per-condition operators or a rule
 * language, and this file is the place where that restraint has to be held:
 * every one of those additions is one afternoon to build and permanent
 * afterwards, because `resolveSegment` in lib/services/newsletter.ts evaluates
 * a FLAT list into sets of ids and unions or intersects them. A builder that
 * can express "(A or B) and not C" would be a builder that saves rules the
 * evaluator silently answers differently. The screen is limited to what the
 * engine behind it actually means.
 *
 * WHY THE VALUE CONTROL CHANGES WITH THE FIELD, rather than being one text box.
 * `SegmentCondition.value` is a single string for every field — a group id, a
 * source key, a tag, an ISO date, "true" — so a free text box would type-check,
 * save, and then match nobody, because a hand-typed group NAME is not a group
 * ID and nothing in the stack would ever say so. A picker per kind makes the
 * unmatchable value unrepresentable.
 *
 * WHY THE COUNT IS A BUTTON AND NOT A LIVE NUMBER. `previewSegmentAction` runs
 * the real `resolveSegment` — up to twelve queries over the contact table —
 * because a preview that was cheaper than the real thing would be a preview of
 * something else. That is not something to fire on every keystroke, and a
 * number that recomputes while you are still typing the condition is a number
 * that is wrong more often than it is right. So the operator asks.
 */

export type PickerOption = { value: string; label: string };

/**
 * Which control answers which field. Kept as a map rather than a chain of
 * conditionals so that adding a field to SEGMENT_FIELDS without deciding how
 * it is entered is a TypeScript error rather than a text box.
 */
type ValueKind = "group" | "source" | "campaign" | "locale" | "bool" | "date" | "text" | "none";

const VALUE_KIND: Record<SegmentField, ValueKind> = {
  source: "source",
  group: "group",
  tag: "text",
  locale: "locale",
  consent: "bool",
  has_account: "bool",
  opened_campaign: "campaign",
  clicked_campaign: "campaign",
  not_clicked_campaign: "campaign",
  created_before: "date",
  created_after: "date",
  never_sent: "none",
};

/** `toSegmentRules` slices at twelve, so the form stops there too: a control
 *  that accepts a thirteenth condition and then drops it on save is worse than
 *  one that refuses it. */
const MAX_CONDITIONS = 12;

export function SegmentBuilder({
  value, onChange, groups, sources, campaigns, disabled,
}: {
  value: SegmentRules;
  onChange: (next: SegmentRules) => void;
  /** Static and dynamic groups, minus the one being edited. */
  groups: PickerOption[];
  sources: PickerOption[];
  campaigns: PickerOption[];
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  /** null = never asked. A number is a real count, produced by the same code
   *  the send will run. */
  const [count, setCount] = useState<number | null>(null);

  const options = (kind: ValueKind): PickerOption[] =>
    kind === "group" ? groups
      : kind === "source" ? sources
      : kind === "campaign" ? campaigns
      : [];

  /** The value a freshly picked field starts with. A boolean condition with an
   *  empty string would read as "consent = false" to `resolveSegment` without
   *  the operator ever having chosen that, so booleans start at "true" and
   *  every picker starts at its first real option. */
  function initialValue(field: SegmentField): string {
    const kind = VALUE_KIND[field];
    if (kind === "bool") return "true";
    if (kind === "locale") return LOCALES[0];
    if (kind === "none" || kind === "text" || kind === "date") return "";
    return options(kind)[0]?.value ?? "";
  }

  function patch(next: Partial<SegmentRules>) {
    setCount(null); // The conditions changed; the old number describes nothing.
    onChange({ match: value.match, conditions: value.conditions, ...next });
  }

  const setCondition = (index: number, field: SegmentField, raw?: string) =>
    patch({
      conditions: value.conditions.map((c, i) =>
        i === index ? { field, value: raw ?? initialValue(field) } : c,
      ),
    });

  const addCondition = () => {
    const fresh: SegmentCondition = { field: "source", value: initialValue("source") };
    patch({ conditions: [...value.conditions, fresh].slice(0, MAX_CONDITIONS) });
  };

  const removeCondition = (index: number) =>
    patch({ conditions: value.conditions.filter((_, i) => i !== index) });

  function preview() {
    start(async () => {
      const res = await previewSegmentAction(value);
      // A failed preview leaves the previous answer cleared rather than
      // showing a stale count next to changed conditions.
      setCount(res.ok && res.data ? res.data.count : null);
    });
  }

  const full = value.conditions.length >= MAX_CONDITIONS;

  return (
    <div data-segment-builder className="space-y-3">
      <div>
        <Label>{t("newsletter.segment.match")}</Label>
        <Segmented
          size="sm"
          label={t("newsletter.segment.match")}
          value={value.match}
          onChange={(next) => patch({ match: next === "any" ? "any" : "all" })}
          options={[
            { value: "all", label: t("newsletter.segment.all") },
            { value: "any", label: t("newsletter.segment.any") },
          ]}
        />
      </div>

      <div>
        <Label>{t("newsletter.segment.conditions")}</Label>
        {value.conditions.length === 0 ? (
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {t("newsletter.segment.noConditions")}
          </p>
        ) : (
          <ul className="mt-1 space-y-2">
            {value.conditions.map((condition, index) => {
              const kind = VALUE_KIND[condition.field];
              const list = options(kind);
              return (
                <li key={index} className="plate rounded-xl p-2.5" data-condition={index}>
                  {/* 320px: field over value over the remove control. From `sm`
                      the three sit on one line. Never a horizontal scroll. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      aria-label={t("newsletter.segment.conditions")}
                      className="sm:flex-1"
                      value={condition.field}
                      disabled={disabled}
                      onChange={(e) => setCondition(index, e.target.value as SegmentField)}
                    >
                      {SEGMENT_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {t(`newsletter.segment.field.${field}`)}
                        </option>
                      ))}
                    </Select>

                    <div className="min-w-0 sm:flex-1">
                      {kind === "none" ? (
                        <p className="px-1 py-2 text-[12px] text-muted">
                          {t("newsletter.segment.noValue")}
                        </p>
                      ) : kind === "text" ? (
                        <Input
                          aria-label={t("newsletter.segment.field.tag")}
                          value={condition.value}
                          disabled={disabled}
                          placeholder={t("newsletter.segment.field.tag")}
                          onChange={(e) => setCondition(index, condition.field, e.target.value)}
                        />
                      ) : kind === "date" ? (
                        <Input
                          type="date"
                          aria-label={t(`newsletter.segment.field.${condition.field}`)}
                          value={condition.value}
                          disabled={disabled}
                          onChange={(e) => setCondition(index, condition.field, e.target.value)}
                        />
                      ) : kind === "bool" ? (
                        <Select
                          aria-label={t(`newsletter.segment.field.${condition.field}`)}
                          value={condition.value === "false" ? "false" : "true"}
                          disabled={disabled}
                          onChange={(e) => setCondition(index, condition.field, e.target.value)}
                        >
                          <option value="true">{t("newsletter.segment.yes")}</option>
                          <option value="false">{t("newsletter.segment.no")}</option>
                        </Select>
                      ) : kind === "locale" ? (
                        <Select
                          aria-label={t("newsletter.segment.field.locale")}
                          value={condition.value || LOCALES[0]}
                          disabled={disabled}
                          onChange={(e) => setCondition(index, condition.field, e.target.value)}
                        >
                          {LOCALES.map((l) => (
                            <option key={l} value={l}>{l.toUpperCase()}</option>
                          ))}
                        </Select>
                      ) : list.length === 0 ? (
                        // An empty picker says so instead of rendering a
                        // dropdown with nothing in it and a value of "".
                        <p className="px-1 py-2 text-[12px] text-muted">
                          {kind === "campaign" ? t("newsletter.segment.noCampaigns")
                            : kind === "group" ? t("newsletter.groups.none")
                            : t("common.noData")}
                        </p>
                      ) : (
                        <Select
                          aria-label={t(`newsletter.segment.field.${condition.field}`)}
                          value={condition.value}
                          disabled={disabled}
                          onChange={(e) => setCondition(index, condition.field, e.target.value)}
                        >
                          <option value="">
                            {kind === "group" ? t("newsletter.segment.pickGroup")
                              : kind === "source" ? t("newsletter.segment.pickSource")
                              : t("newsletter.segment.pickCampaign")}
                          </option>
                          {list.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </Select>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removeCondition(index)}
                      aria-label={t("newsletter.segment.remove")}
                      title={t("newsletter.segment.remove")}
                      data-condition-remove={index}
                      className={cn(
                        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5",
                        "text-[13px] font-semibold text-muted transition-colors",
                        "hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-50",
                        "sm:w-9 sm:px-0",
                      )}
                    >
                      <X size={14} aria-hidden />
                      <span className="sm:hidden">{t("newsletter.segment.remove")}</span>
                    </button>
                  </div>

                  {condition.field === "tag" && (
                    <p className="mt-1.5 px-1 text-[11px] text-faint">
                      {t("newsletter.segment.tagHint")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm" variant="secondary" data-condition-add
          disabled={disabled || full}
          onClick={addCondition}
        >
          <Plus size={14} aria-hidden />{t("newsletter.segment.addCondition")}
        </Button>
        <Button
          size="sm" variant="ghost" data-segment-preview
          disabled={disabled || pending || value.conditions.length === 0}
          onClick={preview}
        >
          <Users size={14} aria-hidden />
          {pending ? t("common.loading") : t("newsletter.segment.preview")}
        </Button>
        {count !== null && (
          <span className="text-[12.5px] font-semibold tabular-nums" data-segment-count={count}>
            {count} <span className="font-normal text-muted">{t("newsletter.segment.matches")}</span>
          </span>
        )}
      </div>

      {full && (
        <p className="text-[11.5px] leading-relaxed text-faint">{t("newsletter.segment.limit")}</p>
      )}
    </div>
  );
}

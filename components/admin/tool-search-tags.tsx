"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveToolSearchTagsAction } from "@/app/actions/ai-tools";
import { SEARCH_TAGS_MAX, SEARCH_TAG_MAX_CHARS, normaliseSearchTags } from "@/lib/search-tags";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/**
 * TAGI WYSZUKIWANIA — extra phrases that find this tool in the global search.
 * Search metadata only: never shown on the tool's card, never sent to AI.
 * Enter or a comma adds a tag; × removes it; nothing is saved until "Zapisz".
 */
export function ToolSearchTagsForm({ toolKey, initial }: { toolKey: string; initial: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const dirty = JSON.stringify(tags) !== JSON.stringify(initial);
  const full = tags.length >= SEARCH_TAGS_MAX;

  function add(raw: string) {
    // A paste like "a, b, c" adds three; duplicates (case/diacritics) and
    // empties fall away under the same rule the server applies.
    const next = normaliseSearchTags([...tags, ...raw.split(",")]);
    setTags(next);
    setDraft("");
  }

  function save() {
    start(async () => {
      const res = await saveToolSearchTagsAction(toolKey, normaliseSearchTags([...tags, ...draft.split(",")]));
      if (res.ok) { setDraft(""); toast.success(t("common.saved")); router.refresh(); }
      else toast.error(res.error === "search_tags_invalid" ? t("aicc.err.searchTagsInvalid") : t("common.error"));
    });
  }

  return (
    <div className="space-y-3" data-search-tags>
      <div>
        <Label htmlFor={`${id}-tag`}>{t("aicc.basics.searchTags")}</Label>
        <p className="mb-2 text-xs text-faint">{t("aicc.basics.searchTagsHint", { max: SEARCH_TAGS_MAX, chars: SEARCH_TAG_MAX_CHARS })}</p>
        {tags.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {tags.map((tag, i) => (
              <li key={tag} className="inline-flex max-w-full items-center gap-1 rounded-full bg-raised py-1 pl-2.5 pr-1 text-[12.5px] font-medium">
                <span className="min-w-0 truncate">{tag}</span>
                <button type="button" aria-label={t("aicc.basics.searchTagRemove", { tag })}
                  onClick={() => setTags(tags.filter((_, j) => j !== i))}
                  className="rounded-full p-0.5 text-muted transition-colors hover:bg-sunken hover:text-ink">
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input id={`${id}-tag`} value={draft} disabled={full} maxLength={SEARCH_TAG_MAX_CHARS * 4}
            placeholder={t("aicc.basics.searchTagsPlaceholder")}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(",")) add(v); else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (draft.trim()) add(draft); }
              if (e.key === "Backspace" && !draft && tags.length > 0) setTags(tags.slice(0, -1));
            }} />
          <Button type="button" variant="secondary" disabled={full || !draft.trim()} onClick={() => add(draft)}>
            {t("aicc.basics.searchTagsAdd")}
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={pending || (!dirty && !draft.trim())}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

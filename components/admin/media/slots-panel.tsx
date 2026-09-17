"use client";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { SlotDef } from "@/lib/media-slots";
import type { LibraryItem, SlotRow } from "@/lib/services/media-slots";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SlotEditor } from "./slot-editor";

/**
 * ONE TAB OF THE MEDIA SCREEN — categories, tools or application sections.
 *
 * Grouped by the thing the slots belong to and collapsed by default, because
 * the product declares eighty-eight positions and a flat list of eighty-eight
 * editors is not a screen anybody can use. Open "Moda" and you get Moda's two;
 * everything else stays out of the way.
 *
 * THE LIBRARY IS PASSED ONCE. Every editor below shares this component's copy
 * rather than receiving its own — three hundred files serialised fifteen times
 * would be the page's whole weight, for one list that is identical every time.
 */

export type SlotGroupView = {
  id: string;
  name: string;
  /** Where it sits — the category a workflow belongs to, the group a tool is in. */
  sub?: string;
  slots: { def: SlotDef; row: SlotRow | null }[];
};

export function SlotsPanel({ groups, library, emptyLabel }: {
  groups: SlotGroupView[];
  library: LibraryItem[];
  emptyLabel: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  // The first group is open on arrival: a screen of closed rows gives no clue
  // what is inside one.
  const [open, setOpen] = useState<string | null>(groups[0]?.id ?? null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      `${g.name} ${g.sub ?? ""} ${g.id}`.toLowerCase().includes(q));
  }, [groups, query]);

  if (groups.length === 0) {
    return (
      <p className="panel rounded-2xl px-4 py-10 text-center text-[13px] text-muted">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div>
      {groups.length > 6 && (
        <div className="relative mb-3 sm:max-w-xs">
          <Search aria-hidden size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={query} className="pl-9" placeholder={t("media.findEntity")}
            aria-label={t("media.findEntity")} data-slot-search
            onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {visible.length === 0 ? (
        <p className="panel rounded-2xl px-4 py-8 text-center text-[13px] text-muted">
          {t("media.noMatchesBody")}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((g) => {
            const filled = g.slots.filter((s) => s.row?.mediaId && s.row.enabled).length;
            const isOpen = open === g.id;
            return (
              <li key={g.id} className="panel overflow-hidden rounded-2xl" data-slot-group={g.id}>
                <button type="button" aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : g.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised/50">
                  <ChevronDown size={15} aria-hidden
                    className={cn("shrink-0 text-faint transition-transform", isOpen && "rotate-180")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{g.name}</span>
                    {g.sub && <span className="block truncate text-[11px] text-faint">{g.sub}</span>}
                  </span>
                  {/* What is already dressed, without opening anything. */}
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums",
                    filled > 0 ? "bg-accent-soft text-accent" : "bg-sunken text-faint",
                  )}>
                    {filled}/{g.slots.length}
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-line bg-sunken/30 p-3 sm:p-4">
                    {g.slots.map(({ def, row }) => (
                      <SlotEditor key={def.key} def={def} row={row}
                        library={library} entityName={g.name} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

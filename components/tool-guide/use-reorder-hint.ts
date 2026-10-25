"use client";
import { useEffect, useState } from "react";
import { fetchToolGuide } from "@/components/tool-guide/use-tool-guide";
import { useIsGuest } from "@/components/public-tools/tool-viewer";
import type { GuideToolKey } from "@/lib/tool-guides";

/**
 * The tool's "drag to reorder" line (Drag & drop zdjęć V2), as the admin
 * wrote it in the tool's guide: a string, `null` (hidden by the admin) or
 * `undefined` (nothing saved — the grid shows the shipped line). Read with
 * the tool's guide in the same request the gallery already makes; a visitor
 * (no account, no guide read) simply sees the shipped line.
 */
export function useReorderHint(tool: GuideToolKey): string | null | undefined {
  const guest = useIsGuest();
  const [hint, setHint] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (guest) return;
    let alive = true;
    void fetchToolGuide(tool).then((json) => {
      if (alive && json?.ok && json.reorderHint !== undefined) setHint(json.reorderHint);
    });
    return () => { alive = false; };
  }, [tool, guest]);
  return hint;
}

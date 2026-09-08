"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { setToolKnowledgeAction } from "@/app/actions/ai-tools";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

export type KnowledgeSetRow = {
  id: string;
  name: string;
  status: string;
  examples: number;
  files: number;
  updatedAt: string;
  assigned: boolean;
};

/**
 * WIEDZA — which reference sets this tool may draw on.
 *
 * The sets themselves are imported and inspected in the knowledge library
 * (Baza wiedzy); this is only the assignment, and one set can serve several
 * tools without the files being copied.
 *
 * Attaching a set does NOT change the production prompt. Imported material is
 * data: it can inform a candidate version that an operator then reads and
 * publishes, and it can never publish itself.
 */
export function ToolKnowledge({ toolKey, sets, locale }: {
  toolKey: string; sets: KnowledgeSetRow[]; locale: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle(setId: string, assigned: boolean) {
    start(async () => {
      const res = await setToolKnowledgeAction({ toolKey, setId, assigned });
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-raised px-4 py-3 text-[13px] leading-relaxed text-muted">
        <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-accent2" />
        {t("aicc.knowledge.safetyNote")}
      </p>

      {sets.length === 0 ? (
        <div className="panel rounded-2xl px-5 py-10 text-center">
          <p className="text-sm font-medium">{t("aicc.knowledge.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-[42ch] text-xs text-muted">{t("aicc.knowledge.emptyBody")}</p>
          <Link href="/admin/ai/wiedza"
            className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-accent-soft px-3 text-[13px] font-semibold text-accent hover:brightness-110">
            {t("aicc.knowledge.import")} <ExternalLink size={13} aria-hidden />
          </Link>
        </div>
      ) : (
        <ul className="panel divide-y divide-line rounded-2xl">
          {sets.map((s) => (
            <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5",
              s.assigned && "bg-accent-soft/20")}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={s.assigned} disabled={pending}
                  onChange={() => toggle(s.id, !s.assigned)}
                  className="size-4 shrink-0 accent-[rgb(var(--accent))]" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{s.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {t("aicc.knowledge.counts", { examples: s.examples, files: s.files })} ·{" "}
                    <RelativeTime at={s.updatedAt} locale={locale} t={t} />
                  </span>
                </span>
              </label>
              <Badge tone={s.status === "ready" ? "success" : s.status === "error" ? "danger" : "neutral"}>
                {s.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

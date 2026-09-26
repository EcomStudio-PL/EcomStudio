"use client";
import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { ArrowLeftRight, Check, ExternalLink, FileUp, ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { setToolKnowledgeAction } from "@/app/actions/ai-tools";
import { reviewKnowledgeExampleAction } from "@/app/actions/ai-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

export type KnowledgeSetRow = {
  id: string;
  name: string;
  status: string;
  examples: number;
  /** Extracted candidates waiting for an admin decision. */
  pending: number;
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
                    {s.pending > 0 && <>{t("aicc.knowledge.pendingCount", { n: s.pending })} · </>}
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

/**
 * UPLOAD — a ZIP (before/ + after/ + metadata) or a PDF. The server parses,
 * extracts and stores; everything it had to guess comes back as PENDING
 * candidates below, never as live knowledge.
 */
export function KnowledgeImport({ toolKey }: { toolKey: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [assign, setAssign] = useState(true);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (name.trim()) form.append("name", name.trim());
      // The server assigns the set to this tool in the same request (or to
      // none, when the admin unticked it).
      form.append("tool", assign ? toolKey : "none");
      const res = await fetch("/api/admin/knowledge/import", { method: "POST", body: form });
      const json = await res.json().catch(() => null) as { ok?: boolean; error?: string; setId?: string; examples?: number; pending?: number } | null;
      if (!json?.ok || !json.setId) {
        toast.error(t(`aicc.knowledge.importErr.${json?.error ?? "generic"}`));
        return;
      }
      toast.success(t("aicc.knowledge.imported", { n: json.examples ?? 0, pending: json.pending ?? 0 }));
      setFile(null); setName("");
      router.refresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel space-y-3 rounded-2xl p-4 sm:p-5" data-knowledge-import>
      <p className="text-xs leading-relaxed text-muted">{t("aicc.knowledge.importHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-file`}>{t("aicc.knowledge.file")}</Label>
          <input id={`${id}-file`} type="file" accept=".zip,.pdf,application/zip,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full min-w-0 text-[13px] file:mr-3 file:min-h-[36px] file:rounded-lg file:border-0 file:bg-raised file:px-3 file:text-[13px] file:font-semibold" />
        </div>
        <div>
          <Label htmlFor={`${id}-name`}>{t("aicc.knowledge.setName")}</Label>
          <Input id={`${id}-name`} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} className="size-4 accent-[rgb(var(--accent))]" />
          {t("aicc.knowledge.assignAfter")}
        </label>
        <Button disabled={!file || busy} onClick={upload}>
          <FileUp size={14} aria-hidden /> {busy ? t("aicc.knowledge.importing") : t("aicc.knowledge.importBtn")}
        </Button>
      </div>
    </div>
  );
}

export type ReviewItem = {
  id: string;
  setName: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  prompt: string | null;
  scene: string | null;
  category: string | null;
  tags: string[];
  confidence: number | null;
  sourceRef: string | null;
};

/**
 * ADMIN REVIEW — before, after, the extracted prompt, scene, tags, category
 * and how sure the extractor was. Nothing here is live until it is approved;
 * approving builds the sealed hint and the embedding, rejecting keeps it out.
 */
export function KnowledgeReview({ toolKey, items }: { toolKey: string; items: ReviewItem[] }) {
  const { t } = useI18n();
  if (items.length === 0) {
    return <p className="panel rounded-2xl px-5 py-8 text-center text-sm text-muted">{t("aicc.knowledge.reviewEmpty")}</p>;
  }
  return (
    <ul className="space-y-3" data-review-queue>
      {items.map((it) => <ReviewCard key={it.id} toolKey={toolKey} item={it} />)}
    </ul>
  );
}

function ReviewCard({ toolKey, item }: { toolKey: string; item: ReviewItem }) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [prompt, setPrompt] = useState(item.prompt ?? "");
  const [scene, setScene] = useState(item.scene ?? "");
  const [category, setCategory] = useState(item.category ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [swap, setSwap] = useState(false);
  const before = swap ? item.afterUrl : item.beforeUrl;
  const after = swap ? item.beforeUrl : item.afterUrl;

  function decide(decision: "approve" | "reject") {
    start(async () => {
      const res = await reviewKnowledgeExampleAction({
        id: item.id, decision, promptUsed: prompt, scene, productCategory: category,
        tags: tags.split(",").map((x) => x.trim()).filter(Boolean), swap, toolKey,
      });
      if (res.ok) { toast.success(decision === "approve" ? t("aicc.knowledge.approved") : t("aicc.knowledge.rejected")); router.refresh(); }
      else toast.error(res.error === "nothing_to_learn" ? t("aicc.knowledge.nothingToLearn") : t("common.error"));
    });
  }

  const conf = item.confidence;
  return (
    <li className="panel rounded-2xl p-4 sm:p-5" data-review-item>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold">{item.setName}</span>
        {item.sourceRef && <span className="text-xs text-faint">{item.sourceRef}</span>}
        <Badge tone={conf === null ? "neutral" : conf >= 0.7 ? "success" : conf >= 0.45 ? "warning" : "danger"}>
          {t("aicc.knowledge.confidence", { n: conf === null ? "—" : Math.round(conf * 100) })}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        {([["before", before], ["after", after]] as const).map(([label, url]) => (
          <figure key={label} className="min-w-0">
            <div className="aspect-square overflow-hidden rounded-xl bg-sunken">
              {url
                // A short-lived signed URL from the private bucket, shown as a
                // background so no image optimiser ever proxies or caches it.
                ? <div role="img" aria-label={t(`aicc.knowledge.${label}`)} className="size-full bg-cover bg-center"
                    style={{ backgroundImage: `url("${url}")` }} />
                : <span className="flex size-full items-center justify-center text-xs text-faint">{t("aicc.knowledge.noImage")}</span>}
            </div>
            <figcaption className="mt-1 text-center text-xs text-muted">{t(`aicc.knowledge.${label}`)}</figcaption>
          </figure>
        ))}
      </div>
      {(item.beforeUrl || item.afterUrl) && (
        <Button size="sm" variant="ghost" className="mt-2" disabled={pending} onClick={() => setSwap(!swap)}>
          <ArrowLeftRight size={14} aria-hidden /> {t("aicc.knowledge.swap")}
        </Button>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor={`${id}-prompt`}>{t("aicc.knowledge.extractedPrompt")}</Label>
          <Textarea id={`${id}-prompt`} rows={4} value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)}
            className="font-mono text-[12px]" />
          <p className="mt-1 text-xs text-faint">{t("aicc.knowledge.dataNotInstruction")}</p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${id}-scene`}>{t("aicc.knowledge.scene")}</Label>
          <Input id={`${id}-scene`} value={scene} maxLength={1500} onChange={(e) => setScene(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-cat`}>{t("aicc.knowledge.category")}</Label>
          <Input id={`${id}-cat`} value={category} maxLength={120} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-tags`}>{t("aicc.knowledge.tags")}</Label>
          <Input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={pending} onClick={() => decide("reject")}>
          <X size={14} aria-hidden /> {t("aicc.knowledge.reject")}
        </Button>
        <Button disabled={pending} onClick={() => decide("approve")}>
          <Check size={14} aria-hidden /> {t("aicc.knowledge.approve")}
        </Button>
      </div>
    </li>
  );
}

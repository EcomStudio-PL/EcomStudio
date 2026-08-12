"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, Loader2, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updatePromptTextAction } from "@/app/actions/prompts";

export type PromptCardData = {
  id: string;
  conceptName: string;
  sceneType: string | null;
  promptText: string;
  negativePrompt: string | null;
  lockStrength: string;
  references: { image: number; url: string | null; label: string; why: string | null; primary: boolean }[];
};

/** The five prompt-concept cards: scene, chosen references with WHY, the
 *  master prompt, collapsed negative, and the handoff to AI Studio. */
export function SessionCards({ prompts }: { prompts: PromptCardData[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {prompts.map((p, i) => <PromptCard key={p.id} p={p} index={i + 1} />)}
    </div>
  );
}

function PromptCard({ p, index }: { p: PromptCardData; index: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [showPrompt, setShowPrompt] = useState(false);
  const [showNegative, setShowNegative] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.promptText);
  const [busy, setBusy] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    toast.success(t("prompts.copied"));
  }

  async function saveEdit() {
    setBusy(true);
    const res = await updatePromptTextAction(p.id, text);
    setBusy(false);
    if (res.ok) { setEditing(false); toast.success(t("common.save")); }
    else toast.error(t("common.error"));
  }

  async function regenerate() {
    setBusy(true);
    try {
      const res = await fetch("/api/prompts/regenerate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: p.id }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) { toast.success(t("psess.regenerated")); router.refresh(); }
      else toast.error(t(`studio.err.${json.error}`, {}) || t("common.error"));
    } catch { toast.error(t("common.error")); }
    setBusy(false);
  }

  return (
    <Card className="anim-pop flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg brand-gradient text-[11px] font-bold text-white">{index}</span>
          <h3 className="text-sm font-semibold">{p.conceptName}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {p.sceneType && <Badge tone="indigo">{t(`scene.${p.sceneType}`, {}) || p.sceneType}</Badge>}
          <Badge>{p.lockStrength}</Badge>
        </div>
      </div>

      <div className="space-y-3 p-5">
        {p.references.length > 0 && (
          <div>
            <div className="flex flex-wrap gap-2">
              {p.references.map((r) => (
                <div key={r.image} className={cn(
                  "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border",
                  r.primary ? "border-accent ring-1 ring-accent" : "border-line")}>
                  {r.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.url} alt="" className="h-full w-full object-cover" />
                  ) : <div className="h-full w-full bg-raised" />}
                  <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{r.image}</span>
                </div>
              ))}
            </div>
            <ul className="mt-2 space-y-0.5">
              {p.references.map((r) => (
                <li key={r.image} className="min-w-0 text-xs text-muted">
                  <span className="font-semibold text-ink">{r.image}</span>
                  {r.primary && <span className="ml-1 rounded bg-accent/10 px-1 text-[9px] font-bold uppercase tracking-wide text-accent">{t("psess.primaryRef")}</span>}
                  {" — "}{r.label}{r.why ? `: ${r.why}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <button type="button" onClick={() => setShowPrompt(!showPrompt)}
            className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
            <ChevronDown size={13} className={cn("transition-transform", showPrompt && "rotate-180")} />
            Prompt
          </button>
          {showPrompt && (
            editing ? (
              <div className="mt-2 space-y-2">
                <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={saveEdit}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white">{t("common.save")}</button>
                  <button type="button" onClick={() => { setEditing(false); setText(p.promptText); }}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs">{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-raised p-3 text-xs text-muted">{text}</pre>
            )
          )}
        </div>

        {p.negativePrompt && (
          <div>
            <button type="button" onClick={() => setShowNegative(!showNegative)}
              className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
              <ChevronDown size={13} className={cn("transition-transform", showNegative && "rotate-180")} />
              Negative
            </button>
            {showNegative && (
              <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-raised p-3 text-xs text-muted">{p.negativePrompt}</pre>
            )}
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <button type="button" onClick={copy}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
          <Copy size={13} /> {t("prompts.copy")}
        </button>
        <button type="button" onClick={() => { setEditing(true); setShowPrompt(true); }}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
          <Pencil size={13} /> {t("common.edit")}
        </button>
        <button type="button" disabled={busy} onClick={regenerate}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {t("psess.regenerate")}
        </button>
        <Link href={`/generator?prompt=${p.id}`} prefetch
          className="brand-gradient ml-auto flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90">
          <Sparkles size={13} /> {t("psess.toStudio")}
        </Link>
      </div>
    </Card>
  );
}

/** Small ready-state banner on the session page. */
export function SessionStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "ready") return <Badge tone="green"><Check size={11} className="mr-1 inline" />{t("psess.ready")}</Badge>;
  if (status === "failed") return <Badge tone="red">{t("psess.failed")}</Badge>;
  return <Badge tone="amber">{t("psess.processing")}</Badge>;
}

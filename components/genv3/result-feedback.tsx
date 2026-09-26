"use client";
import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { readResultVoteAction, voteResultAction, type ResultVote } from "@/app/actions/feedback";
import { DISLIKE_REASONS, LIKE_REASONS } from "@/lib/feedback-reasons";
import { cn } from "@/lib/utils";

/**
 * 👍 / 👎 on one result, with optional reasons.
 *
 * One vote per GENERATION (the job) per seller, enforced by the database — a
 * job that returned several images shares one vote, and the question says
 * "this generation" for that reason. A double tap is
 * two requests that settle on the same single row. Tapping the active thumb
 * again withdraws the vote. What a vote does is small and stated in the admin
 * panel: it moves the ranking of the knowledge examples behind this result. It
 * never edits a prompt.
 */
export function ResultFeedback({ generationId }: { generationId: string }) {
  const { t } = useI18n();
  const [vote, setVote] = useState<ResultVote | null>(null);
  // null until known; false for a result that is not the viewer's to rate
  // (a teammate's), in which case nothing is rendered.
  const [votable, setVotable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    setVote(null);
    setVotable(null);
    readResultVoteAction(generationId).then((v) => {
      if (!alive) return;
      setVotable(v !== null);
      setVote(v ?? { verdict: null, reasons: [] });
    });
    return () => { alive = false; };
  }, [generationId]);

  async function send(verdict: "like" | "dislike" | null, reasons: string[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const previous = vote;
    setVote({ verdict, reasons });
    const res = await voteResultAction({ generationId, verdict, reasons });
    inFlight.current = false;
    setBusy(false);
    if (!res.ok || !res.vote) {
      setVote(previous);
      toast.error(t("genv3.feedback.error"));
      return;
    }
    setVote(res.vote);
    if (verdict && !previous?.verdict) toast.success(t("genv3.feedback.thanks"));
  }

  const current = vote?.verdict ?? null;
  const reasons = current === "like" ? LIKE_REASONS : current === "dislike" ? DISLIKE_REASONS : [];
  const toggleReason = (r: string) => {
    if (!current) return;
    const has = vote?.reasons.includes(r);
    void send(current, has ? vote!.reasons.filter((x) => x !== r) : [...(vote?.reasons ?? []), r]);
  };

  if (votable === false) return null;
  return (
    <div className="rounded-xl border border-line px-3 py-2.5" data-result-feedback>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] font-semibold text-muted">{t("genv3.feedback.question")}</p>
        <div className="flex shrink-0 gap-1.5">
          {(["like", "dislike"] as const).map((v) => (
            <button key={v} type="button" disabled={busy || votable !== true}
              aria-pressed={current === v}
              aria-label={t(`genv3.feedback.${v}`)}
              title={t(`genv3.feedback.${v}`)}
              onClick={() => void send(current === v ? null : v, [])}
              className={cn(
                "flex size-10 items-center justify-center rounded-lg transition-colors disabled:opacity-60",
                current === v
                  ? v === "like" ? "bg-[rgb(var(--success)/0.16)] text-success" : "bg-[rgb(var(--danger)/0.14)] text-danger"
                  : "text-muted hover:bg-raised hover:text-ink",
              )}>
              {v === "like" ? <ThumbsUp size={16} aria-hidden /> : <ThumbsDown size={16} aria-hidden />}
            </button>
          ))}
        </div>
      </div>
      {current && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("genv3.feedback.reasons")}>
          {reasons.map((r) => {
            const on = vote?.reasons.includes(r) ?? false;
            return (
              <button key={r} type="button" disabled={busy} aria-pressed={on} onClick={() => toggleReason(r)}
                className={cn(
                  "min-h-[32px] rounded-lg px-2.5 text-[11.5px] font-semibold ring-1 transition-colors",
                  on ? "bg-accent2-soft text-accent2 ring-[rgb(var(--accent2)/0.30)]" : "text-muted ring-line hover:text-ink",
                )}>
                {t(`genv3.feedback.reason.${r}`)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

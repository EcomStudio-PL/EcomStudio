"use client";
import { useState, useTransition } from "react";
import {
  AlertTriangle, BadgeCheck, Check, Copy, Loader2, Sparkles, SplitSquareHorizontal,
  Stethoscope, UserRoundPen, Wand2, WandSparkles,
} from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { StepPanel } from "@/components/ui/step-panel";
import {
  abVariantsAction, analyzeCampaignAction, estimatePersonalizationAction,
  generatePersonalizationAction, generatePersonalizationSampleAction,
  improveEmailAction, preheaderIdeasAction, subjectIdeasAction, writeEmailAction,
  type AbVariantDraft, type AnalysisArea, type CampaignAnalysis, type EmailDraft,
  type ImprovedEmail, type PersonalizationEstimate, type PersonalizationPreview,
  type PersonalizationRun,
} from "@/app/actions/newsletter-ai";

/**
 * AI STUDIO — and the same component inside a campaign.
 *
 * ONE PANEL, TWO HOMES. Its own screen renders it with a picker over every
 * campaign; `campaign-wizard.tsx` renders it with a one-campaign list, which
 * pins it to the mailing being edited. A second implementation for the
 * embedded case is how the two drift until "Popraw" means something different
 * depending on which screen you pressed it from.
 *
 * WHAT IT NEVER DOES IS PRETEND. When no text provider is configured the whole
 * panel is replaced by the unavailable state and every control is gone — not
 * disabled-but-clickable, not "demo mode", not a canned example draft. A
 * fabricated draft on this screen is indistinguishable from a real one at the
 * moment it matters, and the operator finds out by sending it.
 *
 * "WSTAW DO KAMPANII" ONLY EXISTS WHERE IT CAN WORK. `onApply` is supplied by
 * a host that has somewhere to put the text; without one the panel offers
 * "Kopiuj" instead. A button that looks like it saves and silently does not is
 * worse than no button, and this module has spent the rest of its screens
 * earning the opposite reputation.
 *
 * MOBILE. Every result is a card, never a table: the analysis, the variants and
 * the personalisation sample are all multi-line prose, which is the one thing a
 * table cannot do at 320px. The mode switcher is the house `ChipRow`, which
 * scrolls inside itself rather than pushing the page sideways, and every
 * generated string is `break-words` so a 70-character subject line cannot
 * widen the document.
 */

/** What a result can be handed back to a host editor as. Everything is optional
 *  because each action produces a different part of a mail. */
export type AiApplyPayload = {
  subject?: string;
  preheader?: string;
  paragraphs?: string[];
  ctaLabel?: string;
};

type Mode = "write" | "improve" | "analyze" | "variants" | "personalize";

const MODES: { key: Mode; icon: typeof Wand2 }[] = [
  { key: "write", icon: WandSparkles },
  { key: "improve", icon: Wand2 },
  { key: "analyze", icon: Stethoscope },
  { key: "variants", icon: SplitSquareHorizontal },
  { key: "personalize", icon: UserRoundPen },
];

/*
  THESE TWO LISTS ARE SPELLED OUT AGAIN RATHER THAN IMPORTED. Their originals
  live in lib/server/newsletter/ai.ts next to the instructions each value
  carries, and that module is `server-only`: importing a VALUE from it would
  pull every system prompt in the feature into this bundle. The server
  re-validates both (`asImproveAction`, `asTone`), so a list that drifts here
  produces a safe default, never an unchecked string inside a prompt.
*/
const IMPROVE_ACTIONS = [
  "shorten", "conversion", "cta", "natural", "trim", "premium", "sales",
] as const;

const TONES = ["professional", "casual", "premium", "short", "sales"] as const;

/** The order the review reads in: what is on offer, how to act on it, and only
 *  then the craft. A findings list in the model's own output order changes
 *  shape between two runs of the same campaign. */
const ANALYSIS_ORDER: AnalysisArea[] = [
  "offer", "cta", "length", "spam", "subject_match", "hierarchy",
];

export function AiPanel({ available, campaigns, campaignId: fixedCampaignId, onApply }: {
  /** Whether a text-capable provider is configured. Decided on the server —
   *  the panel never guesses, and never assumes yes. */
  available: boolean;
  /** Campaigns to choose from. A one-entry list pins the panel to that one. */
  campaigns?: { id: string; name: string }[];
  /** Pins the panel without offering a picker at all. */
  campaignId?: string;
  /** Present only where there is something to insert into. */
  onApply?: (payload: AiApplyPayload) => void;
}) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>("write");
  const [campaignId, setCampaignId] = useState(fixedCampaignId ?? campaigns?.[0]?.id ?? "");

  // The brief.
  const [goal, setGoal] = useState("");
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState<string>("professional");

  // The working text — what "Popraw", "5 tematów" and the variants act on.
  const [body, setBody] = useState("");

  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [improved, setImproved] = useState<ImprovedEmail | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [preheaders, setPreheaders] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<CampaignAnalysis | null>(null);
  const [variants, setVariants] = useState<AbVariantDraft[]>([]);

  const [sample, setSample] = useState<PersonalizationPreview[] | null>(null);
  const [estimate, setEstimate] = useState<PersonalizationEstimate | null>(null);
  const [run, setRun] = useState<PersonalizationRun | null>(null);

  const fail = (error: string) => toast.error(t(`newsletter.err.${error}`));

  /** Every action goes through here, so a failure always reaches the operator
   *  as a translated sentence rather than as a raw key or a silent no-op. */
  function call<T>(
    promise: Promise<{ ok: true; data?: T } | { ok: false; error: string }>,
    onOk: (data: T) => void,
    okMessage?: string,
  ) {
    start(async () => {
      const res = await promise;
      if (!res.ok) { fail(res.error); return; }
      if (res.data !== undefined) onOk(res.data);
      if (okMessage) toast.success(okMessage);
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("newsletter.ai.copied"));
    } catch {
      // A clipboard permission the browser refused is not worth a red toast:
      // the text is on screen and selectable either way.
      toast.info(t("newsletter.ai.copyFailed"));
    }
  }

  /* ── THE HONEST UNAVAILABLE STATE ──────────────────────────────────────── */

  if (!available) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t("newsletter.ai.title")}
        body={t("newsletter.ai.unavailable")}
      />
    );
  }

  /** The text every "act on this mail" button reads. The textarea wins when the
   *  operator has typed in it; otherwise the last generated result does, so
   *  "Napisz" → "Skróć" works without a copy-paste in between. */
  const workingText = (): string => {
    if (body.trim()) return body;
    const lines = improved?.paragraphs.length ? improved.paragraphs : draft?.paragraphs ?? [];
    return lines.join("\n\n");
  };

  const showPicker = !fixedCampaignId
    && (mode === "analyze" || mode === "variants" || mode === "personalize")
    && (campaigns?.length ?? 0) !== 1;

  return (
    <div data-ai-panel className="space-y-5">
      <p className="text-[12.5px] leading-relaxed text-muted">{t("newsletter.ai.sub")}</p>

      <ChipRow>
        {MODES.map((m) => (
          <Chip key={m.key} icon={m.icon} active={mode === m.key}
            data-ai-mode={m.key} onClick={() => setMode(m.key)}>
            {t(`newsletter.ai.mode.${m.key}`)}
          </Chip>
        ))}
      </ChipRow>

      {/* The picker exists only where there is a choice. Embedded in one
          campaign, a dropdown that could retarget the AI at a different mailing
          is a way to write generated copy into the wrong one. */}
      {showPicker && (
        <div className="panel rounded-2xl p-4">
          <Label htmlFor="ai-campaign" hint={t("newsletter.ai.campaignHint")}>
            {t("newsletter.ai.campaign")}
          </Label>
          {campaigns && campaigns.length > 0 ? (
            <Select id="ai-campaign" value={campaignId} data-ai-campaign
              onChange={(e) => {
                setCampaignId(e.target.value);
                // Results belong to the campaign they were produced from.
                setAnalysis(null); setVariants([]); setSample(null); setEstimate(null); setRun(null);
              }}>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted">{t("newsletter.campaigns.none")}</p>
          )}
        </div>
      )}

      {/* ── WRITE ──────────────────────────────────────────────────────────── */}
      {mode === "write" && (
        <section className="panel space-y-4 rounded-2xl p-4">
          <SectionHeader size="sm" title={t("newsletter.ai.write")} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ai-goal">{t("newsletter.ai.goal")}</Label>
              <Input id="ai-goal" value={goal} data-ai-goal
                placeholder={t("newsletter.ai.goalPlaceholder")}
                onChange={(e) => setGoal(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ai-offer">{t("newsletter.ai.offer")}</Label>
              <Textarea id="ai-offer" value={offer} rows={3} data-ai-offer
                placeholder={t("newsletter.ai.offerPlaceholder")}
                onChange={(e) => setOffer(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ai-audience">{t("newsletter.ai.audience")}</Label>
              <Input id="ai-audience" value={audience} data-ai-audience
                onChange={(e) => setAudience(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ai-tone">{t("newsletter.ai.tone")}</Label>
              <Select id="ai-tone" value={tone} data-ai-tone
                onChange={(e) => setTone(e.target.value)}>
                {TONES.map((key) => (
                  <option key={key} value={key}>{t(`newsletter.ai.tone.${key}`)}</option>
                ))}
              </Select>
            </div>
          </div>

          <Button size="sm" disabled={pending} data-ai-generate
            onClick={() => call<EmailDraft>(
              writeEmailAction({ goal, offer, audience, tone, locale }),
              (data) => {
                setDraft(data);
                setImproved(null);
                // The draft becomes the working text, so the improve actions
                // have something to act on without a copy-paste.
                setBody(data.paragraphs.join("\n\n"));
              },
              t("newsletter.ai.generated"),
            )}>
            {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <WandSparkles size={14} aria-hidden />}
            {t("newsletter.ai.generate")}
          </Button>

          {draft && (
            <div className="space-y-3 border-t border-line pt-4" data-ai-draft>
              <Field label={t("newsletter.editor.subject")} value={draft.subject} onCopy={copy} t={t} />
              <Field label={t("newsletter.editor.preheader")} value={draft.preheader} onCopy={copy} t={t} />
              <Field label={t("newsletter.block.heading")} value={draft.heading} onCopy={copy} t={t} />
              <Field label={t("newsletter.block.button")} value={draft.ctaLabel} onCopy={copy} t={t} />
              <div>
                <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                  {t("newsletter.ai.bodyLabel")}
                </p>
                <div className="space-y-2">
                  {draft.paragraphs.map((p, i) => (
                    <p key={i} className="break-words text-[13px] leading-relaxed text-ink">{p}</p>
                  ))}
                </div>
              </div>
              <Handoff t={t} onApply={onApply} onCopy={copy}
                payload={{
                  subject: draft.subject, preheader: draft.preheader,
                  paragraphs: draft.paragraphs, ctaLabel: draft.ctaLabel,
                }} />
            </div>
          )}
        </section>
      )}

      {/* ── IMPROVE, SUBJECTS, PREHEADERS ──────────────────────────────────── */}
      {mode === "improve" && (
        <section className="panel space-y-4 rounded-2xl p-4">
          <SectionHeader size="sm" title={t("newsletter.ai.improve")} />

          <div>
            <Label htmlFor="ai-body" hint={t("newsletter.ai.bodyHint")}>
              {t("newsletter.ai.bodyLabel")}
            </Label>
            <Textarea id="ai-body" value={body} rows={8} data-ai-body
              placeholder={t("newsletter.ai.bodyPlaceholder")}
              onChange={(e) => setBody(e.target.value)} />
          </div>

          <ChipRow>
            {IMPROVE_ACTIONS.map((action) => (
              <Chip key={action} disabled={pending} data-ai-improve={action}
                onClick={() => call<ImprovedEmail>(
                  improveEmailAction({ body: workingText(), action, locale }),
                  (data) => { setImproved(data); setDraft(null); },
                  t("newsletter.ai.generated"),
                )}>
                {t(`newsletter.ai.action.${action}`)}
              </Chip>
            ))}
            <Chip disabled={pending} data-ai-subjects
              onClick={() => call<string[]>(
                subjectIdeasAction({ context: workingText(), n: 5, locale }),
                setSubjects,
              )}>
              {t("newsletter.ai.action.subjects")}
            </Chip>
            <Chip disabled={pending} data-ai-preheaders
              onClick={() => call<string[]>(
                preheaderIdeasAction({ context: workingText(), n: 5, locale }),
                setPreheaders,
              )}>
              {t("newsletter.ai.action.preheaders")}
            </Chip>
          </ChipRow>

          {pending && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted" data-ai-working>
              <Loader2 size={14} aria-hidden className="animate-spin" />
              {t("newsletter.ai.working")}
            </p>
          )}

          {improved && (
            <div className="space-y-3 border-t border-line pt-4" data-ai-improved>
              {improved.note && (
                <p className="rounded-xl bg-raised px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted">
                  <span className="font-semibold text-ink">{t("newsletter.ai.changed")}: </span>
                  {improved.note}
                </p>
              )}
              <div className="space-y-2">
                {improved.paragraphs.map((p, i) => (
                  <p key={i} className="break-words text-[13px] leading-relaxed text-ink">{p}</p>
                ))}
              </div>
              {improved.ctaLabel && (
                <Field label={t("newsletter.block.button")} value={improved.ctaLabel} onCopy={copy} t={t} />
              )}
              <Handoff t={t} onApply={onApply} onCopy={copy}
                payload={{ paragraphs: improved.paragraphs, ctaLabel: improved.ctaLabel || undefined }} />
            </div>
          )}

          <IdeaList title={t("newsletter.ai.subjectIdeas")} ideas={subjects} t={t}
            onCopy={copy} onApply={onApply ? (v) => onApply({ subject: v }) : undefined}
            testId="ai-subject-idea" />
          <IdeaList title={t("newsletter.ai.preheaderIdeas")} ideas={preheaders} t={t}
            onCopy={copy} onApply={onApply ? (v) => onApply({ preheader: v }) : undefined}
            testId="ai-preheader-idea" />
        </section>
      )}

      {/* ── ANALYSE ────────────────────────────────────────────────────────── */}
      {mode === "analyze" && (
        <section className="panel space-y-4 rounded-2xl p-4">
          <SectionHeader size="sm" title={t("newsletter.ai.analysis")} sub={t("newsletter.ai.analyzeHint")} />

          {!campaignId && (
            <div>
              <Label htmlFor="ai-analyze-body">{t("newsletter.ai.bodyLabel")}</Label>
              <Textarea id="ai-analyze-body" value={body} rows={8} data-ai-analyze-body
                placeholder={t("newsletter.ai.bodyPlaceholder")}
                onChange={(e) => setBody(e.target.value)} />
            </div>
          )}

          <Button size="sm" disabled={pending || (!campaignId && !body.trim())} data-ai-analyze
            onClick={() => call<CampaignAnalysis>(
              analyzeCampaignAction(campaignId ? { campaignId, locale } : { body, locale }),
              setAnalysis,
            )}>
            {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Stethoscope size={14} aria-hidden />}
            {t("newsletter.ai.analyze")}
          </Button>

          {analysis && (
            <div className="space-y-3 border-t border-line pt-4" data-ai-analysis>
              {analysis.summary && (
                <p className="rounded-xl bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-ink">
                  {analysis.summary}
                </p>
              )}
              {analysis.findings.length === 0 ? (
                <p className="text-[12.5px] text-muted">{t("newsletter.ai.noFindings")}</p>
              ) : (
                <ul className="space-y-2.5">
                  {[...analysis.findings]
                    .sort((a, b) => ANALYSIS_ORDER.indexOf(a.area) - ANALYSIS_ORDER.indexOf(b.area))
                    .map((f) => (
                      <li key={f.area} className="plate rounded-xl p-3.5" data-ai-finding={f.area}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold">
                            {t(`newsletter.ai.area.${f.area}`)}
                          </span>
                          <Badge tone={f.verdict === "ok" ? "success" : f.verdict === "warn" ? "warning" : "danger"}>
                            {t(`newsletter.ai.verdict.${f.verdict}`)}
                          </Badge>
                        </div>
                        <p className="mt-1.5 break-words text-[12.5px] leading-relaxed text-muted">{f.finding}</p>
                        {f.fix && (
                          <p className="mt-1.5 break-words text-[12.5px] leading-relaxed text-ink">
                            <span className="font-semibold">{t("newsletter.ai.fix")}: </span>{f.fix}
                          </p>
                        )}
                      </li>
                    ))}
                </ul>
              )}
              {/* The brief forbids a made-up score, and saying so is part of the
                  feature: an operator who expected "94/100" should learn why
                  they are not getting one, rather than assume it is missing. */}
              <p className="text-[11.5px] leading-relaxed text-faint" data-ai-noscore>
                {t("newsletter.ai.noScoreNote")}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── A/B VARIANTS ───────────────────────────────────────────────────── */}
      {mode === "variants" && (
        <section className="panel space-y-4 rounded-2xl p-4">
          <SectionHeader size="sm" title={t("newsletter.ai.variants")} sub={t("newsletter.ai.variantsHint")} />

          {!campaignId && (
            <div>
              <Label htmlFor="ai-variant-body">{t("newsletter.ai.bodyLabel")}</Label>
              <Textarea id="ai-variant-body" value={body} rows={6} data-ai-variant-body
                placeholder={t("newsletter.ai.bodyPlaceholder")}
                onChange={(e) => setBody(e.target.value)} />
            </div>
          )}

          <Button size="sm" disabled={pending || (!campaignId && !body.trim())} data-ai-variants
            onClick={() => call<AbVariantDraft[]>(
              abVariantsAction(campaignId ? { campaignId, n: 2, locale } : { body, n: 2, locale }),
              setVariants,
            )}>
            {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <SplitSquareHorizontal size={14} aria-hidden />}
            {t("newsletter.ai.variants")}
          </Button>

          {variants.length > 0 && (
            <ul className="grid gap-3 border-t border-line pt-4 lg:grid-cols-2" data-ai-variant-list>
              {variants.map((v, i) => (
                <li key={i} className="plate flex flex-col rounded-xl p-3.5" data-ai-variant={i}>
                  <span className="text-[11.5px] font-semibold uppercase tracking-wide text-accent">
                    {t("newsletter.ai.variantLabel", { n: String.fromCharCode(65 + i) })}
                  </span>
                  {v.angle && (
                    <p className="mt-1 break-words text-[12px] leading-relaxed text-muted">
                      <span className="font-semibold text-ink">{t("newsletter.ai.angle")}: </span>{v.angle}
                    </p>
                  )}
                  <p className="mt-2 break-words text-[13px] font-semibold">{v.subject}</p>
                  {v.preheader && (
                    <p className="mt-0.5 break-words text-[12px] text-muted">{v.preheader}</p>
                  )}
                  <div className="mt-2 space-y-1.5">
                    {v.paragraphs.map((p, j) => (
                      <p key={j} className="break-words text-[12.5px] leading-relaxed text-muted">{p}</p>
                    ))}
                  </div>
                  <div className="mt-auto pt-3">
                    <Handoff t={t} onApply={onApply} onCopy={copy}
                      payload={{
                        subject: v.subject, preheader: v.preheader, paragraphs: v.paragraphs,
                      }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── PERSONALISATION ────────────────────────────────────────────────── */}
      {mode === "personalize" && (
        <div className="space-y-5" data-ai-personalize>
          <p className="rounded-2xl border border-line bg-raised px-4 py-3 text-[12.5px] leading-relaxed text-muted">
            {t("newsletter.ai.personalizeHint")}
          </p>

          <StepPanel n={1} overline={t("newsletter.ai.stepSample")} title={t("newsletter.ai.sample")}
            sub={t("newsletter.ai.sampleFirst")}>
            <div className="space-y-3">
              <Button size="sm" disabled={pending || !campaignId} data-ai-sample
                onClick={() => call<{ previews: PersonalizationPreview[] }>(
                  generatePersonalizationSampleAction(campaignId),
                  (data) => setSample(data.previews),
                )}>
                {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Sparkles size={14} aria-hidden />}
                {t("newsletter.ai.sample")}
              </Button>

              {/* What the model was allowed to see, said out loud next to the
                  output it produced. The restriction is enforced server-side by
                  an allowlist; this is where an operator can check it. */}
              <p className="text-[11.5px] leading-relaxed text-faint">{t("newsletter.ai.sees")}</p>

              {sample && (sample.length === 0 ? (
                <p className="text-[12.5px] text-muted">{t("newsletter.ai.sampleEmpty")}</p>
              ) : (
                <ul className="space-y-2.5" data-ai-sample-list>
                  {sample.map((p) => (
                    <li key={p.contactId} className="plate rounded-xl p-3.5">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
                        <span className="font-semibold text-ink">
                          {p.firstName || t("newsletter.ai.noFirstName")}
                        </span>
                        <span>· {t("newsletter.col.locale")}: {p.locale}</span>
                        <span>· {t("newsletter.col.source")}: {p.sourceKey}</span>
                      </p>
                      <p className="mt-1.5 break-words text-[13px] font-semibold">{p.subject}</p>
                      <p className="mt-1 break-words text-[12.5px] leading-relaxed text-muted">{p.intro}</p>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </StepPanel>

          <StepPanel n={2} overline={t("newsletter.ai.stepCost")} title={t("newsletter.ai.batchCost")}>
            <div className="space-y-3">
              <Button size="sm" variant="secondary" disabled={pending || !campaignId} data-ai-estimate
                onClick={() => call<PersonalizationEstimate>(
                  estimatePersonalizationAction(campaignId), setEstimate,
                )}>
                {t("newsletter.ai.estimate")}
              </Button>

              {estimate && (
                <div className="space-y-1.5 text-[13px]" data-ai-estimate-result>
                  <p>
                    <span className="text-muted">{t("newsletter.ai.batchContacts")}: </span>
                    <span className="font-semibold tabular-nums">{estimate.contacts}</span>
                  </p>
                  {estimate.alreadyDone > 0 && (
                    <p className="text-[12.5px] text-muted">
                      {t("newsletter.ai.alreadyDone")}: <span className="tabular-nums">{estimate.alreadyDone}</span>
                    </p>
                  )}
                  {estimate.estimatedCost ? (
                    <>
                      <p>
                        <span className="text-muted">{t("newsletter.ai.batchCost")}: </span>
                        <span className="font-semibold tabular-nums">
                          {formatPrice(estimate.estimatedCost.usdMicrosTotal / 10_000, "USD")}
                        </span>
                      </p>
                      <p className="break-words text-[11.5px] leading-relaxed text-faint">
                        {t("newsletter.ai.costNote", {
                          n: estimate.contacts,
                          model: estimate.estimatedCost.model,
                        })}
                      </p>
                    </>
                  ) : (
                    /* NO PRICE IS NOT "0 $". Nothing in this repository stores
                       token pricing, so a number here would be invented — and
                       this is the one button on the screen that spends money. */
                    <p className="break-words text-[12.5px] leading-relaxed text-muted" data-ai-cost-unknown>
                      {t("newsletter.ai.costUnknown", { model: estimate.model ?? "—" })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </StepPanel>

          <StepPanel n={3} last overline={t("newsletter.ai.stepRun")} title={t("newsletter.ai.batchRun")}>
            <div className="space-y-3">
              {/* The batch cannot be reached before the sample. That ordering IS
                  the feature: a one-click batch over the whole list is exactly
                  what the brief rules out. */}
              <Button size="sm" disabled={pending || !campaignId || !sample} data-ai-batch
                onClick={() => call<PersonalizationRun>(
                  generatePersonalizationAction(campaignId),
                  (data) => {
                    setRun(data);
                    // The remainder changes what the estimate said, so the stale
                    // number is cleared rather than left to contradict it.
                    setEstimate(null);
                  },
                )}>
                {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <UserRoundPen size={14} aria-hidden />}
                {run && run.remaining > 0 ? t("newsletter.ai.continue") : t("newsletter.ai.batchRun")}
              </Button>

              {!sample && (
                <p className="text-[12px] leading-relaxed text-faint">{t("newsletter.ai.sampleFirst")}</p>
              )}

              {run && (
                <div className="space-y-1.5 text-[13px]" data-ai-run>
                  <p className="flex flex-wrap items-center gap-1.5">
                    {run.remaining === 0
                      ? <BadgeCheck size={15} aria-hidden className="text-success" />
                      : <AlertTriangle size={15} aria-hidden className="text-warning" />}
                    <span className="text-muted">{t("newsletter.ai.generated")}: </span>
                    <span className="font-semibold tabular-nums">{run.written}</span>
                  </p>
                  {run.remaining > 0 ? (
                    <p className="break-words text-[12.5px] leading-relaxed text-muted">
                      {t("newsletter.ai.remaining")}: <span className="tabular-nums">{run.remaining}</span>
                      {run.stopped === "budget" && ` — ${t("newsletter.ai.batchPartial")}`}
                      {run.stopped === "error" && ` — ${t("newsletter.err.aiFailed")}`}
                    </p>
                  ) : (
                    <p className="text-[12.5px] text-muted">{t("newsletter.ai.batchDone")}</p>
                  )}
                </div>
              )}
            </div>
          </StepPanel>
        </div>
      )}
    </div>
  );
}

/* ── SMALL PARTS ─────────────────────────────────────────────────────────── */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** One generated line with a copy button. Wraps rather than scrolls, so a long
 *  subject cannot widen the page on a phone. */
function Field({ label, value, onCopy, t }: {
  label: string; value: string; onCopy: (v: string) => void; t: Translate;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{label}</p>
        <p className="break-words text-[13px] text-ink">{value}</p>
      </div>
      <Button size="sm" variant="ghost" aria-label={t("common.copy")}
        className="shrink-0" onClick={() => onCopy(value)}>
        <Copy size={14} aria-hidden />
      </Button>
    </div>
  );
}

/** Insert, or copy where there is nothing to insert into. Never both, and never
 *  an insert button on a screen that cannot insert. */
function Handoff({ payload, onApply, onCopy, t }: {
  payload: AiApplyPayload;
  onApply?: (payload: AiApplyPayload) => void;
  onCopy: (v: string) => void;
  t: Translate;
}) {
  const text = [
    payload.subject, payload.preheader, ...(payload.paragraphs ?? []), payload.ctaLabel,
  ].filter(Boolean).join("\n\n");

  return (
    <div className="flex flex-wrap gap-1.5">
      {onApply ? (
        <Button size="sm" data-ai-apply onClick={() => onApply(payload)}>
          <Check size={14} aria-hidden />{t("newsletter.ai.apply")}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" data-ai-copy onClick={() => onCopy(text)}>
          <Copy size={14} aria-hidden />{t("common.copy")}
        </Button>
      )}
    </div>
  );
}

/** A list of alternatives — subject lines or preheaders. */
function IdeaList({ title, ideas, onCopy, onApply, t, testId }: {
  title: string;
  ideas: string[];
  onCopy: (v: string) => void;
  onApply?: (v: string) => void;
  t: Translate;
  testId: string;
}) {
  if (ideas.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{title}</p>
      <ul className="space-y-1.5">
        {ideas.map((idea, i) => (
          <li key={i} className="plate flex items-start justify-between gap-2 rounded-xl px-3 py-2.5"
            data-idea={testId}>
            <span className="min-w-0 break-words text-[13px]">{idea}</span>
            <span className="flex shrink-0 gap-1">
              {onApply && (
                <Button size="sm" variant="ghost" aria-label={t("newsletter.ai.apply")}
                  onClick={() => onApply(idea)}>
                  <Check size={14} aria-hidden />
                </Button>
              )}
              <Button size="sm" variant="ghost" aria-label={t("common.copy")}
                onClick={() => onCopy(idea)}>
                <Copy size={14} aria-hidden />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

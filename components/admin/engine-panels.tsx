"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { CheckCircle2, CircleAlert, FlaskConical, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  dryRunEngineAction, saveKnowledgeStrategyAction, type DryRunCheck,
} from "@/app/actions/ai-engine";
import type { RequestManifest } from "@/lib/ai/request-manifest";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Testuj konfigurację" — a DRY RUN. The server compiles what production
 * would compile and checks every dependency; no provider is called and no
 * credit moves. A paid test is a deliberate act: the admin runs the tool
 * itself, from their own account.
 */
export function EngineDryRun({ toolKey, toolPath }: { toolKey: string; toolPath: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [checks, setChecks] = useState<DryRunCheck[] | null>(null);
  const [manifest, setManifest] = useState<RequestManifest | null>(null);

  function run() {
    start(async () => {
      const res = await dryRunEngineAction(toolKey);
      if (!res.ok || !res.checks) { toast.error(t("common.error")); return; }
      setChecks(res.checks);
      setManifest(res.manifest ?? null);
    });
  }

  const fails = checks?.filter((c) => c.status === "fail").length ?? 0;
  return (
    <div className="space-y-3" data-dry-run>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={pending}>
          <FlaskConical size={14} aria-hidden />
          {pending ? t("aicc.test.running") : t("aicc.test.run")}
        </Button>
        <span className="text-xs text-muted">{t("aicc.test.dryNote")}</span>
      </div>
      {checks && (
        <>
          <p className={cn("text-[13px] font-semibold", fails ? "text-danger" : "text-success")} data-dry-verdict>
            {fails ? t("aicc.test.verdictFail", { n: fails }) : t("aicc.test.verdictOk")}
          </p>
          <ul className="divide-y divide-line rounded-xl bg-raised">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5 px-3.5 py-2.5 text-[13px]" data-check={c.key} data-status={c.status}>
                {c.status === "ok" ? <CheckCircle2 size={15} aria-hidden className="mt-0.5 shrink-0 text-success" />
                  : c.status === "warn" ? <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
                  : <CircleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-danger" />}
                <span className="min-w-0 break-words">{t(`aicc.test.check.${c.key}`, c.params ?? {})}</span>
              </li>
            ))}
          </ul>
          {manifest && <ManifestView m={manifest} />}
        </>
      )}
      {toolPath && <p className="text-xs leading-relaxed text-faint">{t("aicc.test.liveNote", { path: toolPath })}</p>}
    </div>
  );
}

/**
 * What a real run would send — model, prompt (length and hash, never the
 * text), image handling, request settings — and what the last real run
 * recorded, side by side. Read-only.
 */
function ManifestView({ m }: { m: RequestManifest }) {
  const { t } = useI18n();
  const k = (key: string, vars?: Record<string, string | number>) => t(`aicc.test.manifest.${key}`, vars);
  const yesNo = (v: boolean | null) => (v === null ? "—" : k(v ? "yes" : "no"));
  const short = (h: string | null) => (h ? `${h.slice(0, 12)}…${h.slice(-6)}` : "—");
  const secs = (ms: number) => Math.round(ms / 1000);
  const p = m.prompt;
  const c = m.config;
  const last = m.lastRun;
  const recorded = Boolean(last?.provider);

  const sections: { title: string; rows: [string, string][] }[] = [
    {
      title: k("model"),
      rows: [
        [k("provider"), m.model?.provider ?? "—"],
        [k("name"), m.model?.name ?? "—"],
        [k("identifier"), m.model?.identifier ?? "—"],
        [k("fallback"), m.fallback ?? k("off")],
      ],
    },
    {
      title: k("prompt"),
      rows: [
        [k("promptSource"), k("promptSource.grovbase")],
        [k("source"), k(`source.${p.source}`, { version: p.version ?? "?" })],
        [k("promptMode"), p.source === "published" ? k(p.strict ? "promptMode.strict" : "promptMode.template") : "—"],
        [k("mode"), p.mode],
        [k("policy"), p.policy ? k(`policy.${p.policy}`) : "—"],
        [k("chars"), p.chars === null ? "—" : k("charsValue", { n: p.chars })],
        [k("sha"), short(p.sha256)],
        [k("identical"), p.source !== "published" ? "—" : p.identical === null ? k("identicalWithVars") : yesNo(p.identical)],
        [k("variables"), p.variables.length ? p.variables.map((v) => `{{${v}}}`).join(", ") : "—"],
        [k("resolved"), p.resolved.length ? p.resolved.map((v) => `{{${v}}}`).join(", ") : "—"],
        [k("knowledge"), p.knowledge.length ? p.knowledge.map((v) => `{{${v}}}`).join(", ") : k("knowledgeNone")],
        [k("appended"), p.appended.length ? p.appended.map((a) => k(`appended.${a}`)).join(", ") : k("appended.none")],
      ],
    },
    {
      // Guaranteed by the execution layer itself (and pinned by
      // test:fidelity): GrovBase adds no text of its own anywhere.
      title: k("guarantees"),
      rows: ["hiddenPrefix", "hiddenSuffix", "autoLock", "autoKnowledge", "autoToolText", "fallbackPrompt"]
        .map((g): [string, string] => [k(`g.${g}`), k("no")]),
    },
    {
      title: k("config"),
      rows: [
        [k("operation"), c.operation],
        [k("ratio"), k(`ratio.${c.ratioWhenOriginal}`)],
        [k("ratios"), c.ratios.join(", ") || "—"],
        [k("sizes"), c.sizes.map((s) => `${s.resolution} → ${s.sent ?? k("notSent")}`).join(", ")],
        [k("modalities"), "IMAGE"],
        [k("systemInstruction"), k("notSent")],
        [k("sampling"), k("modelDefault")],
        [k("mediaResolution"), k("modelDefault")],
        [k("thinking"), k("modelDefault")],
        [k("responsePick"), k("responsePickValue")],
        [k("providerOptions"), k("providerOptionsNone")],
        [k("timeout"), c.timeoutMs === null
          ? k("timeoutDefault", { budget: secs(c.budgetMs) })
          : k("timeoutValue", { s: secs(c.timeoutMs), budget: secs(c.budgetMs) })],
        [k("attempts"), k("retryRule", { n: c.maxAttempts })],
      ],
    },
  ];
  if (last && recorded) {
    sections.push({
      title: k("last"),
      rows: [
        [k("when"), new Date(last.at).toLocaleString()],
        [k("identifier"), `${last.provider} / ${last.identifier ?? "—"}`],
        [k("fallbackUsed"), yesNo(last.fallbackUsed)],
        [k("operation"), last.operation ?? "—"],
        [k("policy"), last.policy ? k(`policy.${last.policy}`) : "—"],
        [k("chars"), last.chars === null ? "—" : k("charsValue", { n: last.chars })],
        [k("digest"), short(last.digest)],
        [k("matches"), yesNo(last.matchesPublished)],
        [k("ratioSent"), `${last.ratioRequested ?? "—"} → ${last.ratioSent ?? k("notSent")}`],
        [k("aspectMode"), last.aspectMode ? k(`aspectMode.${last.aspectMode}`) : "—"],
        [k("aspectSource"), last.sourceAspect === null ? "—" : k("aspectSourceValue", { r: last.sourceAspect, to: last.resolvedAspect ?? k("notSent") })],
        [k("sizeSent"), last.sizeSent ?? k("notSent")],
        [k("retries"), String(last.failedAttempts)],
        ...last.inputs.flatMap((i, n): [string, string][] => [
          [k("input", { n: n + 1 }), k("inputValue", {
            mime: i.mime, w: i.width ?? "?", h: i.height ?? "?", kb: Math.round(i.bytes / 1024),
            transform: k(`transform.${i.transform}`),
          })],
          [k("inputSha"), `${short(i.sourceSha256)} → ${i.sentSha256 === i.sourceSha256 ? "=" : short(i.sentSha256)}`],
          [k("inputEqual"), yesNo(i.sentSha256 === i.sourceSha256)],
          [k("inputQuality"), i.megapixels === null ? "—"
            : `${k("megapixels", { mp: i.megapixels })}${i.lowResolution ? ` · ${k("lowSource")}` : ""}`],
        ]),
        ...last.outputs.flatMap((o, n): [string, string][] => [
          [k("output", { n: n + 1 }), k("outputValue", {
            size: o.requestedSize ?? "—", pw: o.providerWidth ?? "?", ph: o.providerHeight ?? "?",
            sw: o.storedWidth ?? "?", sh: o.storedHeight ?? "?", kb: o.storedBytes === null ? "?" : Math.round(o.storedBytes / 1024),
          })],
          [k("transformed"), yesNo(o.transformed)],
          [k("outputSha"), `${short(o.providerSha256)} → ${o.storedSha256 === null ? "—" : o.storedEqual ? "=" : short(o.storedSha256)}`],
          [k("outputEqual"), yesNo(o.storedEqual)],
          [k("drafts"), o.imageParts === null ? "—" : k("draftsValue", { parts: o.imageParts, skipped: o.thoughtSkipped ?? 0, reason: o.finishReason ?? "—" })],
        ]),
      ],
    });
  }

  return (
    <section className="space-y-2" data-manifest>
      <h4 className="text-[13px] font-semibold">{k("title")}</h4>
      <p className="text-xs text-muted">{k("note")}</p>
      {m.workflowEnabled && <p className="text-xs font-medium text-warning" data-manifest-workflow>{k("workflowNote")}</p>}
      <div className="grid gap-2 lg:grid-cols-2">
        {sections.map((sec) => (
          <div key={sec.title} className="rounded-xl bg-raised px-3.5 py-2.5" data-manifest-section={sec.title}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{sec.title}</p>
            <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 text-[12.5px]">
              {sec.rows.map(([label, value], i) => (
                <div key={i} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <div className="rounded-xl bg-raised px-3.5 py-2.5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{k("image")}</p>
          <p className="text-[12.5px] leading-relaxed">{k("imageRule")}</p>
          {!recorded && <p className="mt-2 text-xs text-faint">{last ? k("lastUnrecorded") : k("lastNone")}</p>}
        </div>
      </div>
    </section>
  );
}

/** "Preferuj sprawdzone wyniki" vs "Więcej różnorodności". */
export function KnowledgeStrategyForm({ toolKey, initial }: { toolKey: string; initial: "proven" | "diverse" }) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(initial);
  function save() {
    start(async () => {
      const res = await saveKnowledgeStrategyAction(toolKey, value);
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }
  return (
    <fieldset className="space-y-2" data-strategy>
      <legend className="mb-1 text-sm font-semibold">{t("aicc.strategy.title")}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["proven", "diverse"] as const).map((s) => (
          <label key={s} className={cn(
            "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
            value === s ? "border-accent bg-accent-soft/40" : "border-line hover:border-accent/50",
          )}>
            <input type="radio" name={`${id}-strategy`} checked={value === s} onChange={() => setValue(s)}
              className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--accent))]" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{t(`aicc.strategy.${s}`)}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">{t(`aicc.strategy.${s}Hint`)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button disabled={pending || value === initial} onClick={save}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </fieldset>
  );
}

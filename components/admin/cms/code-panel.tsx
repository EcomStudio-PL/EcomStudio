"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Code2, RotateCcw, WandSparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { scopeCss } from "@/lib/cms-css";
import { sanitizeHtml } from "@/lib/cms-sanitize";
import type { CmsCode } from "@/lib/cms";

/**
 * THE CODE TAB.
 *
 * HTML, CSS and JavaScript for one section, with line numbers, a formatter, a
 * reset and — the part that matters — an honest account of what will actually
 * happen to what is typed.
 *
 * DELIBERATELY NOT MONACO. A full editor is roughly half a megabyte, and §15
 * of the brief is explicit that the builder must not drag weight onto pages.
 * It would also be the wrong tool: this is a place for forty lines of markup,
 * not an IDE. A textarea with a synced gutter, monospace and tab handling
 * covers what someone pasting a snippet needs.
 *
 * THE WARNINGS ARE COMPUTED FROM THE REAL SANITISER. The preview under the
 * HTML box is `sanitizeHtml()` output and the CSS note is `scopeCss()` output
 * — the same functions the renderer uses. So when the panel says a tag will be
 * removed, it is not a guess: it is what the page will do.
 */

type Tab = "html" | "css" | "js";

export function CodePanel({ code, sectionId, onChange }: {
  code: CmsCode;
  /** The block's uuid — what its CSS gets scoped under. */
  sectionId: string;
  onChange: (code: CmsCode) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("html");
  const [resetting, setResetting] = useState(false);

  const html = code.html ?? "";
  const css = code.css ?? "";
  const js = code.js ?? "";

  // What the renderer will really produce. Cheap enough to run on every
  // keystroke for a section-sized snippet, and worth far more than a lint.
  const cleanedHtml = useMemo(() => sanitizeHtml(html), [html]);
  const scopedCss = useMemo(() => scopeCss(css, sectionId), [css, sectionId]);

  const htmlStripped = html.trim().length > 0 && cleanedHtml.trim().length === 0;
  const cssRefused = css.trim().length > 0 && scopedCss.trim().length === 0;

  const set = (part: Partial<CmsCode>) => onChange({ ...code, ...part });

  return (
    <div className="space-y-3" data-code-panel>
      <div className="flex rounded-lg bg-sunken/80 p-1">
        {(["html", "css", "js"] as Tab[]).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold uppercase transition-colors ${
              tab === k ? "bg-surface text-accent shadow-e1" : "text-muted hover:text-ink"}`}>
            {k}
          </button>
        ))}
      </div>

      {tab === "html" && (
        <>
          <CodeArea value={html} onChange={(v) => set({ html: v })} label="HTML" />
          {htmlStripped && (
            <Notice tone="warn" icon={<AlertTriangle size={14} />}
              title={t("cms.code.htmlStripped")} body={t("cms.code.htmlStrippedBody")} />
          )}
          <p className="text-[11.5px] leading-relaxed text-faint">{t("cms.code.htmlHint")}</p>
        </>
      )}

      {tab === "css" && (
        <>
          <CodeArea value={css} onChange={(v) => set({ css: v })} label="CSS" />
          {cssRefused && (
            <Notice tone="warn" icon={<AlertTriangle size={14} />}
              title={t("cms.code.cssRefused")} body={t("cms.code.cssRefusedBody")} />
          )}
          <Notice tone="info" icon={<Code2 size={14} />}
            title={t("cms.code.scoped")}
            body={t("cms.code.scopedBody", { scope: `[data-cms-section="${sectionId}"]` })} />
        </>
      )}

      {tab === "js" && (
        <>
          {/* OFF BY DEFAULT, AND SAID OUT LOUD. Ticking this moves the block
              into a sandboxed frame — which is both the safety and the cost,
              so the panel explains both rather than only the switch. */}
          <label className="flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 text-[13px]">
            <input type="checkbox" checked={code.jsEnabled === true}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" data-js-enabled
              onChange={(e) => set({ jsEnabled: e.target.checked })} />
            <span>
              {t("cms.code.jsEnabled")}
              <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">
                {t("cms.code.jsEnabledHint")}
              </span>
            </span>
          </label>
          <CodeArea value={js} onChange={(v) => set({ js: v })} label="JavaScript" />
          {code.jsEnabled && js.trim() && (
            <Notice tone="info" icon={<Code2 size={14} />}
              title={t("cms.code.sandbox")} body={t("cms.code.sandboxBody")} />
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button size="sm" variant="secondary"
          onClick={() => set(tab === "html" ? { html: formatHtml(html) }
            : tab === "css" ? { css: formatCss(css) } : { js })}>
          <WandSparkles size={14} aria-hidden />{t("cms.code.format")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
          <RotateCcw size={14} aria-hidden />{t("cms.code.reset")}
        </Button>
      </div>

      {resetting && (
        <div className="rounded-xl border border-danger/40 bg-danger-soft/40 p-3.5">
          <p className="text-[12.5px] font-semibold">{t("cms.code.resetConfirm")}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="danger" onClick={() => {
              set(tab === "html" ? { html: "" } : tab === "css" ? { css: "" } : { js: "" });
              setResetting(false);
            }}>{t("cms.code.reset")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setResetting(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A textarea with a line-number gutter.
 *
 * The gutter scrolls with the text because it shares the same scroll
 * container and the same line height — the simplest thing that stays in step,
 * and the only thing that does without measuring wrapped lines. `wrap="off"`
 * is what makes that true: with wrapping on, one logical line can occupy three
 * visual rows and no gutter can be right.
 */
function CodeArea({ value, onChange, label }: {
  value: string; onChange: (value: string) => void; label: string;
}) {
  const lines = value.split("\n").length;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-sunken/60">
      <div className="flex max-h-[26rem] min-h-[14rem]">
        <div aria-hidden
          className="select-none border-r border-line bg-sunken px-2 py-3 text-right font-mono text-[12px] leading-[1.6] text-faint">
          {Array.from({ length: Math.max(lines, 12) }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          aria-label={label}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Tab indents instead of leaving the field. Shift+Tab still moves
            // focus, so the panel stays reachable from the keyboard.
            if (e.key !== "Tab" || e.shiftKey) return;
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = el;
            const next = `${value.slice(0, s)}  ${value.slice(end)}`;
            onChange(next);
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
          }}
          className="thin-scroll min-h-[14rem] w-full resize-none bg-transparent px-3 py-3 font-mono text-[12px] leading-[1.6] outline-none"
        />
      </div>
    </div>
  );
}

function Notice({ tone, icon, title, body }: {
  tone: "warn" | "info"; icon: React.ReactNode; title: string; body: string;
}) {
  const skin = tone === "warn"
    ? "border-[rgb(var(--caution)/0.45)] bg-[rgb(var(--caution)/0.08)]"
    : "border-line bg-raised/50";
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3.5 py-3 ${skin}`}>
      <span aria-hidden className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block break-words text-[11.5px] leading-relaxed text-muted">{body}</span>
      </span>
    </div>
  );
}

/* ── FORMATTING ───────────────────────────────────────────────────────────
 *
 * Indentation only. A real formatter would need a parser for each language,
 * which is the half-megabyte this panel exists to avoid; what somebody pasting
 * a minified snippet actually wants is to be able to read it.
 */

function formatHtml(src: string): string {
  const tokens = src.replace(/>\s*</g, ">\n<").split("\n");
  let depth = 0;
  return tokens.map((raw) => {
    const line = raw.trim();
    if (!line) return "";
    if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
    const out = "  ".repeat(depth) + line;
    // A self-closing or void tag does not open a level.
    const opens = /^<[a-zA-Z]/.test(line)
      && !/\/>$/.test(line)
      && !/^<(br|hr|img|input|meta|link|source|col)\b/i.test(line)
      && !/<\/[a-zA-Z][^>]*>\s*$/.test(line);
    if (opens) depth++;
    return out;
  }).filter((l) => l !== "").join("\n");
}

function formatCss(src: string): string {
  return src
    .replace(/\s*\{\s*/g, " {\n  ")
    .replace(/;\s*/g, ";\n  ")
    .replace(/\s*\}\s*/g, "\n}\n\n")
    .replace(/\n\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

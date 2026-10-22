"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { Download, ExternalLink, Eye, EyeOff, FileUp, Maximize2, Minimize2, Wand2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { LegalText } from "@/components/legal/legal-text";
import { LEGAL_LOCALES, type LegalLocale } from "@/lib/legal/docs";
import {
  MAX_LEGAL_CHARS, emptyLocaleDoc, legalCharCount, legalHeaderFacts, normalizeLegalText, readLegalDoc,
  type LegalDocContent, type LegalLocaleDoc, type LegalStatus,
} from "@/lib/legal/content";
import { parseLegalText } from "@/lib/legal/document";
import type { CmsBlockContent } from "@/lib/cms";
import { cn, formatBytes } from "@/lib/utils";

/**
 * A LEGAL DOCUMENT IN THE BUILDER — one language of a `legal` section's `doc`.
 *
 * The Regulamin is 75 000 characters, and the next version may be three times
 * that. So this is not a text field with a document pasted into it: it is the
 * document's own editor, for the language tab the builder is on —
 *
 *   status (Aktywny / Wkrótce), version and effective date, each language its
 *   own; the whole text in a large monospace box with NO length cap of its
 *   own (the server's guard is lib/legal/content.ts MAX_LEGAL_CHARS); a .txt
 *   upload; a live counter; the digest the server stored; a download of what
 *   is saved; and a preview drawn by the very component the public page uses.
 *
 * THE TEXT IS NEVER REWRITTEN HERE. A pasted or uploaded document keeps every
 * character; the only changes are the technical ones normalizeLegalText makes
 * (line endings, a leading BOM) — the server makes the same ones again.
 *
 * TYPING STAYS CHEAP at 250 000 characters: a keystroke updates the section
 * (the builder autosaves it a moment after typing stops) and nothing else
 * runs at the speed of the keyboard. The counter, the digest and the preview
 * read a DEFERRED copy of the text, the digest after a pause, and the
 * preview only while it is open.
 */

/** A file bigger than this is not a text document (a Regulamin is ~100 kB). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** U+FFFD, what a UTF-8 decoder writes for bytes that are not UTF-8. */
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

type Pending = { name: string; size: number; text: string; notUtf8: boolean };

const blankDoc = (): LegalDocContent => ({ pl: emptyLocaleDoc(), en: emptyLocaleDoc(), de: emptyLocaleDoc() });

const intlLocale = (ui: string) => (ui === "pl" ? "pl-PL" : ui === "de" ? "de-DE" : "en-GB");

/** Whether a text has anything but whitespace — without copying a 250 000-
 *  character string the way `.trim()` would, on every keystroke. */
const hasText = (s: string) => /\S/.test(s);

/** Lines as an editor counts them: a final line break does not start a new
 *  (empty) line, and an empty text has none. */
function lineCount(text: string): number {
  if (text === "") return 0;
  let n = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n += 1;
  return text.endsWith("\n") ? n : n + 1;
}

/** The section's content with a new document, every other key untouched. */
function withDoc(content: CmsBlockContent, doc: LegalDocContent): CmsBlockContent {
  const next: CmsBlockContent & { doc: LegalDocContent } = { ...content, doc };
  return next;
}

/** SHA-256 of the text as the browser holds it, a moment after it stops
 *  changing — the same digest the server writes on save (UTF-8, hex). */
function useSha256(text: string): string | null {
  const [result, setResult] = useState<{ text: string; hex: string } | null>(null);
  useEffect(() => {
    if (!text || typeof crypto === "undefined" || !crypto.subtle) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((buf) => {
        if (cancelled) return;
        setResult({ text, hex: Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("") });
      }).catch(() => undefined);
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text]);
  return result && result.text === text ? result.hex : null;
}

export function LegalDocField({ label, hint, locale, content, onChange }: {
  label: string;
  hint?: string;
  /** The builder's language tab: the language this editor shows. */
  locale: LegalLocale;
  content: CmsBlockContent;
  onChange: (content: CmsBlockContent) => void;
}) {
  const { t, locale: ui } = useI18n();
  // The builder lives at /admin/www/<slug>: the page this section belongs to,
  // for the download and the draft preview links.
  const params = useParams();
  const slug = typeof params?.slug === "string" ? params.slug : null;

  // An old `legal` section (html / description, no doc) opens as an empty
  // document, every language "soon" — nothing is written until it is edited.
  const doc = useMemo(() => readLegalDoc(content) ?? blankDoc(), [content]);
  const entry = doc[locale];

  const deferred = useDeferredValue(entry.text);
  const chars = useMemo(() => legalCharCount(deferred), [deferred]);
  const lines = useMemo(() => lineCount(deferred), [deferred]);
  const sha = useSha256(deferred);

  const [preview, setPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState<{ locale: LegalLocale; name: string; size: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const outline = useMemo(() => (preview ? parseLegalText(deferred) : null), [preview, deferred]);

  useEffect(() => {
    // Escape leaves the full-screen editor — unless a dialog is open over
    // it, which Escape closes first.
    if (!expanded || pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, pending]);

  const nf = useMemo(() => new Intl.NumberFormat(intlLocale(ui)), [ui]);
  const plurals = useMemo(() => new Intl.PluralRules(intlLocale(ui)), [ui]);
  /** "75 255 znaków", "1 wiersz" — the language's own plural forms. */
  const count = (base: "chars" | "lines", n: number) =>
    t(`cms.legalDoc.${base}.${plurals.select(n)}`, { n: nf.format(n) });

  const setEntry = (next: LegalLocaleDoc) => onChange(withDoc(content, { ...doc, [locale]: next }));
  // A new text drops the stored digests: they described the old one, and the
  // server writes the new ones on the next save anyway.
  const setText = (raw: string) => {
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    setEntry({ status: entry.status, version: entry.version, effective: entry.effective, text });
  };
  const setMeta = (patch: Partial<Pick<LegalLocaleDoc, "status" | "version" | "effective">>) =>
    setEntry({ ...entry, ...patch });

  function apply(file: Pending) {
    setPending(null);
    setText(file.text);
    setLoaded({ locale, name: file.name, size: file.size });
    toast.success(t("cms.legalDoc.uploadLoaded", { name: file.name, size: formatBytes(file.size) }));
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared, so choosing the same file again (after fixing it) fires again.
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t("cms.legalDoc.fileTooLarge", { max: nf.format(MAX_LEGAL_CHARS) }));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error(t("cms.legalDoc.fileReadError"));
    reader.onload = () => {
      const text = normalizeLegalText(typeof reader.result === "string" ? reader.result : "");
      if (legalCharCount(text) > MAX_LEGAL_CHARS) {
        toast.error(t("cms.legalDoc.fileTooLarge", { max: nf.format(MAX_LEGAL_CHARS) }));
        return;
      }
      // U+FFFD is what a decoder writes for bytes that are not UTF-8: a file
      // saved as Windows-1250 would arrive with every "ą" replaced by it.
      const next: Pending = { name: file.name, size: file.size, text, notUtf8: text.includes(REPLACEMENT_CHAR) };
      if (next.notUtf8 || (entry.text !== "" && entry.text !== text)) setPending(next);
      else apply(next);
    };
    reader.readAsText(file, "utf-8");
  }

  function fillFromHeader() {
    const facts = legalHeaderFacts(entry.text);
    if (!facts.version && !facts.effective) { toast.error(t("cms.legalDoc.fillNone")); return; }
    setMeta({
      ...(facts.version ? { version: facts.version } : {}),
      ...(facts.effective ? { effective: facts.effective } : {}),
    });
    toast.success(t("cms.legalDoc.fillDone", { version: facts.version ?? "—", date: facts.effective ?? "—" }));
  }

  const id = `cms-legal-${locale}`;
  const activeEmpty = entry.status === "active" && !hasText(entry.text);
  const download = slug ? `/admin/www/${slug}/dokument?locale=${locale}` : null;

  const editor = (
    <div data-legal-doc-field={locale} data-legal-expanded={expanded ? "1" : undefined}>
      <div className={cn("space-y-3.5", expanded && "mx-auto max-w-[1400px]")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor={`${id}-text`} hint={locale.toUpperCase()}>{label}</Label>
            {hint && <p className="-mt-0.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
          </div>
          <button type="button" onClick={() => setExpanded((v) => !v)} data-legal-expand
            title={t(expanded ? "cms.legalDoc.collapse" : "cms.legalDoc.expand")}
            aria-label={t(expanded ? "cms.legalDoc.collapse" : "cms.legalDoc.expand")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
            {expanded ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
          </button>
        </div>

        {/* ALL THREE LANGUAGES AT A GLANCE. Each is its own document: the
            Polish one can be live while English is still "soon". */}
        <div data-legal-languages>
          <p className="mb-1.5 text-[11.5px] font-semibold text-muted">{t("cms.legalDoc.languages")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {LEGAL_LOCALES.map((l) => {
              const e = doc[l];
              const on = e.status === "active" && hasText(e.text);
              return (
                <li key={l} data-legal-chip={l} data-legal-chip-status={e.status}
                  className={cn("rounded-lg border px-2 py-1 text-[11.5px] leading-tight",
                    l === locale ? "border-accent/50 bg-accent-soft/40" : "border-line",
                    on ? "text-ink" : "text-muted")}>
                  <span className="font-semibold uppercase">{l}</span>
                  {" · "}
                  {t(e.status === "active" ? "cms.legalDoc.statusActive" : "cms.legalDoc.statusSoon")}
                  {e.version && <span className="tabular-nums"> · v{e.version}</span>}
                  {e.text === "" && <span className="text-faint"> · {t("cms.legalDoc.noText")}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`${id}-status`}>{t("cms.legalDoc.status")}</Label>
            <Select id={`${id}-status`} value={entry.status} data-legal-status
              onChange={(e) => setMeta({ status: e.target.value as LegalStatus })}>
              <option value="active">{t("cms.legalDoc.statusActive")}</option>
              <option value="soon">{t("cms.legalDoc.statusSoon")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-version`}>{t("cms.legalDoc.version")}</Label>
            <Input id={`${id}-version`} value={entry.version} spellCheck={false} data-legal-version
              placeholder={t("cms.legalDoc.versionPlaceholder")}
              onChange={(e) => setMeta({ version: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${id}-effective`}>{t("cms.legalDoc.effective")}</Label>
            <Input id={`${id}-effective`} type="date" value={entry.effective ?? ""} data-legal-effective
              onChange={(e) => setMeta({ effective: e.target.value || null })} />
          </div>
        </div>
        {entry.status === "soon" && (
          <p className="text-[11.5px] leading-relaxed text-faint">{t("cms.legalDoc.statusSoonHint")}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} data-legal-upload>
            <FileUp size={14} aria-hidden />{t("cms.legalDoc.upload")}
          </Button>
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={pickFile}
            data-legal-file tabIndex={-1} aria-hidden />
          <Button size="sm" variant="secondary" onClick={fillFromHeader} disabled={entry.text === ""} data-legal-fill>
            <Wand2 size={14} aria-hidden />{t("cms.legalDoc.fillFromHeader")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPreview((v) => !v)} aria-pressed={preview}
            data-legal-preview-toggle>
            {preview ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            {t(preview ? "cms.legalDoc.previewHide" : "cms.legalDoc.preview")}
          </Button>
          {download && (
            <a href={download} data-legal-download
              className="plate inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-raised">
              <Download size={14} aria-hidden />{t("cms.legalDoc.download")}
            </a>
          )}
          {slug && (
            <a href={`/podglad/${slug}`} target="_blank" rel="noreferrer" data-legal-page-preview
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
              {t("cms.legalDoc.previewPage")}<ExternalLink size={12} aria-hidden />
            </a>
          )}
        </div>
        {loaded && loaded.locale === locale && (
          <p className="text-[11.5px] text-muted" data-legal-loaded>
            {t("cms.legalDoc.loadedFile", { name: loaded.name, size: formatBytes(loaded.size) })}
          </p>
        )}

        <div className={cn("grid gap-3", preview && expanded && "lg:grid-cols-2")}>
          <div className="min-w-0">
            <Textarea id={`${id}-text`} value={entry.text} rows={24} spellCheck={false} autoCorrect="off"
              autoCapitalize="off" data-legal-doc-text placeholder={t("cms.legalDoc.textPlaceholder")}
              className={cn("resize-y font-mono leading-relaxed", expanded ? "min-h-[70vh]" : "min-h-[24rem]")}
              onChange={(e) => setText(e.target.value)} />
            <p className="mt-1.5 flex flex-wrap gap-x-2 text-[11.5px] tabular-nums text-muted" data-legal-counter
              data-chars={chars} data-lines={lines}>
              <span>{count("chars", chars)} · {count("lines", lines)}</span>
              {sha && <span className="text-faint" data-legal-sha={sha}>{t("cms.legalDoc.liveSha", { sha: sha.slice(0, 12) })}</span>}
            </p>
            {entry.sha256 && (
              <p className="mt-0.5 text-[11.5px] tabular-nums text-faint" data-legal-saved-sha={entry.sha256}>
                {t("cms.legalDoc.savedDigest", {
                  chars: count("chars", entry.chars ?? legalCharCount(entry.text)), sha: `${entry.sha256.slice(0, 12)}…`,
                })}
                {sha === entry.sha256 && <span className="text-success"> ✓ {t("cms.legalDoc.savedMatches")}</span>}
              </p>
            )}
            {activeEmpty && (
              <p className="mt-1.5 text-[11.5px] font-medium text-warning" data-legal-active-empty>
                {t("cms.legalDoc.activeEmpty")}
              </p>
            )}
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{t("cms.legalDoc.verbatimNote")}</p>
          </div>

          {preview && (
            <div className="min-w-0" data-legal-preview>
              <div className={cn("thin-scroll overflow-y-auto rounded-xl border border-line bg-bg px-4 py-4 sm:px-6",
                expanded ? "max-h-[78vh]" : "max-h-[60vh]")}>
                {outline && outline.nodes.length > 0
                  ? <LegalText outline={outline} lang={locale} />
                  : <p className="text-center text-[12.5px] text-faint">{t("cms.legalDoc.previewEmpty")}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* In place while full screen (the overlay is already at the body, and a
          portalled dialog would open BEHIND it); at the body otherwise, out
          of the builder's filtered panel. */}
      <ConfirmModal open={!!pending} onClose={() => setPending(null)} portal={!expanded}
        onConfirm={() => { if (pending) apply(pending); }}
        title={t(pending?.notUtf8 ? "cms.legalDoc.notUtf8Title" : "cms.legalDoc.replaceTitle")}
        body={pending
          ? [
            pending.notUtf8 ? t("cms.legalDoc.notUtf8Body", { name: pending.name }) : "",
            entry.text !== "" && entry.text !== pending.text
              ? t("cms.legalDoc.replaceBody", { name: pending.name, chars: count("chars", legalCharCount(entry.text)) })
              : "",
          ].filter(Boolean).join(" ")
          : ""}
        confirmLabel={t(pending?.notUtf8 ? "cms.legalDoc.notUtf8Confirm" : "cms.legalDoc.replaceConfirm")}
        danger={pending?.notUtf8} />
    </div>
  );

  /*
    FULL SCREEN, because the builder's settings column is 400px wide and a
    75 000-character document deserves the whole window. The overlay goes to
    the body: the column sits in a `.panel`, whose backdrop-filter would pin a
    fixed element to the panel instead of the viewport (components/ui/modal.tsx
    explains the trap). Same component, same state — only where it is drawn.
  */
  if (expanded && typeof document !== "undefined") {
    return createPortal(
      <div className="thin-scroll fixed inset-0 z-[70] overflow-y-auto bg-bg p-3 sm:p-5" data-legal-fullscreen>
        {editor}
      </div>,
      document.body,
    );
  }
  return editor;
}

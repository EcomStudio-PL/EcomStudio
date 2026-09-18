"use client";
import { useRef, useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { formatBytes } from "@/lib/utils";
import {
  commitImportAction, previewImportAction, type ImportPreview,
} from "@/app/actions/newsletter";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

/**
 * CSV IMPORT — count first, write second.
 *
 * §12 asks for a preview before anything is committed, and the reason is that
 * an import is the ONE operation in this module an operator cannot undo by
 * clicking something. Knowing "1 240 new, 88 already here, 3 unreadable, 2
 * blocked" before the write is what makes the write safe to make; finding out
 * afterwards means restoring a contact list from a backup.
 *
 * THE FIVE COUNTS ADD UP AND THEY ARE MEANT TO BE READ AS A SUM. New +
 * already-here + blocked + unreadable is every data line in the file, so an
 * operator can check the total against what they think they handed over. A
 * preview whose parts do not reconcile teaches people to ignore it.
 *
 * THE FILE IS SENT TWICE, on purpose. There is no staging table and no
 * temporary upload: the preview posts the text, and committing posts the same
 * text again to `commitImportAction`, which parses it with the same function.
 * The alternative — remembering a parse on the server between two round trips —
 * buys one upload and costs a place where "what was previewed" and "what was
 * written" can drift apart, which is the only property this dialog exists to
 * guarantee.
 *
 * FOUR MEGABYTES, and the number is not arbitrary: server actions in this app
 * accept a 4.5 MB body (next.config.mjs), and a file over that would fail
 * somewhere in the framework with an error the operator cannot act on. Refusing
 * it here, by name and with the limit stated, is the difference between "too
 * big, split it" and "something went wrong".
 */

const MAX_BYTES = 4 * 1024 * 1024;

type Option = { key: string; name: string };
type GroupOption = { id: string; name: string };

export function ImportDialog({ open, onClose, sources, groups, onDone }: {
  open: boolean;
  onClose: () => void;
  sources: Option[];
  /** Static groups only — imported contacts land in a list, never in a segment. */
  groups: GroupOption[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const picker = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  // Kept from the File rather than measured off the string: `new Blob([csv])`
  // re-encodes four megabytes on every keystroke in this dialog.
  const [fileSize, setFileSize] = useState(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sourceKey, setSourceKey] = useState("");
  const [groupId, setGroupId] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentVersion, setConsentVersion] = useState("v1");

  function reset() {
    setCsv(""); setFileName(""); setFileSize(0); setPreview(null);
    setSourceKey(""); setGroupId(""); setConsent(false); setConsentVersion("v1");
    if (picker.current) picker.current.value = "";
  }

  function close() { reset(); onClose(); }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) { toast.error(t("newsletter.import.tooLarge")); return; }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setFileSize(file.size);
    start(async () => {
      const res = await previewImportAction({ csv: text });
      if (!res.ok) { toast.error(t(`newsletter.err.${res.error}`)); return; }
      setPreview(res.data ?? null);
    });
  }

  function commit() {
    start(async () => {
      const res = await commitImportAction({
        csv,
        sourceKey: sourceKey || undefined,
        groupIds: groupId ? [groupId] : [],
        consent,
        consentVersion: consent ? consentVersion : null,
      });
      if (!res.ok) { toast.error(t(`newsletter.err.${res.error}`)); return; }
      toast.success(t("newsletter.import.done", {
        created: res.data?.created ?? 0,
        updated: res.data?.updated ?? 0,
        skipped: res.data?.skipped ?? 0,
      }));
      reset();
      onDone();
    });
  }

  /** Nothing in the file this module can use. Not an error — a file with the
   *  wrong column, or a list of names with no addresses — so it is said plainly
   *  and the operator can pick another file without leaving the dialog. */
  const unusable = preview !== null
    && preview.valid === 0 && preview.duplicates === 0 && preview.suppressed === 0;

  return (
    <Modal open={open} onClose={close} title={t("newsletter.import.title")} wide>
      <div className="space-y-4">
        {/* ── THE FILE ───────────────────────────────────────────────────── */}
        <div>
          <input ref={picker} type="file" accept=".csv,text/csv,text/plain" className="hidden"
            // The picker is emptied as soon as the File is in hand: a file
            // input fires no change event when the SAME file is chosen again,
            // so an operator who fixes a column in Excel and re-picks the file
            // would otherwise get silence and the old preview.
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void pick(file);
            }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={pending}
              data-import-pick onClick={() => picker.current?.click()}>
              <FileUp size={14} aria-hidden />{t("newsletter.import.pick")}
            </Button>
            {fileName && (
              <span className="min-w-0 break-all text-[12.5px] text-muted">
                {fileName} · {formatBytes(fileSize)}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            {t("newsletter.import.hint")}
          </p>
        </div>

        {unusable && (
          <p className="text-[13px] font-medium text-warning">{t("newsletter.import.empty")}</p>
        )}

        {preview && !unusable && (
          <>
            {/* ── WHAT COMMITTING WOULD DO ─────────────────────────────────
                Two across on a phone, four from `sm`: five numbers in one row
                at 320px is five numbers nobody reads. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Count label={t("newsletter.import.total")} value={preview.total} />
              <Count label={t("newsletter.import.valid")} value={preview.valid} tone="accent" />
              <Count label={t("newsletter.import.duplicates")} value={preview.duplicates} />
              <Count label={t("newsletter.import.invalid")} value={preview.invalid} />
              <Count label={t("newsletter.import.suppressed")} value={preview.suppressed} />
            </div>

            {/* ── THE FIRST ROWS, AS WE READ THEM ──────────────────────────
                The point is not the data, it is the COLUMN MAPPING: an
                operator can see here that "Imię" landed in the first-name
                field before four thousand contacts land the other way round. */}
            {preview.sample.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                  {t("newsletter.import.sample")}
                </p>
                <ul className="thin-scroll max-h-44 space-y-1 overflow-y-auto">
                  {preview.sample.map((row) => (
                    <li key={row.email}
                      className="plate flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2.5 py-1.5 text-[12.5px]">
                      <span className="break-all font-medium">{row.email}</span>
                      <span className="text-muted">
                        {[row.firstName, row.lastName].filter(Boolean).join(" ")}
                      </span>
                      <span className="ml-auto uppercase text-faint">{row.locale}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── HOW THEY LAND ────────────────────────────────────────── */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="imp-source">{t("newsletter.filter.source")}</Label>
                <Select id="imp-source" value={sourceKey}
                  onChange={(e) => setSourceKey(e.target.value)}>
                  <option value="">—</option>
                  {sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </Select>
              </div>
              {groups.length > 0 && (
                <div>
                  <Label htmlFor="imp-group">{t("newsletter.filter.group")}</Label>
                  <Select id="imp-group" value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}>
                    <option value="">—</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </Select>
                </div>
              )}
            </div>

            {/* ── THE ASSERTION ────────────────────────────────────────────
                Unticked by default, and it stays that way: a checkbox that
                defaults to "they all agreed" is a checkbox that turns every
                bought list into a consented one by inattention. */}
            <div className="plate rounded-xl p-3">
              <label className="flex items-start gap-2.5 text-[13px] font-semibold">
                <input type="checkbox" checked={consent} data-import-consent
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
                {t("newsletter.import.consent")}
              </label>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                {t("newsletter.import.consentHint")}
              </p>
              {consent && (
                <div className="mt-3">
                  <Label htmlFor="imp-version">{t("newsletter.consent.version")}</Label>
                  <Input id="imp-version" value={consentVersion}
                    onChange={(e) => setConsentVersion(e.target.value)} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
        <Button data-import-commit
          disabled={pending || !preview || unusable || preview.valid + preview.duplicates === 0}
          onClick={commit}>
          {pending ? t("common.saving") : t("newsletter.import.commit")}
        </Button>
      </div>
    </Modal>
  );
}

/** One of the five preview numbers. The label wraps and the number never
 *  truncates — a count that reads "1 2…" is worse than no count. */
function Count({ label, value, tone }: { label: string; value: number; tone?: "accent" }) {
  return (
    <div className="plate rounded-xl px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-faint">
        {label}
      </p>
      <p className={`metric mt-1 text-[1.25rem] leading-none ${tone === "accent" ? "text-accent" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

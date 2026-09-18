"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { previewCampaignAction } from "@/app/actions/newsletter";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";

/**
 * KROK 4 — THE REAL MESSAGE, RENDERED BY THE THING THAT SENDS IT.
 *
 * WHY AN IFRAME AND NOT `dangerouslySetInnerHTML`. An email body is a full
 * document with its own table layout, its own background and its own inline
 * styles, and dropping it into the admin panel's DOM means two things at once:
 * the mail inherits the panel's typography — so the preview flatters it and
 * lies about line lengths — and the panel inherits whatever the mail brought
 * with it. The second is the serious one. Part of this body came from a public
 * signup form (a first name interpolated by `applyMerge`) and part of it may
 * be a document an operator pasted, so it is untrusted content being shown in
 * an authenticated admin origin. A frame is the boundary that makes that safe.
 *
 * `sandbox=""` — the EMPTY string, which is the most restrictive value there
 * is, not an omitted attribute. No scripts, no forms, no plugins, no top-level
 * navigation, and a unique opaque origin so the document cannot touch this
 * page's cookies or storage even if it somehow ran. §4's "podgląd w iframe z
 * sandbox (bez skryptów)" is exactly this, and `srcDoc` keeps the whole thing
 * in memory rather than parking a rendered campaign on a URL.
 *
 * THE RENDERING HAPPENS ON THE SERVER, in `renderCampaign`, through
 * `previewCampaignAction` — see the note there for why a browser-side
 * approximation would eventually stop matching what is posted.
 *
 * "PODGLĄD JAKO" IS THE POINT OF THE STEP. The default is the EMPTY case, on
 * purpose: a merge tag with no value is what the contact who never filled in
 * their name receives, and "Cześć ," is the single most recognisable sign of a
 * broken mailing. Picking a real contact then shows the other half — that the
 * tags resolve at all, and in that contact's own language, because the footer
 * follows the recipient rather than the operator.
 */

export type PreviewContact = { id: string; email: string; name: string };

type Rendered = { subject: string; preheader: string; html: string };

export function MailPreview({ campaignId, stepId, contacts, version }: {
  campaignId: string;
  /** Which message of the campaign. Omitted = the first step. */
  stepId?: string;
  contacts: PreviewContact[];
  /** Bumped by the wizard after it saves, so the frame re-renders the version
   *  that is now in the database rather than the one it drew before the edit. */
  version: number;
}) {
  const { t } = useI18n();
  const [contactId, setContactId] = useState("");
  const [mail, setMail] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Same guard the audience panel uses: a slow answer for the previous
   *  contact must not overwrite the one the operator is now looking at. */
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    const res = await previewCampaignAction({
      campaignId,
      stepId,
      contactId: contactId || undefined,
    });
    if (ticket !== latest.current) return;
    if (res.ok && res.data) {
      setMail({ subject: res.data.subject, preheader: res.data.preheader, html: res.data.html });
      setError(null);
    } else {
      setMail(null);
      setError(res.ok ? "generic" : res.error);
    }
    setLoading(false);
  }, [campaignId, stepId, contactId]);

  useEffect(() => { void load(); }, [load, version]);

  return (
    <div className="space-y-3" data-mail-preview>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <Label htmlFor="preview-as">{t("newsletter.preview.as")}</Label>
          <Select id="preview-as" value={contactId} data-preview-as
            onChange={(e) => setContactId(e.target.value)}>
            <option value="">{t("newsletter.preview.default")}</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name ? `${contact.name} · ${contact.email}` : contact.email}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" variant="secondary" disabled={loading} data-preview-refresh
          onClick={() => { void load(); }}>
          {loading
            ? <Loader2 size={14} aria-hidden className="animate-spin" />
            : <RefreshCw size={14} aria-hidden />}
          {t("newsletter.preview.refresh")}
        </Button>
      </div>

      {/* An empty body is not an error the operator has to decode — it is a
          campaign that has not been written yet, and it says so. Every other
          failure keeps its own sentence from the shared error vocabulary. */}
      {error && (
        <p className="plate rounded-xl px-3.5 py-6 text-center text-[12.5px] text-muted"
          data-preview-error={error}>
          {error === "body" ? t("newsletter.preview.empty") : t(`newsletter.err.${error}`)}
        </p>
      )}

      {mail && (
        <>
          {/* The subject and the preheader are part of what is being approved:
              they are what the inbox list shows, and a merge tag that failed to
              resolve fails there first. */}
          <div className="plate min-w-0 rounded-xl px-3.5 py-3">
            <p className="break-words text-[13px] font-semibold" data-preview-subject>
              {mail.subject || "—"}
            </p>
            <p className="mt-0.5 break-words text-[12px] text-muted" data-preview-preheader>
              {mail.preheader || "—"}
            </p>
          </div>

          <iframe
            data-preview-frame
            title={t("newsletter.step.preview")}
            srcDoc={mail.html}
            sandbox=""
            loading="lazy"
            className="h-[60dvh] min-h-[380px] w-full rounded-2xl border border-line bg-white"
          />
        </>
      )}

      <p className="text-[11.5px] leading-relaxed text-faint" data-preview-note>
        {t("newsletter.preview.note")}
      </p>
    </div>
  );
}

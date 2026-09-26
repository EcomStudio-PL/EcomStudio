"use client";
import { useState, useTransition } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { clearSourceSecretAction } from "@/app/actions/grovnews-research";
import { AUTH_KINDS, isValidAuthHeader, type SourceAuthKind } from "@/lib/grovnews-research";

/**
 * API SOURCE AUTHORIZATION (0128) — None / Bearer token / a key in a header.
 *
 * The secret field is WRITE-ONLY: what an admin types is sent once, with the
 * source's save, straight to the vault (saveSourceSecretAction) and never
 * comes back. The page only ever learns whether one is stored and its last
 * four characters (cut in the database). Removing it is its own action.
 */

export type SourceSecretState = { configured: boolean; lastFour: string | null };

export function SourceAuthFields({
  sourceId, kind, header, secret, secretState, onKind, onHeader, onSecret, onSecretRemoved,
}: {
  /** null while the source is being created (the secret is saved right after it). */
  sourceId: string | null;
  kind: SourceAuthKind;
  header: string;
  /** The value being typed — never a stored one. */
  secret: string;
  secretState: SourceSecretState | null;
  onKind: (k: SourceAuthKind) => void;
  onHeader: (h: string) => void;
  onSecret: (s: string) => void;
  onSecretRemoved: () => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [replacing, setReplacing] = useState(false);
  const headerBad = kind === "header" && header.trim() !== "" && !isValidAuthHeader(header.trim());
  const stored = secretState?.configured === true;
  const showInput = kind !== "none" && (!stored || replacing);

  const remove = () => start(async () => {
    if (!sourceId) return;
    const res = await clearSourceSecretAction(sourceId);
    if (!res.ok) { toast.error(t(res.error === "forbidden" ? "grovnewsAdm.errForbidden" : "common.error")); return; }
    toast.success(t("grovnewsAdm.sources.auth.secretRemovedToast"));
    setReplacing(false);
    onSecret("");
    onSecretRemoved();
  });

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-line px-3.5 py-3" data-grovnews-source-auth={kind}>
      <div className="min-w-0">
        <Label>{t("grovnewsAdm.sources.auth.title")}</Label>
        <Segmented size="sm" label={t("grovnewsAdm.sources.auth.title")} value={kind}
          onChange={(v) => { const k = (AUTH_KINDS as readonly string[]).includes(v) ? (v as SourceAuthKind) : "none"; onKind(k); }}
          options={AUTH_KINDS.map((k) => ({ value: k, label: t(`grovnewsAdm.sources.auth.${k}`) }))} />
      </div>

      {kind === "header" && (
        <div className="min-w-0">
          <Label htmlFor="gns-auth-header" hint={t("grovnewsAdm.sources.auth.headerHint")}>{t("grovnewsAdm.sources.auth.headerName")}</Label>
          <Input id="gns-auth-header" value={header} maxLength={64} spellCheck={false} autoComplete="off" placeholder="X-API-Key"
            aria-invalid={headerBad || undefined} onChange={(e) => onHeader(e.target.value)} />
          {headerBad && <p className="mt-1.5 text-[12px] text-danger">{t("grovnewsAdm.sources.auth.errHeader")}</p>}
        </div>
      )}

      {kind !== "none" && (
        <div className="min-w-0 space-y-2" data-grovnews-source-secret={stored ? "stored" : "none"}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
              <KeyRound size={14} aria-hidden className="shrink-0 text-accent" />{t("grovnewsAdm.sources.auth.secret")}
            </p>
            {stored
              ? <Badge tone="success" dot>{secretState?.lastFour
                ? t("grovnewsAdm.sources.auth.secretSaved", { last4: secretState.lastFour }) : t("grovnewsAdm.sources.auth.secretSavedNoFour")}</Badge>
              : <Badge tone="warning" dot>{t("grovnewsAdm.sources.auth.secretNone")}</Badge>}
          </div>
          {showInput ? (
            <Input type="password" value={secret} maxLength={4096} spellCheck={false} autoComplete="new-password"
              placeholder={t("grovnewsAdm.sources.auth.secretPlaceholder")} aria-label={t("grovnewsAdm.sources.auth.secret")}
              onChange={(e) => onSecret(e.target.value)} data-grovnews-source-secret-input />
          ) : null}
          <div className="flex min-w-0 flex-wrap gap-2">
            {stored && !replacing && (
              <Button type="button" size="sm" variant="secondary" onClick={() => setReplacing(true)} data-grovnews-source-secret-replace>
                <KeyRound size={13} aria-hidden />{t("grovnewsAdm.sources.auth.secretReplace")}
              </Button>
            )}
            {stored && sourceId && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove} data-grovnews-source-secret-remove>
                <Trash2 size={13} aria-hidden />{t("grovnewsAdm.sources.auth.secretRemove")}
              </Button>
            )}
          </div>
          <p className="text-[12px] leading-snug text-muted">{t("grovnewsAdm.sources.auth.secretHint")}</p>
          {!stored && !secret.trim() && (
            <p className="text-[12px] leading-snug text-warning" data-grovnews-source-secret-missing>{t("grovnewsAdm.sources.auth.missingNote")}</p>
          )}
        </div>
      )}
    </div>
  );
}

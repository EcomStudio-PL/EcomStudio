"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { toggleProviderAction } from "@/app/actions/admin";
import {
  saveProviderCredentialAction, deleteProviderCredentialAction, testProviderConnectionAction,
} from "@/app/actions/credentials";
import { Modal, ConfirmModal, SecretInput } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type ProviderView = {
  id: string; slug: string; name: string; active: boolean;
  modelsActive: number; modelsTotal: number;
  credential: {
    lastFour: string; updatedAt: string | null; lastTestedAt: string | null;
    lastTestStatus: string | null; lastTestError: string | null; baseUrl: string | null;
  } | null;
};

const TEST_TONE: Record<string, "green" | "red" | "amber" | "neutral"> = {
  connected: "green", auth_failed: "red", rate_limited: "amber", unavailable: "amber",
  invalid: "red", unsupported: "neutral",
};

export function ProviderCard({ p, encryptionReady, locale }: {
  p: ProviderView; encryptionReady: boolean; locale: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [configOpen, setConfigOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.credential?.baseUrl ?? "");

  function run(p2: Promise<{ ok: boolean; error?: string; message?: string; status?: string }>, onDone?: (r: { ok: boolean; message?: string; status?: string; error?: string }) => void) {
    start(async () => {
      const res = await p2;
      if (onDone) onDone(res);
      else if (res.ok) { toast.success(t("common.save")); router.refresh(); }
      else toast.error(res.error === "encryption_unavailable" ? t("admin.encryptionMissing") : t("common.error"));
    });
  }

  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";

  return (
    <div className="panel panel-interactive rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-raised font-display text-base font-bold text-accent">
            {p.name.charAt(0)}
          </span>
          <div>
            <h3 className="font-display text-base font-semibold">{p.name}</h3>
            <code className="text-xs text-faint">{p.slug}</code>
          </div>
        </div>
        <Badge tone={p.active ? "green" : "amber"}>{p.active ? t("admin.active") : t("admin.inactive")}</Badge>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted">{t("admin.apiKey")}</dt>
          <dd>
            {p.credential ? (
              <code className="text-xs">•••••••••••• {p.credential.lastFour.toUpperCase()}</code>
            ) : (
              <Badge tone="red">{t("admin.notConfigured")}</Badge>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted">{t("admin.lastTest")}</dt>
          <dd className="flex items-center gap-2">
            {p.credential?.lastTestStatus && (
              <Badge tone={TEST_TONE[p.credential.lastTestStatus] ?? "neutral"}>
                {t(`admin.test.${p.credential.lastTestStatus}`)}
              </Badge>
            )}
            <span className="text-xs text-faint">{fmt(p.credential?.lastTestedAt ?? null)}</span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted">{t("admin.nav.models")}</dt>
          <dd className="text-xs">{p.modelsActive} / {p.modelsTotal} {t("admin.active").toLowerCase()}</dd>
        </div>
      </dl>
      {p.credential?.lastTestError && (
        <p className="mt-2 truncate text-xs text-red-500" title={p.credential.lastTestError}>{p.credential.lastTestError}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" onClick={() => { setKey(""); setConfigOpen(true); }}>
          {t("admin.configure")}
        </Button>
        <Button size="sm" variant="secondary" disabled={pending || !p.credential}
          onClick={() => run(testProviderConnectionAction(p.id), (res) => {
            if (res.ok && res.status === "connected") toast.success(res.message ?? "Connected");
            else toast.error(res.message ?? t("common.error"));
            router.refresh();
          })}>
          {t("admin.testConnection")}
        </Button>
        {p.credential && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDeleteOpen(true)}>
            {t("common.delete")}
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => run(toggleProviderAction(p.id, !p.active))}>
          {p.active ? t("admin.deactivate") : t("admin.activate")}
        </Button>
      </div>

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title={`${p.name} — ${t("admin.configure")}`}>
        {!encryptionReady && (
          <p className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            {t("admin.encryptionMissing")}
          </p>
        )}
        <div className="space-y-4">
          <div>
            <Label htmlFor={`key-${p.id}`}>{t("admin.apiKey")}</Label>
            <SecretInput id={`key-${p.id}`} value={key} onChange={setKey}
              placeholder={p.credential ? `•••••••••••• ${p.credential.lastFour.toUpperCase()} — ${t("admin.replaceHint")}` : "sk-..."} />
            <p className="mt-1.5 text-xs text-faint">{t("admin.secretHint")}</p>
          </div>
          <div>
            <Label htmlFor={`url-${p.id}`}>{t("admin.baseUrl")}</Label>
            <Input id={`url-${p.id}`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https:// (optional)" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setConfigOpen(false)}>{t("common.cancel")}</Button>
            <Button disabled={pending || key.trim().length < 8 || !encryptionReady}
              onClick={() => run(saveProviderCredentialAction(p.id, key, baseUrl), (res) => {
                if (res.ok) { toast.success(t("admin.credentialSaved")); setKey(""); setConfigOpen(false); router.refresh(); }
                else toast.error(res.error === "encryption_unavailable" ? t("admin.encryptionMissing") : t("common.error"));
              })}>
              {p.credential ? t("admin.replaceCredential") : t("admin.saveCredential")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={deleteOpen} onClose={() => setDeleteOpen(false)} danger pending={pending}
        title={t("admin.deleteCredential")} body={t("admin.deleteCredentialBody", { provider: p.name })}
        confirmLabel={t("common.delete")}
        onConfirm={() => run(deleteProviderCredentialAction(p.id), (res) => {
          if (res.ok) { toast.success(t("common.save")); setDeleteOpen(false); router.refresh(); }
          else toast.error(t("common.error"));
        })} />
    </div>
  );
}

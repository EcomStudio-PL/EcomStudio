"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { toggleProviderAction } from "@/app/actions/admin";
import {
  saveProviderCredentialAction, deleteProviderCredentialAction,
  testProviderConnectionAction, testProviderImageAction,
} from "@/app/actions/credentials";
import { Modal, ConfirmModal, SecretInput } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { ProviderState } from "@/lib/provider-status";

export type ProviderView = {
  id: string; slug: string; name: string; active: boolean;
  modelsActive: number; modelsTotal: number;
  /** Active models of this provider, display names. */
  modelNames: string[];
  /** Tools whose model assignment points at one of this provider's models. */
  toolKeys: string[];
  state: ProviderState;
  /** Why an error / untested state — a code the panel translates. */
  stateReason: string | null;
  credential: {
    /** "•••• abcd" — computed on the server from the stored last four. */
    masked: string; source: "vault" | "legacy"; readable: boolean;
    updatedAt: string | null; lastTestedAt: string | null;
    lastTestStatus: string | null; lastTestDetail: string | null; latencyMs: number | null;
    baseUrl: string | null;
    lastImageTestAt: string | null; lastImageTestStatus: string | null; lastImageTestError: string | null;
    lastSuccessAt: string | null; lastErrorAt: string | null; lastErrorCode: string | null;
  } | null;
};

const STATE_TONE: Record<ProviderState, "success" | "danger" | "neutral" | "warning"> = {
  connected: "success", error: "danger", untested: "warning", not_configured: "neutral",
};

type ActionResult = { ok: boolean; error?: string; status?: string; detail?: string | null; latencyMs?: number | null };

export function ProviderCard({ p, locale }: { p: ProviderView; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [configOpen, setConfigOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.credential?.baseUrl ?? "");
  const c = p.credential;

  function run(action: Promise<ActionResult>, onDone: (r: ActionResult) => void) {
    start(async () => { onDone(await action); });
  }

  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";

  /** A stored detail/verdict code in words. HTTP codes read as "HTTP 401". */
  const detailText = (code: string | null | undefined): string | null => {
    if (!code) return null;
    const http = /^http_(\d{3})$/.exec(code);
    if (http) return t("aicc.providers.detail.http", { code: http[1] });
    if (["sandbox", "live", "reachable", "network"].includes(code)) return t(`aicc.providers.detail.${code}`);
    if (/^[a-z_]+$/.test(code) && code !== "connected") return t(`admin.test.${code}`);
    return code;
  };
  const reasonText = (reason: string | null): string | null => {
    if (!reason) return null;
    if (reason.startsWith("runtime:")) return t("aicc.providers.reason.runtime", { code: reason.slice(8) });
    if (reason === "traffic") return t("aicc.providers.reason.traffic");
    return t(`admin.test.${reason}`);
  };
  const testToast = (res: ActionResult) => {
    if (res.ok) {
      const parts = [t("admin.test.connected"), detailText(res.detail), res.latencyMs != null ? t("aicc.providers.latencyValue", { ms: res.latencyMs }) : null];
      toast.success(parts.filter(Boolean).join(" · "));
    } else {
      toast.error([t(`admin.test.${res.status ?? res.error ?? "unavailable"}`), detailText(res.detail)].filter(Boolean).join(" · "));
    }
    router.refresh();
  };

  const toolLabel = (k: string) => {
    const label = t(`aicc.toolName.${k}`);
    return label === `aicc.toolName.${k}` ? k : label;
  };

  return (
    <div className="panel panel-interactive rounded-2xl p-5" data-provider-card={p.slug} data-provider-state={p.state}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised font-display text-base font-bold text-accent">
            {p.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-semibold">{p.name}</h3>
            <code className="block truncate text-xs text-faint">{p.slug}</code>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={STATE_TONE[p.state]} dot>{t(`aicc.providers.state.${p.state}`)}</Badge>
          {!p.active && <Badge tone="neutral">{t("admin.inactive")}</Badge>}
        </div>
      </div>

      {reasonText(p.stateReason) && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${p.state === "error" ? "bg-[rgb(var(--danger)/0.1)] text-danger" : "bg-raised text-muted"}`}
          data-provider-reason={p.stateReason ?? undefined}>
          {reasonText(p.stateReason)}
        </p>
      )}
      {c && !p.active && <p className="mt-2 text-xs text-muted">{t("aicc.providers.inactiveNote")}</p>}

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Row label={t("admin.apiKey")}>
          {c ? <code className="text-xs" data-masked-key>{c.masked}</code> : <span className="text-muted">{t("aicc.providers.state.not_configured")}</span>}
        </Row>
        <Row label={t("aicc.providers.lastChange")}>{fmt(c?.updatedAt ?? null)}</Row>
        <Row label={t("admin.lastTest")}>
          {c?.lastTestStatus ? (
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <Badge className="max-w-full !whitespace-normal" tone={c.lastTestStatus === "connected" ? "success" : c.lastTestStatus === "unsupported" ? "neutral" : "danger"}>
                {t(`admin.test.${c.lastTestStatus}`)}
              </Badge>
              <span className="text-xs text-faint">{fmt(c.lastTestedAt)}</span>
            </span>
          ) : "—"}
        </Row>
        <Row label={t("aicc.providers.latency")}>
          {c?.latencyMs != null ? t("aicc.providers.latencyValue", { ms: c.latencyMs }) : "—"}
        </Row>
        <Row label={t("aicc.providers.lastSuccess")}>{fmt(c?.lastSuccessAt ?? null)}</Row>
        <Row label={t("aicc.providers.lastError")}>
          {c?.lastErrorAt ? (
            <span className="text-right text-xs">
              <span className="text-danger">{c.lastErrorCode ?? "—"}</span>
              <span className="block text-faint">{fmt(c.lastErrorAt)}</span>
            </span>
          ) : "—"}
        </Row>
        <Row label={t("admin.imageTest")}>
          {c?.lastImageTestStatus ? (
            <Badge className="max-w-full !whitespace-normal" tone={c.lastImageTestStatus === "image_ok" ? "success" : "danger"}>
              {c.lastImageTestStatus === "image_ok" ? t("admin.imageTestOk") : t("admin.imageTestFailed")}
            </Badge>
          ) : <Badge className="max-w-full !whitespace-normal" tone="neutral">{t("admin.imageTestNever")}</Badge>}
        </Row>
        <Row label={t("admin.nav.models")}>
          <span className="text-xs">{p.modelsActive} / {p.modelsTotal} {t("admin.active").toLowerCase()}</span>
        </Row>
      </dl>

      {(p.modelNames.length > 0 || p.toolKeys.length > 0) && (
        <div className="mt-3 space-y-1.5 text-xs">
          {p.modelNames.length > 0 && (
            <p className="text-muted"><span className="text-faint">{t("aicc.providers.models")}: </span>{p.modelNames.join(", ")}</p>
          )}
          <p className="text-muted">
            <span className="text-faint">{t("aicc.providers.tools", { n: p.toolKeys.length })}</span>
            {p.toolKeys.length > 0 && <>: {p.toolKeys.map(toolLabel).join(", ")}</>}
          </p>
        </div>
      )}
      {c?.lastImageTestError && c.lastImageTestStatus !== "image_ok" && (
        <p className="mt-2 truncate text-xs text-danger" title={c.lastImageTestError}>{c.lastImageTestError}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" onClick={() => { setKey(""); setConfigOpen(true); }}>
          {c ? t("aicc.providers.changeKey") : t("admin.saveCredential")}
        </Button>
        <Button size="sm" variant="secondary" disabled={pending || !c}
          onClick={() => run(testProviderConnectionAction(p.id), testToast)}>
          {t("admin.testConnection")}
        </Button>
        <Button size="sm" variant="secondary" disabled={pending || !c}
          onClick={() => run(testProviderImageAction(p.id), (res) => {
            if (res.ok) toast.success(t("admin.imageTestOk"));
            else toast.error([t("admin.imageTestFailed"), res.status && res.status !== "image_failed" ? t(`admin.test.${res.status}`) : null, res.detail].filter(Boolean).join(" · "));
            router.refresh();
          })}>
          {t("admin.imageTest")}
        </Button>
        {c && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDeleteOpen(true)}>
            {t("common.delete")}
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => run(toggleProviderAction(p.id, !p.active), (res) => {
            if (res.ok) { toast.success(t("common.save")); router.refresh(); } else toast.error(t("common.error"));
          })}>
          {p.active ? t("admin.deactivate") : t("admin.activate")}
        </Button>
      </div>

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title={`${p.name} — ${c ? t("aicc.providers.changeKey") : t("admin.saveCredential")}`}>
        <div className="space-y-4">
          <div>
            <Label htmlFor={`key-${p.id}`}>{t("admin.apiKey")}</Label>
            <SecretInput id={`key-${p.id}`} value={key} onChange={setKey}
              placeholder={c ? `${c.masked} — ${t("admin.replaceHint")}` : "sk-..."} />
            <p className="mt-1.5 text-xs text-faint">{t("admin.secretHint")}</p>
          </div>
          <div>
            <Label htmlFor={`url-${p.id}`}>{t("admin.baseUrl")}</Label>
            <Input id={`url-${p.id}`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setConfigOpen(false)}>{t("common.cancel")}</Button>
            {/* Nothing about the server can disable this. Saving a provider key
                needs an admin session and a vault, both of which are present
                whenever this modal is open. */}
            <Button disabled={pending || key.trim().length < 8}
              onClick={() => run(saveProviderCredentialAction(p.id, key, baseUrl), (res) => {
                if (res.ok) { toast.success(t("admin.credentialSaved")); setKey(""); setConfigOpen(false); router.refresh(); }
                else toast.error(res.error === "secret_write_failed" ? t("admin.secretWriteFailed") : `${t("common.error")}${res.error ? ` (${res.error})` : ""}`);
              })}>
              {c ? t("admin.replaceCredential") : t("admin.saveCredential")}
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

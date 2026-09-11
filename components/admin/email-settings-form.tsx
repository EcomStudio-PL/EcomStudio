"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Lock, PlugZap } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { saveEmailSettingsAction, testEmailConnectionAction } from "@/app/actions/launch";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";

/**
 * USTAWIENIA E-MAIL — the sender identity, the SMTP server behind it, and the
 * one message the launch page sends.
 *
 * The password is write-only in this form: what is stored is AES-GCM
 * ciphertext, it is never sent back to the browser, and an empty box means
 * "keep what is saved". The screen only ever learns *whether* a secret exists.
 */
export type EmailSettingsView = {
  from_name: string;
  from_email: string;
  reply_to: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_encryption: "auto" | "tls" | "ssl";
  has_password: boolean;
  confirmation_enabled: boolean;
  confirmation_subject: string;
  confirmation_body: string;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_error_safe: string | null;
};

export function EmailSettingsForm({ initial, encryptionReady, transportOwnedByMailbox = false }: {
  initial: EmailSettingsView;
  encryptionReady: boolean;
  /**
   * ONE EDITABLE SMTP CONFIGURATION, NOT TWO.
   *
   * The mailbox integration card owns host, port, encryption, user and
   * password, and mirrors them here so the waitlist mailer keeps working. When
   * that is true, this form shows the transport read-only and points at the
   * card that owns it — the alternative, two forms writing two tables with the
   * same five fields, is how they drifted apart in the first place.
   *
   * The values are still submitted unchanged on save: the server action's
   * contract is one row, and echoing back what we were given writes the same
   * bytes the mirror already put there.
   */
  transportOwnedByMailbox?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, setTesting] = useState(false);
  const [v, setV] = useState(initial);
  const [password, setPassword] = useState("");

  const patch = <K extends keyof EmailSettingsView>(key: K, value: EmailSettingsView[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  function save() {
    start(async () => {
      const res = await saveEmailSettingsAction({
        fromName: v.from_name,
        fromEmail: v.from_email,
        replyTo: v.reply_to,
        smtpHost: v.smtp_host,
        smtpPort: Number(v.smtp_port) || 587,
        smtpUser: v.smtp_user,
        smtpPassword: password || undefined,
        encryption: v.smtp_encryption,
        confirmationEnabled: v.confirmation_enabled,
        confirmationSubject: v.confirmation_subject,
        confirmationBody: v.confirmation_body,
      });
      if (res.ok) {
        if (password) { setPassword(""); patch("has_password", true); }
        toast.success(t("common.save"));
        router.refresh();
      } else if (res.error === "encryption_unavailable") {
        toast.error(t("launchAdmin.encryptionMissing"));
      } else if (res.error === "invalid_email" || res.error === "invalid_reply_to") {
        toast.error(t("launch.invalid"));
      } else toast.error(t("common.error"));
    });
  }

  async function test() {
    setTesting(true);
    // Save first: testing settings that are only on screen would prove
    // nothing about what the app actually sends with.
    const saved = await saveEmailSettingsAction({
      fromName: v.from_name, fromEmail: v.from_email, replyTo: v.reply_to,
      smtpHost: v.smtp_host, smtpPort: Number(v.smtp_port) || 587, smtpUser: v.smtp_user,
      smtpPassword: password || undefined, encryption: v.smtp_encryption,
      confirmationEnabled: v.confirmation_enabled,
      confirmationSubject: v.confirmation_subject, confirmationBody: v.confirmation_body,
    });
    if (!saved.ok) { setTesting(false); toast.error(t("common.error")); return; }
    if (password) { setPassword(""); patch("has_password", true); }
    const res = await testEmailConnectionAction();
    setTesting(false);
    if (res.ok) toast.success(t("launchAdmin.testOk"));
    else if (res.error === "not_configured") toast.error(t("launchAdmin.notConfigured"));
    else toast.error(`${t("launchAdmin.testFail")} ${res.error ?? ""}`.trim());
    router.refresh();
  }

  return (
    <div data-email-settings className="space-y-5">
      {!encryptionReady && (
        <p className="rounded-2xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-4 py-3 text-[13px] text-warning">
          {t("launchAdmin.encryptionMissing")}
        </p>
      )}

      <Card>
        <CardHeader title={t("launchAdmin.senderSection")} />
        <div className="grid gap-4 p-5 pt-0 sm:grid-cols-3">
          <div>
            <Label htmlFor="from-name">{t("launchAdmin.senderName")}</Label>
            <Input id="from-name" value={v.from_name} onChange={(e) => patch("from_name", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="from-email">{t("launchAdmin.senderEmail")}</Label>
            <Input id="from-email" type="email" autoComplete="off" value={v.from_email}
              onChange={(e) => patch("from_email", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="reply-to">{t("launchAdmin.replyTo")}</Label>
            <Input id="reply-to" type="email" autoComplete="off" value={v.reply_to}
              onChange={(e) => patch("reply_to", e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("launchAdmin.smtpSection")}
          action={v.last_test_status ? (
            <Badge tone={v.last_test_status === "ok" ? "success" : "danger"}>
              {v.last_test_status === "ok" ? t("launchAdmin.testOk") : t("launchAdmin.testFail")}
            </Badge>
          ) : undefined}
        />
        <div className="grid gap-4 p-5 pt-0 sm:grid-cols-2">
          {transportOwnedByMailbox ? (
            <>
              <dl className="grid gap-3 rounded-xl bg-raised px-4 py-3 sm:col-span-2 sm:grid-cols-2">
                <Fact label={t("launchAdmin.smtpHost")} value={v.smtp_host} />
                <Fact label={t("launchAdmin.smtpPort")} value={String(v.smtp_port)} />
                <Fact label={t("launchAdmin.smtpUser")} value={v.smtp_user} />
                <Fact
                  label={t("launchAdmin.smtpPass")}
                  value={v.has_password ? "••••••••" : "—"}
                />
              </dl>
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-faint sm:col-span-2">
                <Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
                {t("comm.transportOwned")}
              </p>
            </>
          ) : (
            <>
              <div className="sm:col-span-2">
                <Label htmlFor="smtp-host">{t("launchAdmin.smtpHost")}</Label>
                <Input id="smtp-host" autoComplete="off" placeholder="smtp.example.com"
                  value={v.smtp_host} onChange={(e) => patch("smtp_host", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="smtp-port">{t("launchAdmin.smtpPort")}</Label>
                <Input id="smtp-port" type="number" inputMode="numeric" min={1} max={65535}
                  value={v.smtp_port} onChange={(e) => patch("smtp_port", Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="smtp-enc">{t("launchAdmin.encryption")}</Label>
                <Select id="smtp-enc" value={v.smtp_encryption}
                  onChange={(e) => patch("smtp_encryption", e.target.value as EmailSettingsView["smtp_encryption"])}>
                  <option value="auto">{t("launchAdmin.encAuto")}</option>
                  <option value="tls">{t("launchAdmin.encTls")}</option>
                  <option value="ssl">{t("launchAdmin.encSsl")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="smtp-user">{t("launchAdmin.smtpUser")}</Label>
                <Input id="smtp-user" autoComplete="off" value={v.smtp_user}
                  onChange={(e) => patch("smtp_user", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="smtp-pass" hint={v.has_password ? t("launchAdmin.passKept") : undefined}>
                  {t("launchAdmin.smtpPass")}
                </Label>
                <SecretInput id="smtp-pass" value={password} onChange={setPassword}
                  placeholder={v.has_password ? "••••••••" : ""} />
              </div>
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-faint sm:col-span-2">
                <Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
                {t("launchAdmin.securityNote")}
              </p>
            </>
          )}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button variant="secondary" disabled={testing || pending} onClick={test} data-email-test>
              <PlugZap size={15} aria-hidden />
              {testing ? t("launchAdmin.testing") : t("launchAdmin.testConnection")}
            </Button>
            {v.last_tested_at && (
              <span className="text-[12px] text-faint">
                {t("launchAdmin.lastTest")}: {new Date(v.last_tested_at).toLocaleString()}
                {v.last_test_status !== "ok" && v.last_test_error_safe ? ` — ${v.last_test_error_safe}` : ""}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("launchAdmin.confirmSection")} />
        <div className="space-y-4 p-5 pt-0">
          <label className="flex items-center gap-3 text-[14px] font-medium">
            <input type="checkbox" checked={v.confirmation_enabled}
              onChange={(e) => patch("confirmation_enabled", e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent))]" />
            {t("launchAdmin.confirmEnabled")}
          </label>
          <div>
            <Label htmlFor="conf-subject">{t("launchAdmin.confirmSubject")}</Label>
            <Input id="conf-subject" value={v.confirmation_subject}
              onChange={(e) => patch("confirmation_subject", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="conf-body">{t("launchAdmin.confirmBody")}</Label>
            <Textarea id="conf-body" rows={4} value={v.confirmation_body}
              onChange={(e) => patch("confirmation_body", e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button disabled={pending} onClick={save} data-email-save>{t("common.save")}</Button>
      </div>
    </div>
  );
}

/** A stored value the operator can read but not edit here, because something
 *  else owns it. Rendered as a definition pair so screen readers announce the
 *  label with the value rather than two loose lines. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate text-[13.5px] font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}

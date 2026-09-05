"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Inbox, Mail, SendHorizonal } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  saveMailIntegrationAction, sendTestEmailAction, testImapAction, testSmtpAction,
} from "@/app/actions/integrations";
import type { IntegrationView, MailConfig } from "@/lib/server/integrations";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/modal";
import { integrationErrorKey } from "@/components/admin/integration-cards";

/**
 * POCZTA — the mailbox behind the whole communications module: one IMAP
 * connection to read it and one SMTP connection to answer from it.
 *
 * Two behaviours are load-bearing. Passwords are write-only: what is stored is
 * ciphertext the browser never sees, so an empty box means KEEP and the
 * placeholder says so. And every test SAVES FIRST — the server actions read the
 * stored row, so testing what is merely on screen would report on the previous
 * settings and tell the admin nothing.
 */

type Busy = "imap" | "smtp" | "send" | null;

export function MailIntegrationForm({ view, encryptionReady }: {
  view: IntegrationView<MailConfig>;
  encryptionReady: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [v, setV] = useState<MailConfig>(view.config);
  const [imapPassword, setImapPassword] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  /** Whether a ciphertext exists, never the secret itself. Kept in state so a
   *  save flips the placeholder without waiting for the page to re-render. */
  const [stored, setStored] = useState({
    imap: view.hasSecret.imap_password === true,
    smtp: view.hasSecret.smtp_password === true,
  });
  const [testTo, setTestTo] = useState(view.config.email);

  const patch = <K extends keyof MailConfig>(key: K, value: MailConfig[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  const working = pending || busy !== null;
  /** "Same as IMAP" is resolved by the action, so the disabled field shows the
   *  value that will actually be stored instead of a stale one. */
  const smtpUser = v.smtp_same_as_imap ? v.imap_user : v.smtp_user;

  async function persist(): Promise<boolean> {
    const res = await saveMailIntegrationAction({
      config: { ...v, smtp_user: smtpUser },
      // There is no on/off switch on this screen: a mailbox is live once it
      // holds a password, so the flag follows the credential rather than
      // drifting to false behind the admin's back.
      enabled: stored.imap || imapPassword.trim().length > 0,
      imapPassword: imapPassword || undefined,
      smtpPassword: smtpPassword || undefined,
    });
    if (!res.ok) {
      toast.error(t(integrationErrorKey(res.error, "generic")));
      return false;
    }
    const nowImap = stored.imap || imapPassword.trim().length > 0;
    // The action mirrors the IMAP password into the SMTP slot when the boxes
    // are tied together, so the placeholder has to follow that too.
    const nowSmtp = v.smtp_same_as_imap ? nowImap : stored.smtp || smtpPassword.trim().length > 0;
    setStored({ imap: nowImap, smtp: nowSmtp });
    // The plaintext leaves the screen the moment it is stored.
    setImapPassword("");
    setSmtpPassword("");
    return true;
  }

  function save() {
    start(async () => {
      if (!(await persist())) return;
      toast.success(t("comm.saved"));
      router.refresh();
    });
  }

  async function runTest(channel: Exclude<Busy, null>) {
    if (channel === "send" && !testTo.trim()) {
      toast.error(t("comm.recipientRequired"));
      return;
    }
    setBusy(channel);
    if (!(await persist())) {
      setBusy(null);
      return;
    }
    const res = channel === "imap"
      ? await testImapAction()
      : channel === "smtp"
        ? await testSmtpAction()
        : await sendTestEmailAction(testTo);
    setBusy(null);
    if (res.ok) {
      toast.success(t(channel === "imap" ? "comm.imapOk" : channel === "smtp" ? "comm.smtpOk" : "comm.testMailSent"));
    } else {
      toast.error(t(integrationErrorKey(res.error, channel === "imap" ? "imap" : "smtp")));
    }
    router.refresh();
  }

  return (
    <Card data-mail-integration>
      <CardHeader title={t("comm.mail")} sub={t("comm.mailTileSub")} icon={Mail} />
      <div className="space-y-6 p-4 pt-0 sm:p-5 sm:pt-0">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="mail-account">{t("comm.accountName")}</Label>
            <Input id="mail-account" value={v.account_name}
              onChange={(e) => patch("account_name", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="mail-email">{t("comm.emailAddress")}</Label>
            <Input id="mail-email" type="email" autoComplete="off" value={v.email}
              onChange={(e) => patch("email", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="mail-from">{t("comm.fromName")}</Label>
            <Input id="mail-from" value={v.from_name}
              onChange={(e) => patch("from_name", e.target.value)} />
          </div>
        </div>

        <section className="space-y-4 border-t border-line pt-5">
          <p className="overline flex items-center gap-2">
            <Inbox size={13} aria-hidden />
            {t("comm.imap")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="imap-host">{t("comm.host")}</Label>
              <Input id="imap-host" autoComplete="off" value={v.imap_host}
                onChange={(e) => patch("imap_host", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="imap-port">{t("comm.port")}</Label>
              <Input id="imap-port" type="number" inputMode="numeric" min={1} max={65535} value={v.imap_port}
                onChange={(e) => patch("imap_port", Number(e.target.value))} />
            </div>
            <label className="flex items-center gap-3 pt-1 text-[13.5px] font-medium sm:pt-7">
              <input type="checkbox" checked={v.imap_secure}
                onChange={(e) => patch("imap_secure", e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--accent))]" />
              {t("comm.sslTls")}
            </label>
            <div>
              <Label htmlFor="imap-user">{t("comm.username")}</Label>
              <Input id="imap-user" autoComplete="off" value={v.imap_user}
                onChange={(e) => patch("imap_user", e.target.value)} />
            </div>
            {/* A fieldset rather than a prop: it disables the reveal button too,
                and without a server key nothing typed here could be stored. */}
            <fieldset disabled={!encryptionReady} className="min-w-0 disabled:opacity-60"
              title={encryptionReady ? undefined : t("comm.encryptionMissing")}>
              <Label htmlFor="imap-pass">{t("comm.password")}</Label>
              <SecretInput id="imap-pass" value={imapPassword} onChange={setImapPassword}
                placeholder={stored.imap ? t("comm.savedSecret") : ""} />
            </fieldset>
          </div>
        </section>

        <section className="space-y-4 border-t border-line pt-5">
          <p className="overline flex items-center gap-2">
            <SendHorizonal size={13} aria-hidden />
            {t("comm.smtp")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="smtp-host">{t("comm.host")}</Label>
              <Input id="smtp-host" autoComplete="off" value={v.smtp_host}
                onChange={(e) => patch("smtp_host", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="smtp-port">{t("comm.port")}</Label>
              <Input id="smtp-port" type="number" inputMode="numeric" min={1} max={65535} value={v.smtp_port}
                onChange={(e) => patch("smtp_port", Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="smtp-enc">{t("comm.security")}</Label>
              <Select id="smtp-enc" value={v.smtp_encryption}
                onChange={(e) => patch("smtp_encryption", e.target.value as MailConfig["smtp_encryption"])}>
                <option value="starttls">{t("comm.starttls")}</option>
                <option value="ssl">{t("comm.sslTls")}</option>
                <option value="none">{t("comm.noneEnc")}</option>
              </Select>
            </div>
            <label className="flex items-start gap-3 text-[13.5px] font-medium sm:col-span-2">
              <input type="checkbox" checked={v.smtp_same_as_imap}
                onChange={(e) => patch("smtp_same_as_imap", e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
              {t("comm.sameAsImap")}
            </label>
            <div>
              <Label htmlFor="smtp-user">{t("comm.username")}</Label>
              <Input id="smtp-user" autoComplete="off" value={smtpUser} disabled={v.smtp_same_as_imap}
                onChange={(e) => patch("smtp_user", e.target.value)} />
            </div>
            <fieldset disabled={v.smtp_same_as_imap || !encryptionReady} className="min-w-0 disabled:opacity-60"
              title={encryptionReady ? undefined : t("comm.encryptionMissing")}>
              <Label htmlFor="smtp-pass">{t("comm.password")}</Label>
              <SecretInput id="smtp-pass" value={smtpPassword} onChange={setSmtpPassword}
                placeholder={stored.smtp ? t("comm.savedSecret") : ""} />
            </fieldset>
          </div>
        </section>

        <section className="space-y-4 border-t border-line pt-5">
          <label className="flex items-start gap-3 text-[13.5px] font-medium">
            <input type="checkbox" checked={v.mirror_to_email_settings}
              onChange={(e) => patch("mirror_to_email_settings", e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
            {t("comm.mirrorSystem")}
          </label>
          <p className="text-[12px] leading-relaxed text-faint">{t("comm.mirrorSystemHint")}</p>
          <div className="max-w-sm">
            <Label htmlFor="mail-test-to">{t("comm.sendTestTo")}</Label>
            <Input id="mail-test-to" type="email" autoComplete="off" value={testTo}
              onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={working} onClick={() => runTest("imap")}>
              {busy === "imap" ? "…" : t("comm.testImap")}
            </Button>
            <Button size="sm" variant="secondary" disabled={working} onClick={() => runTest("smtp")}>
              {busy === "smtp" ? "…" : t("comm.testSmtp")}
            </Button>
            <Button size="sm" variant="secondary" disabled={working} onClick={() => runTest("send")}>
              {busy === "send" ? "…" : t("comm.sendTest")}
            </Button>
            <span className="hidden flex-1 sm:block" />
            <Button size="sm" disabled={working} onClick={save} data-mail-save>
              {t("comm.save")}
            </Button>
          </div>
        </section>
      </div>
    </Card>
  );
}

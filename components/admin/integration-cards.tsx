"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Mail, Pencil, PlugZap, Send, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { testCaptchaAction, testImapAction, testSmtpAction, testTelegramAction } from "@/app/actions/integrations";
import type {
  CaptchaConfig, IntegrationStatus, IntegrationView, MailConfig, TelegramConfig,
} from "@/lib/server/integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CaptchaIntegrationForm } from "@/components/admin/captcha-integration-form";
import { MailIntegrationForm } from "@/components/admin/mail-integration-form";
import { TelegramIntegrationForm } from "@/components/admin/telegram-integration-form";

/**
 * INTEGRACJE — the three tiles that say, at a glance, whether GrovBase can
 * read its mailbox, reach its Telegram channel and verify its signup captcha,
 * with the full form one click behind each of them.
 *
 * Only one form is open at a time and it expands BELOW the tiles rather than
 * inside one: a mail form squeezed into half a grid column is unusable on a
 * phone, and the tiles stay visible so the status badge updates in place after
 * a test.
 */

/**
 * Every code app/actions/integrations.ts answers with, mapped to the one
 * translated sentence that tells the admin what to do next. It lives here
 * because all three screens of this module read the same vocabulary.
 */
const ERROR_KEYS: Record<string, string> = {
  forbidden: "comm.err.forbidden",
  not_configured: "comm.err.notConfigured",
  // NOT comm.secretUnreadable: that one is the page banner and names the
  // channels it concerns, so it needs a variable this table cannot supply. A
  // toast is already attached to the channel the admin just acted on.
  encryption_unavailable: "comm.err.secretStale",
  secret_write_failed: "comm.err.secretWrite",
  not_persisted: "comm.err.notPersisted",
  decrypt_failed: "comm.err.decrypt",
  invalid_email: "comm.invalidEmail",
  // The mail form saves every field at once, so a rejected save has to name the
  // one that was wrong — the generic sentence would leave the admin guessing.
  invalid_host: "comm.err.invalidHost",
  invalid_port: "comm.err.invalidPort",
  invalid_encryption: "comm.err.invalidEncryption",
  imap_port_mismatch: "comm.hint.imapSmtpPort",
  smtp_port_mismatch: "comm.hint.smtpImapPort",
  auth: "comm.err.auth",
  chat_not_found: "comm.err.chatNotFound",
  // A malformed id and an id Telegram does not know lead to the same fix, and
  // that sentence points straight at the field the admin has to correct.
  invalid_chat_id: "comm.err.chatNotFound",
  invalid_token: "comm.err.telegram",
  // A rejected captcha secret and an unreachable Cloudflare are different
  // fixes: retype the key vs. simply try again.
  captcha_secret: "comm.err.captchaSecret",
  timeout: "comm.err.timeout",
};

/** Which channel failed, so an unrecognised code still names the right thing. */
export type ErrorChannel = "imap" | "smtp" | "telegram" | "captcha" | "generic";

const CHANNEL_FALLBACK: Record<ErrorChannel, string> = {
  imap: "comm.err.imap",
  smtp: "comm.err.smtp",
  telegram: "comm.err.telegram",
  captcha: "comm.err.generic",
  generic: "comm.err.generic",
};

/**
 * A code is never shown raw — "auth" on a screen is the same failure as a
 * stack trace on a screen. Anything this table does not know falls back to the
 * channel's sentence, so a code added to the actions later still reads as
 * Polish rather than as debug output.
 */
export function integrationErrorKey(code: string | undefined, channel: ErrorChannel): string {
  if (!code) return CHANNEL_FALLBACK[channel];
  const mapped = ERROR_KEYS[code];
  if (mapped) return mapped;
  // A network failure against Telegram is always the 10 s abort in
  // lib/server/telegram.ts; a mail server can stall for a dozen reasons, and
  // the channel sentence names all of them at once.
  if (code === "network" && channel === "telegram") return "comm.err.timeout";
  return CHANNEL_FALLBACK[channel];
}

const STATUS_TONE: Record<IntegrationStatus, "success" | "neutral" | "danger"> = {
  connected: "success",
  not_configured: "neutral",
  error: "danger",
};

type OpenPanel = "mail" | "telegram" | "captcha" | null;

export function IntegrationCards({ mail, telegram, captcha }: {
  mail: IntegrationView<MailConfig>;
  telegram: IntegrationView<TelegramConfig>;
  captcha: IntegrationView<CaptchaConfig>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState<OpenPanel>(null);
  const [busy, setBusy] = useState<OpenPanel>(null);

  /**
   * The tile's own test. IMAP and SMTP are two different connections and a
   * mailbox that can only receive is not "connected", so both have to pass —
   * and the first failure stops the sequence, because the second answer would
   * only overwrite the status the admin needs to read.
   */
  async function testMail() {
    setBusy("mail");
    const imap = await testImapAction();
    const smtp = imap.ok ? await testSmtpAction() : null;
    setBusy(null);
    if (!imap.ok) toast.error(t(integrationErrorKey(imap.error, "imap")));
    else if (smtp && !smtp.ok) toast.error(t(integrationErrorKey(smtp.error, "smtp")));
    else toast.success(t("comm.status.connected"));
    router.refresh();
  }

  async function testTelegram() {
    setBusy("telegram");
    const res = await testTelegramAction();
    setBusy(null);
    if (res.ok) toast.success(t("comm.tgOk"));
    else toast.error(t(integrationErrorKey(res.error, "telegram")));
    router.refresh();
  }

  async function testCaptcha() {
    setBusy("captcha");
    const res = await testCaptchaAction();
    setBusy(null);
    if (res.ok) toast.success(t("comm.captchaOk"));
    else toast.error(t(integrationErrorKey(res.error, "captcha")));
    router.refresh();
  }

  /**
   * LEFTOVERS FROM THE OLD STORE, AND WHY THERE IS NOW ONLY ONE SENTENCE.
   *
   * A credential written before migration 0078 is AES ciphertext sealed with
   * APP_ENCRYPTION_KEY. If that key is gone (key_missing) or has been rotated
   * (decrypt), the old value cannot be opened — and the panel used to have two
   * different banners for that, one of which told the admin to go and restore
   * an environment variable in a deploy platform.
   *
   * It is the same situation now and it has one remedy: type the password in
   * and save. The new value goes to Supabase Vault, which needs no key of ours,
   * so the fix is entirely inside this screen. The banner says what to do, and
   * every field below it stays editable while it is shown — that combination is
   * the whole point of the rewrite.
   *
   * IT ALSO HAS TO SAY WHICH CHANNEL.
   *
   * `secretsState` is already per integration and already excludes anything the
   * vault answers for, so the condition below is exactly the briefed one: no
   * vault copy, a legacy value present, and that value unopenable. What was
   * wrong was the sentence. One unnamed warning across three channels meant an
   * operator who had just saved a new mailbox password — and could see the
   * mailbox connected and listing mail — read it as being about the mailbox,
   * when what could not be opened was the Telegram token and the Turnstile key.
   * A warning nobody can act on is worse than none, so it names its channels.
   */
  const stale = ([[mail, "comm.mail"], [telegram, "comm.tgTile"], [captcha, "comm.captchaTile"]] as const)
    .filter(([v]) => v.secretsState === "key_missing" || v.secretsState === "decrypt")
    .map(([, label]) => t(label));

  return (
    <div className="space-y-5" data-integrations>
      {stale.length > 0 && (
        <p className="rounded-2xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-4 py-3 text-[13px] text-warning"
          data-stale-secret={stale.length}>
          {t("comm.secretUnreadable", { channels: stale.join(", ") })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <IntegrationTile
          view={mail} icon={Mail} title={t("comm.mail")} sub={t("comm.mailTileSub")}
          channel="imap" panelId="integration-panel-mail" expanded={open === "mail"}
          busy={busy === "mail"} disabled={busy !== null}
          onEdit={() => setOpen((prev) => (prev === "mail" ? null : "mail"))}
          onTest={testMail}
        />
        <IntegrationTile
          view={telegram} icon={Send} title={t("comm.tgTile")} sub={t("comm.tgTileSub")}
          channel="telegram" panelId="integration-panel-telegram" expanded={open === "telegram"}
          busy={busy === "telegram"} disabled={busy !== null}
          onEdit={() => setOpen((prev) => (prev === "telegram" ? null : "telegram"))}
          onTest={testTelegram}
        />
        <IntegrationTile
          view={captcha} icon={ShieldCheck} title={t("comm.captchaTile")} sub={t("comm.captchaTileSub")}
          channel="captcha" panelId="integration-panel-captcha" expanded={open === "captcha"}
          busy={busy === "captcha"} disabled={busy !== null}
          onEdit={() => setOpen((prev) => (prev === "captcha" ? null : "captcha"))}
          onTest={testCaptcha}
        />
      </div>

      {open === "mail" && (
        <div id="integration-panel-mail">
          <MailIntegrationForm view={mail} />
        </div>
      )}
      {open === "telegram" && (
        <div id="integration-panel-telegram">
          <TelegramIntegrationForm view={telegram} />
        </div>
      )}
      {open === "captcha" && (
        <div id="integration-panel-captcha">
          <CaptchaIntegrationForm view={captcha} />
        </div>
      )}
    </div>
  );
}

function IntegrationTile({ view, icon, title, sub, channel, panelId, expanded, busy, disabled, onEdit, onTest }: {
  view: IntegrationView<unknown>;
  icon: LucideIcon;
  title: string;
  sub: string;
  channel: ErrorChannel;
  panelId: string;
  expanded: boolean;
  busy: boolean;
  disabled: boolean;
  onEdit: () => void;
  onTest: () => void;
}) {
  const { t, locale } = useI18n();

  const lastTested = view.last_tested_at
    ? new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB",
      { dateStyle: "short", timeStyle: "short" }).format(new Date(view.last_tested_at))
    : t("comm.never");

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={title} sub={sub} icon={icon}
        action={<Badge tone={STATUS_TONE[view.status]} dot>{t(`comm.status.${view.status}`)}</Badge>}
      />
      <div className="mt-auto space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
        <p className="text-[12px] text-faint">{t("comm.lastTested")}: {lastTested}</p>
        {view.status === "error" && <TileError detail={view.last_error_safe} channel={channel} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onEdit} aria-expanded={expanded} aria-controls={panelId}>
            <Pencil size={14} aria-hidden />
            {t("comm.edit")}
          </Button>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onTest}>
            <PlugZap size={14} aria-hidden />
            {busy ? "…" : t("comm.test")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * last_error_safe holds two different things: a stable code (Telegram) and an
 * already-scrubbed sentence from a mail server. A code has to be translated —
 * printing "auth" at an admin is the raw-key failure mode — while a sentence
 * is the detail that actually helps, so it is shown as it was stored.
 */
function TileError({ detail, channel }: { detail: string | null; channel: ErrorChannel }) {
  const { t } = useI18n();
  const raw = detail?.trim();
  if (!raw) return null;
  const looksLikeCode = /^[a-z][a-z0-9_]{2,30}$/.test(raw);
  const text = looksLikeCode ? t(integrationErrorKey(raw, channel)) : raw;
  return <p className="line-clamp-2 text-[12px] text-danger" title={text}>{text}</p>;
}

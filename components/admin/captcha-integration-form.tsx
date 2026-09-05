"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { saveCaptchaIntegrationAction, testCaptchaAction } from "@/app/actions/integrations";
import type { CaptchaConfig, IntegrationView } from "@/lib/server/integrations";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/modal";
import { integrationErrorKey } from "@/components/admin/integration-cards";

/**
 * CAPTCHA — the Cloudflare Turnstile pair that guards the registration form.
 *
 * The secret key behaves exactly like the mail passwords: write-only, empty
 * means keep. The site key is public by nature — it is rendered into the
 * registration page for every visitor — so it is an ordinary input. The
 * captcha only arms once BOTH halves are stored; until then registration
 * simply works without it, which is what the hint under the fields says.
 */

type Busy = "test" | null;

export function CaptchaIntegrationForm({ view, encryptionReady }: {
  view: IntegrationView<CaptchaConfig>;
  encryptionReady: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [siteKey, setSiteKey] = useState(view.config.site_key);
  const [secretKey, setSecretKey] = useState("");
  /** Whether a ciphertext exists — never the key itself. */
  const [storedSecret, setStoredSecret] = useState(view.hasSecret.secret_key === true);

  const working = pending || busy !== null;

  async function persist(): Promise<boolean> {
    const res = await saveCaptchaIntegrationAction({
      siteKey,
      secretKey: secretKey || undefined,
    });
    if (!res.ok) {
      toast.error(t(integrationErrorKey(res.error, "captcha")));
      return false;
    }
    if (secretKey.trim()) setStoredSecret(true);
    // The plaintext leaves the screen the moment it is stored.
    setSecretKey("");
    return true;
  }

  function save() {
    start(async () => {
      if (!(await persist())) return;
      toast.success(t("comm.saved"));
      router.refresh();
    });
  }

  /** The test reads the STORED secret, so a key typed a second ago has to be
   *  saved first — same as detecting Telegram chats. */
  async function test() {
    setBusy("test");
    if (!(await persist())) {
      setBusy(null);
      return;
    }
    const res = await testCaptchaAction();
    setBusy(null);
    if (res.ok) toast.success(t("comm.captchaOk"));
    else toast.error(t(integrationErrorKey(res.error, "captcha")));
    router.refresh();
  }

  return (
    <Card data-captcha-integration>
      <CardHeader title={t("comm.captchaTile")} sub={t("comm.captchaTileSub")} icon={ShieldCheck} />
      <div className="space-y-6 p-4 pt-0 sm:p-5 sm:pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="captcha-site">{t("comm.siteKey")}</Label>
            <Input id="captcha-site" autoComplete="off" maxLength={100} value={siteKey}
              onChange={(e) => setSiteKey(e.target.value)} />
          </div>
          <fieldset disabled={!encryptionReady} className="min-w-0 disabled:opacity-60"
            title={encryptionReady ? undefined : t("comm.encryptionMissing")}>
            <Label htmlFor="captcha-secret">{t("comm.secretKey")}</Label>
            <SecretInput id="captcha-secret" value={secretKey} onChange={setSecretKey}
              placeholder={storedSecret ? t("comm.savedSecret") : ""} />
          </fieldset>
        </div>
        <p className="text-[12px] leading-relaxed text-faint">{t("comm.captchaDisabledHint")}</p>

        <section className="space-y-2 border-t border-line pt-5">
          <p className="overline">{t("comm.captchaHelpTitle")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-muted">
            <li>{t("comm.captchaHelp1")}</li>
            <li>{t("comm.captchaHelp2")}</li>
            <li>{t("comm.captchaHelp3")}</li>
            <li>{t("comm.captchaHelp4")}</li>
          </ol>
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <Button size="sm" variant="secondary" disabled={working} onClick={test}>
            {busy === "test" ? "…" : t("comm.testCaptcha")}
          </Button>
          <span className="hidden flex-1 sm:block" />
          <Button size="sm" disabled={working} onClick={save} data-captcha-save>
            {t("comm.save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

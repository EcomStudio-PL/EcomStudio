"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Radar, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  detectTelegramChatsAction, saveTelegramIntegrationAction, testTelegramAction,
  type TelegramChat,
} from "@/app/actions/integrations";
import type { IntegrationView, TelegramConfig } from "@/lib/server/integrations";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, Label } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/modal";
import { integrationErrorKey } from "@/components/admin/integration-cards";

/**
 * TELEGRAM — the bot that carries every notification GrovBase sends.
 *
 * The bot token behaves exactly like the mail passwords: write-only, empty
 * means keep. The Chat ID is the part admins get wrong, so the form both
 * explains the four manual steps and offers to detect the chats the bot has
 * actually seen — which needs a stored token, hence the save before the call.
 */

type Busy = "detect" | "test" | null;

export function TelegramIntegrationForm({ view, encryptionReady }: {
  view: IntegrationView<TelegramConfig>;
  encryptionReady: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [chatId, setChatId] = useState(view.config.chat_id);
  const [channelName, setChannelName] = useState(view.config.channel_name);
  const [botToken, setBotToken] = useState("");
  /** Whether a ciphertext exists — never the token. */
  const [storedToken, setStoredToken] = useState(view.hasSecret.bot_token === true);
  /** null until the admin asks; an empty array is a real answer ("no chats"). */
  const [chats, setChats] = useState<TelegramChat[] | null>(null);

  const working = pending || busy !== null;

  async function persist(): Promise<boolean> {
    const res = await saveTelegramIntegrationAction({
      chat_id: chatId,
      channel_name: channelName,
      // No on/off switch on this screen: the integration is live once a token
      // and a chat are stored, so the flag follows them.
      enabled: (storedToken || botToken.trim().length > 0) && chatId.trim().length > 0,
      botToken: botToken || undefined,
    });
    if (!res.ok) {
      toast.error(t(integrationErrorKey(res.error, "telegram")));
      return false;
    }
    if (botToken.trim()) setStoredToken(true);
    // The plaintext leaves the screen the moment it is stored.
    setBotToken("");
    return true;
  }

  function save() {
    start(async () => {
      if (!(await persist())) return;
      toast.success(t("comm.saved"));
      router.refresh();
    });
  }

  /** Detecting reads the STORED token, so a token typed a second ago has to be
   *  saved first — otherwise the admin would be told the bot is unconfigured. */
  async function detect() {
    setBusy("detect");
    if (!(await persist())) {
      setBusy(null);
      return;
    }
    const res = await detectTelegramChatsAction();
    setBusy(null);
    if (!res.ok) {
      toast.error(t(integrationErrorKey(res.error, "telegram")));
      return;
    }
    // An empty list is a normal answer — Telegram only reports recent traffic —
    // so it is shown in place, next to the hint that explains how to fix it.
    setChats(res.chats);
    router.refresh();
  }

  async function test() {
    setBusy("test");
    if (!(await persist())) {
      setBusy(null);
      return;
    }
    const res = await testTelegramAction();
    setBusy(null);
    if (res.ok) toast.success(t("comm.tgOk"));
    else toast.error(t(integrationErrorKey(res.error, "telegram")));
    router.refresh();
  }

  return (
    <Card data-telegram-integration>
      <CardHeader title={t("comm.tgTile")} sub={t("comm.tgTileSub")} icon={Send} />
      <div className="space-y-6 p-4 pt-0 sm:p-5 sm:pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset disabled={!encryptionReady} className="min-w-0 disabled:opacity-60 sm:col-span-2"
            title={encryptionReady ? undefined : t("comm.encryptionMissing")}>
            <Label htmlFor="tg-token">{t("comm.botToken")}</Label>
            <SecretInput id="tg-token" value={botToken} onChange={setBotToken}
              placeholder={storedToken ? t("comm.savedSecret") : ""} />
          </fieldset>
          <div>
            <Label htmlFor="tg-chat">{t("comm.chatId")}</Label>
            <Input id="tg-chat" autoComplete="off" inputMode="text" value={chatId}
              onChange={(e) => setChatId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tg-channel">{t("comm.channelName")}</Label>
            <Input id="tg-channel" value={channelName} onChange={(e) => setChannelName(e.target.value)} />
          </div>
        </div>

        <section className="space-y-3 border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={working} onClick={detect}>
              <Radar size={14} aria-hidden />
              {busy === "detect" ? "…" : t("comm.detectChatId")}
            </Button>
            <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-faint">{t("comm.detectHint")}</p>
          </div>
          {chats !== null && (
            chats.length === 0
              ? <p className="text-[12.5px] text-muted">{t("comm.noChats")}</p>
              : (
                <div className="flex flex-wrap gap-2">
                  {chats.map((c) => (
                    <Chip key={c.id} active={chatId === c.id} disabled={working}
                      onClick={() => setChatId(c.id)} title={`${c.type} · ${c.id}`}>
                      {c.title || c.id}
                    </Chip>
                  ))}
                </div>
              )
          )}
        </section>

        <section className="space-y-2 border-t border-line pt-5">
          <p className="overline">{t("comm.tgHelpTitle")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-muted">
            <li>{t("comm.tgHelp1")}</li>
            <li>{t("comm.tgHelp2")}</li>
            <li>{t("comm.tgHelp3")}</li>
            <li>{t("comm.tgHelp4")}</li>
          </ol>
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <Button size="sm" variant="secondary" disabled={working} onClick={test}>
            {busy === "test" ? "…" : t("comm.testTelegram")}
          </Button>
          <span className="hidden flex-1 sm:block" />
          <Button size="sm" disabled={working} onClick={save} data-telegram-save>
            {t("comm.save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

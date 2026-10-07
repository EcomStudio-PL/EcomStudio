"use client";
import { useEffect, useState, useTransition } from "react";
import { Globe2, Layers, ShoppingBag, Store } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { saveSellerChannelAction } from "@/app/actions/seller-home";
import { CHANNEL_DEFAULT_TASK, SELLER_CHANNELS, channelLabelKey, type SellerChannel } from "@/lib/seller-home-config";
import { setSelectedTask } from "./task-store";

const ICON: Record<SellerChannel, typeof Store> = {
  allegro: ShoppingBag, amazon: Globe2, own_store: Store, multi: Layers,
};

/**
 * "GDZIE SPRZEDAJESZ?" — one question, once, for a seller with no generation
 * yet. The answer goes to the profile (seller_channel) and pre-selects the
 * matching hero task right away; closing it records that it was asked, so it
 * never comes back. The server decides whether to ask (lib/server/seller-home)
 * — it is not asked while the welcome-bonus dialog is due, nor when the bonus
 * survey already answered it.
 *
 * Opened after mount: the dialog is portalled to <body>, which does not exist
 * during the server render.
 */
export function SellerChannelModal({ ask }: { ask: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { if (ask) setOpen(true); }, [ask]);

  const choose = (channel: SellerChannel) => {
    setSelectedTask(CHANNEL_DEFAULT_TASK[channel]);
    setOpen(false);
    start(async () => { await saveSellerChannelAction(channel); });
  };
  const dismiss = () => {
    setOpen(false);
    start(async () => { await saveSellerChannelAction(null); });
  };

  return (
    <Modal open={open} onClose={dismiss} title={t("sellerHome.channel.title")} portal>
      <p className="-mt-2 text-[14px] text-muted">{t("sellerHome.channel.sub")}</p>
      <div role="group" aria-label={t("sellerHome.channel.title")} className="mt-4 grid grid-cols-2 gap-2.5" data-seller-channel>
        {SELLER_CHANNELS.map((c) => {
          const Icon = ICON[c];
          return (
            <button key={c} type="button" disabled={pending} onClick={() => choose(c)} data-channel={c}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.5))] bg-[rgb(var(--surface)/0.7)] p-3.5 text-left transition-colors",
                "hover:border-[rgb(var(--accent)/0.5)] hover:bg-[rgb(var(--accent)/0.05)] disabled:opacity-60",
              )}>
              <Icon size={18} aria-hidden className="text-accent-strong dark:text-accent" />
              <span className="text-[14px] font-semibold text-ink">{t(channelLabelKey(c))}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

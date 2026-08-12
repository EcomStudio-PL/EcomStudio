"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Sparkles, Star } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export type InspirationCard = {
  id: string; title: string; description: string | null; category: string;
  prompt: string; negative_prompt: string | null; model_slug: string | null;
  format: string | null; tags: string[]; premium: boolean; featured: boolean;
  before_url: string | null; after_urls: string[]; video_url: string | null;
};

export function InspirationGallery({ items, categories }: {
  items: InspirationCard[]; categories: string[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<InspirationCard | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) =>
      (!cat || i.category === cat) &&
      (!needle || i.title.toLowerCase().includes(needle) || i.prompt.toLowerCase().includes(needle) ||
        i.tags.some((tg) => tg.toLowerCase().includes(needle)))
    );
  }, [items, q, cat]);

  function usePrompt(item: InspirationCard) {
    navigator.clipboard.writeText(item.prompt).catch(() => {});
    toast.success(t("insp.copied"));
    router.push(`/generator?prompt=${encodeURIComponent(item.prompt)}`);
  }

  const featured = filtered.filter((i) => i.featured);
  const rest = filtered.filter((i) => !i.featured);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Input placeholder={`${t("common.search")}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCat(null)}
            className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              !cat ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
            {t("insp.all")}
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCat(c === cat ? null : c)}
              className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                c === cat ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
              {t(`insp.cat.${c}`)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">{t("insp.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("insp.emptyBody")}</p>
        </div>
      ) : (
        <>
          {featured.length > 0 && (
            <>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                <Star size={12} className="text-accent2" /> Featured
              </p>
              <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((i) => <Card key={i.id} item={i} onOpen={setOpenItem} />)}
              </div>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((i) => <Card key={i.id} item={i} onOpen={setOpenItem} />)}
          </div>
        </>
      )}

      <Modal open={!!openItem} onClose={() => setOpenItem(null)} title={openItem?.title ?? ""} wide>
        {openItem && (
          <div className="space-y-4">
            {openItem.after_urls.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {openItem.before_url && (
                  <figure className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={openItem.before_url} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                    <figcaption className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">{t("landing.before")}</figcaption>
                  </figure>
                )}
                {openItem.after_urls.map((u, i) => (
                  <figure key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                    <figcaption className="brand-gradient absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white">{t("landing.after")}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {openItem.description && <p className="text-sm text-muted">{openItem.description}</p>}
            <div className="rounded-xl bg-raised p-3.5">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Prompt</p>
              <p className="whitespace-pre-wrap text-sm">{openItem.prompt}</p>
            </div>
            {openItem.negative_prompt && (
              <div className="rounded-xl bg-raised p-3.5">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Negative</p>
                <p className="whitespace-pre-wrap text-sm text-muted">{openItem.negative_prompt}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {openItem.model_slug && <Badge tone="indigo">{openItem.model_slug}</Badge>}
              {openItem.format && <Badge tone="neutral">{openItem.format}</Badge>}
              {openItem.tags.map((tg) => <span key={tg} className="text-faint">#{tg}</span>)}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(openItem.prompt); toast.success(t("insp.copied")); }}>
                <Copy size={14} /> {t("prompts.copy")}
              </Button>
              <Button onClick={() => usePrompt(openItem)}>
                <Sparkles size={14} /> {t("insp.use")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );

  function Card({ item, onOpen }: { item: InspirationCard; onOpen: (i: InspirationCard) => void }) {
    const cover = item.after_urls[0] ?? item.before_url;
    return (
      <button type="button" onClick={() => onOpen(item)}
        className="glass group overflow-hidden rounded-2xl text-left transition-transform duration-150 hover:-translate-y-0.5">
        <div className="relative aspect-[4/3] bg-gradient-to-br from-accent/15 via-raised to-accent2/10">
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
          )}
          {item.premium && (
            <span className="absolute right-2 top-2 rounded-full bg-accent2 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Premium</span>
          )}
        </div>
        <div className="p-3.5">
          <p className="truncate text-sm font-semibold">{item.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{item.description ?? item.prompt}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <Badge tone="indigo">{t(`insp.cat.${item.category}`)}</Badge>
            <span className="ml-auto text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
              {t("insp.use")} →
            </span>
          </div>
        </div>
      </button>
    );
  }
}

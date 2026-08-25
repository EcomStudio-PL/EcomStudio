import Link from "next/link";
import { Clock, Film, Info, Ratio, Sparkles } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { VIDEO_CREATE_WF, VIDEO_EDIT_WF, VIDEO_ENABLED, type VideoWorkflow } from "@/lib/categories";

export const dynamic = "force-static";

/**
 * VIDEO — the section is built for real: the workflows, their framing and
 * their length are all here, laid out exactly as the image workspaces are.
 *
 * What is NOT here is a generate button. No video provider is connected, so
 * every entry is disabled behind one honest notice; nothing on this page can
 * spend a credit or promise an asset that would never arrive. When the
 * backend lands, `VIDEO_ENABLED` flips and these cards become links.
 */
export default async function VideoPage() {
  const { dict } = await getDictionary();
  const t = makeT(dict);

  return (
    <div>
      <PageHeader overline={t("video.overline")} title={t("video.title")} sub={t("video.sub")} />

      {/* THE HONEST NOTICE — stated once, at the top, before any card. */}
      {!VIDEO_ENABLED && (
        <div className="panel relative mb-5 overflow-hidden rounded-2xl p-5 sm:p-6">
          <span aria-hidden className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(30rem 16rem at 12% -20%, rgb(var(--violet) / 0.20), transparent 70%)" }} />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start">
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--violet)/0.18)] text-[rgb(var(--violet))]">
              <Info size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold tracking-tight">{t("video.notReadyTitle")}</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{t("video.notReadyBody")}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link href="/prompts" className="cta inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold">
                  <Sparkles size={15} aria-hidden />
                  {t("mega.engine")}
                </Link>
                <Link href="/products"
                  className="plate inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-[rgb(var(--accent)/0.4)]">
                  {t("nav.products")}
                </Link>
                <p className="w-full text-[12.5px] text-faint sm:w-auto sm:pl-2">{t("video.meanwhileBody")}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <section>
        <SectionHeader overline={t("mega.create")} title={t("video.createTitle")} className="mb-3.5" />
        <div className="stagger grid grid-cols-2 gap-3 [&>*]:min-w-0 md:grid-cols-3 xl:grid-cols-6">
          {VIDEO_CREATE_WF.map((w) => <VideoCard key={w.key} w={w} t={t} />)}
        </div>
      </section>

      <section className="mt-6">
        <SectionHeader overline={t("mega.edit")} title={t("video.editTitle")} className="mb-3.5" />
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0 md:grid-cols-3 xl:grid-cols-6">
          {VIDEO_EDIT_WF.map((w) => <VideoCard key={w.key} w={w} t={t} />)}
        </div>
      </section>
    </div>
  );
}

/** One video workflow. Rendered as a card, never as a link, while the
 *  backend is missing — a disabled control is honest, a dead link is not. */
function VideoCard({ w, t }: { w: VideoWorkflow; t: (k: string) => string }) {
  const Icon = w.icon;
  return (
    <div id={w.key} className="panel flex flex-col rounded-2xl p-4 opacity-75" aria-disabled>
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-raised text-faint">
        <Icon size={19} strokeWidth={1.9} />
      </span>
      <span className="mt-3 flex flex-wrap items-center gap-1.5 text-sm font-semibold tracking-tight">
        {t(`video.wf.${w.key}.name`)}
        <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
          {t("common.soon")}
        </span>
      </span>
      <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">{t(`video.wf.${w.key}.sub`)}</span>
      <span className="mt-3 flex items-center gap-3 border-t border-line pt-2.5 text-[11px] font-medium text-faint">
        <span className="inline-flex items-center gap-1"><Ratio size={11} aria-hidden />{w.ratio}</span>
        <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden />{w.length}</span>
        <Film size={12} aria-hidden className="ml-auto" />
      </span>
    </div>
  );
}

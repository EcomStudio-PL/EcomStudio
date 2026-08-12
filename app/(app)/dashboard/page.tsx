import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Box, Images, Plus, Sparkles, Wand2, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { listJobs } from "@/lib/services/generator";
import { signImageUrls } from "@/lib/services/images";
import { Stat } from "@/components/ui/stat";
import { Panel } from "@/components/ui/surface";
import { PanelHeader } from "@/components/ui/section-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

/** Credits at which the wallet meter reads "full" — a visual scale, never a cap. */
const CREDIT_SCALE = 200;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!workspace || !profile) return null;
  const [wallet, products, jobs, gens] = await Promise.all([
    getWallet(supabase, workspace.id),
    listProducts(supabase, workspace.id, 5),
    listJobs(supabase, workspace.id, 5),
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
  ]);
  const firstName = (profile.full_name ?? profile.email).split(" ")[0];
  const credits = wallet?.balance ?? 0;

  if (products.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-6 sm:py-10">
        <Panel className="relative overflow-hidden rounded-3xl p-7 text-center sm:p-9">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-28 h-64"
            style={{ background: "radial-gradient(30rem 14rem at 50% 0%, rgb(var(--accent) / 0.26), transparent 70%)" }}
          />
          <div className="relative">
            <p className="frame-mark mx-auto mb-6 inline-block px-2 font-display text-[11px] uppercase tracking-[0.24em] text-accent">
              EcomStudio
            </p>
            <h1 className="display-lg">{t("dashboard.onbTitle")}</h1>
            <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-muted">{t("dashboard.onbSub")}</p>
            <ol className="mx-auto mt-7 max-w-xs space-y-2.5 text-left text-sm">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="plate flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <span className="brand-gradient flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white">
                    {n}
                  </span>
                  <span className="min-w-0 flex-1">{t(`dashboard.onb${n}`)}</span>
                </li>
              ))}
            </ol>
            <Link href="/products/new"
              className="cta mt-8 inline-flex h-12 items-center gap-2 rounded-2xl px-6 text-[15px] font-semibold">
              <Sparkles size={17} aria-hidden />
              {t("dashboard.onbCta")}
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  const thumbPaths = products
    .map((p) => (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path)
    .filter((v): v is string => !!v);
  const urls = await signImageUrls(supabase, thumbPaths);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* HERO — greeting, workspace state and the two actions that start work. */}
      <Panel className="relative overflow-hidden rounded-3xl">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-[26rem]"
          style={{ background: "radial-gradient(20rem 12rem at 70% 40%, rgb(var(--accent) / 0.30), transparent 72%)" }}
        />
        <div className="relative p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <span aria-hidden className="accent-rule h-px w-7 rounded-full" />
            <span className="overline">{workspace.name}</span>
          </div>
          <h1 className="display-xl mt-2.5">{t("dashboard.welcome", { name: firstName })}</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{t("dashboard.sub")}</p>

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link href="/products/new"
              className="cta inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold">
              <Plus size={17} aria-hidden />
              {t("dashboard.newProduct")}
            </Link>
            <Link href="/generator"
              className="plate inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold text-ink transition-colors hover:border-[rgb(var(--accent)/0.4)]">
              <Wand2 size={17} className="text-accent" aria-hidden />
              {t("nav.generator")}
            </Link>
            <Link href="/prompts"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-muted transition-colors hover:text-ink">
              <Sparkles size={16} className="text-accent2" aria-hidden />
              {t("nav.promptsShort")}
              <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </Panel>

      {/* METRICS */}
      <div className="stagger grid grid-cols-2 gap-3 [&>*]:min-w-0 lg:grid-cols-4">
        <Stat label={t("dashboard.statProducts")} value={products.length} icon={Box} href="/products" />
        <Stat label={t("dashboard.statGenerations")} value={gens.count ?? 0} icon={Images} href="/library" />
        <Stat label={t("dashboard.statCredits")} value={credits} icon={Zap} tone="accent"
          meter={Math.min(1, credits / CREDIT_SCALE)} href="/credits" />
        <Stat label={t("dashboard.statPlan")} value="Free" icon={Sparkles} tone="accent2" href="/plan" />
      </div>

      {/* WORK IN PROGRESS */}
      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            overline={t("nav.groups.work")}
            title={t("dashboard.recentProducts")}
            icon={Box}
            action={
              <Link href="/products" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-75">
                {t("common.viewAll")} <ArrowRight size={13} aria-hidden />
              </Link>
            }
          />
          <ul className="divide-y divide-line">
            {products.map((p) => {
              const thumb = (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path;
              const url = thumb ? urls.get(thumb) : undefined;
              return (
                <li key={p.id}>
                  <Link href={`/products/${p.id}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-raised/60 sm:px-5">
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
                      {url
                        ? <Image src={url} alt="" fill sizes="44px" className="object-cover" />
                        : <span className="flex h-full items-center justify-center text-muted">◨</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-[11px] text-faint">
                        {p.category ?? "—"}
                      </span>
                    </span>
                    <Badge tone={p.status === "ready" ? "green" : "neutral"} dot>
                      {t(`products.status.${p.status}`)}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader
            overline={t("nav.groups.assets")}
            title={t("dashboard.recentJobs")}
            icon={Images}
            action={
              <Link href="/history" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-75">
                {t("common.viewAll")} <ArrowRight size={13} aria-hidden />
              </Link>
            }
          />
          {jobs.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <span aria-hidden className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-raised text-accent">
                <Sparkles size={18} />
              </span>
              <p className="text-sm text-muted">{t("history.emptyBody")}</p>
              <Link href="/generator" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:opacity-75">
                {t("nav.generator")} <ArrowRight size={13} aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-raised text-accent">
                    <Sparkles size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{j.products?.name ?? "—"}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatDate(j.created_at, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

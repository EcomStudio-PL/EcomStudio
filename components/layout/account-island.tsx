"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * ACCOUNT ISLAND — the control centre at the top of every drawer.
 *
 * One elevated surface carrying identity, the two facts that matter for this
 * surface (plan + credits for a customer, business KPIs for staff) and the
 * actions the user would otherwise have to go hunting for: buying credits,
 * managing the plan, reaching support. Both drawers use this component, so
 * customer and admin read as two modes of one product rather than two apps.
 */
export function AccountIsland({ initial, name, email, tone = "accent", badge, facts, primaryAction, secondaryActions, close, standalone }: {
  initial: string;
  name: string;
  email?: string;
  tone?: "accent" | "accent2";
  badge?: React.ReactNode;
  /** Two or three compact KPIs shown as value-over-label. */
  facts: { label: string; value: React.ReactNode; tone?: "accent" | "accent2" | "ink" }[];
  primaryAction?: { href: string; label: string; icon?: LucideIcon };
  secondaryActions?: { href: string; label: string; icon?: LucideIcon }[];
  /** Close control, rendered in the island's top-right corner. */
  close?: React.ReactNode;
  /** True in the desktop rail, where the island is a card in its own right. */
  standalone?: boolean;
}) {
  return (
    <div className={cn(
      // Flush to the drawer's top and side edges; only the bottom corners are
      // rounded, so this reads as the drawer's own account area rather than a
      // card dropped inside it. `standalone` restores the full radius for the
      // desktop rail, where the island genuinely is a card.
      "island relative overflow-hidden",
      standalone
        ? "rounded-3xl p-4"
        : "rounded-b-3xl px-4 pb-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))]",
      tone === "accent2" && "island-admin"
    )}>
      <div className="relative flex items-start gap-3">
        <span aria-hidden className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold shadow-e2",
          tone === "accent2" ? "bg-accent2 text-[rgb(var(--bg))]" : "brand-gradient text-white"
        )}>
          {initial}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[15px] font-semibold leading-tight">{name}</p>
          {email && <p className="mt-0.5 truncate text-xs text-muted">{email}</p>}
        </div>
        {close}
      </div>

      {badge && <div className="relative mt-3">{badge}</div>}

      {/* Facts read value-first: the number is what the user came for. */}
      <dl className={cn("relative mt-4 grid gap-3", facts.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dd className={cn("metric truncate text-[19px] leading-none",
              f.tone === "accent2" ? "text-accent2" : f.tone === "ink" ? "text-ink" : "text-accent")}>
              {f.value}
            </dd>
            <dt className="mt-1 truncate text-[11px] font-medium text-muted">{f.label}</dt>
          </div>
        ))}
      </dl>

      {(primaryAction || secondaryActions?.length) && (
        <div className="relative mt-4 space-y-2">
          {primaryAction && (
            <Link href={primaryAction.href}
              className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold">
              {primaryAction.icon && <primaryAction.icon size={16} aria-hidden />}
              {primaryAction.label}
            </Link>
          )}
          {secondaryActions && secondaryActions.length > 0 && (
            <div className="flex items-center gap-2">
              {secondaryActions.map((a) => (
                <Link key={a.href} href={a.href}
                  className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[rgb(var(--ink)/0.06)] px-3 text-[13px] font-semibold text-muted transition-colors hover:bg-[rgb(var(--ink)/0.1)] hover:text-ink">
                  {a.icon && <a.icon size={14} aria-hidden className="shrink-0" />}
                  <span className="truncate">{a.label}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

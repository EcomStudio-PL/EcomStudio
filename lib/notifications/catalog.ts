import { featureDescriptor, isFeatureKey } from "@/lib/features";

/**
 * POWIADOMIENIA V2 — WHAT EACH NOTIFICATION IS, AND WHAT IT SAYS.
 *
 * Client-safe. The bell, the bar under the header, the generation toast and
 * the admin's preview all render through `presentNotification`, so a code
 * like `provider_error`, a tool key like `ecommerce_thumbnail` or a provider's
 * name can never reach a customer's screen: a row is described by its TYPE
 * and its META (written by lib/server/user-notifications.ts), and the words
 * come from the dictionaries. The row's own title/body are shown only where
 * a person wrote them — an admin's announcement, the subject of a support
 * thread, the welcome bonus copy.
 *
 * THE CATEGORY lives in SQL (public.notification_category, 0160), which a
 * trigger applies to every row. NOTIFICATION_KINDS repeats it for the client;
 * scripts/notifications-tests.ts fails if the two ever disagree.
 */

export type NotificationCategory = "important" | "activity";

export type NotificationIcon =
  | "megaphone" | "card" | "calendar" | "coins" | "message" | "gift" | "image" | "alert" | "bell";

export const NOTIFICATION_KINDS = {
  // IMPORTANT — lights the badge.
  announcement: { category: "important", icon: "megaphone" },
  payment_failed: { category: "important", icon: "card" },
  renewal_failed: { category: "important", icon: "card" },
  plan_expiring: { category: "important", icon: "calendar" },
  credits_granted: { category: "important", icon: "coins" },
  credits_removed: { category: "important", icon: "coins" },
  support_reply: { category: "important", icon: "message" },
  bonus: { category: "important", icon: "gift" },
  // ACTIVITY — never lights the badge.
  generation_done: { category: "activity", icon: "image" },
  generation_failed: { category: "activity", icon: "alert" },
} as const satisfies Record<string, { category: NotificationCategory; icon: NotificationIcon }>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** Unknown types are activity — the same default the SQL map has. */
export function notificationCategory(type: string): NotificationCategory {
  return (NOTIFICATION_KINDS as Record<string, { category: NotificationCategory }>)[type]?.category ?? "activity";
}

/** One row as notification_bell() returns it. */
export type BellNotification = {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  href: string | null;
  meta: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  pinned: boolean;
};

export type BellBanner = { id: string; title: string; body: string | null; href: string | null; meta: Record<string, unknown> };

export type BellPayload = {
  important: BellNotification[];
  activity: BellNotification[];
  /** Unread IMPORTANT rows — the badge. Activity never counts. */
  unread: number;
  banner: BellBanner | null;
};

export const EMPTY_BELL: BellPayload = { important: [], activity: [], unread: 0, banner: null };

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseRow(v: unknown): BellNotification | null {
  const r = rec(v);
  const id = str(r.id);
  const type = str(r.type);
  const created = str(r.created_at);
  if (!id || !type || !created) return null;
  return {
    id, type,
    category: r.category === "important" ? "important" : "activity",
    title: str(r.title) ?? "",
    body: str(r.body),
    href: str(r.href),
    meta: rec(r.meta),
    read_at: str(r.read_at),
    created_at: created,
    pinned: r.pinned === true,
  };
}

/** The RPC's jsonb, read defensively: anything unreadable is "nothing". */
export function parseBell(raw: unknown): BellPayload {
  const r = rec(raw);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(parseRow).filter((n): n is BellNotification => n !== null) : []);
  const b = rec(r.banner);
  const bannerId = str(b.id);
  return {
    important: list(r.important),
    activity: list(r.activity),
    unread: Math.max(0, Math.trunc(num(r.unread) ?? 0)),
    banner: bannerId ? { id: bannerId, title: str(b.title) ?? "", body: str(b.body), href: str(b.href), meta: rec(b.meta) } : null,
  };
}

/**
 * A link a notification may open. An internal path ("/library?open=…" — never
 * "//host" or "/\host", which browsers treat as another site), or an https
 * URL, which opens in a new tab. Anything else — javascript:, data:, http:,
 * whitespace, control characters — is no link at all.
 */
export function safeHref(v: unknown): { href: string; external: boolean } | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 500 || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  if (/^\/(?![/\\])/.test(s) || s === "/") return { href: s, external: false };
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?([/?#]|$)/i.test(s)) return { href: s, external: true };
  return null;
}

/** Tools whose titles have their own grammar (Polish nouns differ in gender). */
const TITLED_TOOLS = new Set(["ecommerce_thumbnail", "retouch", "prompts", "generator"]);

export type T = (key: string, vars?: Record<string, string | number>) => string;

/** The catalogue's own name for a tool (lib/features.ts), or null. */
export function toolName(tool: unknown, t: T): string | null {
  if (typeof tool !== "string" || !isFeatureKey(tool)) return null;
  const d = featureDescriptor(tool);
  return d ? t(d.nameKey) : null;
}

/** The screen a tool lives on — where a retry starts, and where the toast is
 *  not needed (the panel already shows its own result). */
export function toolPath(tool: unknown): string | null {
  if (typeof tool !== "string" || !isFeatureKey(tool)) return null;
  return featureDescriptor(tool)?.path ?? null;
}

function images(n: number, t: T, locale: string): string {
  let form = "other";
  try { form = new Intl.PluralRules(locale).select(n); } catch { /* keep "other" */ }
  return t(`notif.v2.images.${form}`, { n });
}

export type PresentedNotification = {
  icon: NotificationIcon;
  title: string;
  body: string | null;
  link: { href: string; external: boolean } | null;
  /** A button label when the notification carries an explicit call to action. */
  cta: string | null;
};

/** A stored code is never text: snake_case or dotted words with no spaces. */
const looksLikeCode = (s: string) => /^[a-z0-9]+([._:-][a-z0-9]+)*$/i.test(s.trim()) && !/\s/.test(s.trim());

/** Generation titles: per tool where the grammar needs it, else generic. */
function generationTitle(kind: "done" | "failed", tool: unknown, t: T): string {
  if (typeof tool === "string" && TITLED_TOOLS.has(tool)) return t(`notif.v2.${kind}.${tool}`);
  const name = toolName(tool, t);
  return name ? t(`notif.v2.${kind}.named`, { tool: name }) : t(`notif.v2.${kind}.any`);
}

/**
 * EVERYTHING A CUSTOMER READS ABOUT A NOTIFICATION. Rows written before V2
 * carry no meta; they still read as plain Polish (the count recovered from the
 * old "… ×N" body, the amount from "+N · reason"), and a failure from then is
 * never described as refunded — nothing on the row proves it was.
 */
export function presentNotification(
  n: Pick<BellNotification, "type" | "title" | "body" | "href" | "meta">, t: T, locale: string,
): PresentedNotification {
  const kind = (NOTIFICATION_KINDS as Record<string, { icon: NotificationIcon }>)[n.type];
  const icon: NotificationIcon = kind?.icon ?? "bell";
  const m = n.meta ?? {};
  switch (n.type) {
    case "announcement": {
      const link = safeHref(m.cta_href ?? n.href);
      const label = str(m.cta_label);
      return { icon, title: n.title, body: n.body, link, cta: link && label ? label : null };
    }
    case "generation_done": {
      const legacy = n.body?.match(/×\s*(\d+)\s*$/);
      const count = num(m.count) ?? (legacy ? Number(legacy[1]) : null);
      const body = count && count > 0
        ? `${images(count, t, locale)} · ${t("notif.v2.openLibrary")}`
        : t("notif.v2.openLibrary");
      return { icon, title: generationTitle("done", m.tool, t), body, link: safeHref(n.href) ?? { href: "/library", external: false }, cta: null };
    }
    case "generation_failed": {
      const refunded = num(m.refunded);
      const body = refunded && refunded > 0
        ? t("notif.v2.failedRefunded", { n: refunded })
        : m.charged === 0 ? t("notif.v2.failedNotCharged") : t("notif.v2.failedRetry");
      const retry = safeHref(toolPath(m.tool)) ?? safeHref(n.href);
      return { icon, title: generationTitle("failed", m.tool, t), body, link: retry, cta: null };
    }
    case "credits_granted":
    case "credits_removed": {
      const legacy = n.body?.match(/^\s*([+-]?\d+)\s*·\s*([\s\S]*)$/);
      const amount = num(m.amount) ?? (legacy ? Number(legacy[1]) : null);
      const reason = (str(m.reason) ?? (legacy ? legacy[2] : null))?.trim() || null;
      const reasonKind = str(m.kind);
      const signed = amount === null ? null : `${amount > 0 ? "+" : ""}${amount}`;
      const titleKey = reasonKind && ["refund", "bonus", "topup", "admin_adjustment"].includes(reasonKind)
        ? `notif.v2.credits.${reasonKind}` : "notif.v2.credits.admin_adjustment";
      return {
        icon,
        title: signed === null ? t("notif.v2.credits.changed") : t(titleKey, { n: signed }),
        body: reason ? t("notif.v2.credits.reason", { reason }) : null,
        link: safeHref(n.href) ?? { href: "/credits", external: false },
        cta: null,
      };
    }
    case "support_reply":
      return {
        icon, title: t("notif.v2.supportReply"),
        body: n.body && !looksLikeCode(n.body) ? n.body : null,
        link: safeHref(n.href) ?? { href: "/support", external: false }, cta: null,
      };
    case "payment_failed":
    case "renewal_failed": {
      const plan = str(m.plan);
      const key = n.type === "payment_failed" ? "paymentFailed" : "renewalFailed";
      return {
        icon,
        title: plan ? t(`notif.v2.${key}.title`, { plan }) : t(`notif.v2.${key}.titleNoPlan`),
        body: t("notif.v2.updatePaymentBody"),
        link: safeHref(n.href) ?? { href: "/credits", external: false },
        cta: t("notif.v2.updatePaymentCta"),
      };
    }
    case "plan_expiring": {
      const plan = str(m.plan);
      const ends = str(m.ends_at);
      let date = "";
      try { date = ends ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }).format(new Date(ends)) : ""; } catch { date = ""; }
      return {
        icon,
        title: t("notif.v2.planExpiring.title", { plan: plan ?? "", date }),
        body: t("notif.v2.planExpiring.body"),
        link: safeHref(n.href) ?? { href: "/credits", external: false },
        cta: t("notif.v2.planExpiring.cta"),
      };
    }
    case "bonus":
      // The welcome-bonus copy is written for customers (an admin's text or
      // the dictionary), so it is shown as written.
      return { icon, title: n.title, body: n.body, link: safeHref(n.href), cta: null };
    default:
      return {
        icon,
        title: n.title && !looksLikeCode(n.title) ? n.title : t("notif.v2.generic"),
        body: n.body && !looksLikeCode(n.body) ? n.body : null,
        link: safeHref(n.href),
        cta: null,
      };
  }
}

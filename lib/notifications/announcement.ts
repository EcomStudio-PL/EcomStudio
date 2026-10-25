import { safeHref } from "@/lib/notifications/catalog";

/**
 * KOMUNIKATY — what an admin's message may be. Client-safe: the form checks
 * as the admin types, and app/actions/announcements.ts checks the very same
 * rules again before anything is written (and 0160's CHECKs a third time).
 */

export type AnnouncementPriority = "normal" | "important";

export type AnnouncementAudience =
  | { kind: "all" }
  | { kind: "no_plan" }
  | { kind: "plans"; plan_ids: string[] }
  | { kind: "user"; user_id: string; email?: string };

export type AnnouncementDraft = {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  priority: AnnouncementPriority;
  audience: AnnouncementAudience;
  /** "now" publishes on save; "schedule" waits for `publishAt`; "draft" saves only. */
  mode: "now" | "schedule" | "draft";
  /** ISO-8601, for "schedule". */
  publishAt: string | null;
  /** ISO-8601 or null — after this the message leaves every bell. */
  expiresAt: string | null;
};

export const ANNOUNCEMENT_LIMITS = { title: 120, body: 600, ctaLabel: 40, ctaHref: 500 } as const;

export type AnnouncementError =
  | "title" | "body" | "cta_label" | "cta_href" | "cta_pair" | "audience" | "plans" | "user"
  | "publish_at" | "expires_at";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = (s: string | null) => {
  if (!s) return null;
  const v = Date.parse(s);
  return Number.isFinite(v) ? v : NaN;
};

/** Every rule a message must meet. Empty list = it may be saved. */
export function validateAnnouncement(d: AnnouncementDraft, now = Date.now()): AnnouncementError[] {
  const errors: AnnouncementError[] = [];
  const title = d.title.trim();
  const body = d.body.trim();
  const label = d.ctaLabel.trim();
  const href = d.ctaHref.trim();
  if (!title || title.length > ANNOUNCEMENT_LIMITS.title) errors.push("title");
  if (!body || body.length > ANNOUNCEMENT_LIMITS.body) errors.push("body");
  if (label.length > ANNOUNCEMENT_LIMITS.ctaLabel) errors.push("cta_label");
  if (href && !safeHref(href)) errors.push("cta_href");
  if (Boolean(label) !== Boolean(href)) errors.push("cta_pair");
  const a = d.audience;
  if (!a || !["all", "no_plan", "plans", "user"].includes(a.kind)) errors.push("audience");
  else if (a.kind === "plans" && (a.plan_ids.length === 0 || !a.plan_ids.every((id) => UUID.test(id)))) errors.push("plans");
  else if (a.kind === "user" && !UUID.test(a.user_id)) errors.push("user");
  const publish = d.mode === "schedule" ? time(d.publishAt) : now;
  if (d.mode === "schedule" && (publish === null || Number.isNaN(publish) || publish <= now)) errors.push("publish_at");
  const expires = time(d.expiresAt);
  if (expires !== null && (Number.isNaN(expires) || expires <= (typeof publish === "number" && Number.isFinite(publish) ? publish : now))) {
    errors.push("expires_at");
  }
  return errors;
}

/** The admin's list: draft / scheduled / active / expired / withdrawn. */
export function announcementState(row: { status: string; expires_at: string | null }, now = Date.now()):
  "draft" | "scheduled" | "active" | "expired" | "withdrawn" {
  if (row.status === "withdrawn") return "withdrawn";
  if (row.status === "draft") return "draft";
  if (row.status === "scheduled") return "scheduled";
  return row.expires_at && Date.parse(row.expires_at) <= now ? "expired" : "active";
}

import "server-only";
import { buildDedupeKey, type NotifyInput } from "@/lib/server/notify";
import { contextRows, eventDataFrom, formatWarsaw, type EventContext } from "@/lib/server/event-context";
import type { AttributionInput } from "./rpc";

/**
 * WHERE A SIGNUP CAME FROM — read on the server, never from the body.
 *
 * middleware.ts stamps the first page view of a visit into the httpOnly
 * `ecs_first_touch` cookie (utm_* / referring HOST / landing path) and never
 * rewrites it; lib/server/event-context.ts reads it back. A browser cannot set
 * an httpOnly cookie from script, so a bot posting to the endpoint cannot write
 * itself a campaign either — the attribution report stays the visitors'.
 *
 * The database records it once per (contact, 'waitlist') and never overwrites
 * it (prelaunch_signup: first capture wins).
 */
export function attributionFrom(ctx: EventContext): AttributionInput {
  const out: AttributionInput = {};
  const put = (key: keyof AttributionInput, value: string | undefined) => {
    if (value && value.trim()) out[key] = value.trim();
  };
  put("utm_source", ctx.utmSource);
  put("utm_medium", ctx.utmMedium);
  put("utm_campaign", ctx.utmCampaign);
  put("utm_content", ctx.utmContent);
  put("utm_term", ctx.utmTerm);
  put("referrer_host", ctx.referrer);
  put("landing_path", ctx.landingPath);
  return out;
}

/**
 * THE "NOWY ZAPIS NA LISTĘ" PING — one builder for both doors.
 *
 * /api/waitlist (the CMS form's forwarder) and the pre-launch signup announce
 * the same event to the operator (Telegram + admin e-mail through notify), so
 * they share one payload: the same rows, the same keyed template data, the
 * same dedupe key. The pre-launch door passes `withIp: false` (S8): its ping
 * fires for a stranger's address typed by anyone, so the raw IP stays out of
 * the outbox — the database has the keyed hash, which is all a throttle needs.
 */
export function waitlistSignupNotice(
  context: EventContext,
  who: { firstName: string; lastName: string; email: string; source: string; locale: string },
  opts: { withIp: boolean } = { withIp: true },
): NotifyInput {
  // "unknown" is the context's own word for "no address": contextRows drops
  // the 📍 row for it and eventDataFrom leaves {{ip}} empty.
  const ctx: EventContext = opts.withIp ? context : { ...context, ip: "unknown" };
  const name = `${who.firstName} ${who.lastName}`.trim();
  const language = who.locale.toUpperCase();
  // Empty rows are dropped rather than rendered as a dangling label, so the
  // fields the visitor left empty simply are not in the message.
  const rows: [string, string][] = [
    ["👤 Użytkownik", name],
    ["📧 E-mail", who.email],
    ["🕒 Data", formatWarsaw(new Date())],
    // Which block of the landing page the visitor used, then what the server
    // saw of the visit: campaign, entry point, address, device.
    ["🌍 Źródło", who.source],
    ...contextRows({ ...ctx, language }),
  ];
  return {
    type: "waitlist.signup",
    title: "NOWY ZAPIS NA LISTĘ",
    icon: "📝",
    rows: rows.filter(([, value]) => value !== ""),
    data: eventDataFrom(ctx, { name, email: who.email, source: who.source, language }),
    footer: "GrovBase Waitlist",
    // The e-mail doubles as the dedupe key, which keeps the ping unique even
    // if the row is ever removed and re-added.
    dedupeKey: buildDedupeKey("waitlist.signup", who.email),
  };
}

import "server-only";
import type { Client } from "@/lib/services/workspace";

/**
 * THE PRE-LAUNCH DATABASE CONTRACT (migration 0144) — one typed wrapper per
 * function, and the only place the app names them.
 *
 * Every write is a SECURITY DEFINER function: the public ones are gated by the
 * proof-of-server token (`p_token`, see lib/server/server-token.ts), the reward
 * grant by the caller's own session, the admin reads by is_admin(). There is
 * no service-role client and no direct table write anywhere in the app.
 *
 * The answers are parsed defensively here — a missing field is "no", never a
 * crash — so a route can map them to its uniform response without guessing.
 */

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
/** Call by name. The generated types learn these functions with 0144; until a
 *  regenerate, the name is checked here, in one place, instead of at every call. */
const call = (supabase: Client, fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as Rpc).call(supabase, fn, args);

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const bool = (v: unknown): boolean => v === true;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

export type ConsentInput = { key: "terms_privacy" | "marketing_email"; version: string; text: string };
export type AttributionInput = Partial<Record<
  "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term" | "referrer_host" | "landing_path", string>>;

export type SignupAnswer =
  | { status: "invalid" | "consent_required" }
  | {
      status: "pending" | "confirmed";
      created: boolean;
      send: boolean;
      tokenId: string | null;
      signupId: string | null;
      email: string | null;
      locale: string;
      /** Only when the signup was CREATED by this call (S7). */
      referralCode: string | null;
      throttled: boolean;
    };

export async function rpcSignup(supabase: Client, token: string, input: {
  email: string; firstName: string | null; locale: string; form: "hero" | "final";
  consents: ConsentInput[]; docVersions: Record<string, string | null>; attribution: AttributionInput;
  refCode: string | null; ipHash: string | null; optinHash: string; answerHash: string;
}): Promise<SignupAnswer | null> {
  const { data, error } = await call(supabase, "prelaunch_signup", {
    p_token: token, p_email: input.email, p_first_name: input.firstName, p_locale: input.locale,
    p_form: input.form, p_consents: input.consents, p_doc_versions: input.docVersions,
    p_attr: input.attribution, p_ref_code: input.refCode, p_ip_hash: input.ipHash,
    p_optin_hash: input.optinHash, p_answer_hash: input.answerHash,
  });
  if (error) return null;
  const r = obj(data);
  if (r.status === "invalid" || r.status === "consent_required") return { status: r.status };
  if (r.status !== "pending" && r.status !== "confirmed") return null;
  return {
    status: r.status, created: bool(r.created), send: bool(r.send),
    tokenId: str(r.token_id), signupId: str(r.signup_id), email: str(r.email),
    locale: str(r.locale) ?? "pl", referralCode: str(r.referral_code), throttled: bool(r.throttled),
  };
}

export type ResendAnswer = { status: "sent" | "noop"; send: boolean; tokenId: string | null; email: string | null; locale: string };

export async function rpcResend(supabase: Client, token: string, input: {
  email: string | null; oldHash: string | null; ipHash: string | null; optinHash: string;
}): Promise<ResendAnswer | null> {
  const { data, error } = await call(supabase, "prelaunch_resend", {
    p_token: token, p_email: input.email, p_old_hash: input.oldHash, p_ip_hash: input.ipHash, p_optin_hash: input.optinHash,
  });
  if (error) return null;
  const r = obj(data);
  return {
    status: r.status === "sent" ? "sent" : "noop", send: bool(r.send),
    tokenId: str(r.token_id), email: str(r.email), locale: str(r.locale) ?? "pl",
  };
}

export type ConfirmAnswer = {
  status: "confirmed" | "already" | "expired" | "invalid";
  /** SERVER ONLY — for the welcome mail; never forwarded to the browser. */
  email: string | null;
  firstName: string | null;
  locale: string;
  referralCode: string | null;
  referralCounted: boolean;
  /** This call is the one that confirmed (send the welcome mail once). */
  welcome: boolean;
};

export async function rpcConfirm(supabase: Client, token: string, tokenHash: string): Promise<ConfirmAnswer | null> {
  const { data, error } = await call(supabase, "prelaunch_confirm", { p_token: token, p_token_hash: tokenHash });
  if (error) return null;
  const r = obj(data);
  const status = r.status === "confirmed" || r.status === "already" || r.status === "expired" ? r.status : "invalid";
  return {
    status, email: str(r.email), firstName: str(r.first_name), locale: str(r.locale) ?? "pl",
    referralCode: str(r.referral_code), referralCounted: bool(r.referral_counted), welcome: bool(r.welcome),
  };
}

export async function rpcSetChannel(supabase: Client, token: string, answerHash: string, channel: string): Promise<"ok" | "invalid" | "expired" | null> {
  const { data, error } = await call(supabase, "prelaunch_set_channel", { p_token: token, p_answer_hash: answerHash, p_channel: channel });
  if (error) return null;
  return data === "ok" || data === "expired" ? data : "invalid";
}

/** Same shape as waitlist_confirmation_payload (0106) — WITHOUT its on/off
 *  switch: a double opt-in mail must always be sendable. */
export type MailPayload = {
  from_name: string; from_email: string; reply_to: string;
  smtp: { host: string; port: number; user: string; encryption: string; ciphertext: string | null; iv: string | null; auth_tag: string | null; password?: string };
};

export async function rpcMailPayload(supabase: Client, token: string): Promise<MailPayload | null> {
  const { data, error } = await call(supabase, "prelaunch_mail_payload", { p_token: token });
  if (error || !data || typeof data !== "object") return null;
  return data as MailPayload;
}

export async function rpcMarkSent(supabase: Client, token: string, tokenId: string, ok: boolean): Promise<void> {
  await call(supabase, "prelaunch_mark_sent", { p_token: token, p_token_id: tokenId, p_ok: ok });
}

export type RewardAnswer = { granted: number; signup: number; referrals: number; error: string | null };

/** The signed-in user's own lazy grant (session-gated in SQL). */
export async function rpcRewardEnsure(supabase: Client): Promise<RewardAnswer | null> {
  const { data, error } = await call(supabase, "prelaunch_reward_ensure");
  if (error) return null;
  const r = obj(data);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { granted: n(r.granted), signup: n(r.signup), referrals: n(r.referrals), error: str(r.error) };
}

export async function rpcPublicConfig(supabase: Client): Promise<unknown> {
  const { data, error } = await call(supabase, "prelaunch_public_config");
  return error ? null : data;
}

/** Admin: scrub a contact's pre-launch rows before the contact is erased. */
export async function rpcForgetContact(supabase: Client, contactId: string): Promise<boolean> {
  const { error } = await call(supabase, "prelaunch_forget_contact", { p_contact: contactId });
  return !error;
}

/**
 * Admin KPIs for Newsletter → Analityka (one SQL source of truth).
 * Shape (all counts are integers; arrays sorted by count desc, max 20 rows):
 * { signups, confirmed, pending, expired, confirm_rate, dois_sent, resends, send_failures,
 *   by_form: [{form, signups, confirmed}],
 *   by_source: [{utm_source, utm_medium, utm_campaign, signups, confirmed}],
 *   by_referrer_host: [{host, signups, confirmed}],
 *   by_channel: [{channel, count}],
 *   referrals: { counted, rejected: [{reason, count}], top: [{signup_id, email, counted}] },
 *   rewards: { signup_claims, signup_credits, referral_claims, referral_credits } }
 * Range: signups whose created_at is in [from, to).
 */
export async function rpcAdminSummary(supabase: Client, from: string, to: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await call(supabase, "prelaunch_admin_summary", { p_from: from, p_to: to });
  return error ? null : obj(data);
}

/**
 * Admin: one contact's pre-launch profile, or null.
 * Shape: { signup: { status, created_at, confirmed_at, form_variant, seller_channel, referral_code,
 *            referred_by_email, referrals_counted, referral_rejected, locale,
 *            attribution: { utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host, landing_path } },
 *          consents: [{ consent_key, consent_version, consent_text, locale, form_variant, accepted_at, confirmed_at, doc_versions }] }
 */
export async function rpcAdminContact(supabase: Client, contactId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await call(supabase, "prelaunch_admin_contact", { p_contact: contactId });
  if (error || !data) return null;
  return obj(data);
}

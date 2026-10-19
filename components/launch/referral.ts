import { REFERRAL_CODE_RE, REFERRAL_PARAM } from "@/lib/launch/fields";

/**
 * WHO SENT THIS VISITOR — kept in the browser until they sign up.
 *
 * A referral link is `/?ref_code=ABCD2345`. The first-touch attribution cookie
 * cannot carry it: it is written once and never overwritten (middleware.ts),
 * so somebody who first came organically and later through a friend's link
 * would arrive with no referral at all. So the code gets its own small memory:
 * `gb_ref` in localStorage, for 30 days, sent with the signup form.
 *
 * Only a well-formed code is kept (8 characters of the unambiguous alphabet,
 * lib/launch/fields.ts); anything else in the parameter is ignored rather than
 * stored and forwarded. The server validates it again and decides on its own
 * whether it counts. Storage can be absent or throw (private mode, blocked
 * site data), so every access is guarded and "no storage" means "no referral".
 */

export const REF_STORAGE_KEY = "gb_ref";
export const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A valid referral code from a query string, or null. */
export function refCodeFromSearch(search: string): string | null {
  let raw: string | null = null;
  try { raw = new URLSearchParams(search).get(REFERRAL_PARAM); } catch { return null; }
  const code = (raw ?? "").trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

/** Remember a code for 30 days. The newest link wins: the person who most
 *  recently sent the visitor here is the one they are acting on. */
export function rememberRef(store: Store | null, code: string, now: number = Date.now()): void {
  if (!store || !REFERRAL_CODE_RE.test(code)) return;
  try { store.setItem(REF_STORAGE_KEY, JSON.stringify({ code, at: now })); } catch { /* no storage, no memory */ }
}

/** The remembered code, if it is still fresh and well-formed. */
export function storedRef(store: Store | null, now: number = Date.now()): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(REF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const fresh = typeof parsed.at === "number" && now - parsed.at >= 0 && now - parsed.at < REF_TTL_MS;
    if (typeof parsed.code === "string" && REFERRAL_CODE_RE.test(parsed.code) && fresh) return parsed.code;
    store.removeItem(REF_STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

/** window.localStorage, or null where touching it throws. */
export function browserStore(): Store | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

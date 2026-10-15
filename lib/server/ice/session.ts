import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { viewerIsAdmin } from "@/lib/server/feature-availability";

/**
 * WHO IS IN THE VISUAL EDITOR, AND ON WHICH PAGE.
 *
 * Two cookies, neither of which grants anything — every use re-checks the
 * role on the server:
 *
 *   gb_ice            "this browser belongs to an admin": the root layout
 *                     looks for the launcher only when it is present, so a
 *                     customer's request does no extra work at all.
 *   gb_ice_e_<hash>   "editing <path>": set when the admin presses „Edytuj
 *                     stronę”, with `Path=<path>` and no Max-Age. The browser
 *                     sends it only on that page (and the paths under it) and
 *                     forgets it when it closes, so edit mode cannot spread to
 *                     other routes or outlive the session. Its value carries
 *                     the page and a random nonce that every marker on the
 *                     page repeats — text from anywhere else cannot pose as an
 *                     editable element.
 */

export const ICE_HINT_COOKIE = "gb_ice";
export const ICE_EDIT_PREFIX = "gb_ice_e_";

export type IceEditSession = { nonce: string; path: string };

/** FNV-1a, 32-bit, hex — a cookie-safe name for a path. */
function hash(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function editCookieName(path: string): string {
  return `${ICE_EDIT_PREFIX}${hash(path)}`;
}

const NONCE = /^[a-z0-9]{8}$/;
const PATH = /^\/[a-zA-Z0-9_\-/.]{0,200}$/;

export function editCookieValue(session: IceEditSession): string {
  return `${session.nonce}~${session.path}`;
}

export function parseEditCookie(value: string | undefined): IceEditSession | null {
  if (!value) return null;
  const at = value.indexOf("~");
  if (at < 0) return null;
  const nonce = value.slice(0, at);
  const path = value.slice(at + 1);
  return NONCE.test(nonce) && PATH.test(path) ? { nonce, path } : null;
}

/** The cookies as sent — no auth call, nothing for a customer to pay. */
export const iceCookies = cache(async (): Promise<{ hint: boolean; edits: IceEditSession[] }> => {
  try {
    const store = await cookies();
    const edits = store.getAll()
      .filter((c) => c.name.startsWith(ICE_EDIT_PREFIX))
      .map((c) => {
        const s = parseEditCookie(c.value);
        // The name is the path's hash: a value moved under another name is not
        // a session for that path.
        return s && editCookieName(s.path) === c.name ? s : null;
      })
      .filter((s): s is IceEditSession => s !== null)
      // The most specific page first: /tools/remove_bg before /tools.
      .sort((a, b) => b.path.length - a.path.length);
    return { hint: store.has(ICE_HINT_COOKIE), edits };
  } catch {
    return { hint: false, edits: [] };
  }
});

/** Whether the viewer is an admin who is not previewing as a customer. */
export const iceViewerIsAdmin = cache(async (): Promise<boolean> => {
  try {
    return await viewerIsAdmin(await createClient());
  } catch {
    return false;
  }
});

/** The edit session this request renders under: only for an admin, only for
 *  the page the cookie names (the most specific one the browser sent). */
export const iceEditSession = cache(async (): Promise<IceEditSession | null> => {
  const { edits } = await iceCookies();
  if (edits.length === 0) return null;
  if (!(await iceViewerIsAdmin())) return null;
  return edits[0];
});

/** Every edit session the browser sent (an admin's), for the CMS layer,
 *  which matches a session to the page it renders by its own path. */
export const iceEditSessions = cache(async (): Promise<IceEditSession[]> => {
  const { edits } = await iceCookies();
  if (edits.length === 0) return [];
  return (await iceViewerIsAdmin()) ? edits : [];
});

export function newNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

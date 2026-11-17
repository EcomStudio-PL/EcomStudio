// The browser-only stand-ins for scripts/v4-tools-tests.ts. Navigation and
// toasts are recorded on the window (window.__pushes, window.__toasts), every
// Storage upload succeeds without leaving the page (window.__uploads).
// Everything else the harness mounts is the real code.

type Rec = { __pushes?: string[]; __toasts?: { kind: string; text: string }[]; __uploads?: string[]; __fx?: { path?: string } };
const w = globalThis as unknown as Rec;

/* next/navigation */
const router = {
  refresh() {}, prefetch() {}, back() {},
  push(href: string) { (w.__pushes ??= []).push(href); },
  replace(href: string) { (w.__pushes ??= []).push(`replace:${href}`); },
};
export function useRouter() { return router; }
export function usePathname() { return w.__fx?.path ?? "/"; }
export function useSearchParams() { return new URLSearchParams(); }

/* @/lib/supabase/client */
const bucket = {
  upload: async (path: string) => { (w.__uploads ??= []).push(path); return { data: { path }, error: null }; },
  createSignedUrls: async () => ({ data: [], error: null }),
};
type Q = { [k: string]: unknown };
const query: Q = {};
for (const k of ["select", "eq", "in", "order", "limit", "neq", "is", "gte", "lte"]) query[k] = () => query;
query.maybeSingle = async () => ({ data: null, error: null });
query.then = (r: (v: unknown) => void) => r({ data: [], error: null });
export function createClient() {
  return {
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => bucket },
    from: () => query,
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
}

/* @/lib/notify — what the customer is told, readable by the test */
const say = (kind: string) => (message: string) => { (w.__toasts ??= []).push({ kind, text: String(message) }); return kind; };
export const notify = {
  success: say("success"), error: say("error"), warning: say("warning"), info: say("info"), message: say("message"),
  dismiss() {},
};
export const toast = notify;

/* Server actions the mounted screens reference (not under test): inert. */
export async function resendConfirmation() { return { ok: true as const }; }
export async function toolPricingAction() { return { ok: false as const }; }
export async function markToolTutorialSeenAction() { return { ok: true as const }; }
export async function trialPaywallAction() { return { ok: false as const, error: "test" }; }
export async function trialPlanSelectedAction() { return { ok: true as const }; }
export async function quotePlanChangeAction() { return { ok: false as const, error: "test" }; }
export async function confirmPlanChangeAction() { return { ok: false as const, error: "test" }; }
export async function cancelPlanChangeAction() { return { ok: true as const }; }
export async function planChangeStatusAction() { return { ok: false as const, error: "test" }; }

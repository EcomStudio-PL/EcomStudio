// Everything the REAL ImageDetails imports that needs a server, swapped for
// inert stand-ins (scripts/preview-sources-tests.ts). Nothing here answers the
// question under test: the sources come from the page's own (routed) fetch.

/* next/navigation */
const router = { refresh() {}, push() {}, replace() {}, prefetch() {}, back() {} };
export function useRouter() { return router; }
export function usePathname() { return "/library"; }
export function useSearchParams() { return new URLSearchParams(); }

/* @/lib/supabase/client — the note save is not under test */
export function createClient() {
  return { rpc: async () => ({ data: null, error: null }) };
}

/* @/app/actions/feedback — 👍/👎 renders, reads "no vote" */
export type ResultVote = { vote: "like" | "dislike"; reasons: string[] } | null;
export async function readResultVoteAction() { return { ok: true as const, vote: null }; }
export async function voteResultAction() { return { ok: true as const }; }

/* @/lib/inflight/store — the GrovShot retake button's hand-off */
export function adoptAccepted() {}

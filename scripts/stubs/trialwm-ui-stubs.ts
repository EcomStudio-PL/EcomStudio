// The trial-watermark UI outside Next (scripts/trialwm-ui-tests.ts): the two
// server actions and next/navigation, answered from a control object the
// test drives. In the browser harness that object is `window.__wm`; in a
// node render nothing calls these (no effect runs on the server).
import type { TrialPaywallResult, TrialUnlockSurface } from "@/lib/trial-watermark/types";

type PlanSelected = { ok: true; href: string } | { ok: false; error: "invalid" | "failed" };

export type WmControl = {
  calls: [string, unknown][];
  pushed: string[];
  paywallReplies: TrialPaywallResult[];
  planReply: PlanSelected;
};

function control(): WmControl {
  const w = (globalThis as unknown as { __wm?: WmControl }).__wm;
  if (!w) throw new Error("trialwm-ui-stubs: no __wm control object");
  return w;
}

export async function trialPaywallAction(input: { assetId: string; surface: TrialUnlockSurface }): Promise<TrialPaywallResult> {
  const w = control();
  w.calls.push(["paywall", input]);
  return w.paywallReplies.shift() ?? { kind: "error" };
}

export async function trialPlanSelectedAction(input: { paywallId: string; assetId: string; planId: string }): Promise<PlanSelected> {
  const w = control();
  w.calls.push(["plan", input]);
  return w.planReply;
}

const router = {
  push: (href: string) => { control().pushed.push(href); },
  replace: (href: string) => { control().pushed.push(`replace:${href}`); },
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

export function useRouter() { return router; }
export function usePathname() { return "/library"; }
export function useSearchParams() { return new URLSearchParams(); }

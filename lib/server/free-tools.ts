import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { ToolSlug } from "@/lib/images/tools";

/**
 * FREE ALLOWANCES — a tool an operator has decided to give away, with a limit
 * that actually holds.
 *
 * Background removal is the obvious candidate: it is what a seller opens
 * first, and at $0.02 it is the cheapest call GrovBase buys. "Free forever,
 * unmetered" is not the same proposition — a hundred images a day per
 * workspace is a real invoice with no revenue against it — so the offer is
 * "free up to N per window", and N is enforced where a browser cannot reach it.
 *
 * TWO RULES SHAPE THIS FILE.
 *
 * The limit is counted and consumed in ONE database statement
 * (`claim_free_tool_run`), never read here and written there. A batch runs
 * three uploads at a time; two workers a millisecond apart would both read
 * "9 of 10 used" and both proceed, and the tenth image would be the twelfth.
 *
 * A grant is taken BEFORE the provider is called and is not handed back if
 * the provider fails. That is deliberate and it is the conservative choice:
 * refunding a free run means a second statement that can itself fail, and the
 * failure mode of not refunding is that a seller loses one of ten free images
 * on a bad day. The failure mode of the alternative is an unbounded free tier.
 */

export type FreeWindow = "day" | "week" | "month";

export type FreeToolRule = {
  enabled: boolean;
  /** Runs granted per window, per workspace. */
  limit: number;
  window: FreeWindow;
  /** Plan slugs the allowance applies to. Empty means every plan. */
  plans: string[];
};

export const FREE_TOOL_DEFAULT: FreeToolRule = {
  enabled: false, limit: 10, window: "day", plans: [],
};

/** Only tools an operator may actually give away. Keeping this closed means a
 *  stray settings key cannot switch the expensive tools to free. */
export const FREE_ELIGIBLE: readonly ToolSlug[] = ["remove_bg"];

function asRule(value: unknown): FreeToolRule {
  const v = (value ?? {}) as Record<string, unknown>;
  const limit = typeof v.limit === "number" && Number.isFinite(v.limit) ? Math.trunc(v.limit) : FREE_TOOL_DEFAULT.limit;
  const window = v.window === "week" || v.window === "month" ? v.window : "day";
  return {
    enabled: v.enabled === true,
    // A negative or absurd limit is a typo in a settings box, not an
    // instruction to give the module away.
    limit: Math.min(1000, Math.max(0, limit)),
    window,
    plans: Array.isArray(v.plans) ? v.plans.filter((p): p is string => typeof p === "string") : [],
  };
}

/** Every configured allowance, keyed by tool slug. */
export async function freeToolRules(supabase: Client): Promise<Map<ToolSlug, FreeToolRule>> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "free_tools").maybeSingle();
  const raw = (data?.value ?? {}) as Record<string, unknown>;
  const out = new Map<ToolSlug, FreeToolRule>();
  for (const slug of FREE_ELIGIBLE) {
    const rule = asRule(raw[slug]);
    if (rule.enabled && rule.limit > 0) out.set(slug, rule);
  }
  return out;
}

/**
 * The start of the current window, in UTC.
 *
 * Calendar boundaries, not a rolling window: "10 a day" that resets at
 * midnight is something a seller can predict, while a trailing 24 hours is a
 * number they cannot see and will read as the counter being broken. Weeks
 * start Monday, which is what the product's locale expects.
 */
export function windowStart(window: FreeWindow, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (window === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (window === "week") {
    // getUTCDay: 0 is Sunday, so Monday-based needs the shift.
    const shift = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - shift);
  }
  return d;
}

/** Does this workspace's plan qualify? An empty list means every plan does. */
export function planQualifies(rule: FreeToolRule, planSlug: string | null): boolean {
  return rule.plans.length === 0 || (planSlug !== null && rule.plans.includes(planSlug));
}

/**
 * Consume one free run if the workspace still has one.
 *
 * Returns the number remaining AFTER this run, or null when the allowance is
 * off, exhausted, or the claim failed for any reason — in which case the
 * caller charges credits exactly as it did before. A broken free tier must
 * never become a broken tool.
 */
export async function claimFreeRun(
  supabase: Client, workspaceId: string, slug: ToolSlug, rule: FreeToolRule,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("claim_free_tool_run", {
    p_workspace_id: workspaceId,
    p_tool_slug: slug,
    p_limit: rule.limit,
    p_window_start: windowStart(rule.window).toISOString(),
  });
  if (error) {
    // Worth a line in the log: an operator who switched the free tier on and
    // sees every run charged needs to know the claim is failing, not that the
    // setting was ignored.
    console.error("free_tools.claim", slug, error.code ?? error.message);
    return null;
  }
  const remaining = typeof data === "number" ? data : -1;
  return remaining < 0 ? null : remaining;
}

/** How many are left, without consuming one. For the badge on the tool card. */
export async function freeRunsRemaining(
  supabase: Client, workspaceId: string, slug: ToolSlug, rule: FreeToolRule,
): Promise<number> {
  const { data, error } = await supabase.rpc("free_tool_remaining", {
    p_workspace_id: workspaceId,
    p_tool_slug: slug,
    p_limit: rule.limit,
    p_window_start: windowStart(rule.window).toISOString(),
  });
  if (error || typeof data !== "number") return 0;
  return Math.max(0, data);
}

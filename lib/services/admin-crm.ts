import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/**
 * THE CUSTOMER LIST.
 *
 * Every filter here maps to a state the database can actually answer for:
 * `blocked` is a column, verification is `auth.users.email_confirmed_at`, the
 * plan is an active subscription, and registration is `created_at`. There is
 * deliberately no "engagement" or "risk" filter — inventing a status the data
 * cannot support is how an admin panel starts lying.
 *
 * Search, filtering, sorting and paging all happen in `admin_customer_rows`
 * (migration 0069). Sorting by spend across 200 rows fetched into memory would
 * have sorted a page, not the customers — which is worse than not offering it.
 */

export const CUSTOMER_SORTS = ["newest", "oldest", "name", "spent", "credits", "active"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const CUSTOMER_STATUSES = ["active", "blocked"] as const;
export const VERIFIED_VALUES = ["yes", "no"] as const;
/** Registration windows, in days. */
export const REGISTERED_WINDOWS = [7, 30, 90] as const;

export type CustomerFilters = {
  search?: string;
  role?: string;
  status?: string;
  verified?: string;
  plan?: string;
  /** Registered within the last N days. */
  registered?: number;
  sort?: CustomerSort;
  page?: number;
  perPage?: number;
};

export type CustomerRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  blocked: boolean;
  createdAt: string;
  verified: boolean;
  lastSignInAt: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  plan: string;
  credits: number;
  spentCents: number;
  generations: number;
  lastActive: string | null;
};

export type CustomerPage = {
  rows: CustomerRow[];
  total: number;
  page: number;
  perPage: number;
};

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | null =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : null;

export async function readCustomers(supabase: Client, filters: CustomerFilters): Promise<CustomerPage> {
  const perPage = Math.min(Math.max(filters.perPage ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);
  const registered = filters.registered && (REGISTERED_WINDOWS as readonly number[]).includes(filters.registered)
    ? new Date(Date.now() - filters.registered * 86_400_000).toISOString()
    : null;

  const { data, error } = await supabase.rpc("admin_customer_rows", {
    p_search: filters.search?.trim() || null,
    p_role: oneOf(filters.role, ["admin", "manager", "user"] as const),
    p_status: oneOf(filters.status, CUSTOMER_STATUSES),
    p_verified: oneOf(filters.verified, VERIFIED_VALUES),
    p_plan: filters.plan?.trim() || null,
    p_since: registered,
    p_sort: oneOf(filters.sort, CUSTOMER_SORTS) ?? "newest",
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });
  if (error || !data) return { rows: [], total: 0, page, perPage };

  return {
    // The window function repeats the same total on every row; an empty page
    // has none, which is exactly zero matches.
    total: Number(data[0]?.total_count ?? 0),
    page,
    perPage,
    rows: data.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.full_name,
      role: r.role,
      blocked: r.blocked,
      createdAt: r.created_at,
      verified: r.verified,
      lastSignInAt: r.last_sign_in_at,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      plan: r.plan,
      credits: Number(r.credits ?? 0),
      spentCents: Number(r.spent_cents ?? 0),
      generations: Number(r.generations ?? 0),
      lastActive: r.last_active,
    })),
  };
}

/** The plan names that exist right now — the filter offers nothing else. */
export async function readCustomerPlans(supabase: Client): Promise<string[]> {
  const { data } = await supabase.rpc("admin_customer_plans");
  return (data ?? []).map((r) => r.plan).filter(Boolean);
}

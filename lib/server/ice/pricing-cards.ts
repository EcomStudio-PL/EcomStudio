import "server-only";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/services/audit";
import { parsePlanCapabilities, type PlanCapabilities } from "@/lib/plans/capabilities";
import { checkCardsDoc, emptyCardsDoc, readCardsDoc, type PricingCardsDoc } from "@/components/plan/card-features";
import type { IceResult } from "@/lib/ice/types";
import { IceRefusal, authorNames, dbCode, requireIceAdmin, run, type Client } from "./core";

/**
 * „EDYTUJ STRONĘ” ON /plany AND /plan — THE PLAN CARDS' FEATURE LINES (0179).
 *
 * What the editor starts from, its one write, and the history it restores
 * from. Every save sends the WHOLE document with the updated_at it was read
 * at (compare-and-set: a second tab's newer change is refused, never
 * overwritten), is re-validated here by the same checkCardsDoc the page
 * renders with (whatever the browser sent becomes a valid document or a
 * refusal), is written by pricing_cards_write() — which also writes the
 * history row — and is audited. Both pricing pages re-render for everybody.
 *
 * Presentation only: no price, credit, capability or Stripe value is read for
 * writing or written here. The plans' capabilities are read so the editor can
 * show — and lock — the truth a bound line must show.
 */

export type PricingCardsPlan = { slug: string; name: string; capabilities: PlanCapabilities };
export type PricingCardsVersion = {
  id: string; action: string; createdAt: string; author: string | null;
  /** The document after that change (what "Przywróć" brings back). */
  restorable: boolean;
};
export type PricingCardsState = {
  doc: PricingCardsDoc;
  updatedAt: string | null;
  plans: PricingCardsPlan[];
  versions: PricingCardsVersion[];
};

async function readState(supabase: Client): Promise<PricingCardsState> {
  const [row, plans, versions] = await Promise.all([
    // The admin reads the table itself (its RLS: admins only).
    supabase.from("pricing_cards").select("doc, updated_at").eq("id", "cards").maybeSingle(),
    supabase.from("subscription_plans").select("slug, name, features, price_cents").eq("active", true).order("sort_order"),
    supabase.from("content_versions").select("id, action, after, created_at, created_by")
      .eq("target", "pricing").eq("key", "cards").order("created_at", { ascending: false }).limit(30),
  ]);
  if (row.error || versions.error) throw new IceRefusal("migration_missing");
  if (plans.error) throw new Error(plans.error.message);
  const names = await authorNames(supabase, (versions.data ?? []).map((v) => v.created_by));
  return {
    // A stored document the code no longer accepts is shown as the default,
    // exactly as the page renders it.
    doc: readCardsDoc(row.data?.doc ?? null) ?? emptyCardsDoc(),
    updatedAt: row.data?.updated_at ?? null,
    // The paid plans the page shows cards for (the free tier is a note).
    plans: (plans.data ?? []).filter((p) => p.price_cents > 0)
      .map((p) => ({ slug: p.slug, name: p.name, capabilities: parsePlanCapabilities(p.features) })),
    versions: (versions.data ?? []).map((v) => ({
      id: v.id,
      action: v.action,
      createdAt: v.created_at,
      author: v.created_by ? names.get(v.created_by) ?? null : null,
      restorable: readCardsDoc((v.after as { doc?: unknown } | null)?.doc ?? null) !== null,
    })),
  };
}

export function pricingCardsState(): Promise<IceResult<PricingCardsState>> {
  return run(async () => {
    const { supabase } = await requireIceAdmin();
    return readState(supabase);
  });
}

async function write(
  supabase: Client, adminId: string, doc: PricingCardsDoc, base: string | null, action: "save" | "restore", before: PricingCardsState,
): Promise<PricingCardsState> {
  // Both sides are canonical (checkCardsDoc), so equal text = the same cards.
  if (JSON.stringify(doc) === JSON.stringify(before.doc)) throw new IceRefusal("noop");
  const { data, error } = await supabase.rpc("pricing_cards_write", { p_doc: doc as never, p_base: base, p_action: action });
  if (error) {
    const code = dbCode(error.message);
    // A newer change from elsewhere: hand the editor what is there now.
    if (code === "conflict") throw new IceRefusal("conflict", await readState(supabase));
    throw new IceRefusal(code === "generic" && /pricing_cards_write/.test(error.message) ? "migration_missing" : code);
  }
  const updatedAt = (data as { updated_at?: string } | null)?.updated_at ?? null;
  await logAudit(supabase, {
    actorId: adminId, action: "ice.pricing_cards.saved", entityType: "pricing_cards", entityId: "cards",
    before: { updatedAt: before.updatedAt, plans: Object.keys(before.doc.plans) },
    after: { updatedAt, action, plans: Object.keys(doc.plans) },
  });
  revalidatePath("/plany");
  revalidatePath("/plan");
  return readState(supabase);
}

const cleanBase = (v: unknown) => (typeof v === "string" && v.length <= 64 ? v : null);

export function pricingCardsSave(input: { doc: unknown; base: string | null }): Promise<IceResult<PricingCardsState>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    const checked = checkCardsDoc(input?.doc);
    if (!checked.ok) throw new IceRefusal("invalid", { error: checked.error, at: checked.at ?? null });
    const before = await readState(supabase);
    return write(supabase, adminId, checked.doc, cleanBase(input?.base), "save", before);
  });
}

/**
 * Brings back the document as it was right after a version — or, with
 * `version: "default"`, the code default (an empty document). Itself a new
 * version, so a restore can be undone the same way.
 */
export function pricingCardsRestore(input: { version: string; base: string | null }): Promise<IceResult<PricingCardsState>> {
  return run(async () => {
    const { supabase, adminId } = await requireIceAdmin();
    let doc: PricingCardsDoc | null;
    if (input?.version === "default") {
      doc = emptyCardsDoc();
    } else {
      if (typeof input?.version !== "string" || !/^[0-9a-f-]{36}$/.test(input.version)) throw new IceRefusal("bad_input");
      const { data, error } = await supabase.from("content_versions").select("after")
        .eq("id", input.version).eq("target", "pricing").eq("key", "cards").maybeSingle();
      if (error) throw new Error(error.message);
      doc = readCardsDoc((data?.after as { doc?: unknown } | null)?.doc ?? null);
    }
    if (!doc) throw new IceRefusal("not_found");
    const before = await readState(supabase);
    return write(supabase, adminId, doc, cleanBase(input?.base), "restore", before);
  });
}

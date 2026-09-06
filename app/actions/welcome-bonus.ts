"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { getWallet } from "@/lib/services/credits";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import {
  clearBonusNotification, getBonusConfig, readOffer, toView,
} from "@/lib/server/welcome-bonus";
import { validateAnswers, type OfferView } from "@/lib/welcome-bonus";

/**
 * CLAIMING THE WELCOME BONUS.
 *
 * This action validates and delegates. The grant itself is one database
 * function that locks the offer row, writes the survey, moves the credits
 * through the normal ledger entry point and stamps the claim — all in one
 * transaction. That is what makes a double click, two tabs, a refresh and a
 * retried request add up to exactly one bonus.
 *
 * Nothing the browser sends decides the amount, the deadline or whether the
 * offer is still open: the amount is frozen on the offer row, and expiry is
 * compared against the server clock inside the function.
 */

export type ClaimResult =
  | { ok: true; amount: number; balance: number }
  | { ok: false; error: "expired" | "no_offer" | "missing_answer" | "generic"; missing?: string };

export async function claimWelcomeBonusAction(
  answers: Record<string, string[]>,
): Promise<ClaimResult> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "generic" };

    // The questions the CAMPAIGN asks — never the ones the browser claims to
    // have answered. An answer to a question that is switched off, or an
    // option that is not on the list, simply does not survive this.
    const config = await getBonusConfig(supabase);
    const checked = validateAnswers(config.questions, answers);
    if (!checked.ok) return { ok: false, error: "missing_answer", missing: checked.missing };

    const { data, error } = await supabase.rpc("claim_welcome_bonus", {
      p_answers: checked.clean,
    });
    if (error) return { ok: false, error: "generic" };

    const result = (data ?? {}) as {
      ok?: boolean; error?: string; amount?: number; balance?: number;
    };

    if (result.ok !== true) {
      // "Already claimed" is not a failure to show as one — the customer has
      // the credits. The caller renders the success state from the wallet.
      if (result.error === "already_claimed") {
        const workspace = await getCurrentWorkspace(supabase, user.id);
        const wallet = workspace ? await getWallet(supabase, workspace.id) : null;
        after(() => clearBonusNotification(supabase, user.id));
        return { ok: true, amount: result.amount ?? 0, balance: wallet?.balance ?? 0 };
      }
      if (result.error === "expired") return { ok: false, error: "expired" };
      if (result.error === "no_offer") return { ok: false, error: "no_offer" };
      return { ok: false, error: "generic" };
    }

    // Housekeeping and the admin ping happen after the answer is on its way:
    // the customer sees their credits without waiting for Telegram.
    after(async () => {
      await clearBonusNotification(supabase, user.id);
      const { data: profile } = await supabase
        .from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
      const answered = (key: string) => (checked.clean[key] ?? []).join(", ");
      const rows: [string, string][] = [
        ["👤 Klient", profile?.full_name ?? ""],
        ["📧 E-mail", profile?.email ?? user.email ?? ""],
        ["🌍 Źródło", answered("acquisition_source")],
        ["🛒 Sprzedaje na", answered("sales_channels")],
        ["📦 Branża", answered("product_categories")],
        ["💎 Bonus", `+${result.amount ?? 0}`],
        ["👛 Saldo", String(result.balance ?? 0)],
      ];
      await notify(supabase, {
        type: "welcome.survey_completed",
        title: "BONUS ODEBRANY",
        icon: "🎁",
        rows: rows.filter(([, value]) => value !== ""),
        data: {
          name: profile?.full_name ?? "",
          email: profile?.email ?? user.email ?? "",
          source: answered("acquisition_source"),
          credits: String(result.amount ?? 0),
          balance: String(result.balance ?? 0),
          user_id: user.id,
        },
        footer: "GrovBase Admin",
        dedupeKey: buildDedupeKey("welcome.survey_completed", user.id),
      });
    });

    // The balance in the chrome is server-rendered, so the layout has to be
    // told it changed — otherwise the header still shows the old number.
    revalidatePath("/", "layout");
    return { ok: true, amount: result.amount ?? 0, balance: result.balance ?? 0 };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/** Re-read the offer from the server — used when the modal reopens, so the
 *  countdown can never drift away from the real deadline. */
export async function welcomeBonusStateAction(): Promise<OfferView | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const offer = await readOffer(supabase, user.id);
    return offer ? toView(offer) : null;
  } catch {
    return null;
  }
}

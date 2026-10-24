"use server";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { dispatchToken } from "@/lib/server/server-token";
import {
  SMART_PROMPT_INSTRUCTION_MAX, SMART_PROMPT_PROVIDERS, SMART_PROMPT_SERVICE, SMART_PROMPT_SETTING_KEY,
  parseSmartPromptConfig, smartPromptDocument, type SmartPromptProvider,
} from "@/lib/smart-prompt";

/**
 * INTELIGENTNY PROMPT — the operator's one write (Admin → AI → Generator).
 *
 * Admin only. The price and the switch go to service_catalog.smart_prompt —
 * the row usage_event_start prices from (its trigger keeps the price history);
 * the text model and the instruction go to the private app_settings row,
 * re-validated with the same parser the server reads it with, so a document
 * the feature would refuse is never saved. Before migration 0149 nothing is
 * written: the private reader is probed first and the catalogue row must
 * exist. The audit log records numbers and choices, never the instruction.
 */

type Result = { ok: boolean; error?: "forbidden" | "invalid" | "migration_pending" | "generic"; field?: string };

const MAX_CREDITS = 1000;
/** The generator's admin page, /admin/ai/[tool] — the panel lives on it. */
const TOOL_KEY = "generator";

export async function saveSmartPromptSettingsAction(input: {
  enabled: boolean; credits: number; provider: string; model: string; instruction: string;
}): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "forbidden" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  if (!input || typeof input !== "object") return { ok: false, error: "invalid" };
  if (typeof input.enabled !== "boolean") return { ok: false, error: "invalid", field: "enabled" };
  if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > MAX_CREDITS) {
    return { ok: false, error: "invalid", field: "credits" };
  }
  if (!(SMART_PROMPT_PROVIDERS as readonly string[]).includes(input.provider)) return { ok: false, error: "invalid", field: "provider" };
  if (typeof input.instruction !== "string" || input.instruction.length > SMART_PROMPT_INSTRUCTION_MAX) {
    return { ok: false, error: "invalid", field: "instruction" };
  }
  const provider = input.provider as SmartPromptProvider;
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const config = parseSmartPromptConfig({ v: 1, provider, model: provider === "auto" ? "" : model, instruction: input.instruction });
  if (!config) return { ok: false, error: "invalid", field: "model" };

  // FAIL CLOSED until 0149 is in: the reader is what proves the row is private.
  const token = dispatchToken();
  const probe = token ? await supabase.rpc("smart_prompt_config_read", { p_token: token }) : null;
  if (!probe || probe.error) return { ok: false, error: "migration_pending" };
  const { data: service } = await supabase.from("service_catalog")
    .select("id, credits_cost, enabled").eq("slug", SMART_PROMPT_SERVICE).maybeSingle();
  if (!service) return { ok: false, error: "migration_pending" };

  const before = parseSmartPromptConfig(probe.data);
  const { error: settingsError } = await supabase.from("app_settings").upsert(
    { key: SMART_PROMPT_SETTING_KEY, value: smartPromptDocument(config) as never },
    { onConflict: "key" },
  );
  if (settingsError) return { ok: false, error: "generic" };
  const { error: priceError } = await supabase.from("service_catalog")
    .update({ credits_cost: input.credits, enabled: input.enabled }).eq("id", service.id);
  if (priceError) return { ok: false, error: "generic" };

  const fingerprint = (text: string | null | undefined) =>
    text ? createHash("sha256").update(text).digest("hex").slice(0, 12) : null;
  await logAudit(supabase, {
    actorId: user.id,
    action: "admin.smart_prompt_saved",
    entityType: "app_settings",
    entityId: "smart_prompt",
    before: {
      enabled: service.enabled, credits: service.credits_cost,
      provider: before?.provider ?? null, model: before?.model ?? null,
      instruction_custom: Boolean(before?.instruction), instruction_sha: fingerprint(before?.instruction),
    },
    after: {
      enabled: input.enabled, credits: input.credits, provider: config.provider, model: config.model,
      instruction_custom: Boolean(config.instruction), instruction_sha: fingerprint(config.instruction),
      instruction_chars: config.instruction?.length ?? 0,
    },
  });
  revalidatePath(`/admin/ai/${TOOL_KEY}`);
  revalidatePath("/admin/services");
  revalidatePath("/generator");
  return { ok: true };
}

"use client";
import { createContext, useContext } from "react";
import type { ToolViewerFacts } from "@/lib/public-tools";

/**
 * WHO IS LOOKING AT THIS PANEL — handed down by the tool's server page.
 *
 * Every value is the server's (lib/server/public-tools.ts): a visitor, an
 * admin previewing as one, or a member with their plan, bonus and address
 * state. A panel never decides any of it from what the browser holds. A panel
 * rendered without a provider (an older screen, a test) behaves exactly as
 * before: no visitor mode, no new notices.
 */
export type ToolViewer = {
  /** The public tool's catalogue key (lib/public-tools.ts PUBLIC_TOOLS). */
  tool: string;
  /** The tool's canonical address — where a visitor comes back to. */
  path: string;
  facts: ToolViewerFacts;
  /** Member only: the next paid run would carry the trial watermark. */
  trialWatermark: boolean;
  /** The account's address, for "send the confirmation again" (member,
   *  unconfirmed only — their own address, in their own browser). */
  email?: string;
};

const Ctx = createContext<ToolViewer | null>(null);

export function ToolViewerProvider({ value, children }: { value: ToolViewer; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToolViewer(): ToolViewer | null {
  return useContext(Ctx);
}

/** True for a visitor and for an admin's guest preview. */
export function useIsGuest(): boolean {
  return useContext(Ctx)?.facts.kind === "guest";
}

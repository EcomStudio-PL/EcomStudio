/**
 * Test stubs for scripts/trialwm-pipeline-tests.ts — ONE world for the three
 * producers it drives (runGeneration, the Miniaturka driver, the engine tool
 * entry and the paid-tool runner), aliased in for:
 *
 *   next/server                     `after` work is QUEUED (the test flushes
 *                                   it), so derivatives are really made
 *   @/lib/server/engine/workflow-store  the Miniaturka run store (thumb-store)
 *                                   plus a published-workflow reader the test sets
 *   @/lib/server/engine/workflow    startWorkflowRun, recorded
 *   @/lib/server/ai-usage           thumb-ai-usage plus a pass-through textMeter
 */
export * from "./thumb-store";
export * from "./thumb-ai-usage";

const g = globalThis as unknown as {
  __trialAfter?: (() => unknown)[];
  __trialWorkflow?: { id: string; version: number; status: string; maxOutputs: number; concurrency: number; legacy: boolean; steps: unknown[] } | null;
  __trialWorkflowStarts?: Record<string, unknown>[];
};

// next/server
export function after(fn: () => unknown): void { (g.__trialAfter ??= []).push(fn); }
export async function flushAfter(): Promise<void> {
  const queue = g.__trialAfter ?? [];
  g.__trialAfter = [];
  for (const fn of queue) await fn();
}

// @/lib/server/engine/workflow-store
export async function loadWorkflow(_s: unknown, _toolKey: string, _id: string | null) {
  return g.__trialWorkflow ?? null;
}

// @/lib/server/engine/workflow
export async function startWorkflowRun(_s: unknown, _u: string, _w: string, input: Record<string, unknown>) {
  (g.__trialWorkflowStarts ??= []).push(input);
  return { ok: true as const, runId: "run-wf-1", jobId: null, credits: 10, expected: 1 };
}

// @/lib/server/ai-usage
export function textMeter() {
  return { wrap: <T>(x: T) => x, flush: async () => undefined };
}

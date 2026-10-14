/** The real runRetouch is never reached from these tests: the driver gets an
 *  injected one that records its calls. Reaching this is a test bug. */
export type RetouchInput = { sourcePath: string; resolution?: string; format?: string; quotedOutputs?: number };
export type RetouchResult =
  | { ok: true; generationId: string | null; jobId: string; url: string; path: string; credits: number }
  | { ok: true; pending: true; runId: string; jobId: string | null; credits: number; expected: number }
  | { ok: false; error: string; missingCredits?: number };
export async function runRetouch(): Promise<RetouchResult> { throw new Error("real runRetouch reached"); }

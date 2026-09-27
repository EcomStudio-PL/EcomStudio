/**
 * THE BROWSER'S SIDE OF A WORKFLOW RUN. The tool's POST returns at once with
 * the run id (the run is already charged and being driven on the server);
 * this polls the run's status until it settles. No request is held open for
 * the length of an AI job, and a poll also resumes a run whose previous
 * invocation ran out of time.
 *
 * Status only: progress counts, result images, a safe error code.
 */

export type EngineRunStatus = {
  ok: boolean;
  status: "queued" | "running" | "ok" | "partial" | "failed" | "blocked";
  progress: { step: number; steps: number; done: number; total: number; failed: number };
  images: { url: string; path: string }[];
  credits: number;
  error: string | null;
};

const POLL_MS = 2500;
/** A safety net for a tab left open on a run that can no longer move. */
const GIVE_UP_MS = 30 * 60_000;

export async function awaitEngineRun(
  runId: string,
  onProgress?: (s: EngineRunStatus) => void,
): Promise<EngineRunStatus> {
  const until = Date.now() + GIVE_UP_MS;
  let misses = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const res = await fetch(`/api/engine/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      const json = await res.json() as EngineRunStatus & { error?: string | null };
      if (!json.ok) {
        if (++misses >= 5) return { ...empty(), status: "failed", error: json.error ?? "common_error" };
      } else {
        misses = 0;
        onProgress?.(json);
        if (json.status !== "queued" && json.status !== "running") return json;
      }
    } catch {
      // A dropped poll is not a failed run: the server keeps going.
      if (++misses >= 20) return { ...empty(), status: "failed", error: "network_error" };
    }
    if (Date.now() > until) return { ...empty(), status: "failed", error: "provider_timeout" };
  }
}

function empty(): EngineRunStatus {
  return {
    ok: false, status: "failed", progress: { step: 0, steps: 0, done: 0, total: 1, failed: 0 },
    images: [], credits: 0, error: null,
  };
}

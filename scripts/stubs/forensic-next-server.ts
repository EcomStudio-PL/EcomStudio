/**
 * Test stub for next/server: NextResponse.json as a plain Response; `after`
 * QUEUED (never run on its own) — a test that needs the post-response work
 * awaits `flushAfter()`, every other test is unaffected.
 */
type AfterTask = (() => unknown) | Promise<unknown>;
const g = globalThis as unknown as { __afterQueue?: AfterTask[] };
const queue: AfterTask[] = (g.__afterQueue ??= []);

export function after(task: AfterTask): void { queue.push(task); }

export async function flushAfter(): Promise<void> {
  while (queue.length > 0) {
    const task = queue.shift()!;
    await (typeof task === "function" ? task() : task);
  }
}

export class NextResponse extends Response {
  static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    return new Response(JSON.stringify(body), {
      status: init?.status ?? 200, headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  }
}

/** Test double for runGeneration (scripts/ai-engine-tests.ts): records every
 *  call — i.e. every CHARGE — and returns a fixed successful result. */
import type { GenerateInput, GenerateOutput } from "../../lib/server/generation";
export type { GenerateInput, GenerateOutput };
export const generationCalls: GenerateInput[] = [];
export async function runGeneration(_s: unknown, _u: string, _w: string, input: GenerateInput): Promise<GenerateOutput> {
  generationCalls.push(input);
  return { ok: true, jobId: "job-1", productId: null, images: [{ url: "https://x/1.png", path: "ws/job-1/0.png" }], credits: 7 };
}

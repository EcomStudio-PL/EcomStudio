import { iceState } from "./ice-state";

/** Test-only stand-in for next/cache (ice suite): revalidations are recorded,
 *  and unstable_cache is a pass-through (every call reads afresh), so a
 *  thrown read reaches the caller exactly as it would on a cold cache. */

export function revalidateTag(tag: string): void {
  iceState.revalidated.push(`tag:${tag}`);
}

export function revalidatePath(path: string, type?: string): void {
  iceState.revalidated.push(type ? `path:${path}|${type}` : `path:${path}`);
}

export function unstable_cache<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => fn(...args);
}

export function unstable_noStore(): void {}

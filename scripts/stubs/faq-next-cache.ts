/** Test-only stand-in for next/cache: no cache, no revalidation outside Next. */
export function unstable_cache<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return fn;
}
export function revalidatePath(): void {}
export function revalidateTag(): void {}

/** Test-only stand-in for next/cache (tool-status suite): records every
 *  revalidation so the test can see which surfaces a save refreshes. */
const g = globalThis as unknown as { __revalidated?: string[] };

export function revalidatePath(path: string, type?: string): void {
  (g.__revalidated ??= []).push(type ? `${path}|${type}` : path);
}
export function revalidateTag(): void {}

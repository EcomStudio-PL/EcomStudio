/**
 * next/navigation for tests that render client components to static markup,
 * outside a mounted App Router: navigation is a no-op.
 */
const noop = () => {};
export function useRouter() {
  return { refresh: noop, push: noop, replace: noop, back: noop, forward: noop, prefetch: noop };
}
export function usePathname() { return "/"; }
export function useSearchParams() { return new URLSearchParams(); }
export function redirect(): never { throw new Error("redirect() called in a test render"); }
export function notFound(): never { throw new Error("notFound() called in a test render"); }

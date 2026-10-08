/**
 * `?checkout=` as the pricing page accepts it: one short lowercase token or
 * nothing. CheckoutNotice renders null for a token it does not know, so an
 * invented value shows nothing rather than a humanised key — and the value is
 * never used as a URL, so it cannot redirect anywhere.
 */
export function checkoutNotice(params: Record<string, string | string[] | undefined>): string | null {
  const raw = typeof params.checkout === "string" ? params.checkout : null;
  return raw && /^[a-z_]{1,32}$/.test(raw) ? raw : null;
}

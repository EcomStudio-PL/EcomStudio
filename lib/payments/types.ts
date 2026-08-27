/**
 * Payment provider abstraction. No provider is registered yet — GrovBase never
 * fakes purchases. When Stripe (or another PSP) is connected, implement this
 * interface and register it; the credits store then switches from the disabled
 * "payments not enabled" state to real checkout.
 */
export interface PaymentProvider {
  slug: string;
  /** True only when server-side credentials for this PSP are configured. */
  isConfigured(): boolean;
  /** Create a checkout session for a credit package; returns a redirect URL. */
  createCheckout(input: {
    workspaceId: string;
    packageId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
}

const providers = new Map<string, PaymentProvider>();

export function registerPaymentProvider(p: PaymentProvider) {
  providers.set(p.slug, p);
}

export function getConfiguredPaymentProvider(): PaymentProvider | undefined {
  return [...providers.values()].find((p) => p.isConfigured());
}

/**
 * PRODUCT LOCK — the reusable fidelity contract appended to every generation
 * prompt and passed to provider adapters via GenerationRequest.productLock.
 * These rules are non-negotiable: product appearance must never drift.
 */
export const PRODUCT_LOCK_RULES = `PRODUCT LOCK — NON-NEGOTIABLE FIDELITY RULES:
- Reproduce the product EXACTLY as shown in the referenced images: shape, dimensions, proportions, colors, materials and construction.
- Never add, remove, move or restyle buttons, ports, switches, labels, logos, cables, connections or accessories.
- Keep the exact item and accessory count from the references. Never duplicate or multiply the product.
- The product must be physically supported at all times: standing, lying, held or mounted — never floating.
- No invented text, no watermarks, no fake logos. Real label text stays unaltered and legible.
- Photographic realism only: natural lighting, true shadows and reflections, no artificial 3D-render look.
- If humans appear: true photorealism — natural skin texture with pores and subtle imperfections, natural hair, correct anatomy, correct hands, no plastic skin.`;

/** Combine the global lock with product-specific constraints from the product record. */
export function buildFidelityInstructions(productInstructions?: string | null): string {
  if (!productInstructions?.trim()) return PRODUCT_LOCK_RULES;
  return `${PRODUCT_LOCK_RULES}\n- Product-specific constraints: ${productInstructions.trim()}`;
}

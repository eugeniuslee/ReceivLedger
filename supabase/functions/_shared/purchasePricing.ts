// V1 records one whole RLU as one SGD of fund capital. This subscription
// policy follows that accounting; it is not a redemption or market valuation.
export const PURCHASE_PRICING_BASIS = 'rlu_sgd_1_v1' as const;
export const PURCHASE_PRICING = {
  pricing_basis: PURCHASE_PRICING_BASIS,
  unit_price_cents: '100',
  currency: 'SGD',
  max_units: '9999999999999',
} as const;
export type PurchasePricingBasis = 'legacy_reported' | typeof PURCHASE_PRICING_BASIS;

export function purchaseAmountCents(units: string): string {
  if (typeof units !== 'string' || units.trim() !== units || !/^[1-9]\d{0,12}$/.test(units)) {
    throw new Error('Enter a positive whole number of RLU, up to 9,999,999,999,999.');
  }
  // BigInt keeps multiplication exact and within the stored 15-digit cents limit.
  return (BigInt(units) * 100n).toString();
}

export function purchaseHasPriceMismatch(request: { units: string; amount_cents: string }): boolean {
  try { return purchaseAmountCents(request.units) !== request.amount_cents; }
  catch { return true; }
}

export function isPurchasePricing(value: unknown): value is typeof PURCHASE_PRICING {
  if (!value || typeof value !== 'object') return false;
  const pricing = value as Record<string, unknown>;
  return Object.entries(PURCHASE_PRICING).every(([key, expected]) => pricing[key] === expected);
}

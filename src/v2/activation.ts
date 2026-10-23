/** Deliberate release lock. An address or browser environment flag cannot enable writes. */
export const V2_EXECUTION_ENABLED = false;
export const V2_EXECUTION_LOCK = 'V2 execution is not activated. Private onboarding, verified permissions and reviewed wallet handlers are required.';
export function investmentAllowance(cents: bigint, lifetimeUsed: bigint) {
  if (cents < 100n || lifetimeUsed < 0n) throw new Error('Enter at least S$1 and non-negative lifetime automatic usage.');
  const remaining = lifetimeUsed < 1000000n ? 1000000n - lifetimeUsed : 0n;
  return { remaining, reviewRequired: cents > remaining };
}

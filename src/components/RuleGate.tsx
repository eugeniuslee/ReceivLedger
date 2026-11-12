import type { ChainInvoice } from '../chain/chainLedger';
import { useFundNav } from '../finance/useFundNav';
import { financingDays } from '../finance/financing';
import { riskGuidelines, type Guideline } from '../finance/eligibility';

export const CONFIRM_WORD = 'CONFIRM';

/**
 * Check an invoice the manager is about to approve or finance against the risk management guidelines.
 * They are not enforced by the contract (except where noted); breaking one needs the manager to confirm deliberately.
 */
export function useRuleCheck(invoice: ChainInvoice | undefined) {
  const { data, nav, now } = useFundNav();
  if (!invoice || !data || !nav) return { guidelines: [] as Guideline[], breaches: [] as Guideline[] };
  const guidelines = riskGuidelines({
    invoice, invoices: data.invoices, navCents: nav.navCents, availableFundsCents: data.availableFunds * 100n,
    days: invoice.maturity > now ? financingDays(now, invoice.maturity) : 0n, asOf: Number(now),
  });
  return { guidelines, breaches: guidelines.filter(guideline => !guideline.ok) };
}

/** "Risk Management Guidelines": what this invoice breaks, with a field where the manager types CONFIRM to proceed. */
export function RuleWarning({ breaches, value, onChange }: { breaches: Guideline[]; value: string; onChange: (value: string) => void }) {
  if (!breaches.length) return null;
  return <div className="notice warning rule-warning" role="alert">
    <b>Risk Management Guidelines</b>
    <p>This invoice breaks {breaches.length === 1 ? 'one guideline' : `${breaches.length} guidelines`}:</p>
    <ul>{breaches.map(guideline => <li key={guideline.id}><b>{guideline.rule}:</b> {guideline.breach}</li>)}</ul>
    <label>Type {CONFIRM_WORD} to approve or finance it anyway<input value={value} onChange={event => onChange(event.target.value)} placeholder={CONFIRM_WORD} autoComplete="off" spellCheck={false} aria-describedby="rule-warning-help" /></label>
    <small id="rule-warning-help" className="document-meta">These guidelines are not enforced by the contract. Confirming records nothing extra on-chain.</small>
  </div>;
}

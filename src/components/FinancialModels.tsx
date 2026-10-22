import { useState } from 'react';
import type { ChainInvoice } from '../chain/chainLedger';
import { useFinance } from '../finance/FinanceContext';
import { financialDate } from '../finance/presentation';
import { assessInvoice, durationDays, financingQuote, money, moneyInput, navScenario, percentInput, perUnit, roundRatio, RISK_POLICY, validateAssumptions, type Assumptions, type FinancialSnapshot, type RiskTier } from '../finance/models';
import { formatInteger } from '../chain/presentation';

type Draft = Record<'advance' | 'annualFee' | 'serviceFee' | 'smeCap' | 'reserve' | 'salesCap' | 'sales', string>;
const initialDraft: Draft = { advance: '80', annualFee: '12', serviceFee: '1', smeCap: '20', reserve: '20', salesCap: '10', sales: '' };
export function useModelAssumptions() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  let assumptions: Assumptions | null = null; let error = '';
  try {
    assumptions = { advanceBps: percentInput(draft.advance), annualFeeBps: percentInput(draft.annualFee), serviceFeeBps: percentInput(draft.serviceFee),
      smeCapBps: percentInput(draft.smeCap), liquidityReserveBps: percentInput(draft.reserve), salesCapBps: percentInput(draft.salesCap), annualSalesCents: draft.sales ? moneyInput(draft.sales) : null };
    validateAssumptions(assumptions);
  } catch (cause) { error = (cause as Error).message; assumptions = null; }
  const controls = <details className="model-controls"><summary>Edit demonstration assumptions</summary>
    <p className="support-copy">Session-only assumptions for this view; no registration data, credit bureau scores or verified statements are used. Changing these inputs never changes a contract balance or transaction.</p>
    <div className="model-inputs">{([
      ['advance', 'Proposed advance (%)', '70–90'], ['annualFee', 'Simple annual discount (%)', '0–100'],
      ['serviceFee', 'Service fee on face value (%)', '0–100'], ['smeCap', 'SME cap / fund capital (%)', '0–100'],
      ['reserve', 'Liquidity reserve / capital (%)', '0–100'], ['salesCap', 'Cap / assumed annual sales (%)', '0–100'],
      ['sales', 'Assumed annual SME sales (S$, optional)', 'Fictional, not verified'],
    ] as [keyof Draft, string, string][]).map(([key, label, hint]) => <label key={key}>{label}<input inputMode="decimal" value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} aria-label={label} /><small>{hint}</small></label>)}</div>
    <button className="btn o small" onClick={() => setDraft(initialDraft)}>Reset assumptions</button>
  </details>;
  return { assumptions, error, controls };
}

export function FinancialSource({ compact = false }: { compact?: boolean }) {
  const { data, loading, error, refresh } = useFinance();
  return <div className="financial-source">
    <span className="source-tag">Contract-derived</span>
    <span>{data ? `Sepolia block ${data.blockNumber.toLocaleString('en-SG')} · ${financialDate(data.blockTimestamp)} SGT` : loading ? 'Reading financial records…' : 'Financial records unavailable'}</span>
    {!compact && <button className="btn o small" disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing report…' : 'Refresh report'}</button>}
    {error && <p className="inline-error" role="alert">Financial data could not be refreshed: {error}{data ? ' The prior block snapshot remains visible.' : ' No substitute balances are shown.'}</p>}
  </div>;
}

export function QuoteBreakdown({ quote }: { quote: ReturnType<typeof financingQuote> }) {
  return <><dl className="detail-list">
    <div><dt>Invoice face value</dt><dd>{money(quote.faceCents)}</dd></div><div><dt>Proposed initial advance</dt><dd>{money(quote.advanceCents)}</dd></div>
    <div><dt>Reserve held back</dt><dd>{money(quote.reserveCents)}</dd></div><div><dt>Financing duration</dt><dd>{quote.days.toString()} charged day(s)</dd></div>
    <div><dt>Simple discount charge</dt><dd>{money(quote.discountCents)}</dd></div><div><dt>Service fee</dt><dd>{money(quote.serviceFeeCents)}</dd></div>
    <div><dt>Hypothetical fund gross income</dt><dd>{money(quote.incomeCents)}</dd></div><div><dt>Expected payer settlement</dt><dd>{money(quote.expectedPayerSettlementCents)}</dd></div>
    <div><dt>Fund retains at settlement</dt><dd>{money(quote.fundRetainedCents)} (advance + fees)</dd></div>
    <div><dt>Potential balance returned to SME</dt><dd>{money(quote.smeSettlementCents)}{!quote.feesFitReserve && ' · additional SME payment required'}</dd></div>
    <div><dt>Total proposed SME proceeds</dt><dd>{money(quote.totalSmeProceedsCents)}</dd></div>
  </dl><p className="footnote">Discount = proposed advance × annual rate × rounded-up days / 365. Service fee = face value × service fee %. Fees round half-up to cents; the advance rounds down. Fees are assumed withheld from the reserve at settlement. No income here has been earned, paid or recorded on-chain.</p></>;
}

export function InvoiceAssessment({ invoice }: { invoice: ChainInvoice }) {
  const { data, now } = useFinance();
  const { assumptions, error, controls } = useModelAssumptions();
  const [risk, setRisk] = useState<RiskTier>('unassessed');
  const result = data && assumptions ? assessInvoice(invoice, data, now, assumptions, risk) : null;
  // Match the row at the financial snapshot's block rather than mixing it with
  // a newer role snapshot. Require refresh if status/terms have changed.
  const pinned = data?.invoices.find(row => row.id === invoice.id);
  const stale = data && (!pinned || pinned.status !== invoice.status || pinned.amount !== invoice.amount || pinned.maturity !== invoice.maturity || pinned.sme.toLowerCase() !== invoice.sme.toLowerCase() || pinned.payer !== invoice.payer);
  return <section className="model-panel"><div className="section-heading"><h3>Financing recommendation</h3><span className="source-tag illustrative">Illustrative · manager review</span></div>
    <FinancialSource compact />
    <p className="support-copy">No external payer credit data or real SME financial statements are verified. Recommendations are policy examples, not approved terms.</p>
    {controls}<label className="risk-choice">Payer risk scenario<select value={risk} onChange={event => setRisk(event.target.value as RiskTier)}>{Object.entries(RISK_POLICY).map(([key, policy]) => <option key={key} value={key}>{policy.label}</option>)}</select></label>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!data && <p className="empty-state compact">Waiting for live portfolio data. Existing invoice actions remain available.</p>}
    {stale && <p className="notice warning">This invoice differs from the reporting snapshot. Refresh blockchain records before relying on this assessment.</p>}
    {result && !stale && <>
      <div className="assessment-grid"><div><h4>SME borrowing capacity</h4><dl className="detail-list">
        <div><dt>Fund-concentration cap</dt><dd>{money(result.fundPolicyCapCents)}</dd></div>
        <div><dt>Assumed-sales cap</dt><dd>{result.salesPolicyCapCents === null ? 'Not supplied' : money(result.salesPolicyCapCents)}</dd></div>
        <div><dt>Recommended total borrowing limit</dt><dd>{money(result.borrowingLimitCents)}</dd></div><div><dt>Current financed principal</dt><dd>{money(result.smeOutstandingCents)}</dd></div>
        <div><dt>Remaining borrowing capacity</dt><dd>{money(result.remainingBorrowingCents)}</dd></div></dl>
        <p className="footnote">Limit = lower of the fund-concentration cap and optional assumed-sales cap × {result.riskFactorBps / 100}% scenario factor. Unassessed and demo high-risk use 50%, moderate 75%, low 100%. {result.missingFinancialEvidence ? 'No sales input was supplied; this is fund-policy capacity only.' : 'Sales are a fictional input, not evidence of company performance.'}</p>
      </div><div><h4>Payer and liquidity</h4><dl className="detail-list"><div><dt>Current payer exposure</dt><dd>{money(result.payerExposureCents)}</dd></div><div><dt>Contract payer cap</dt><dd>{money(data!.maxPayerExposure * 100n)}</dd></div>
        <div><dt>Remaining payer capacity</dt><dd>{money(result.remainingPayerCents)}</dd></div><div><dt>Demo liquidity reserve target</dt><dd>{money(result.reserveTargetCents)}</dd></div><div><dt>Liquidity after reserve</dt><dd>{money(result.liquidAfterReserveCents)}</dd></div>
        <div><dt>Maximum new proposed advance</dt><dd>{money(result.maximumProposedAdvanceCents)}</dd></div><div><dt>Payer's overdue financed invoices</dt><dd>{result.payerOverdueCount}</dd></div></dl></div></div>
      <p><b>Expected payer date:</b> {financialDate(invoice.maturity)} SGT · {durationDays(now, invoice.maturity).toString()} future day(s). Actual settlement timing is unknown.</p>
      <div className={`notice ${result.contractEligible ? 'info' : 'warning'}`}><b>Observed contract eligibility: {result.contractEligible ? 'passes current checks' : 'not ready'}</b>{result.contractReasons.length > 0 && <ul>{result.contractReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}<p className="footnote">Date checks use the device clock; Solidity checks the execution block timestamp. Amount/date checks do not reserve funds or guarantee transaction success.</p></div>
      <div className="notice info"><b>Demo policy: {result.modelWithinPolicy ? 'within modelled capacity; human review required' : 'requires changes or further review'}</b>{result.modelReasons.length > 0 && <ul>{result.modelReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}</div>
      {result.quote && <details className="fee-details" open><summary>Proposed {assumptions!.advanceBps / 100}% advance and fee breakdown</summary><QuoteBreakdown quote={result.quote} /></details>}
    </>}
    <div className="notice warning"><b>Actual contract transaction:</b> financeInvoice commits the full {money(invoice.amount * 100n)} face value (100%). It charges no fee and cannot execute the proposed partial advance. This model neither changes nor bypasses that rule.</div>
  </section>;
}

export function FeeCalculator() {
  const { assumptions, error, controls } = useModelAssumptions();
  const [face, setFace] = useState(''); const [days, setDays] = useState('30');
  let quote: ReturnType<typeof financingQuote> | null = null; let quoteError = '';
  if (face && assumptions) try {
    if (!/^\d{1,5}$/.test(days)) throw new Error('Enter a whole number of days.');
    quote = financingQuote(moneyInput(face), BigInt(days), assumptions);
  } catch (cause) { quoteError = (cause as Error).message; }
  return <section className="section-block"><div className="section-heading"><h2>Proposed financing terms calculator</h2><span className="source-tag illustrative">Standalone what-if</span></div>
    <p className="support-copy">Enter hypothetical terms to explore advance/reserve/fee mechanics. This creates no invoice, financing approval, earned income or blockchain transaction.</p>
    <div className="model-inputs"><label>Hypothetical invoice face value (S$)<input value={face} inputMode="decimal" placeholder="Enter an assumption" onChange={event => setFace(event.target.value)} /></label><label>Hypothetical term (days)<input value={days} inputMode="numeric" onChange={event => setDays(event.target.value)} /></label></div>
    {controls}{(error || quoteError) && <p className="inline-error" role="alert">{error || quoteError}</p>}{quote && <QuoteBreakdown quote={quote} />}
  </section>;
}

export function NavIllustration({ snapshot, investor = false }: { snapshot: FinancialSnapshot; investor?: boolean }) {
  const [income, setIncome] = useState('0'); const [liabilities, setLiabilities] = useState('0'); const [impairment, setImpairment] = useState('0');
  // Ownership is contract-derived and remains available even if a scenario input
  // is temporarily invalid. It must not depend on the model's adjustments.
  const ownership = snapshot.totalSupply > 0n && snapshot.connectedBalance >= 0n && snapshot.connectedBalance <= snapshot.totalSupply
    ? roundRatio(snapshot.connectedBalance * 10000n, snapshot.totalSupply) : null;
  let result: ReturnType<typeof navScenario> | null = null; let error = '';
  try { result = navScenario(snapshot, { incomeCents: moneyInput(income), liabilitiesCents: moneyInput(liabilities), impairmentBps: percentInput(impairment) }); }
  catch (cause) { error = (cause as Error).message; }
  return <section className="section-block"><div className="section-heading"><h2>{investor ? 'Your investment illustration' : 'Illustrative NAV bridge'}</h2><span className="source-tag illustrative">Off-chain scenario</span></div>
    <p className="support-copy">NAV here is a model of available simulated capital plus outstanding principal, adjusted by your explicit assumptions. totalFundSize is issued simulated capital, not actual NAV. Defaults assume full principal recovery, no income and no other liabilities; none of these is verified fair value.</p>
    {investor && <div className="metric-grid"><div className="metric"><span>RLU holdings at reporting block</span><strong>{formatInteger(snapshot.connectedBalance)}</strong><small>On-chain, 0 decimals</small></div><div className="metric"><span>Total RLU supply</span><strong>{formatInteger(snapshot.totalSupply)}</strong><small>Same reporting block</small></div><div className="metric"><span>Ownership</span><strong>{ownership === null ? 'Not defined' : `${ownership / 100n}.${String(ownership % 100n).padStart(2, '0')}%`}</strong><small>Holdings / total supply</small></div></div>}
    <details className="model-controls"><summary>Edit NAV scenario assumptions</summary><div className="model-inputs"><label>Assumed additional fund income (S$)<input value={income} inputMode="decimal" onChange={event => setIncome(event.target.value)} /></label><label>Assumed fund liabilities (S$)<input value={liabilities} inputMode="decimal" onChange={event => setLiabilities(event.target.value)} /></label><label>Impairment / outstanding principal (%)<input value={impairment} inputMode="decimal" onChange={event => setImpairment(event.target.value)} /></label></div><p className="footnote">These are personal what-if inputs for this view. No income is inferred from repayments, and fee scenarios elsewhere are not automatically added to NAV.</p></details>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {result && <><div className="metric-grid model-metrics"><div className="metric"><span>Illustrative fund NAV</span><strong>{money(result.navCents)}</strong><small>Scenario equity, not on-chain cash</small></div><div className="metric"><span>Illustrative NAV per RLU</span><strong>{perUnit(result.navPerRluMicros)}</strong><small>6 decimal display precision</small></div>{investor && <div className="metric"><span>Estimated holdings value</span><strong>{result.holdingsValueCents === null ? 'Not defined' : money(result.holdingsValueCents)}</strong><small>Pro-rata scenario value only</small></div>}</div>
      <dl className="detail-list"><div><dt>Available simulated capital</dt><dd>{money(snapshot.availableFunds * 100n)}</dd></div><div><dt>Outstanding financed principal</dt><dd>{money(result.principalCents)}</dd></div><div><dt>Less assumed impairment</dt><dd>{money(result.impairmentCents)}</dd></div><div><dt>Plus assumed income</dt><dd>{money(moneyInput(income))}</dd></div><div><dt>Less assumed liabilities</dt><dd>{money(moneyInput(liabilities))}</dd></div></dl>
      {result.navCents < 0n && <p className="notice warning">This stress scenario has negative net assets. It is not a redeemable token price.</p>}
      {snapshot.totalSupply === 0n && <p className="notice info">There are no issued RLU. Ownership, NAV per RLU and holdings value are undefined.</p>}
    </>}
    <p className="footnote">If financing fees were earned and retained in a future implementation, net income could increase NAV and pro-rata value. This is not realised investment performance, paid dividends or a redemption quote. The deployed contract supports neither redemption nor distributions.</p>
  </section>;
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useRegistrationAccess } from '../registration/access';
import type { PageId } from '../chain/access';
import { formatMoney } from '../chain/presentation';
import { financialDate } from '../finance/presentation';
import { maturityState, money } from '../finance/models';
import { calculateFinancing, endOfSgtDate, estimateSubmission, financingDays, invoiceIncome, termsAt, type InvoiceIncomeRow } from '../finance/financing';
import { assessFinancing, DECISION_LABELS, SME_RULES, smeLimits, type RuleCheck } from '../finance/eligibility';
import { useFundNav } from '../finance/useFundNav';
import { FinancingBreakdownList } from '../components/FinancialModels';
import { InvoiceSummary } from '../components/InvoiceSummary';
import { PrivateAccess } from '../components/PrivateAccess';
import { ProofUpload } from '../components/ProofUpload';
import type { PrivateDocument } from '../../supabase/functions/_shared/domain';

const DAY = 86_400n;
const sgtToday = (now: bigint) => new Date(Number(now) * 1000 + 8 * 3_600_000).toISOString().slice(0, 10);
const date = (seconds: bigint) => financialDate(seconds).replace(/,\s*\d{1,2}:\d{2}\s*[ap]m$/i, '');

/** The connected SME's own invoices, what it owes on each, and its limits under the financing rules. */
function useSmeFinances() {
  const { account, snapshot, events, lifecycleEvents } = useLedger();
  const { data, nav, now, credits } = useFundNav();
  const own = snapshot?.role === 'sme' ? snapshot.invoices : [];
  const rows = invoiceIncome(own, lifecycleEvents?.length ? lifecycleEvents : events ?? [], now, credits);
  const financed = rows.filter(row => row.invoice.status === 'Financed');
  const owedCents = (row: InvoiceIncomeRow) => row.advanceCents + row.serviceFeeCents + row.interestCents;
  const limits = data && nav && account ? smeLimits({ sme: account, invoices: data.invoices, navCents: nav.navCents, availableFundsCents: data.availableFunds * 100n, asOf: Number(now) }) : null;
  return { account, own, rows, financed, owedCents, limits, now, data, nav };
}

// ───────────────────────────── Eligibility (shared) ─────────────────────────────

/** Live check of a proposed invoice against the SME financing rules. */
export function EligibilityPanel({ invoiceCents, days, payer }: { invoiceCents: bigint | null; days: bigint | null; payer: string }) {
  const { account } = useLedger();
  const { data, nav, now } = useFundNav();
  const registration = useRegistrationAccess();
  if (!account || !data || !nav || invoiceCents === null || invoiceCents <= 0n) return null;
  const result = assessFinancing({ invoiceCents, days, payer, sme: account, registrationApproved: registration.invoiceAllowed, invoices: data.invoices, navCents: nav.navCents, availableFundsCents: data.availableFunds * 100n, asOf: Number(now) });
  return <section className="section-block eligibility" aria-label="Financing eligibility">
    <div className="section-heading"><h3>Financing rules</h3><span className={`status ${result.decision === 'automatic' ? 'approved' : result.decision === 'review' ? 'submitted' : 'rejected'}`}>{DECISION_LABELS[result.decision]}</span></div>
    <div className="table-scroll"><table><thead><tr><th>Rule</th><th>Requirement</th><th>Your invoice</th><th>Result</th></tr></thead>
      <tbody>{result.checks.map((check: RuleCheck) => <tr key={check.rule}><td>{check.rule}</td><td>{check.requirement}</td><td>{check.detail}</td>
        <td><span className={`status ${check.status === 'pass' ? 'approved' : check.status === 'review' ? 'submitted' : 'rejected'}`}>{check.status === 'pass' ? 'Pass' : check.status === 'review' ? 'Manager review' : 'Not met'}</span></td></tr>)}</tbody></table></div>
    <p className="footnote">A guide based on today’s fund records. The fund manager makes the final decision.</p>
  </section>;
}

// ───────────────────────────── Home ─────────────────────────────

export function SmeHome({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const { own, financed, owedCents, limits, now } = useSmeFinances();
  const totalOwed = financed.reduce((sum, row) => sum + owedCents(row), 0n);
  const next = financed.slice().sort((a, b) => (a.invoice.maturity < b.invoice.maturity ? -1 : 1))[0];
  const overdue = financed.filter(row => row.invoice.maturity < now);
  const dueSoon = financed.filter(row => row.invoice.maturity >= now && row.invoice.maturity <= now + 7n * DAY);
  const awaiting = own.filter(invoice => invoice.status === 'Submitted').length;
  const approved = own.filter(invoice => invoice.status === 'Approved').length;
  const attention: [string, number, string, PageId][] = [
    ['Overdue repayments', overdue.length, 'Past the due date — repay now', 'repayments'],
    ['Repayments due within 7 days', dueSoon.length, 'Prepare your payment', 'repayments'],
    ['Invoices awaiting approval', awaiting, 'With the fund manager', 'invoices'],
    ['Approved, awaiting cash', approved, 'Approved and waiting to be financed', 'invoices'],
  ];
  return <>
    <section className="metric-grid" aria-label="Your financing">
      <div className="metric emphasis"><span>Cash advance limit</span><strong>{limits ? money(limits.cashAdvanceLimitCents) : '—'}</strong><small>Cash you can receive now</small></div>
      <div className="metric"><span>Amount owed today</span><strong>{money(totalOwed)}</strong><small>{financed.length} financed invoice(s)</small></div>
      <div className="metric"><span>Next repayment</span><strong>{next ? money(owedCents(next)) : '—'}</strong><small>{next ? `Due ${date(next.invoice.maturity)}` : 'Nothing due'}</small></div>
      <div className="metric"><span>Invoices in progress</span><strong>{awaiting + approved + financed.length}</strong><small>Submitted, approved or financed</small></div>
    </section>
    <section className="section-block"><h3>Quick actions</h3>
      <div className="form-row">
        <button className="btn" onClick={() => onNavigate?.('submitInvoice')}>Request funds</button>
        <button className="btn" onClick={() => onNavigate?.('repayments')}>Repay</button>
        <button className="btn o" onClick={() => onNavigate?.('calculator')}>Cost calculator</button>
      </div>
    </section>
    <section className="section-block" aria-labelledby="sme-attention-title"><h3 id="sme-attention-title">Needs your attention</h3>
      {attention.every(([, count]) => count === 0) && <p className="support-copy">Nothing needs your attention right now.</p>}
      <div className="review-grid">{attention.map(([label, count, detail, page]) => <div key={label} className={`review-card${count ? ' active' : ''}`}>
        <span className="review-label">{label}</span><strong>{count}</strong><small className="document-meta">{detail}</small>
        {count > 0 && onNavigate && <button className="btn o small" onClick={() => onNavigate(page)} aria-label={`Open ${label.toLowerCase()}`}>Open</button>}
      </div>)}</div>
    </section>
    {limits && <LimitsCard limits={limits} />}
    <InvoiceSummary invoices={own.slice().reverse()} title="Your latest invoices" empty="You have not submitted any invoices yet." collapsedCount={3} />
  </>;
}

function LimitsCard({ limits }: { limits: NonNullable<ReturnType<typeof useSmeFinances>['limits']> }) {
  const usedPct = Number(limits.exposureCents * 100n / SME_RULES.maxExposureCents);
  return <section className="section-block fund-accounting" aria-labelledby="limits-title"><h3 id="limits-title">Your borrowing limit</h3>
    <div className="accounting-bar" role="img" aria-label={`${usedPct}% of your S$100,000 limit used`}><div style={{ width: `${100 - usedPct}%` }} /></div>
    <div className="bar-legend"><span><i className="legend-dot available" />Available {money(limits.exposureRemainingCents)}</span><span><i className="legend-dot financed" />Used {money(limits.exposureCents)} of S$100,000</span></div>
    <dl className="detail-list">
      <div><dt>Largest invoice you can finance now</dt><dd>{money(limits.maxInvoiceCents)}</dd></div>
      <div><dt>Cash advance limit ({termsAt(Math.floor(Date.now() / 1000)).advanceBps / 100}% of that)</dt><dd>{money(limits.cashAdvanceLimitCents)}</dd></div>
      <div><dt>Automatic financing available</dt><dd>{money(limits.autoCashAdvanceLimitCents)} cash</dd></div>
    </dl>
    <p className="footnote">Limits use approved and financed invoices, the S$100,000 cap and the fund’s available cash. Automatic financing also needs invoices up to S$5,000, due within 30 days, and total SME exposure below 1% of fund NAV.</p>
  </section>;
}

// ───────────────────────────── Repayments ─────────────────────────────

function useMyProofs() {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const [documents, setDocuments] = useState<PrivateDocument[] | null>(null);
  const reload = useCallback(async () => {
    if (!authenticated) { setDocuments(null); return; }
    try { setDocuments((await requestRef.current<PrivateDocument[]>({ action: 'documents' })).filter(doc => doc.purpose === 'repayment')); }
    catch { setDocuments(null); }
  }, [authenticated]);
  useEffect(() => { void reload(); }, [reload]);
  return { documents, reload };
}

export function Repayments() {
  const { role } = useLedger();
  const { rows, financed, owedCents, now } = useSmeFinances();
  if (role !== 'sme' && role !== 'provisional') return <p className="notice error" role="alert">Repayments are available to SME wallets.</p>;
  const totalOwed = financed.reduce((sum, row) => sum + owedCents(row), 0n);
  const overdueCents = financed.filter(row => row.invoice.maturity < now).reduce((sum, row) => sum + owedCents(row), 0n);
  const dueSoonCents = financed.filter(row => row.invoice.maturity >= now && row.invoice.maturity <= now + 7n * DAY).reduce((sum, row) => sum + owedCents(row), 0n);
  const repaid = rows.filter(row => row.invoice.status === 'Repaid');
  return <>
    <section className="metric-grid" aria-label="Repayment summary">
      <div className="metric emphasis"><span>Total owed today</span><strong>{money(totalOwed)}</strong><small>Cash advanced + fees + interest</small></div>
      <div className="metric"><span>Due within 7 days</span><strong>{money(dueSoonCents)}</strong><small>Upcoming repayments</small></div>
      <div className="metric"><span>Overdue</span><strong>{money(overdueCents)}</strong><small>Past the due date</small></div>
    </section>
    <section className="section-block"><h3>How to repay</h3>
      <ol className="steps">
        <li><b>Pay the amount owed</b>Transfer the “Owed today” amount to the fund.</li>
        <li><b>Upload proof</b>Upload the payment receipt as a PDF against the invoice below.</li>
        <li><b>Manager confirms</b>The fund manager checks the proof and records the repayment on-chain.</li>
        <li><b>Holdback released</b>Your holdback, less the fee and interest, is released to you.</li>
      </ol>
    </section>
    <PrivateAccess compact message="Sign in with your wallet to upload payment proofs and see their status."><OwedTable rows={financed} owedCents={owedCents} now={now} /></PrivateAccess>
    <section className="section-block"><h3>Repaid invoices</h3>
      {repaid.length ? <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Repaid</th><th>Days financed</th><th>Total repaid</th><th>Holdback released</th></tr></thead>
        <tbody>{repaid.map(row => { const charges = calculateFinancing(row.invoice.amount * 100n, row.days ?? 0n, termsAt(row.financedAt ?? now)); return <tr key={row.invoice.id.toString()}>
          <td>#{row.invoice.id.toString()}<small className="document-meta">{row.invoice.payer}</small></td><td>{row.repaidAt ? date(row.repaidAt) : '—'}</td><td>{row.days?.toString() ?? '—'}</td>
          <td>{row.datesPending ? '—' : money(owedCents(row))}</td><td>{row.datesPending ? '—' : money(charges.holdbackReleasedCents)}</td></tr>; })}</tbody></table></div>
        : <p className="empty-state compact">No repaid invoices yet.</p>}
    </section>
  </>;
}

function OwedTable({ rows, owedCents, now }: { rows: InvoiceIncomeRow[]; owedCents: (row: InvoiceIncomeRow) => bigint; now: bigint }) {
  const { documents, reload } = useMyProofs();
  const [open, setOpen] = useState<string | null>(null);
  const proofFor = (id: bigint) => documents?.filter(doc => doc.invoice_id === id.toString()).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return <section className="section-block"><h3>Funds owed</h3>
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Cash advanced</th><th>Service fee</th><th>Interest to date</th><th>Owed today</th><th>Due</th><th>Payment proof</th></tr></thead>
      <tbody>{rows.map(row => { const id = row.invoice.id.toString(), proof = proofFor(row.invoice.id), state = maturityState(row.invoice, now); return <tr key={id}>
        <td>#{id}{row.credit && <span className="status rejected credit-badge">{row.credit.stage === 'impaired' ? 'Impaired' : 'Written off'}</span>}<small className="document-meta">{row.invoice.payer} · {formatMoney(row.invoice.amount)}</small></td>
        <td>{money(row.advanceCents)}</td><td>{money(row.serviceFeeCents)}</td><td>{row.datesPending ? '—' : money(row.interestCents)}</td>
        <td><b>{money(owedCents(row))}</b></td>
        <td>{date(row.invoice.maturity)}<small className={`timing-label${state.overdue ? ' late' : ''}`}>{state.label}</small></td>
        <td>{proof && <><span className={`status ${proof.status === 'verified' ? 'approved' : proof.status === 'rejected' ? 'rejected' : 'submitted'}`}>{proof.status === 'pending' ? 'Under review' : proof.status === 'verified' ? 'Confirmed' : 'Rejected'}</span>{proof.review_note && <small className="document-meta">{proof.review_note}</small>}</>}
          {(!proof || proof.status === 'rejected') && (open === id ? <ProofUpload link={{ purpose: 'repayment', invoice_id: id }} onDone={() => { setOpen(null); void reload(); }} onCancel={() => setOpen(null)} />
            : <button className="btn small" onClick={() => setOpen(id)}>Upload proof</button>)}</td>
      </tr>; })}</tbody></table></div>
      : <p className="empty-state compact">You have no financed invoices to repay.</p>}
    <p className="footnote">Interest keeps accruing daily until the repayment is recorded or the due date, whichever comes first. Repaying early lowers the interest.</p>
  </section>;
}

// ───────────────────────────── Cost calculator ─────────────────────────────

export function CostCalculator() {
  const { now } = useFundNav();
  const [amount, setAmount] = useState('5000');
  const [due, setDue] = useState(() => new Date(Date.now() + 30 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10));
  const [expected, setExpected] = useState('');
  const [payer, setPayer] = useState('');
  const cents = /^[1-9]\d{0,9}$/.test(amount) ? BigInt(amount) * 100n : null;
  const dueAt = endOfSgtDate(due);
  const estimate = estimateSubmission({ invoiceCents: cents, dueDate: dueAt, expectedPaymentDate: endOfSgtDate(expected || due), now });
  const terms = termsAt(now);
  const scenarios = estimate.maximumDays === null || cents === null ? [] : [...new Set([7n, 14n, 30n, 60n, 90n, estimate.maximumDays].filter(days => days > 0n && days <= estimate.maximumDays!))].sort((a, b) => Number(a - b));
  return <>
    <section className="section-block"><h2>Financing cost calculator</h2>
      <p className="support-copy">Try different amounts and dates to see what financing costs. Nothing is submitted.</p>
      <div className="form-row">
        <label>Invoice amount (S$)<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>Invoice due date<input type="date" min={sgtToday(now)} value={due} onChange={event => setDue(event.target.value)} /></label>
        <label>Expected payment date (optional)<input type="date" min={sgtToday(now)} value={expected} onChange={event => setExpected(event.target.value)} /></label>
        <label>Payer (optional)<input value={payer} maxLength={100} onChange={event => setPayer(event.target.value)} placeholder="Customer name" /></label>
      </div>
      {estimate.warnings.map(warning => <p className="notice warning" key={warning}>{warning}</p>)}
      {estimate.breakdown ? <FinancingBreakdownList breakdown={estimate.breakdown} /> : <p className="support-copy">{estimate.errors[0]}</p>}
    </section>
    {scenarios.length > 0 && cents !== null && <section className="section-block"><h3>Cost by repayment day</h3>
      <p className="support-copy">Repaying earlier lowers the interest. The {terms.serviceFeeBps / 100}% service fee stays the same.</p>
      <div className="table-scroll"><table><thead><tr><th>Repaid after</th><th>Interest</th><th>Total cost</th><th>Total repayment</th><th>Holdback released</th></tr></thead>
        <tbody>{scenarios.map(days => { const b = calculateFinancing(cents, days, terms); return <tr key={days.toString()}><td>{days.toString()} day(s){days === estimate.maximumDays ? ' (due date)' : ''}</td><td>{money(b.interestCents)}</td><td>{money(b.serviceFeeCents + b.interestCents)}</td><td>{money(b.payableCents)}</td><td>{money(b.holdbackReleasedCents)}</td></tr>; })}</tbody></table></div>
    </section>}
    <EligibilityPanel invoiceCents={cents} days={dueAt === null ? null : financingDays(now, dueAt)} payer={payer} />
  </>;
}


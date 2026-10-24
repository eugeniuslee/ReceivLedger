import { useEffect, useState } from 'react';
import { money, moneyInput } from '../finance/models';
import { resolveV2Address } from './config';
import { usePublicReport } from './usePublicReport';
import { v2Eligibility, v2Quote } from './models';
import { concentrationBand } from './reporting';
import { operationsSummary, requestAction, pendingInvestment, pendingRedemption, pendingInvoice, investmentStatuses, redemptionStatuses, invoiceStatuses, statusLabel, rluUnits, type FundReport } from './operations';
import './operations.css';

const executionHelp = 'Execution is unavailable until private V2 permissions, funding evidence and signed workflows are integrated and tested.';
type RequestKind = 'investment' | 'redemption' | 'invoice';
const kinds = [['investment', 'Investment Requests'], ['redemption', 'Redemption Requests'], ['invoice', 'Invoice Financing']] as const;
const shortId = (value: string) => value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
const date = (seconds: bigint) => new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' }).format(new Date(Number(seconds) * 1000));

export function ManagerOperations({ wallet, epoch, networkOk }: { wallet: string; epoch: number; networkOk: boolean }) {
  let address = '', configurationError = '';
  try { address = resolveV2Address(import.meta.env.VITE_V2_CONTRACT_ADDRESS); } catch (cause) { configurationError = (cause as Error).message; }
  const { report, loading, error, read } = usePublicReport(address, wallet, epoch, networkOk);
  useEffect(() => { if (address && wallet && networkOk) void read(); }, [address, wallet, networkOk, read]);
  return <ManagerOperationsView report={report} loading={loading} error={configurationError || error} canRead={Boolean(address && wallet && networkOk)} refresh={() => void read()} />;
}

export function ManagerOperationsView({ report, loading, error, canRead, refresh }: { report: FundReport | null; loading: boolean; error: string; canRead: boolean; refresh: () => void }) {
  const summary = report ? operationsSummary(report) : null;
  const [kind, setKind] = useState<RequestKind>('investment');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [selected, setSelected] = useState<{ kind: RequestKind; id: bigint } | null>(null);
  const counts = summary ? [summary.investmentCount, summary.redemptionCount, summary.invoiceCount] : null;
  const metrics = [
    ['V2 fund NAV', report ? money(BigInt(report.fund.navCents)) : 'Unavailable'],
    ['NAV per RLU2', summary ? summary.navPerUnit === null ? 'No active units' : money(summary.navPerUnit) : 'Unavailable'],
    ['Available liquidity', report ? money(BigInt(report.fund.freeLiquidityCents)) : 'Unavailable'],
    ['Outstanding financing', report ? money(BigInt(report.fund.outstandingCents)) : 'Unavailable'],
  ];
  const rows = report ? kind === 'investment' ? report.subscriptions.filter(r => !pendingOnly || pendingInvestment(r.status)).map(r => ({ id: r.id, applicant: r.investor, amount: money(r.cents), action: requestAction('investment', r.status), rejectable: r.status <= 2n, status: statusLabel(investmentStatuses, r.status), date: 'Unavailable', detail: `Funding ${r.funded ? 'confirmed by manager' : 'not confirmed'} · Review ${r.reviewed ? 'completed' : 'not completed'} · Minimum units ${rluUnits(r.minimumUnits)}` }))
    : kind === 'redemption' ? report.redemptions.filter(r => !pendingOnly || pendingRedemption(r.status)).map(r => ({ id: r.id, applicant: r.investor, amount: rluUnits(r.units), action: requestAction('redemption', r.status), rejectable: r.status <= 1n, status: statusLabel(redemptionStatuses, r.status), date: 'Unavailable', detail: `Minimum payout ${money(r.minimumCents)} · Allocated payout ${money(r.payoutCents)}. Pending units are valued at allocation; a zero allocated payout is not a payment.` }))
      : report.invoices.filter(r => !pendingOnly || pendingInvoice(r.status)).map(r => ({ id: r.id, applicant: r.sme ?? r.entity, amount: money(r.advance), action: requestAction('invoice', r.status), rejectable: r.status <= 2n, status: statusLabel(invoiceStatuses, r.status), date: `Due ${date(r.maturity)}`, detail: `Face value ${money(r.face)} · Principal outstanding ${money(r.principal)} · Net cash commitment ${money(r.commitment)} · SME identity ${r.entity} · Payer ${r.payer}` })) : [];
  const review = selected?.kind === kind ? rows.find(r => r.id === selected.id) : null;
  return <div className="v2-shell manager-operations" aria-label="Financing and fund requests">
    <section aria-labelledby="fund-overview-title">
      <div className="section-heading"><div><h2 id="fund-overview-title">V2 fund overview</h2><p className="support-copy">Sepolia university simulation · SGD accounting and RLU2 have no real monetary value.</p></div><button className="btn o" disabled={loading || !canRead} onClick={refresh}>{loading ? 'Refreshing…' : 'Refresh fund data'}</button></div>
      <div className="operations-source"><span className="source-tag">{report ? `Blockchain snapshot · block ${report.blockTag}` : 'Awaiting blockchain data'}</span><span className="source-tag illustrative">Execution disabled</span></div>
      {loading && <p role="status">Loading V2 balances and requests…</p>}
      {error && <p className="notice error" role="alert">Fund data could not be loaded. {error}</p>}
      {!canRead && !error && <p className="notice info">Connect your wallet on Sepolia to load the verified V2 fund.</p>}
      <div className="metric-grid operations-metrics">{metrics.map(([label, value], index) => <div className={`metric ${index === 0 ? 'emphasis' : ''}`} key={label}><span>{label}</span><strong>{value}</strong>{index === 1 && <small>Rounded to cents</small>}</div>)}</div>
      <div className="operations-counts">{kinds.map(([value, label], index) => <button key={value} onClick={() => { setKind(value); setPendingOnly(true); setSelected(null); }}><span>Pending {label === 'Invoice Financing' ? 'invoices' : label.toLowerCase()}</span><strong>{counts ? counts[index] : '—'}</strong></button>)}</div>
      <p className="footnote">Available liquidity excludes approved financing commitments and allocated exits. Pending counts include funding, processing and settlement still requiring action.</p>
    </section>
    <section className="section-block operations-requests" aria-labelledby="requests-title">
      <div className="section-heading"><h2 id="requests-title">Requests requiring action</h2><label className="operations-filter"><input type="checkbox" checked={pendingOnly} onChange={e => { setPendingOnly(e.target.checked); setSelected(null); }} />Pending only</label></div>
      <div className="operations-tabs" role="group" aria-label="Request type">{kinds.map(([value, label], index) => <button className={`btn ${kind === value ? '' : 'o'}`} aria-pressed={kind === value} key={value} onClick={() => { setKind(value); setSelected(null); }}>{label} <span>{counts ? counts[index] : '—'}</span></button>)}</div>
      <p id="execution-help" className="support-copy">{executionHelp} Public request details can be reviewed below.</p>
      {!report ? <p className="empty-state compact">Requests are unavailable until a complete blockchain snapshot loads.</p> : rows.length ? <div className="table-scroll"><table className="operations-table"><caption className="sr-only">{kinds.find(([value]) => value === kind)?.[1]}</caption><thead><tr><th>Request</th><th>Applicant wallet</th><th>{kind === 'invoice' ? 'Gross advance' : 'Amount / units'}</th><th>{kind === 'invoice' ? 'Maturity (SGT)' : 'Submitted (SGT)'}</th><th>Status</th><th>Review</th></tr></thead><tbody>{rows.map(row => <tr key={String(row.id)}><td>#{String(row.id)}</td><td><span className="mono" title={row.applicant}>{shortId(row.applicant)}</span></td><td>{row.amount}</td><td>{row.date}</td><td><span className="status">{row.status}</span></td><td><button className="btn o small" aria-label={`Review ${kind} request ${row.id}`} onClick={() => setSelected({ kind, id: row.id })}>Review details</button></td></tr>)}</tbody></table></div> : <p className="empty-state compact">No {pendingOnly ? 'pending ' : ''}{kind === 'invoice' ? 'invoice financing' : kind} requests at this block.</p>}
      {report && <p className="footnote">Applicants are identified by public wallet. Private names and KYC remain in Applications. Submission dates are not stored in V2 request records; no date is inferred from the reporting block.</p>}
      {review && <article className="operations-review" aria-label="Selected request review"><div className="section-heading"><h3>Review {kind} request #{String(review.id)}</h3><button className="btn o small" onClick={() => setSelected(null)}>Close review</button></div><p className="mono">{review.applicant}</p><p><b>{review.amount}</b> · {review.status}</p><p>{review.detail}</p><div className="v2-actions">{review.action && <button className="btn" disabled aria-describedby="execution-help">{review.action}</button>}{review.rejectable && <button className="btn o" disabled aria-describedby="execution-help">Reject request</button>}</div><p className="support-copy">{executionHelp}</p></article>}
    </section>
    <section className="section-block" aria-labelledby="risk-title"><div className="section-heading"><h2 id="risk-title">Risk monitoring</h2><span className="support-copy">Based on the same V2 snapshot</span></div>
      {!report || !summary ? <p className="empty-state compact">Risk indicators are unavailable until fund data loads.</p> : <>
        <div className="operations-risk-grid"><div><h3>Liquidity and obligations</h3><dl className="detail-list">{[
          ['Approved financing · net cash reserved', money(summary.commitments)], ['Allocated redemption cash', money(summary.reservedExits)],
          ['Pending redemption value · indicative', summary.proposedExitValue === null ? 'Unavailable' : money(summary.proposedExitValue)],
          ['Funded subscriptions · segregated', money(BigInt(report.fund.pendingSubscriptionCents))], ['SME reserve pool · segregated', money(BigInt(report.fund.smeReservePoolCents))],
          ['Overdue loans / principal', `${summary.overdue.length} / ${money(summary.overduePrincipal)}`],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="footnote">Pending redemption estimates use current NAV and active units. They are unallocated and may change; segregated balances are excluded from available fund cash.</p></div>
          <div><h3>Risk warnings</h3>{summary.warnings.length ? <ul className="operations-warnings">{summary.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p className="notice info">No monitored threshold warnings at this block.</p>}<p className="footnote">These indicators do not establish credit clearance, document verification or execution eligibility.</p></div></div>
        <details className="operations-risk-details" open={report.concentrations.some(c => c.outstanding + c.commitments > 0n)}><summary>SME financing concentration ({report.concentrations.length})</summary>{report.concentrations.length ? <div className="table-scroll"><table><thead><tr><th>SME identity</th><th>Principal</th><th>Gross commitments</th><th>% NAV</th><th>Risk band</th></tr></thead><tbody>{report.concentrations.map(c => <tr key={c.entity}><td className="mono" title={c.entity}>{shortId(c.entity)}</td><td>{money(c.outstanding)}</td><td>{money(c.commitments)}</td><td>{c.navExposure}</td><td>{concentrationBand(c.outstanding + c.commitments, BigInt(report.fund.navCents))}</td></tr>)}</tbody></table></div> : <p>No V2 SME financing recorded.</p>}<p className="footnote">Principal plus approved gross commitments. 0.5% and 0.8% are display bands; at 1% the contract requires acknowledgement. Combined SME cap: S$100,000.</p></details>
        <details className="operations-risk-details" open={summary.payerExposures.some(p => p.exceedsLimit)}><summary>Payer exposure ({summary.payerExposures.length})</summary>{summary.payerExposures.length ? <div className="table-scroll"><table><thead><tr><th>Payer identity</th><th>Combined exposure</th><th>% NAV</th><th>10% limit</th></tr></thead><tbody>{summary.payerExposures.map(p => <tr key={p.payer}><td className="mono" title={p.payer}>{shortId(p.payer)}</td><td>{money(p.total)}</td><td>{p.percentage}</td><td>{p.exceedsLimit ? 'Exceeded' : 'Within limit'}</td></tr>)}</tbody></table></div> : <p>No outstanding payer exposure.</p>}<p className="footnote">Payer principal and approved gross commitments are combined across SMEs. Financing must remain within 10% of current NAV.</p></details>
        {summary.overdue.length > 0 && <details className="operations-risk-details"><summary>Overdue financed invoices ({summary.overdue.length})</summary><ul>{summary.overdue.map(i => <li key={String(i.id)}>Invoice #{String(i.id)} · due {date(i.maturity)} SGT · principal {money(i.principal)}</li>)}</ul></details>}
      </>}
    </section>
    <ScenarioAnalysis />
  </div>;
}

function ScenarioAnalysis() {
  const [nav, setNav] = useState(''), [liquidity, setLiquidity] = useState(''), [face, setFace] = useState('5000'), [days, setDays] = useState('30');
  const [sme, setSme] = useState('0'), [payer, setPayer] = useState('0'), [commitments, setCommitments] = useState('0'), [payerCommitments, setPayerCommitments] = useState('0'), [automatic, setAutomatic] = useState('0');
  const [evidence, setEvidence] = useState(false);
  let result: ReturnType<typeof v2Eligibility> | null = null, quote: ReturnType<typeof v2Quote> | null = null, error = '';
  if (nav && liquidity) try {
    quote = v2Quote(moneyInput(face), Number(days));
    result = v2Eligibility(moneyInput(face), { navCents: moneyInput(nav), freeLiquidityCents: moneyInput(liquidity), smeOutstandingCents: moneyInput(sme), payerOutstandingCents: moneyInput(payer), smeCommitmentsCents: moneyInput(commitments), payerCommitmentsCents: moneyInput(payerCommitments), automaticExposureCents: moneyInput(automatic), verifiedSme: evidence, documentVerified: evidence, creditCleared: evidence, lowRisk: evidence, remainingDays: Number(days) });
  } catch { error = 'Enter non-negative S$ amounts with up to two decimals and a valid financing term.'; }
  return <details className="section-block operations-scenario"><summary>Scenario Analysis <span className="source-tag illustrative">Hypothetical</span></summary><p className="support-copy">Explore financing rules with your own assumptions. This calculator does not change fund data, save requests or verify applicants.</p>
    <div className="form-row">{([
      ['Scenario fund NAV (S$)', nav, setNav], ['Scenario unreserved liquidity (S$)', liquidity, setLiquidity], ['Scenario invoice face value (S$)', face, setFace], ['Scenario financing days', days, setDays],
      ['Scenario SME principal (S$)', sme, setSme], ['Scenario SME gross commitments (S$)', commitments, setCommitments], ['Scenario payer principal (S$)', payer, setPayer], ['Scenario payer gross commitments (S$)', payerCommitments, setPayerCommitments], ['Scenario automatic facility used (S$)', automatic, setAutomatic],
    ] as const).map(([label, value, setter]) => <label key={label}>{label}<input inputMode="decimal" value={value} onChange={e => setter(e.target.value)} /></label>)}</div>
    <label className="operations-filter"><input type="checkbox" checked={evidence} onChange={e => setEvidence(e.target.checked)} />Assume independent verification and low risk for this scenario only</label>
    {error && <p role="alert">{error}</p>}{result && quote ? <div className="operations-review"><h3>{result.decision}</h3><p>Hypothetical gross advance {money(quote.grossAdvanceCents)} · Net cash {money(quote.upfrontCents)} · Estimated interest {money(quote.estimatedInterestCents)}</p>{[...result.blocked, ...result.review].length > 0 && <ul>{[...result.blocked, ...result.review].map(reason => <li key={reason}>{reason}</li>)}</ul>}<p className="footnote">Calculator uses the reviewed default V2 policy. It is not an execution decision or a substitute for current on-chain limits and evidence.</p></div> : <p className="footnote">Enter hypothetical NAV and available liquidity to calculate a scenario.</p>}
  </details>;
}

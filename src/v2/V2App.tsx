import { useState } from 'react';
import type { Provider } from 'ethers';
import { resolveV2Address, V2_DEPLOYMENT } from './config';
import { money, moneyInput } from '../finance/models';
import { v2Eligibility, v2Quote, subscriptionPreview } from './models';
import { usePublicReport } from './usePublicReport';
import { InvestmentPolicy, RedemptionDraft, ManagerDraft, RequestHistory } from './RequestPanels';
import { InvestorAssets, ManagerReport } from './Reports';
import { userFacingError } from '../errors';
import { ManagerOperations } from './ManagerOperations';

type WorkspaceProps = { stakeholder?: 'manager' | 'investor' | 'sme'; connectedWallet?: string; walletEpoch?: number; networkOk?: boolean; readProvider?: Provider | null };
export function V2App(props: WorkspaceProps = {}) {
  if (props.stakeholder === 'manager') return <ManagerOperations key={`${props.connectedWallet}:${props.walletEpoch}:${props.networkOk}`} wallet={props.connectedWallet ?? ''} epoch={props.walletEpoch ?? 0} networkOk={props.networkOk ?? true} readProvider={props.readProvider} />;
  return <V2Preview {...props} />;
}
function V2Preview({ stakeholder, connectedWallet, walletEpoch = 0, networkOk = true, readProvider = null }: WorkspaceProps) {
  const initialTab = stakeholder === 'manager' ? 'Manager controls' : stakeholder === 'investor' ? 'Investor requests' : 'SME quotation';
  const [selectedTab, setTab] = useState(initialTab);
  const tab = stakeholder ? initialTab : selectedTab;
  const [face, setFace] = useState('5000'), [days, setDays] = useState('30');
  const [capital, setCapital] = useState('10000000'), [liquidity, setLiquidity] = useState('10000000');
  const [evidence, setEvidence] = useState(false), [investment, setInvestment] = useState('10000');
  const [configuration] = useState(() => {
    try { return { address: resolveV2Address(import.meta.env.VITE_V2_CONTRACT_ADDRESS), error: '' }; }
    catch (cause) { return { address: '', error: (cause as Error).message }; }
  });
  const [address, setAddress] = useState(configuration.address), [inspectedWallet, setWallet] = useState('');
  const wallet = connectedWallet ?? inspectedWallet;
  const { report: visible, loading: reading, error: readError, read } = usePublicReport(address, wallet, walletEpoch, networkOk, readProvider);
  const [exposures, setExposures] = useState({ sme: '0', payer: '0', commitments: '0', payerCommitments: '0', automatic: '0' });
  let quote: ReturnType<typeof v2Quote> | null = null, eligibility: ReturnType<typeof v2Eligibility> | null = null;
  let error = '', subscription: ReturnType<typeof subscriptionPreview> | null = null;
  try {
    if (tab === 'SME quotation') {
      quote = v2Quote(moneyInput(face), Number(days));
      eligibility = v2Eligibility(moneyInput(face), {
        navCents: moneyInput(capital), freeLiquidityCents: moneyInput(liquidity), smeOutstandingCents: moneyInput(exposures.sme),
        payerOutstandingCents: moneyInput(exposures.payer), smeCommitmentsCents: moneyInput(exposures.commitments),
        payerCommitmentsCents: moneyInput(exposures.payerCommitments), automaticExposureCents: moneyInput(exposures.automatic),
        verifiedSme: evidence, documentVerified: evidence, creditCleared: evidence, lowRisk: evidence, remainingDays: Number(days),
      });
    }
    if (tab === 'Investor requests') subscription = subscriptionPreview(moneyInput(investment), moneyInput(capital), moneyInput(capital), evidence, false);
  } catch (cause) { error = userFacingError(cause); }
  const due = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' }).format(new Date(Date.now() + Math.max(0, Math.min(36500, Number(days) || 0)) * 86400000));
  const scenarioInputs = <details className="model-controls"><summary>Fund assumptions</summary>
    <p className="support-copy">Adjust these assumptions to explore eligibility. They are separate from live fund balances.</p>
    <div className="form-row"><label>Scenario fund NAV (S$)<input inputMode="decimal" value={capital} onChange={e => setCapital(e.target.value)} /></label><label>Scenario unreserved liquidity (S$)<input inputMode="decimal" value={liquidity} onChange={e => setLiquidity(e.target.value)} /></label></div>
    <label className="consent-row"><input type="checkbox" checked={evidence} onChange={e => setEvidence(e.target.checked)} />Assume independent verification and low risk for this scenario only</label>
    {tab === 'SME quotation' && <div className="model-inputs">{([
      ['sme', 'SME outstanding principal (S$)'], ['commitments', 'SME approved gross commitments (S$)'],
      ['payer', 'Payer outstanding principal (S$)'], ['payerCommitments', 'Payer approved gross commitments (S$)'],
      ['automatic', 'Automatic facility already used, including commitments (S$)'],
    ] as const).map(([key, label]) => <label key={key}>{label}<input inputMode="decimal" value={exposures[key]} onChange={e => setExposures(previous => ({ ...previous, [key]: e.target.value }))} /></label>)}</div>}
  </details>;
  return <section className="v2-shell" aria-label="Financing and fund requests">
    <header><h2>{tab === 'Manager controls' ? 'Fund records' : tab === 'Investor requests' ? 'Investment overview' : 'Financing overview'}</h2><p className="support-copy">Requests are not available from this workspace yet. View current records or explore an estimate below.</p></header>
    {!stakeholder && <nav aria-label="Fund workspace sections">{['SME quotation', 'Investor requests', 'Manager controls'].map(name => <button className={`btn ${tab === name ? '' : 'o'}`} aria-pressed={tab === name} onClick={() => setTab(name)} key={name}>{name}</button>)}</nav>}
    <section className="section-block">
      <div className="section-heading"><h3>Fund records</h3><button className="btn o" disabled={reading || !address || !wallet || !networkOk || Boolean(configuration.error)} onClick={() => void read()}>{reading ? 'Refreshing…' : 'Refresh fund records'}</button></div>
      {!visible && <p className="support-copy">Load the fund to see holdings, requests and repayments for this wallet.</p>}
      {visible && <p className="support-copy">Records updated at Sepolia block {visible.blockTag}.</p>}
      {configuration.error && <p role="alert">{configuration.error}</p>}{readError && <p role="alert">{readError}</p>}
      <details className="calculation-notes"><summary>Data source</summary><div className="form-row">
        <label>Fund contract address<input value={address} readOnly={stakeholder !== undefined} onChange={e => { if (!stakeholder) setAddress(e.target.value); }} /></label>
        <label>Public wallet address to inspect<input value={wallet} readOnly={connectedWallet !== undefined} onChange={e => setWallet(e.target.value)} /></label>
      </div><p>RLU2 records are separate from RLU holdings. <a href={`https://sepolia.etherscan.io/address/${V2_DEPLOYMENT.address}`} target="_blank" rel="noreferrer">View fund contract</a></p></details>
    </section>
    {visible && tab === 'Investor requests' && <InvestorAssets report={visible} />}
    {visible && <RequestHistory report={visible} stakeholder={stakeholder ?? (tab === 'Manager controls' ? 'manager' : tab === 'Investor requests' ? 'investor' : 'sme')} />}
    {visible && tab === 'Manager controls' && <ManagerReport report={visible} />}
    {tab === 'SME quotation' && <details className="section-block operations-scenario"><summary>Financing calculator</summary>
      <p className="support-copy">Estimate your advance and repayment terms before requesting financing.</p>
      <div className="form-row"><label>Invoice face value (S$)<input inputMode="decimal" value={face} onChange={e => setFace(e.target.value)} /></label><label>Estimated financing days<input type="number" min="1" max="90" value={days} onChange={e => setDays(e.target.value)} /></label></div>
      {quote && <><div className="metric-grid"><div className="metric emphasis"><span>Estimated cash upfront</span><strong>{money(quote.upfrontCents)}</strong></div><div className="metric"><span>Estimated interest</span><strong>{money(quote.estimatedInterestCents)}</strong></div><div className="metric"><span>Estimated amount payable before payer offset</span><strong>{money(quote.estimatedObligationCents)}</strong></div></div>
        <details className="model-controls"><summary>Advance and repayment breakdown</summary><dl className="detail-list">{[
          ['Invoice face value', money(quote.faceCents)], ['Advance percentage', `${quote.advanceBps / 100n}%`], ['Gross advance', money(quote.grossAdvanceCents)],
          ['Processing fee (withheld upfront)', money(quote.processingFeeCents)], ['Annual simple interest', '8% on unpaid gross principal'],
          ['Reserve / holdback (not a fee)', money(quote.holdbackCents)], ['Estimated repayment date (SGT)', due],
          ['Estimated reserve release after full payer collection', money(quote.estimatedReserveReleaseCents)], ['Estimated SME top-up after full payer collection', money(quote.estimatedTopUpCents)],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="footnote">The processing fee is charged once. Payer collections reduce the same debt. Interest accrues for the actual time principal is unpaid. Early repayment penalty: S$0.</p></details></>}
      {scenarioInputs}
      {eligibility && <div className="notice info"><b>{eligibility.decision}</b>{[...eligibility.blocked, ...eligibility.review].length > 0 && <ul>{[...eligibility.blocked, ...eligibility.review].map(reason => <li key={reason}>{reason}</li>)}</ul>}<p className="footnote">This assessment uses your assumptions. Approval requires verified documents and current fund checks.</p></div>}
      {error && <p className="notice error" role="alert">{error}</p>}<button className="btn" disabled title="Financing requests are not available yet">Submit financing request</button>
    </details>}
    {tab === 'Investor requests' && <>
      <details className="section-block operations-scenario"><summary>Investment calculator</summary><p className="support-copy">Explore the investment allowance and review requirements for RLU2.</p>
        <label>Proposed additional investment (S$)<input inputMode="decimal" value={investment} onChange={e => setInvestment(e.target.value)} /></label>
        <InvestmentPolicy amount={investment} />{scenarioInputs}{subscription && <p className="notice info">{subscription.decision}. Funding must be confirmed before units are issued.</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
      </details>
      <RedemptionDraft report={visible} />
    </>}
    {tab === 'Manager controls' && <ManagerDraft />}
  </section>;
}

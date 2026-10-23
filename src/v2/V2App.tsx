import { useRef, useState } from 'react';
import { JsonRpcProvider } from 'ethers';
import { money, moneyInput } from '../finance/models';
import { v2Eligibility, v2Quote, subscriptionPreview } from './models';
import { V2Ledger } from './V2Ledger';
import {InvestorAssets,ManagerReport} from './Reports';
import { userFacingError } from '../errors';

export function V2App() {
  const [tab,setTab]=useState('SME quotation');
  const [face,setFace]=useState('5000'); const [days,setDays]=useState('30');
  const [capital,setCapital]=useState('10000000'); const [liquidity,setLiquidity]=useState('10000000');
  const [evidence,setEvidence]=useState(false); const [investment,setInvestment]=useState('10000');
  const [address,setAddress]=useState('');const [wallet,setWallet]=useState('');
  const identity=useRef('');identity.current=address+':'+wallet;
  const sequence=useRef(0);const [reading,setReading]=useState(false);const [readError,setReadError]=useState('');
  const [snapshot,setSnapshot]=useState<{key:string;data:Awaited<ReturnType<V2Ledger['readReport']>>}|null>(null);
  const visible=snapshot?.key===identity.current?snapshot.data:null;
  let quote:ReturnType<typeof v2Quote>|null=null;let eligibility:ReturnType<typeof v2Eligibility>|null=null;let error='';let subscription:ReturnType<typeof subscriptionPreview>|null=null;
  try {
    if(tab==='SME quotation') {
    quote=v2Quote(moneyInput(face),Number(days));
    eligibility=v2Eligibility(moneyInput(face),{navCents:moneyInput(capital),freeLiquidityCents:moneyInput(liquidity),smeOutstandingCents:0n,payerOutstandingCents:0n,verifiedSme:evidence,documentVerified:evidence,creditCleared:evidence,lowRisk:evidence,remainingDays:Number(days)});
    }
    if(tab==='Investor requests') subscription=subscriptionPreview(moneyInput(investment),moneyInput(capital),moneyInput(capital),evidence,false);
  } catch(cause){error=userFacingError(cause);}
  async function read() {
    const key=identity.current;const version=++sequence.current;setReading(true);setReadError('');setSnapshot(null);
    const provider=new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com',11155111,{staticNetwork:true});
    try {const data=await new V2Ledger(address,provider).readReport(wallet);if(key===identity.current&&version===sequence.current)setSnapshot({key,data});}
    catch(cause){if(key===identity.current&&version===sequence.current)setReadError(userFacingError(cause));}
    finally{provider.destroy();if(version===sequence.current)setReading(false);}
  }
  const due=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium'}).format(new Date(Date.now()+Math.max(0,Math.min(36500,Number(days)||0))*86400000));
  return <main className="v2-shell"><header><p className="section-kicker">Separate university prototype</p><h1>ReceivLedger V2</h1><p>Simulated SGD accounting. No real money, V1 upgrade or token migration.</p><a href="/">Return to existing V1 website</a></header>
    <div className="notice warning"><b>V2 is not deployed or activated.</b> This preview does not connect MetaMask, sign messages, create requests or send transactions. Figures entered below are policy scenarios, not fund balances. Actual V1 records remain separate.</div>
    <nav aria-label="V2 preview sections">{['SME quotation','Investor requests','Manager controls'].map(name=><button className={`btn ${tab===name?'':'o'}`} aria-pressed={tab===name} onClick={()=>setTab(name)} key={name}>{name}</button>)}</nav>
    <section className="section-block"><h2>Policy scenario inputs</h2><div className="form-row"><label>Scenario fund NAV (S$)<input value={capital} onChange={e=>setCapital(e.target.value)} /></label><label>Scenario unreserved liquidity (S$)<input value={liquidity} onChange={e=>setLiquidity(e.target.value)} /></label><label className="consent-row"><input type="checkbox" checked={evidence} onChange={e=>setEvidence(e.target.checked)} />Assume independent verification and low risk for this scenario only</label></div><p>Assumes no existing SME/payer exposure or approved redemption liabilities. A real execution must check the contract's current exposures, permissions, valuation and receipts.</p></section>
    {tab==='SME quotation'&&<section className="section-block"><h2>SME financing quotation</h2><div className="form-row"><label>Invoice face value (S$)<input value={face} onChange={e=>setFace(e.target.value)} /></label><label>Estimated financing days<input type="number" min="1" max="90" value={days} onChange={e=>setDays(e.target.value)} /></label></div>
      {quote&&<><dl className="detail-list">{[['Invoice face value',money(quote.faceCents)],['Advance percentage',`${quote.advanceBps/100n}%`],['Gross advance',money(quote.grossAdvanceCents)],['Processing fee (withheld upfront)',money(quote.processingFeeCents)],['Cash available upfront (simulated)',money(quote.upfrontCents)],['Annual simple interest','8% on unpaid gross principal, actual seconds / 365 days'],['Estimated financing days',days],['Estimated interest',money(quote.estimatedInterestCents)],['Estimated amount payable before payer offset',money(quote.estimatedObligationCents)],['Reserve / holdback (not a fee)',money(quote.holdbackCents)],['Illustrative repayment due date (SGT)',due],['Estimated unused reserve release after full payer collection',money(quote.estimatedReserveReleaseCents)],['Estimated SME top-up after full payer collection',money(quote.estimatedTopUpCents)]] .map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="notice info">Processing is charged once. Payer collections offset the same debt; principal is not charged twice. Early repayment penalty: S$0. Optional additional overdue pricing is disabled by default and requires explicit terms; no overdue charge is included here.</p></>}
      {eligibility&&<div className="notice warning"><b>{eligibility.decision}</b><ul>{[...eligibility.blocked,...eligibility.review].map(reason=><li key={reason}>{reason}</li>)}</ul><p>Automatic financing also requires no more than 30 days, S$50,000 automatic exposure and combined SME exposure within 1% of NAV. Manual financing has a S$100,000 hard cap and 90-day maturity. Eligibility is not approval, financing or payment. Approved and Auto-approved are separate V2 states; neither moves funds until financing is executed.</p></div>}
      <button className="btn" disabled title="Independent V2 deployment and authenticated wallet integration required">Submit / Accept V2 Financing Terms</button>
    </section>}
    {tab==='Investor requests'&&<section className="section-block"><h2>Investor subscriptions and redemptions</h2><p>Actual V2 holdings, request history and NAV per unit are unavailable until an independent V2 deployment is selected. One RLU2 starts at S$1 only at initial issuance. Later subscriptions and redemptions use NAV including earned unpaid interest and active units, with conservative rounding and valuation checks.</p><label>Proposed additional investment (S$)<input value={investment} onChange={e=>setInvestment(e.target.value)} /></label>{subscription&&<p className="notice info">{subscription.decision}. Automatic subscriptions have a S$10,000 lifetime limit per verified identity across wallets; redemptions do not reset it. A signature does not confirm funds. Only a manager-confirmed simulated funding receipt can enter execution.</p>}
      <div className="v2-actions">{['Request Additional Investment','Request Withdrawal / Redeem RLU','Transfer RLU','View Requests and Status'].map(name=><button className="btn o" key={name} disabled title="No activated V2 deployment">{name}</button>)}</div><p>Requests without cash remain Pending Liquidity after manager review. Fully allocated redemptions reserve cash and units, then burn on simulated settlement. No SGD payment is made.</p></section>}
    {tab==='Manager controls'&&<section className="section-block"><h2>Manager dashboard and risk controls</h2><p>Live V2 fund size, liquidity, SME/payer exposures, financed principal, pending approvals/subscriptions/redemptions, reserved redemption cash, overdue loans and realised income require V2 data. No demonstration history is substituted.</p><p>V2 supports Approve, Reject with reason, Finance, Record Collection/Repayment, subscription review and redemption review/allocation/settlement. Authority is enforced in Solidity. Automation is disabled initially; executors cannot confirm funding, approve large requests or change risk limits.</p>
      <h3>Inspect a future V2 deployment (public reads only)</h3><div className="form-row"><label>Independent V2 contract address<input value={address} onChange={e=>{sequence.current++;setAddress(e.target.value);setSnapshot(null);setReading(false);setReadError('');}} /></label><label>Public wallet address to inspect<input value={wallet} onChange={e=>{sequence.current++;setWallet(e.target.value);setSnapshot(null);setReading(false);setReadError('');}} /></label><button className="btn o" disabled={reading||!address||!wallet} onClick={()=>void read()}>{reading?'Reading Sepolia...':'Read V2 fund'}</button></div>
      {readError&&<p role="alert">{readError}</p>}{visible&&<><p>Sepolia block {visible.blockTag}. Public wallet {visible.wallet}. Raw RLU2 units: {visible.units.toString()} (2 decimals).</p><dl className="detail-list">{Object.entries(visible.fund).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{typeof value==='bigint'&&name.endsWith('Cents')?money(value):String(value)}</dd></div>)}</dl></>}
    </section>}
    {visible&&tab==='Manager controls'&&<ManagerReport report={visible}/>}
    {visible&&tab==='Investor requests'&&<InvestorAssets report={visible}/>}
    {error&&<p className="notice error" role="alert">{error}</p>}
    <footer>Pending activation: independent contract review/deployment, V2 registration attestation and execution services, and wallet UI acceptance. No private keys belong in this application.</footer>
  </main>;
}

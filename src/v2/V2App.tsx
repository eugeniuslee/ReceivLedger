import { useState } from 'react';
import { resolveV2Address, V2_DEPLOYMENT } from './config';
import { money, moneyInput } from '../finance/models';
import { v2Eligibility, subscriptionPreview } from './models';
import { calculateFinancing, termsAt, type FinancingBreakdown } from '../finance/financing';
import { FinancingBreakdownList } from '../components/FinancialModels';
import { usePublicReport } from './usePublicReport';
import { InvestmentPolicy, RedemptionDraft, ManagerDraft, RequestHistory } from './RequestPanels';
import {InvestorAssets,ManagerReport} from './Reports';
import { userFacingError } from '../errors';
import { ManagerOperations } from './ManagerOperations';

type WorkspaceProps = {stakeholder?:'manager'|'investor'|'sme';connectedWallet?:string;walletEpoch?:number;networkOk?:boolean};
export function V2App(props: WorkspaceProps = {}) {
  if (props.stakeholder === 'manager') return <ManagerOperations key={`${props.connectedWallet}:${props.walletEpoch}:${props.networkOk}`} wallet={props.connectedWallet ?? ''} epoch={props.walletEpoch ?? 0} networkOk={props.networkOk ?? true} />;
  return <V2Preview {...props} />;
}
function V2Preview({stakeholder,connectedWallet,walletEpoch=0,networkOk=true}:WorkspaceProps) {
  const initialTab=stakeholder==='manager'?'Manager controls':stakeholder==='investor'?'Investor requests':'SME quotation';
  const [selectedTab,setTab]=useState(initialTab);
  const tab=stakeholder?initialTab:selectedTab;
  const [face,setFace]=useState('5000'); const [days,setDays]=useState('30');
  const [capital,setCapital]=useState('10000000'); const [liquidity,setLiquidity]=useState('10000000');
  const [evidence,setEvidence]=useState(false); const [investment,setInvestment]=useState('10000');
  const [configuration]=useState(()=>{
    try{return {address:resolveV2Address(import.meta.env.VITE_V2_CONTRACT_ADDRESS),error:''};}
    catch(cause){return {address:'',error:(cause as Error).message};}
  });
  const [address,setAddress]=useState(configuration.address);const [inspectedWallet,setWallet]=useState('');
  const wallet=connectedWallet??inspectedWallet;
  const {report:visible,loading:reading,error:readError,read} = usePublicReport(address,wallet,walletEpoch,networkOk);
  const [exposures,setExposures]=useState({sme:'0',payer:'0',commitments:'0',payerCommitments:'0',automatic:'0'});
  let quote:FinancingBreakdown|null=null;let eligibility:ReturnType<typeof v2Eligibility>|null=null;let error='';let subscription:ReturnType<typeof subscriptionPreview>|null=null;
  try {
    if(tab==='SME quotation') {
    quote=calculateFinancing(moneyInput(face),BigInt(Math.max(0,Math.min(36500,Number(days)||0))),termsAt(Math.floor(Date.now()/1000)));
    eligibility=v2Eligibility(moneyInput(face),{navCents:moneyInput(capital),freeLiquidityCents:moneyInput(liquidity),smeOutstandingCents:moneyInput(exposures.sme),payerOutstandingCents:moneyInput(exposures.payer),smeCommitmentsCents:moneyInput(exposures.commitments),payerCommitmentsCents:moneyInput(exposures.payerCommitments),automaticExposureCents:moneyInput(exposures.automatic),verifiedSme:evidence,documentVerified:evidence,creditCleared:evidence,lowRisk:evidence,remainingDays:Number(days)});
    }
    if(tab==='Investor requests') subscription=subscriptionPreview(moneyInput(investment),moneyInput(capital),moneyInput(capital),evidence,false);
  } catch(cause){error=userFacingError(cause);}
  const due=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium'}).format(new Date(Date.now()+Math.max(0,Math.min(36500,Number(days)||0))*86400000));
  return <section className="v2-shell" aria-label="Financing and fund requests"><header><h2>{stakeholder==='manager'?'Fund operations and risk':stakeholder==='investor'?'Investment and redemption':'Financing quotation'}</h2><p>Invoice ledger records and RLU remain separate from fund records and RLU2.</p></header>
    <div className="notice info"><b>The fund is deployed on Sepolia. Financial execution remains disabled.</b> Quotations are estimates. Private registration, permissions and signed execution workflows still require integration and verification. Invoice ledger records remain available in the other navigation pages.</div>
    {!stakeholder&&<nav aria-label="Preview sections">{['SME quotation','Investor requests','Manager controls'].map(name=><button className={`btn ${tab===name?'':'o'}`} aria-pressed={tab===name} onClick={()=>setTab(name)} key={name}>{name}</button>)}</nav>}
    <section className="section-block"><h2>Policy scenario inputs</h2><div className="form-row"><label>Scenario fund NAV (S$)<input value={capital} onChange={e=>setCapital(e.target.value)} /></label><label>Scenario unreserved liquidity (S$)<input value={liquidity} onChange={e=>setLiquidity(e.target.value)} /></label><label className="consent-row"><input type="checkbox" checked={evidence} onChange={e=>setEvidence(e.target.checked)} />Assume independent verification and low risk for this scenario only</label></div><p>All values here are scenario inputs, not live balances or verified evidence. Liquidity means cash after approved commitments and redemption allocations. Real execution must recheck current permissions, valuation, exposures and receipts.</p>
      {tab==='SME quotation'&&<details className="model-controls"><summary>Scenario outstanding financing and commitments</summary><div className="model-inputs">{([['sme','SME outstanding principal (S$)'],['commitments','SME approved gross commitments (S$)'],['payer','Payer outstanding principal (S$)'],['payerCommitments','Payer approved gross commitments (S$)'],['automatic','Automatic facility already used, including commitments (S$)']] as const).map(([key,label])=><label key={key}>{label}<input inputMode="decimal" value={exposures[key]} onChange={e=>setExposures(previous=>({...previous,[key]:e.target.value}))}/></label>)}</div></details>}</section>
    {tab==='SME quotation'&&<section className="section-block"><h2>SME financing quotation</h2><div className="form-row"><label>Invoice face value (S$)<input value={face} onChange={e=>setFace(e.target.value)} /></label><label>Estimated financing days<input type="number" min="1" max="90" value={days} onChange={e=>setDays(e.target.value)} /></label></div>
      {quote&&<><FinancingBreakdownList breakdown={quote}/><p className="support-copy">Illustrative repayment due date (SGT): {due}. The service fee is charged once; repaying early reduces interest, with no early repayment penalty.</p></>}
      {eligibility&&<div className="notice warning"><b>{eligibility.decision}</b><ul>{[...eligibility.blocked,...eligibility.review].map(reason=><li key={reason}>{reason}</li>)}</ul><p>Automatic financing also requires no more than 30 days, S$50,000 automatic exposure and combined SME exposure within 1% of NAV. Manual financing has a S$100,000 hard cap and 90-day maturity. Eligibility is not approval, financing or payment. Approved and Auto-approved are separate states; neither moves funds until financing is executed.</p></div>}
      <button className="btn" disabled title="Verified permissions and authenticated wallet integration required">Submit / Accept Financing Terms</button>
    </section>}
    {tab==='Investor requests'&&<section className="section-block"><h2>Investor subscriptions and redemptions</h2><p>Actual holdings, request history and NAV per unit require a successful public read of the deployed contract. One RLU2 starts at S$1 only at initial issuance. Later subscriptions and redemptions use NAV including earned unpaid interest and active units, with conservative rounding and valuation checks.</p><label>Proposed additional investment (S$)<input value={investment} onChange={e=>setInvestment(e.target.value)} /></label><InvestmentPolicy amount={investment}/><RedemptionDraft report={visible}/>{subscription&&<p className="notice info">{subscription.decision}. Automatic subscriptions have a S$10,000 lifetime limit per verified identity across wallets; redemptions do not reset it. A signature does not confirm funds. Only a manager-confirmed funding receipt can enter execution.</p>}
      <div className="v2-actions">{['Request Additional Investment','Request Withdrawal / Redeem RLU','Transfer RLU','View Requests and Status'].map(name=><button className="btn o" key={name} disabled title="Financial execution is not activated">{name}</button>)}</div><p>Requests without cash remain Pending Liquidity after manager review. Fully allocated redemptions reserve cash and units, then burn on settlement. No SGD payment is made.</p></section>}
    {tab==='Manager controls'&&<section className="section-block"><h2>Manager dashboard and risk controls</h2><p>Live fund size, liquidity, SME/payer exposures, financed principal, pending approvals/subscriptions/redemptions, reserved redemption cash, overdue loans and realised income require live fund data. No demonstration history is substituted.</p><p>The fund supports Approve, Reject with reason, Finance, Record Collection/Repayment, subscription review and redemption review/allocation/settlement. Authority is enforced in Solidity. Automation is disabled initially; executors cannot confirm funding, approve large requests or change risk limits.</p>
      <ManagerDraft/><div className="v2-actions">{['Approve investment request','Reject investment request','Confirm funding','Process investment','Approve redemption','Allocate redemption liquidity','Settle redemption','Approve invoice','Reject invoice with reason','Finance invoice','Record payer collection / SME repayment'].map(name=><button className="btn o" key={name} disabled title="Reviewed wallet/backend integration required; deployed contract does not activate execution">{name}</button>)}</div>
      <p>Review Investor and SME applications in Applications. Invoice ledger approval does not register a fund identity.</p>
    </section>}
    {(tab==='Manager controls'||tab==='Investor requests'||tab==='SME quotation')&&<section className="section-block">
      <h3>Read the deployed fund contract (public reads only)</h3><div className="form-row"><label>Fund contract address<input value={address} readOnly={stakeholder!==undefined} onChange={e=>{if(!stakeholder)setAddress(e.target.value);}} /></label><label>Public wallet address to inspect<input value={wallet} readOnly={connectedWallet!==undefined} onChange={e=>setWallet(e.target.value)} /></label><button className="btn o" disabled={reading||!address||!wallet||!networkOk||Boolean(configuration.error)} onClick={()=>void read()}>{reading?'Reading Sepolia...':'Read fund'}</button></div>
      <p className="support-copy">Verified Sepolia deployment: <a href={`https://sepolia.etherscan.io/address/${V2_DEPLOYMENT.address}`} target="_blank" rel="noreferrer">{V2_DEPLOYMENT.address}</a>. Contract deployment does not activate private onboarding, automation workers or financial execution.</p>{configuration.error&&<p role="alert">{configuration.error}</p>}{readError&&<p role="alert">{readError}</p>}{visible&&<><p>Sepolia block {visible.blockTag}. Public wallet {visible.wallet}. Raw RLU2 units: {visible.units.toString()} (2 decimals).</p><dl className="detail-list">{Object.entries(visible.fund).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{typeof value==='bigint'&&name.endsWith('Cents')?money(value):String(value)}</dd></div>)}</dl></>}
    </section>}
    {visible&&<RequestHistory report={visible} stakeholder={stakeholder??(tab==='Manager controls'?'manager':tab==='Investor requests'?'investor':'sme')}/>}{visible&&tab==='Manager controls'&&<ManagerReport report={visible}/>}
    {visible&&tab==='Investor requests'&&<InvestorAssets report={visible}/>}
    {error&&<p className="notice error" role="alert">{error}</p>}
    {stakeholder==='sme'&&<section className="section-block"><h3>Invoice documents, repayments and history</h3><p>Use Private Documents for authenticated supporting PDFs and My Invoices for invoice ledger records. Fund document binding, invoice submission and repayment entry await backend and wallet integration. Do not submit an invoice ledger invoice expecting fund financing.</p><p>Read the deployed fund contract above for current public invoice and repayment records. Repayment will distinguish remaining principal, accrued unpaid interest, previous repayments and payer offsets.</p><button className="btn o" disabled>Repay financing</button></section>}
    {stakeholder==='investor'&&<section className="section-block"><h3>Request and transaction history</h3><p>Fund requests and receipts require a successful read of the independently deployed contract. Invoice ledger receipts remain in Transaction History and are not fund subscriptions or redemptions.</p></section>}
  </section>;
}

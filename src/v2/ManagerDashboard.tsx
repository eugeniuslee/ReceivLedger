import { useEffect } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { resolveV2Address } from './config';
import { usePublicReport } from './usePublicReport';
import { ManagerReport } from './Reports';
import { money } from '../finance/models';
export function PublicManagerDashboard({ title='Fund Manager dashboard' }: {title?:string}) {
  const {account,networkOk,walletEpoch=0,isV2Manager,v2Owner}=useLedger();
  let address='',configurationError='';
  try{address=resolveV2Address(import.meta.env.VITE_V2_CONTRACT_ADDRESS);}catch(cause){configurationError=(cause as Error).message;}
  const {report,loading,error,read}=usePublicReport(address,account??'',walletEpoch,networkOk);
  useEffect(()=>{if(isV2Manager&&account&&networkOk&&address)void read();},[isV2Manager,account,networkOk,address,read]);
  if(!isV2Manager)return null;
  return <><section className="section-block"><div className="section-heading"><h2>{title}</h2><button className="btn o small" disabled={loading||!address} onClick={()=>void read()}>Refresh V2 reports</button></div>
    <p className="support-copy">Recognised by owner() on the deployed V2 contract. These public blockchain reports require no private sign-in.</p><p className="mono">{v2Owner}</p>
    {loading&&<p role="status">Loading public V2 reports…</p>}{(error||configurationError)&&<p role="alert">{error||configurationError}</p>}
    {report&&<><p>Sepolia block {report.blockTag}. SGD values are simulated; V2 financial execution remains disabled.</p><div className="metric-grid">{[['V2 fund NAV',money(BigInt(report.fund.navCents))],['Available V2 liquidity',money(BigInt(report.fund.freeLiquidityCents))],['Outstanding V2 principal',money(BigInt(report.fund.outstandingCents))]].map(([label,value])=><div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></>}
  </section>{report&&<ManagerReport report={report}/>}</>;
}

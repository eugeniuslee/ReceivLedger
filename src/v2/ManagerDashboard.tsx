import { useEffect } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { resolveV2Address } from './config';
import { usePublicReport } from './usePublicReport';
import { ManagerReport } from './Reports';
import { money } from '../finance/models';
export function PublicManagerDashboard({ title='Fund Manager dashboard' }: {title?:string}) {
  const {account,networkOk,walletEpoch=0,isV2Manager,v2Owner,ledger}=useLedger();
  let address='',configurationError='';
  try{address=resolveV2Address(import.meta.env.VITE_V2_CONTRACT_ADDRESS);}catch(cause){configurationError=(cause as Error).message;}
  const {report,loading,error,read}=usePublicReport(address,account??'',walletEpoch,networkOk,ledger?.contract?.runner?.provider??null);
  useEffect(()=>{if(isV2Manager&&account&&networkOk&&address)void read();},[isV2Manager,account,networkOk,address,read]);
  if(!isV2Manager)return null;
  return <><section className="section-block"><div className="section-heading"><h2>{title}</h2><button className="btn o small" disabled={loading||!address} onClick={()=>void read()}>Refresh fund data</button></div>
    {loading&&<p role="status">Loading fund data…</p>}{(error||configurationError)&&<p role="alert">{error||configurationError}</p>}
    {report&&<><div className="metric-grid">{[['Fund NAV',money(BigInt(report.fund.navCents))],['Available liquidity',money(BigInt(report.fund.freeLiquidityCents))],['Outstanding principal',money(BigInt(report.fund.outstandingCents))]].map(([label,value])=><div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <details className="model-controls"><summary>Data source</summary><p className="support-copy">Sepolia block {report.blockTag}. These balances reflect contract accounting; they are not bank balances.</p><p className="support-copy">Fund manager wallet: <span className="mono">{v2Owner}</span></p></details></>}
  </section>{report&&<details className="section-block home-details"><summary>Income and financing detail</summary><ManagerReport report={report}/></details>}</>;
}

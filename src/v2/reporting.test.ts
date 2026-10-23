import {describe,it,expect} from 'vitest';
import {concentrationBand,concentrationReport,myAssets,type ReportingInvoice} from './reporting';
import {subscriptionPreview,v2Eligibility} from './models';
describe('V2 reporting and cumulative policy calculations',()=>{
 it.each([[4999n,'Normal'],[5000n,'Moderate concentration'],[8000n,'Approaching recommended limit'],[10000n,'High concentration — manager acknowledgement required']])('uses exact concentration boundary %s',(exposure,expected)=>{expect(concentrationBand(exposure as bigint,1000000n)).toBe(expected);});
 it('counts common payer exposure across SMEs and separates pending proposals from commitments',()=>{
  const loan:ReportingInvoice={id:1n,entity:'SME A',payer:'Common payer',face:500000n,advance:500000n,principal:500000n,commitment:0n,maturity:100n,status:3n,collectedBase:10n,collectedOverdue:0n,collectedPrincipal:0n};
  const result=concentrationReport([loan,{...loan,id:2n,entity:'SME B',principal:0n,commitment:498000n,status:2n},{...loan,id:3n,principal:0n,status:0n}],100000000n,101n);
  expect(result[0].outstanding).toBe(500000n);expect(result[0].pendingPrincipal).toBe(500000n);expect(result[0].payers[0].total).toBe(1000000n);expect(result[0].maturities[0].overdue).toBe(true);expect(result[1].commitments).toBe(500000n);
 });
 it('includes pending escrow in holdings and allocated exit claims separately without double counting',()=>{
  const result=myAssets(1500000n,1000000n,400000n,100000n,200000n);
  expect(result.ownership).toBe('50%');expect(result.activeValue).toBe(750000n);expect(result.personalValue).toBe(950000n);expect(result.navPerRlu).toBe(150n);
  expect(myAssets(0n,0n,0n,0n,200000n).personalValue).toBe(200000n);
  expect(()=>myAssets(0n,0n,1n)).toThrow();expect(concentrationBand(1n,0n)).toContain('High');
 });
 it('uses lifetime automatic subscription capacity without resetting on a new request',()=>{
  expect(subscriptionPreview(500000n,1000000n,1000000n,true,true,0n,500000n).decision).toBe('Eligible execution queue');
  expect(subscriptionPreview(500001n,1000000n,1000000n,true,true,0n,500000n).decision).toBe('Manager review required');
 });
 it('counts commitments and automatic facility usage and uses 30/90-day boundaries',()=>{
  const e={navCents:1000000000n,freeLiquidityCents:1000000000n,smeOutstandingCents:4000000n,smeCommitmentsCents:500000n,payerOutstandingCents:0n,automaticExposureCents:5000000n,verifiedSme:true,documentVerified:true,creditCleared:true,lowRisk:true,remainingDays:31};
  const result=v2Eligibility(500000n,e);expect(result.review).toContain('S$50,000 automatic facility exceeded');expect(result.review).toContain('Automatic financing requires maturity within 30 days');
  expect(v2Eligibility(500000n,{...e,smeOutstandingCents:9500001n,smeCommitmentsCents:0n}).blocked).toContain('SME S$100,000 cap exceeded');
 });
});

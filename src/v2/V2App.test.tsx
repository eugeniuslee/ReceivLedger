// @vitest-environment jsdom
import { act,cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it,vi } from 'vitest';
import { V2App } from './V2App';
import {V2Ledger} from './V2Ledger';
import {InvestorAssets,ManagerReport} from './Reports';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('isolated V2 preview',()=>{
 it('shows a complete quote and never presents scenario inputs as actual fund balances',()=>{render(<V2App/>);expect(screen.getByText('V2 is deployed on Sepolia. Financial execution remains disabled.')).toBeTruthy();expect(screen.getByText('SME financing quotation')).toBeTruthy();expect(screen.getByText('Estimated amount payable before payer offset')).toBeTruthy();expect(screen.getByText('Reserve / holdback (not a fee)')).toBeTruthy();expect((screen.getByRole('button',{name:'Submit / Accept V2 Financing Terms'}) as HTMLButtonElement).disabled).toBe(true);});
 it('keeps request controls disabled and does not invent holdings or request history',()=>{render(<V2App/>);fireEvent.click(screen.getByRole('button',{name:'Investor requests'}));for(const name of ['Request Additional Investment','Request Withdrawal / Redeem RLU','Transfer RLU','View Requests and Status'])expect((screen.getByRole('button',{name}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/Actual V2 holdings, request history and NAV per unit require/)).toBeTruthy();});
 it('changes eligibility only within the explicit scenario and protects manager reads until configured',()=>{render(<V2App/>);expect(screen.getByText('Blocked')).toBeTruthy();fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByText('Eligible for automatic approval')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Manager controls'}));expect((screen.getByRole('button',{name:'Read V2 fund'}) as HTMLButtonElement).disabled).toBe(true);});
 it('discards a report response after an A/B/A wallet inspection change',async()=>{
  let resolve!:(value:Awaited<ReturnType<V2Ledger['readReport']>>)=>void;
  const pending=new Promise<Awaited<ReturnType<V2Ledger['readReport']>>>(r=>{resolve=r;});
  vi.spyOn(V2Ledger.prototype,'readReport').mockReturnValue(pending);
  render(<V2App/>);fireEvent.click(screen.getByRole('button',{name:'Manager controls'}));
  const wallet=screen.getByLabelText('Public wallet address to inspect'),a='0x'+'22'.repeat(20);
  fireEvent.change(screen.getByLabelText('Independent V2 contract address'),{target:{value:'0x'+'aa'.repeat(20)}});fireEvent.change(wallet,{target:{value:a}});
  fireEvent.click(screen.getByRole('button',{name:'Read V2 fund'}));
  fireEvent.change(wallet,{target:{value:'0x'+'33'.repeat(20)}});fireEvent.change(wallet,{target:{value:a}});
  await act(async()=>{resolve({wallet:a,blockTag:123456,fund:{}} as Awaited<ReturnType<V2Ledger['readReport']>>);await pending;});
  expect(screen.queryByText(/Sepolia block 123456/)).toBeNull();
 });
 it('renders honest zero holdings and empty reports without fabricating history',()=>{
  const report={wallet:'public wallet',blockTag:1,movementsFromBlock:0,concentrations:[],movements:[],fund:{fundAssetsCents:0n,freeLiquidityCents:0n,accruedInterestCents:0n,bookedAccruedCents:0n,impairmentCents:0n},assets:{nav:0n,activeUnits:0n,navPerRlu:null,ownership:'0%',activeValue:0n,allocatedClaim:0n,personalValue:0n}} as unknown as Awaited<ReturnType<V2Ledger['readReport']>>;
  render(<><InvestorAssets report={report}/><ManagerReport report={report}/></>);
  expect(screen.getByText('No active units')).toBeTruthy();expect(screen.getByText('No V2 invoices at this block.')).toBeTruthy();expect(screen.getByText('No NAV movement records in this range.')).toBeTruthy();
 });
});

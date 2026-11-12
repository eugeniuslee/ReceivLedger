// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Dashboard} from '../pages/Dashboard';
import {Reports} from '../pages/Reports';
import {Applications} from '../pages/Applications';
import {PrivateAccess} from '../components/PrivateAccess';
import {useLedger} from '../chain/LedgerContext';
import {useRegistry} from '../registration/RegistryContext';
import {usePublicReport} from './usePublicReport';
import type {V2Ledger} from './V2Ledger';
vi.mock('../chain/LedgerContext',()=>({useLedger:vi.fn(),useOptionalLedger:()=>null}));
vi.mock('../registration/RegistryContext',()=>({useRegistry:vi.fn()}));
vi.mock('./usePublicReport',()=>({usePublicReport:vi.fn()}));
vi.mock('../finance/FinanceContext',async()=>{const {testSnapshot,testNow}=await import('../finance/fixtures');return {useFinance:()=>({data:testSnapshot(),loading:false,error:null,now:testNow,refresh:vi.fn()})};});
let wallet:ReturnType<typeof useLedger>,registry:ReturnType<typeof useRegistry>,read:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  wallet={account:'0x'+'11'.repeat(20),role:'manager',networkOk:true,isV2Manager:true,v2Owner:'0x'+'11'.repeat(20),walletEpoch:0,snapshot:null,events:[],transactionPending:false} as unknown as ReturnType<typeof useLedger>;
  registry={configured:true,authenticated:false,busy:false,error:null,isManager:false,signIn:vi.fn(),request:vi.fn()} as unknown as ReturnType<typeof useRegistry>;
  read=vi.fn().mockResolvedValue(undefined);
  vi.mocked(useLedger).mockImplementation(()=>wallet);vi.mocked(useRegistry).mockImplementation(()=>registry);
  vi.mocked(usePublicReport).mockReturnValue({read,error:'',loading:false,report:{blockTag:123,wallet:wallet.account,concentrations:[],movements:[],movementsFromBlock:100,fund:{navCents:0n,freeLiquidityCents:0n,outstandingCents:0n,accruedInterestCents:0n,bookedAccruedCents:0n,impairmentCents:0n}} as unknown as Awaited<ReturnType<V2Ledger['readReport']>>});
});
afterEach(cleanup);
describe('manager public/private boundary',()=>{
  it('merges fund figures, requests and financial reports on one manager page',()=>{
    wallet.legacyRole='manager';vi.mocked(usePublicReport).mockReturnValue({read,error:'',loading:false,report:null});render(<Reports/>);
    for(const label of ['Fund NAV','NAV per RLU','Fund capital','Income earned','Available funds','Receivables from SMEs'])expect(screen.getByText(label,{selector:'.metric > span'})).toBeTruthy();
    expect(screen.getByRole('heading',{name:'How the NAV is built'})).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Invoice income'})).toBeTruthy();
    expect(registry.request).not.toHaveBeenCalled();expect(registry.signIn).not.toHaveBeenCalled();
  });
  it('loads manager Home public reports without any private sign-in or request',()=>{
    render(<Dashboard/>);
    expect(screen.getByRole('heading',{name:'Fund Manager dashboard'})).toBeTruthy();expect(screen.getByText('Fund NAV')).toBeTruthy();
    expect(registry.signIn).not.toHaveBeenCalled();expect(registry.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'Verify Fund Manager Wallet'})).toBeNull();
  });
  it('requires a single explicit manager verification action before requesting applications',()=>{
    render(<Applications/>);
    expect(registry.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Verify Fund Manager Wallet'}));
    expect(registry.signIn).toHaveBeenCalledOnce();expect(registry.request).not.toHaveBeenCalled();
  });
  it('does not mistake a restoring session for a need to sign again',()=>{
    registry.busy=true;render(<PrivateAccess><div>Confidential</div></PrivateAccess>);
    expect(screen.getByRole('status').textContent).toContain('Verifying');
    expect(screen.queryByRole('button',{name:'Verify Fund Manager Wallet'})).toBeNull();expect(screen.queryByText('Confidential')).toBeNull();
  });
  it.each(['investor','sme'] as const)('does not show private manager content for an ordinary %s',role=>{
    wallet.role=role;wallet.isV2Manager=false;registry.authenticated=true;
    render(<Applications/>);expect(screen.getByText('Fund manager access required.')).toBeTruthy();expect(registry.request).not.toHaveBeenCalled();
  });
  it('keeps a recognised public manager out of applications when the backend does not authorise the signed session',()=>{
    registry.authenticated=true;registry.isManager=false;render(<Applications/>);
    expect(screen.getByText(/signed session is not the contract's fund manager/)).toBeTruthy();expect(registry.request).not.toHaveBeenCalled();
  });
});

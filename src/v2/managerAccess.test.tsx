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
vi.mock('../chain/LedgerContext',()=>({useLedger:vi.fn()}));
vi.mock('../registration/RegistryContext',()=>({useRegistry:vi.fn()}));
vi.mock('./usePublicReport',()=>({usePublicReport:vi.fn()}));
let wallet:ReturnType<typeof useLedger>,registry:ReturnType<typeof useRegistry>,read:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  wallet={account:'0x'+'11'.repeat(20),role:'provisional',legacyRole:'provisional',networkOk:true,isV2Manager:true,v2Owner:'0x'+'11'.repeat(20),walletEpoch:0,snapshot:null,transactionPending:false} as ReturnType<typeof useLedger>;
  registry={configured:true,authenticated:false,busy:false,error:null,isManager:false,signIn:vi.fn(),request:vi.fn()} as unknown as ReturnType<typeof useRegistry>;
  read=vi.fn().mockResolvedValue(undefined);
  vi.mocked(useLedger).mockImplementation(()=>wallet);vi.mocked(useRegistry).mockImplementation(()=>registry);
  vi.mocked(usePublicReport).mockReturnValue({read,error:'',loading:false,report:{blockTag:123,wallet:wallet.account,concentrations:[],movements:[],movementsFromBlock:100,fund:{navCents:0n,freeLiquidityCents:0n,outstandingCents:0n,accruedInterestCents:0n,bookedAccruedCents:0n,impairmentCents:0n}} as unknown as Awaited<ReturnType<V2Ledger['readReport']>>});
});
afterEach(cleanup);
describe('manager public/private boundary',()=>{
  it('keeps legacy V1 financial reporting available separately from the new public V2 report',()=>{
    wallet.role='manager';wallet.legacyRole='manager';render(<Reports/>);
    expect(screen.getByText('RLU reports and scenarios')).toBeTruthy();
    expect(screen.getByRole('heading',{name:'RLU2 fund report'})).toBeTruthy();
    expect(registry.request).not.toHaveBeenCalled();expect(registry.signIn).not.toHaveBeenCalled();
  });
  it('loads manager Home public reports without any private sign-in or request',()=>{
    render(<Dashboard onNavigate={vi.fn()}/>);
    expect(screen.getByRole('heading',{name:'RLU2 fund overview'})).toBeTruthy();expect(screen.getByText('Fund NAV')).toBeTruthy();
    expect(read).toHaveBeenCalled();expect(registry.signIn).not.toHaveBeenCalled();expect(registry.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'Verify Fund Manager Wallet'})).toBeNull();
    expect(screen.queryByRole('button',{name:/Review purchases|Review invoices|Review applications/})).toBeNull();
  });
  it('preserves investor quick actions for a reporting owner who is an RLU investor',()=>{
    wallet.role='investor';wallet.legacyRole='investor';
    wallet.snapshot={role:'investor',manager:'0x'+'22'.repeat(20),approved:true,connectedBalance:100n};
    const navigate=vi.fn();render(<Dashboard onNavigate={navigate}/>);
    fireEvent.click(screen.getByRole('button',{name:'Buy RLU'}));expect(navigate).toHaveBeenCalledWith('purchases');
    expect(screen.getByRole('button',{name:'Manage my tokens'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:/Review purchases|Review invoices|Review applications/})).toBeNull();
    expect(read).toHaveBeenCalled();expect(registry.signIn).not.toHaveBeenCalled();
  });
  it('does not offer private RLU manager applications to a reporting-only owner',()=>{
    render(<Applications/>);
    expect(screen.getByText('Fund manager access required.')).toBeTruthy();
    expect(registry.request).not.toHaveBeenCalled();expect(registry.signIn).not.toHaveBeenCalled();
  });
  it('requires a single explicit manager verification action before requesting applications',()=>{
    wallet.role='manager';wallet.legacyRole='manager';
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
    wallet.role='manager';wallet.legacyRole='manager';registry.authenticated=true;registry.isManager=false;render(<Applications/>);
    expect(screen.getByText(/signed session is not the contract's fund manager/)).toBeTruthy();expect(registry.request).not.toHaveBeenCalled();
  });
});

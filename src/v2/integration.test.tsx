// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2App } from './V2App';
import { V2Ledger } from './V2Ledger';
import { investmentAllowance, V2_EXECUTION_LOCK } from './activation';
import type { ContractRunner } from 'ethers';
const a='0x'+'11'.repeat(20),b='0x'+'22'.repeat(20),contract='0x'+'aa'.repeat(20);
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('unified fund integration boundaries',()=>{
  it.each([[500000n,500000n,false],[500001n,500000n,true],[100n,1000000n,true]])('checks lifetime automatic capacity %s / %s',(amount,used,review)=>{
    expect(investmentAllowance(amount as bigint,used as bigint).reviewRequired).toBe(review);
  });
  it('blocks programmatic V2 execution even with a Sepolia signer',async()=>{
    const sendTransaction=vi.fn();
    const ledger=new V2Ledger(contract,{sendTransaction,provider:{getNetwork:async()=>({chainId:11155111n})}} as unknown as ContractRunner);
    await expect(ledger.execute('requestSubscription',[10000n,10000n,'0x'+'33'.repeat(32)])).rejects.toThrow(V2_EXECUTION_LOCK);
    expect(sendTransaction).not.toHaveBeenCalled();
  });
  it('makes cumulative investment review visible independently of funding confirmation',()=>{
    render(<V2App stakeholder="investor" connectedWallet={a}/>);
    fireEvent.change(screen.getByLabelText('Scenario lifetime automatic investment already used (S$)'),{target:{value:'1'}});
    expect(screen.getByText(/Manager review required for this investment/)).toBeTruthy();
    expect((screen.getByRole('button',{name:'Request Additional Investment'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button',{name:'Approve invoice'})).toBeNull();
    fireEvent.change(screen.getByLabelText('RLU2 units to redeem'),{target:{value:'1.25'}});
    expect(screen.getByText(/live V2 NAV and active-unit read is required/)).toBeTruthy();
  });
  it('applies actual scenario outstanding commitments and automatic facility capacity',()=>{
    render(<V2App stakeholder="sme" connectedWallet={a}/>);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Automatic facility already used, including commitments (S$)'),{target:{value:'50000'}});
    expect(screen.getByText('S$50,000 automatic facility exceeded')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('SME approved gross commitments (S$)'),{target:{value:'100000'}});
    expect(screen.getByText('SME S$100,000 cap exceeded')).toBeTruthy();
    expect((screen.getByRole('button',{name:'Submit / Accept V2 Financing Terms'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each(['wallet','epoch','network'])('invalidates a pending public report after %s changes',async(change)=>{
    let finish!:(value:Awaited<ReturnType<V2Ledger['readReport']>>)=>void;
    vi.spyOn(V2Ledger.prototype,'readReport').mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    const view=render(<V2App stakeholder="investor" connectedWallet={a}/>);
    expect((screen.getByLabelText('Independent V2 contract address') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Read V2 fund'}));
    if(change==='wallet'){
      view.rerender(<V2App stakeholder="investor" connectedWallet={b}/>);
      view.rerender(<V2App stakeholder="investor" connectedWallet={a}/>);
    }else if(change==='epoch')view.rerender(<V2App stakeholder="investor" connectedWallet={a} walletEpoch={1}/>);
    else view.rerender(<V2App stakeholder="investor" connectedWallet={a} networkOk={false}/>);
    await act(async()=>finish({wallet:a,blockTag:987654,fund:{}} as Awaited<ReturnType<V2Ledger['readReport']>>));
    expect(screen.queryByText(/Sepolia block 987654/)).toBeNull();
  });
});

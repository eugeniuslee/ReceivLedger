// @vitest-environment jsdom
import { act,cleanup,render,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { AbiCoder,type Provider } from 'ethers';
import {readV2Owner,useV2ManagerAuthority} from './managerAuthority';
import {V2_DEPLOYMENT} from '../v2/config';
const a='0x'+'11'.repeat(20),b='0x'+'22'.repeat(20);
const encode=(owner:string)=>AbiCoder.defaultAbiCoder().encode(['address'],[owner]);
function fixture(){const call=vi.fn().mockResolvedValue(encode(a));return {call,provider:{getNetwork:vi.fn().mockResolvedValue({chainId:11155111n}),call} as unknown as Provider};}
let current:ReturnType<typeof useV2ManagerAuthority>;
function Probe({provider,account=a,epoch=0,network=true}:{provider:Provider;account?:string;epoch?:number;network?:boolean}){current=useV2ManagerAuthority(provider,account,network,epoch);return null;}
afterEach(cleanup);
describe('live V2 public manager recognition',()=>{
  it('reads owner() from the deployed V2 contract, not from a hardcoded manager or Supabase',async()=>{
    const {provider,call}=fixture();
    expect((await readV2Owner(provider)).toLowerCase()).toBe(a);
    const transaction=await call.mock.calls[0][0];
    expect(transaction.to.toLowerCase()).toBe(V2_DEPLOYMENT.address);
    expect(transaction.data).toBe('0x8da5cb5b');
  });
  it('rejects the wrong chain before reading permissions',async()=>{
    const {provider,call}=fixture();vi.mocked(provider.getNetwork).mockResolvedValue({chainId:1n} as Awaited<ReturnType<Provider['getNetwork']>>);
    await expect(readV2Owner(provider)).rejects.toThrow('Sepolia');expect(call).not.toHaveBeenCalled();
  });
  it('identifies only the current owner without wallet signatures',async()=>{
    const {provider}=fixture();const view=render(<Probe provider={provider}/>);
    await waitFor(()=>expect(current.isManager).toBe(true));
    view.rerender(<Probe provider={provider} account={b}/>);
    expect(current.isManager).toBe(false);expect(current.owner).toBeNull();
    await waitFor(()=>expect(current.owner?.toLowerCase()).toBe(a));
    expect(current.isManager).toBe(false);
  });
  it('discards an owner response after an A/B/A epoch change',async()=>{
    const {provider,call}=fixture();let finish!:(value:string)=>void;
    call.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    const view=render(<Probe provider={provider}/>);
    await waitFor(()=>expect(call).toHaveBeenCalledTimes(1));
    view.rerender(<Probe provider={provider} account={b} epoch={1}/>);
    view.rerender(<Probe provider={provider} epoch={2}/>);
    call.mockResolvedValue(encode(b));
    await act(async()=>finish(encode(a)));
    await waitFor(()=>expect(current.owner?.toLowerCase()).toBe(b));
    expect(current.isManager).toBe(false);
  });
  it('clears recognition on network change and fails closed on RPC errors',async()=>{
    const {provider,call}=fixture();const view=render(<Probe provider={provider}/>);
    await waitFor(()=>expect(current.isManager).toBe(true));
    view.rerender(<Probe provider={provider} network={false}/>);
    expect(current.isManager).toBe(false);expect(current.owner).toBeNull();
    call.mockRejectedValue(new Error('RPC unavailable'));
    view.rerender(<Probe provider={provider} epoch={1}/>);
    await waitFor(()=>expect(current.error).toContain('could not be verified'));
    expect(current.isManager).toBe(false);
  });
});

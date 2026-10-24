// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveV2Address, V2_DEPLOYMENT } from './config';
import { V2App } from './V2App';
import { V2_EXECUTION_ENABLED } from './activation';
import { RECEIVLEDGER_ADDRESS } from '../chain/abi';
import { V2Ledger } from './V2Ledger';
afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('verified deployed V2 frontend configuration',()=>{
  it.each([undefined,'','  '])('uses the verified public default for %s',value=>{
    expect(resolveV2Address(value).toLowerCase()).toBe('0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882');
    expect(V2_DEPLOYMENT.chainId).toBe(11155111);
  });
  it('accepts a matching checksummed build override with surrounding whitespace',()=>{
    expect(resolveV2Address(' 0x9672B0Aec292C9F8DD8FefBC9daAb876b8eC9882 ')).toBe(resolveV2Address());
  });
  it.each([RECEIVLEDGER_ADDRESS,'0x'+'00'.repeat(20),'0x'+'aa'.repeat(20),'not-an-address'])('rejects stale or incorrect address %s',value=>{
    expect(()=>resolveV2Address(value)).toThrow('must match the verified');
  });
  it.each(['investor','sme'] as const)('prepares %s public reads of the correct contract without activating writes',stakeholder=>{
    vi.stubEnv('VITE_V2_CONTRACT_ADDRESS','');
    render(<V2App stakeholder={stakeholder} connectedWallet={V2_DEPLOYMENT.manager}/>);
    const field=screen.getByLabelText('Independent V2 contract address') as HTMLInputElement;
    expect(field.value.toLowerCase()).toBe(V2_DEPLOYMENT.address);expect(field.readOnly).toBe(true);
    expect((screen.getByRole('button',{name:'Read V2 fund'}) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('V2 is deployed on Sepolia. Financial execution remains disabled.')).toBeTruthy();
    expect(V2_EXECUTION_ENABLED).toBe(false);
    const names=stakeholder==='sme'?['Submit / Accept V2 Financing Terms','Repay V2 financing']:stakeholder==='investor'?['Request Additional Investment','Submit redemption request']:['Finance invoice','Process investment','Settle redemption'];
    for(const name of names)expect((screen.getByRole('button',{name}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('automatically reads the verified manager contract without exposing address overrides or activating writes',()=>{
    vi.stubEnv('VITE_V2_CONTRACT_ADDRESS','');
    const read=vi.spyOn(V2Ledger.prototype,'readReport').mockReturnValue(new Promise(()=>{}));
    render(<V2App stakeholder="manager" connectedWallet={V2_DEPLOYMENT.manager}/>);
    expect(read).toHaveBeenCalledWith(V2_DEPLOYMENT.manager);
    expect(screen.getByRole('heading',{name:'V2 fund overview'})).toBeTruthy();
    expect(screen.getByText('Execution disabled')).toBeTruthy();
    expect(screen.queryByLabelText('Independent V2 contract address')).toBeNull();
    expect(V2_EXECUTION_ENABLED).toBe(false);
  });
  it('fails closed on an incorrect Preview override while leaving scenarios usable',()=>{
    vi.stubEnv('VITE_V2_CONTRACT_ADDRESS',RECEIVLEDGER_ADDRESS);
    render(<V2App stakeholder="sme" connectedWallet={V2_DEPLOYMENT.manager}/>);
    expect(screen.getByRole('alert').textContent).toContain('must match the verified');
    expect((screen.getByRole('button',{name:'Read V2 fund'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('SME financing quotation')).toBeTruthy();
    expect(V2_EXECUTION_ENABLED).toBe(false);
  });
});

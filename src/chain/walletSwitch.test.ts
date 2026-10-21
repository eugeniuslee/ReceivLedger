import { describe, expect, it } from 'vitest';
import { didWalletAddressChange, isCurrentWalletRequest } from './requestGuard';

const manager = '0x79b246212650b686a0e9E5726092B1558B35D974';
const investor = '0xCBFF3E3e718B1ef1199828E3aE226F5AF6D4d1AA';
const sme = '0x213E83c00C28E56eA475b2049ebA2Ef61e3299bd';

describe('automatic MetaMask wallet transitions', () => {
  it.each([
    ['Fund Manager → Investor', manager, investor],
    ['Investor → SME', investor, sme],
    ['SME → Fund Manager', sme, manager],
  ])('invalidates the previous wallet view during %s', (_label, previous, next) => {
    const oldRequestVersion = 10;
    const nextRequestVersion = oldRequestVersion + 1;
    expect(didWalletAddressChange(previous, next)).toBe(true);
    expect(isCurrentWalletRequest(oldRequestVersion, nextRequestVersion, previous, next)).toBe(false);
    expect(isCurrentWalletRequest(nextRequestVersion, nextRequestVersion, next, next)).toBe(true);
  });

  it('rejects both old responses after rapid manager → investor → SME switching', () => {
    const managerRequest = { version: 1, account: manager };
    const investorRequest = { version: 2, account: investor };
    const current = { version: 3, account: sme };
    expect(isCurrentWalletRequest(managerRequest.version, current.version, managerRequest.account, current.account)).toBe(false);
    expect(isCurrentWalletRequest(investorRequest.version, current.version, investorRequest.account, current.account)).toBe(false);
    expect(isCurrentWalletRequest(current.version, current.version, current.account, current.account)).toBe(true);
  });

  it('keeps the identity for same-wallet reconnect but invalidates an older refresh sequence', () => {
    expect(didWalletAddressChange(investor, investor.toLowerCase())).toBe(false);
    expect(isCurrentWalletRequest(7, 8, investor, investor)).toBe(false);
    expect(isCurrentWalletRequest(8, 8, investor, investor)).toBe(true);
  });

  it('accepts an authorized wallet discovered during page reload', () => {
    expect(didWalletAddressChange(null, manager)).toBe(true);
    expect(isCurrentWalletRequest(1, 1, manager, manager)).toBe(true);
  });

  it('ignores an RPC response that resolves after a newer wallet request', async () => {
    let resolveSlow!: (value: { account: string; role: string }) => void;
    const slowRead = new Promise<{ account: string; role: string }>(resolve => { resolveSlow = resolve; });
    const slowRequest = { version: 4, account: manager };
    const active = { version: 5, account: investor };
    let displayedAccount = active.account;
    const staleCompletion = slowRead.then(response => {
      if (isCurrentWalletRequest(slowRequest.version, active.version, response.account, active.account)) displayedAccount = response.account;
    });

    resolveSlow({ account: manager, role: 'manager' });
    await staleCompletion;
    expect(displayedAccount).toBe(investor);
  });
});
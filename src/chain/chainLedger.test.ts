import { describe, expect, it } from 'vitest';
import { canAccessPage, ROLE_PAGES } from './access';
import { groupEventsByTransaction } from './activity';
import { decodeEventCache, encodeEventCache, eventCacheKey, mergeChainEvents } from './eventCache';
import { isCurrentWalletRequest } from './requestGuard';
import { classifyProvisionalWallet, classifyWalletEvidence, discoverInvestorAddresses, filterInvestorEvents, filterInvoiceEvents, filterInvoicesForSme, hasInvestorHistory, investorApprovalLabel, invoiceActionForStatus, invoiceIdsSubmittedBy, mapInvoiceRecord, mergeInvestorAccounts, ownershipDisplay, ownershipPercentage, type ChainEvent } from './chainLedger';
import { walletRoleChanged } from './chainLedger';

describe('mapInvoiceRecord', () => {
  const row = (status: bigint) => ({
    id: 1n,
    sme: '0x213E83c00C28E56eA475b2049ebA2Ef61e3299bd',
    payerName: 'Demo Payer',
    amount: 12345678901234567890n,
    maturityDate: 1790000000n,
    status,
    rejectionReason: '',
  });

  it.each([
    ['Submitted', 0], ['Approved', 1], ['Financed', 2], ['Rejected', 3], ['Repaid', 4],
  ] as const)('maps enum status %s without converting uint values to Number', (status, index) => {
      const mapped = mapInvoiceRecord(row(BigInt(index)));
      expect(mapped.status).toBe(status);
      expect(mapped.amount).toBe(12345678901234567890n);
      expect(mapped.maturity).toBe(1790000000n);
      expect(mapped.sme).toBe(row(0n).sme);
      expect(mapped.payer).toBe('Demo Payer');
    },
  );

  it('does not mislabel an unknown enum value as Submitted', () => {
    expect(mapInvoiceRecord(row(255n)).status).toBe('Unknown');
  });
});

describe('manager invoice action visibility', () => {
  it.each([
    ['Submitted', 'approve'],
    ['Approved', 'finance'],
    ['Financed', 'repay'],
    ['Rejected', null],
    ['Repaid', null],
  ] as const)('%s maps to %s', (status, action) => {
    expect(invoiceActionForStatus(status)).toBe(action);
  });
});

describe('revoked investor and provisional wallet classification', () => {
  const manager = '0x79b246212650b686a0e9E5726092B1558B35D974';
  const investor = '0xCBFF3E3e718B1ef1199828E3aE226F5AF6D4d1AA';

  it('classifies revoked investors with remaining RLU as inactive investors', () => {
    expect(classifyWalletEvidence(investor, manager, false, 250n, [])).toBe('inactiveInvestor');
  });

  it('classifies zero-balance wallets with historical approval or revocation as inactive investors', () => {
    const approved: ChainEvent = { name: 'InvestorApproved', detail: investor, participants: [investor], transactionHash: '0x1', logIndex: 0, blockNumber: 1 };
    const revoked: ChainEvent = { ...approved, name: 'InvestorRevoked', transactionHash: '0x2', blockNumber: 2 };
    expect(classifyWalletEvidence(investor, manager, false, 0n, [approved])).toBe('inactiveInvestor');
    expect(classifyWalletEvidence(investor, manager, false, 0n, [approved, revoked])).toBe('inactiveInvestor');
  });

  it('uses a historical non-mint token transfer as reliable investor evidence, but current approval wins', () => {
    const transfer: ChainEvent = { name: 'Transfer', detail: 'transfer', participants: [investor, manager], transactionHash: '0x3', logIndex: 0, blockNumber: 3 };
    expect(hasInvestorHistory([transfer], investor)).toBe(true);
    expect(classifyWalletEvidence(investor, manager, false, 0n, [transfer])).toBe('inactiveInvestor');
    expect(classifyWalletEvidence(investor, manager, false, 0n, [])).toBe('provisional');
    expect(classifyWalletEvidence(investor, manager, true, 0n, [transfer])).toBe('investor');
  });

  it('keeps unknown wallets provisional when historical indexing is incomplete', () => {
    expect(classifyWalletEvidence('0x2222222222222222222222222222222222222222', manager, false, 0n, [])).toBe('provisional');
    expect(classifyProvisionalWallet(false)).toBe('provisional');
    expect(classifyProvisionalWallet(true)).toBe('sme');
  });
});

describe('investor ownership calculations and discovery', () => {
  const investorA = '0xCBFF3E3e718B1ef1199828E3aE226F5AF6D4d1AA';
  const investorB = '0x1111111111111111111111111111111111111111';

  it('calculates ownership from total RLU supply, not simulated fund accounting', () => {
    expect(ownershipPercentage(250n, 1000n)).toBe('25.00%');
    expect(ownershipPercentage(1n, 10000n)).toBe('0.01%');
    expect(ownershipPercentage(0n, 0n)).toBeNull();
  });

  it('hides percentages while event indexing is incomplete', () => {
    expect(ownershipDisplay(250n, 1000n, false)).toBeNull();
    expect(ownershipDisplay(250n, 1000n, true)).toBe('25.00%');
    expect(ownershipDisplay(0n, 0n, true)).toBe('—');
  });

  it('discovers wallets from approval/revocation/issuance/Transfer events and explicit lookup', () => {
    const discovered = discoverInvestorAddresses([
      { name: 'InvestorApproved', detail: investorA, participants: [investorA], transactionHash: '0xa', logIndex: 0, blockNumber: 1 },
      { name: 'Transfer', detail: 'mint', participants: ['0x0000000000000000000000000000000000000000', investorB], transactionHash: '0xb', logIndex: 0, blockNumber: 2 },
      { name: 'InvoiceSubmitted', detail: 'not an investor event', participants: ['0x2222222222222222222222222222222222222222'], transactionHash: '0xc', logIndex: 0, blockNumber: 3 },
    ], ['0x3333333333333333333333333333333333333333']);
    expect(discovered.map(address => address.toLowerCase())).toEqual([investorA.toLowerCase(), investorB.toLowerCase(), '0x3333333333333333333333333333333333333333'].sort());
  });

  it('shows revoked approval separately and retains existing RLU balance on refresh', () => {
    expect(investorApprovalLabel(true)).toBe('Approved');
    expect(investorApprovalLabel(false)).toBe('Not approved');
    const before = [{ address: investorA, approved: true, balance: 1000n }];
    const refreshed = mergeInvestorAccounts(before, [{ address: investorA.toLowerCase(), approved: false, balance: 1000n }]);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toEqual({ address: investorA.toLowerCase(), approved: false, balance: 1000n });
  });
});

describe('SME invoices from contract mappings', () => {
  it('retains invoices submitted before the event cache window', () => {
    const sme = '0x213E83c00C28E56eA475b2049ebA2Ef61e3299bd';
    const invoices = [
      mapInvoiceRecord({ id: 1n, sme, payerName: 'Old Payer', amount: 50n, maturityDate: 1800000000n, status: 2n, rejectionReason: '' }),
      mapInvoiceRecord({ id: 2n, sme: '0x1111111111111111111111111111111111111111', payerName: 'Other Payer', amount: 70n, maturityDate: 1800000000n, status: 0n, rejectionReason: '' }),
    ];
    expect(filterInvoicesForSme(invoices, sme).map(invoice => invoice.id)).toEqual([1n]);
    expect(filterInvoiceEvents([], [1n])).toEqual([]);
  });
});

describe('role-scoped event filtering', () => {
  const event = (overrides: Partial<ChainEvent>): ChainEvent => ({
    name: 'InvoiceApproved',
    detail: '',
    participants: [],
    transactionHash: '0xhash',
    logIndex: 0,
    blockNumber: 1,
    ...overrides,
  });

  it('shows investors only events involving their connected address', () => {
    const investor = '0xCbFF3E3e718B1ef1199828E3aE226F5AF6D4d1AA';
    const events = [
      event({ name: 'Transfer', participants: ['0xaaa', investor] }),
      event({ name: 'FundUnitsIssued', participants: ['0xcBff3e3e718b1ef1199828e3ae226f5af6d4d1aa'] }),
      event({ name: 'InvoiceApproved', invoiceId: 4n }),
    ];
    expect(filterInvestorEvents(events, investor).map(item => item.name)).toEqual(['Transfer', 'FundUnitsIssued']);
  });

  it('shows SMEs the later lifecycle events for only invoice IDs they submitted', () => {
    const sme = '0x213E83c00C28E56eA475b2049ebA2Ef61e3299bd';
    const events = [
      event({ name: 'InvoiceSubmitted', invoiceId: 1n, participants: [sme] }),
      event({ name: 'InvoiceSubmitted', invoiceId: 2n, participants: ['0xother'] }),
      event({ name: 'InvoiceApproved', invoiceId: 1n }),
      event({ name: 'InvoiceRepaid', invoiceId: 2n }),
      event({ name: 'InvestorApproved', participants: [sme] }),
    ];
    const ids = invoiceIdsSubmittedBy(events, sme);
    expect(ids).toEqual([1n]);
    expect(filterInvoiceEvents(events, ids).map(item => item.name)).toEqual(['InvoiceSubmitted', 'InvoiceApproved']);
  });
});

describe('role page access', () => {
  it('gives the manager the six requested management pages', () => {
    expect(ROLE_PAGES.manager.map(page => page.id)).toEqual(['dashboard', 'reports', 'applications', 'investors', 'invoices', 'history']);
  });

  it('keeps investor routes personal and hides invoice/global administration', () => {
    expect(canAccessPage('investor', 'dashboard')).toBe(true);
    expect(canAccessPage('investor', 'transfer')).toBe(true);
    expect(canAccessPage('investor', 'history')).toBe(true);
    expect(canAccessPage('investor', 'invoices')).toBe(false);
    expect(canAccessPage('investor', 'investors')).toBe(false);
  });

  it('limits verified SME routes to their own invoice workflow and history', () => {
    expect(canAccessPage('sme', 'dashboard')).toBe(true);
    expect(canAccessPage('sme', 'invoices')).toBe(true);
    expect(canAccessPage('sme', 'history')).toBe(true);
    expect(canAccessPage('sme', 'transfer')).toBe(false);
    expect(canAccessPage('sme', 'investors')).toBe(false);
    expect(canAccessPage('provisional', 'dashboard')).toBe(true);
    expect(canAccessPage('provisional', 'invoices')).toBe(false);
    expect(canAccessPage('provisional', 'submitInvoice')).toBe(true);
    expect(canAccessPage('provisional', 'history')).toBe(false);
    expect(canAccessPage(null, 'dashboard')).toBe(false);
  });

  it('gives inactive investors personal history but no transfer or invoice route', () => {
    expect(ROLE_PAGES.inactiveInvestor.map(page => page.id)).toEqual(['dashboard', 'assets', 'history']);
    expect(canAccessPage('inactiveInvestor', 'history')).toBe(true);
    expect(canAccessPage('inactiveInvestor', 'transfer')).toBe(false);
    expect(canAccessPage('inactiveInvestor', 'invoices')).toBe(false);
    expect(canAccessPage('inactiveInvestor', 'investors')).toBe(false);
  });

  it('does not redirect a mapping-verified SME when the fast approval-only poll says provisional', () => {
    expect(walletRoleChanged('sme', 'provisional')).toBe(false);
    expect(walletRoleChanged('provisional', 'inactiveInvestor')).toBe(true);
    expect(ROLE_PAGES.provisional.map(page => page.id)).toEqual(['dashboard']);
  });
});

describe('transaction activity grouping', () => {
  const investor = '0xCBFF3E3e718B1ef1199828E3aE226F5AF6D4d1AA';
  const event = (name: string, overrides: Partial<ChainEvent> = {}): ChainEvent => ({
    name,
    detail: '',
    participants: [],
    transactionHash: '0xtransaction',
    logIndex: 0,
    blockNumber: 100,
    ...overrides,
  });

  it('combines FundUnitsIssued and its ERC-20 mint into one investor activity', () => {
    const activities = groupEventsByTransaction([
      event('FundUnitsIssued', { amount: 1000n, participants: [investor], logIndex: 1 }),
      event('Transfer', {
        amount: 1000n,
        participants: ['0x0000000000000000000000000000000000000000', investor],
        detail: `0x0000000000000000000000000000000000000000 transferred 1000 RLU to ${investor}`,
        logIndex: 2,
      }),
    ], 'investor', investor);
    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe('Received 1,000 RLU — Fund units issued');
    expect(activities[0].events).toHaveLength(2);
  });

  it('labels a non-mint wallet-to-wallet Transfer as a send/receive', () => {
    const activities = groupEventsByTransaction([
      event('Transfer', {
        amount: 250n,
        participants: [investor, '0x1111111111111111111111111111111111111111'],
        detail: `${investor} transferred 250 RLU to 0x1111111111111111111111111111111111111111`,
      }),
    ], 'investor', investor);
    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe('Sent 250 RLU');
  });

  it('presents investor approval as one activity', () => {
    const activities = groupEventsByTransaction([
      event('InvestorApproved', { detail: investor, participants: [investor] }),
    ], 'manager');
    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe('Investor approved');
  });
});

describe('incremental event cache', () => {
  const cachedEvent = (overrides: Partial<ChainEvent> = {}): ChainEvent => ({
    name: 'FundUnitsIssued',
    detail: 'Investor received RLU',
    amount: 1000n,
    participants: ['0xinvestor'],
    transactionHash: '0xhash',
    logIndex: 1,
    blockNumber: 50,
    ...overrides,
  });

  it('round-trips bigint event values through storage JSON', () => {
    const encoded = encodeEventCache({ scannedThrough: 100, events: [cachedEvent({ invoiceId: 12345678901234567890n })] });
    const decoded = decodeEventCache(encoded);
    expect(decoded?.scannedThrough).toBe(100);
    expect(decoded?.events[0].amount).toBe(1000n);
    expect(decoded?.events[0].invoiceId).toBe(12345678901234567890n);
    expect(eventCacheKey('0xABC', 11155111)).toContain('11155111:0xabc');
  });

  it('replaces reorg overlap logs and deduplicates logs returned by both ranges', () => {
    const oldOverlap = cachedEvent({ transactionHash: '0xold', blockNumber: 90 });
    const beforeOverlap = cachedEvent({ transactionHash: '0xolder', blockNumber: 89 });
    const replacement = cachedEvent({ transactionHash: '0xnew', blockNumber: 90 });
    const refreshedDuplicate = cachedEvent({ transactionHash: '0xolder', blockNumber: 89 });
    const merged = mergeChainEvents([beforeOverlap, oldOverlap], [replacement, refreshedDuplicate], 90);
    expect(merged).toHaveLength(2);
    expect(merged.map(event => event.transactionHash)).toEqual(['0xnew', '0xolder']);
  });

  it('ignores invalid cache payloads', () => {
    expect(decodeEventCache('{broken')).toBeNull();
  });
});

describe('wallet request staleness guard', () => {
  it('accepts the current account and request generation', () => {
    expect(isCurrentWalletRequest(4, 4, '0xABC', '0xabc')).toBe(true);
  });

  it('rejects responses after account changes, disconnects or a newer request', () => {
    expect(isCurrentWalletRequest(4, 5, '0xABC', '0xABC')).toBe(false);
    expect(isCurrentWalletRequest(4, 4, '0xABC', '0xDEF')).toBe(false);
    expect(isCurrentWalletRequest(4, 4, '0xABC', null)).toBe(false);
  });
});

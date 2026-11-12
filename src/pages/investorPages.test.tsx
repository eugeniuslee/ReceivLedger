// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';
import type { FundRequest } from '../../supabase/functions/_shared/domain';
import { FundPerformance, Invest, Portfolio } from './Investor';
import { Funds } from './Funds';

const DAY = 86_400n;
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
const me = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20), sme = '0x' + '5e'.repeat(20), zero = '0x' + '00'.repeat(20);
let ledger: Record<string, unknown>;
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => ledger }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
// Fund: S$1,000 capital, S$800 available, one S$200 invoice financed 10 days ago → NAV S$1,000.45 (fee 0.20 + interest 0.25).
const invoices = [{ id: 1n, sme, payer: 'Secret Payer', amount: 200n, maturity: now + 20n * DAY, status: 'Financed', rejectionReason: '' }] as ChainInvoice[];
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: { blockNumber: 1, blockTimestamp: now, totalSupply: 1000n, connectedBalance: 300n, totalFundSize: 1000n, availableFunds: 800n, maxPayerExposure: 100n, maxMaturityDays: 90n, invoices }, loading: false, error: null, now, refresh: vi.fn() }) }));

const ev = (name: string, participants: string[], amount: bigint, block: number) => ({ name, detail: '', participants, amount, timestamp: Number(now) - block, blockNumber: block, logIndex: 0, transactionHash: `0x${block}` }) as unknown as ChainEvent;
const lifecycle = [{ name: 'InvoiceFinanced', detail: '', invoiceId: 1n, participants: [], timestamp: Number(now - 10n * DAY), blockNumber: 1, logIndex: 0, transactionHash: '0xf' }] as unknown as ChainEvent[];
// Issued 400 (with its minting Transfer), received 50, sent 150 → 300 RLU.
const myEvents = [ev('FundUnitsIssued', [me], 400n, 10), ev('Transfer', [zero, me], 400n, 10), ev('Transfer', [other, me], 50n, 11), ev('Transfer', [me, other], 150n, 12)];
let requests: FundRequest[];
let request: ReturnType<typeof vi.fn>;
const fundRequest = (patch: Partial<FundRequest>): FundRequest => ({ id: 'r1', user_id: 'u', wallet: me, kind: 'subscription', amount: '500', status: 'pending', manager_note: null, tx_hash: null, version: 1, decided_at: null, created_at: '2026-11-11T00:00:00Z', updated_at: '2026-11-11T00:00:00Z', ...patch });

beforeEach(() => {
  ledger = { account: me, role: 'investor', networkOk: true, snapshot: { role: 'investor', connectedBalance: 300n, approved: true }, events: myEvents, lifecycleEvents: lifecycle,
    transactionPending: false, ledger: null, runTransaction: vi.fn() };
  vi.mocked(useLedger).mockImplementation(() => ledger as unknown as ReturnType<typeof useLedger>);
  requests = [fundRequest({})];
  request = vi.fn(async (input: Record<string, unknown>) => input.action === 'fund_requests' ? requests : {});
  vi.mocked(useRegistry).mockReturnValue({ configured: true, authenticated: true, busy: false, error: null, application: null, registeredName: 'Ivy Investor', request,
    displayName: () => null, signIn: vi.fn() } as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);

describe('investor Portfolio', () => {
  it('shows units, value at NAV and gain, from the investor’s own activity', () => {
    render(<Portfolio />);
    const holding = within(screen.getByRole('heading', { name: 'Your holding' }).parentElement!);
    expect(holding.getByText('400 RLU')).toBeTruthy(); // issued, minting Transfer not double-counted
    expect(holding.getByText('50 RLU')).toBeTruthy();
    expect(holding.getByText('150 RLU')).toBeTruthy();
    const value = within(screen.getByRole('heading', { name: 'Value' }).parentElement!);
    expect(value.getByText('S$300.14')).toBeTruthy(); // 300 × S$1,000.45 / 1,000
    expect(value.getByText('+S$0.14')).toBeTruthy();
    expect(within(screen.getByLabelText('Your holding')).getByText('30.00%')).toBeTruthy();
  });
});

describe('Fund Performance', () => {
  it('shows public fund figures without exposing SME or payer identities', () => {
    render(<FundPerformance />);
    expect(within(screen.getByLabelText('Fund performance')).getByText('S$1,000.45')).toBeTruthy();
    expect(screen.getByText('+0.00%')).toBeTruthy(); // NAV per RLU still rounds to S$1.00
    expect(screen.queryByText('Secret Payer')).toBeNull();
    expect(document.body.textContent).not.toContain(sme.slice(0, 7));
  });
});

describe('Invest', () => {
  it('requests a subscription and a redemption, and blocks redeeming more than the holding', async () => {
    render(<Invest />);
    const subscribe = within(screen.getByRole('heading', { name: 'Subscribe' }).parentElement!);
    fireEvent.change(subscribe.getByLabelText('Amount (S$)'), { target: { value: '250' } });
    expect(subscribe.getByText('250 RLU')).toBeTruthy();
    fireEvent.click(subscribe.getByRole('button', { name: 'Request subscription' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'request_fund', kind: 'subscription', amount: '250' }));
    const redeem = within(screen.getByRole('heading', { name: 'Redeem' }).parentElement!);
    fireEvent.change(redeem.getByLabelText('RLU to redeem'), { target: { value: '301' } });
    expect((redeem.getByRole('button', { name: 'Request redemption' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(redeem.getByRole('button', { name: 'Use full balance (300 RLU)' }));
    fireEvent.click(redeem.getByRole('button', { name: 'Request redemption' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'request_fund', kind: 'redemption', amount: '300' }));
  });

  it('lists the investor’s requests and lets them cancel a pending one', async () => {
    render(<Invest />);
    const mine = within(screen.getByRole('heading', { name: 'Your requests' }).closest('section')!);
    fireEvent.click(await mine.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'cancel_fund_request', id: 'r1' }));
  });

  it('is not available to wallets that are not approved investors', () => {
    ledger.role = 'inactiveInvestor';
    render(<Invest />);
    expect(screen.getByText(/Only approved investors/)).toBeTruthy();
  });
});

describe('manager Funds requests', () => {
  beforeEach(() => {
    const issueFundUnits = vi.fn();
    ledger = { ...ledger, account: other, role: 'manager', events: [], snapshot: { role: 'manager' },
      ledger: { getMaxFundSize: vi.fn().mockResolvedValue(10_000n), issueFundUnits },
      runTransaction: vi.fn(async (_role: string, operation: (l: unknown) => unknown) => { await operation({ issueFundUnits }); return { hash: '0x' + 'ab'.repeat(32) }; }) };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('issues RLU for a subscription request and records the transaction', async () => {
    render(<Funds />);
    const panel = within(screen.getByRole('heading', { name: 'Subscription and redemption requests' }).closest('section')!);
    fireEvent.click(await panel.findByRole('button', { name: 'Issue RLU' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'decide_fund_request', id: 'r1', version: 1, decision: 'completed', tx_hash: '0x' + 'ab'.repeat(32) })));
    expect((ledger.ledger as { issueFundUnits: ReturnType<typeof vi.fn> }).issueFundUnits).toHaveBeenCalledWith(me, 500n);
  });

  it('requires a reason to reject, and settles redemptions off-chain', async () => {
    requests = [fundRequest({ id: 'r2', kind: 'redemption', amount: '100' })];
    render(<Funds />);
    const panel = within(screen.getByRole('heading', { name: 'Subscription and redemption requests' }).closest('section')!);
    expect(await panel.findByText('S$100.05')).toBeTruthy(); // 100 RLU at NAV
    fireEvent.click(panel.getByRole('button', { name: 'Reject' }));
    expect((panel.getByRole('button', { name: 'Confirm reject' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(panel.getByLabelText('Reason for rejecting'), { target: { value: 'Lock-up period' } });
    fireEvent.click(panel.getByRole('button', { name: 'Confirm reject' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'decide_fund_request', id: 'r2', decision: 'rejected', note: 'Lock-up period' })));
    expect(ledger.runTransaction).not.toHaveBeenCalled();
  });
});

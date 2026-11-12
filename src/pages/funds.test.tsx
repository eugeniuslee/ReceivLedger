// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Funds } from './Funds';
import { useLedger } from '../chain/LedgerContext';
import type { ChainEvent } from '../chain/chainLedger';

const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => null }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: () => ({ displayName: (wallet: string) => wallet.toLowerCase() === alice.toLowerCase() ? 'Alice Capital' : null }) }));
vi.mock('../v2/usePublicReport', () => ({ usePublicReport: () => ({ report: null, loading: false, error: '', read: vi.fn() }) }));
const refresh = vi.fn();
// Fund: S$3,200 capital and 3,200 RLU; S$2,950 available + one S$250 financed invoice (+S$0.25 fee) → NAV S$3,200.25, S$1.00 per RLU.
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: { blockNumber: 10, totalSupply: 3200n, totalFundSize: 3200n, availableFunds: 2950n,
  invoices: [{ id: 6n, sme: '0x' + '22'.repeat(20), payer: 'xyz', amount: 250n, maturity: now + 86_400n * 30n, status: 'Financed', rejectionReason: '' }] }, loading: false, error: null, now, refresh }) }));

const alice = '0x259EC0e06A2Ec1Bf41a197bDEb5361e6e00B70B1';
const stranger = '0x' + '33'.repeat(20);
let ledger: Record<string, ReturnType<typeof vi.fn>>;
let runTransaction: ReturnType<typeof vi.fn>;
const issued = (amount: bigint, block: number) => ({ name: 'FundUnitsIssued', detail: '', amount, participants: [alice], timestamp: Number(now), blockNumber: block, logIndex: 0, transactionHash: `0x${block}` }) as unknown as ChainEvent;

beforeEach(() => {
  ledger = {
    getMaxFundSize: vi.fn().mockResolvedValue(10_000n), totalFundSize: vi.fn().mockResolvedValue(3200n),
    isApproved: vi.fn(async (wallet: string) => wallet === alice), balanceOf: vi.fn().mockResolvedValue(1100n),
    issueFundUnits: vi.fn(),
  };
  runTransaction = vi.fn(async (_role: string, operation: (l: typeof ledger) => unknown) => operation(ledger));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(useLedger).mockReturnValue({ account: '0x' + '79'.repeat(20), role: 'manager', networkOk: true, walletEpoch: 0, ledger, runTransaction, transactionPending: false,
    events: [issued(1000n, 5), issued(1100n, 7)] } as unknown as ReturnType<typeof useLedger>);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Funds tab', () => {
  it('summarises RLU in issue, NAV per RLU, fund NAV and capital, with no fund cap or manual forms', () => {
    render(<Funds />);
    const summary = within(screen.getByLabelText('Fund unit summary'));
    expect(summary.getByText('3,200 RLU')).toBeTruthy();
    expect(summary.getByText('S$1.0001')).toBeTruthy(); // S$3,200.25 / 3,200 RLU to 4 decimals
    expect(summary.getByText('S$3,200.25')).toBeTruthy();
    expect(summary.getByText('S$3,200')).toBeTruthy();
    expect(screen.queryByText(/fund cap|Remaining capacity/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Process a subscription' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Redemption check' })).toBeNull();
  });

  it('lists recent RLU issuance newest first', () => {
    render(<Funds />);
    const rows = within(screen.getByRole('heading', { name: 'Recent RLU issuance' }).closest('section')!).getAllByRole('row');
    expect(rows[1].textContent).toContain('1,100 RLU');
    expect(rows[2].textContent).toContain('1,000 RLU');
  });
});

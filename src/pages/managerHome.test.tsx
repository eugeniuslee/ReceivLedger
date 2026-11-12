// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { useLedger } from '../chain/LedgerContext';
import type { ChainInvoice } from '../chain/chainLedger';

const DAY = 86_400n;
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: () => registry }));
vi.mock('../v2/usePublicReport', () => ({ usePublicReport: () => ({ report: fundReport, loading: false, error: '', read: vi.fn() }) }));
// Applications and RLU request counts come from the shared provider that also drives the tab badges.
vi.mock('../chain/ReviewCounts', async importOriginal => ({ ...(await importOriginal<typeof import('../chain/ReviewCounts')>()), useReviewCounts: () => ({ applications: 2, subscriptions: 2, redemptions: 1 }) }));
const registry = { authenticated: true, displayName: () => null, request: vi.fn(async () => [{ status: 'pending' }, { status: 'pending' }, { status: 'approved' }]) };
// Two RLU subscriptions awaiting action (pending funding, ready) and one redemption pending review.
const fundReport = { fund: { navCents: 0n, pricingUnits: 0n, freeLiquidityCents: 0n, financingCommitmentsCents: 0n, reservedRedemptionCents: 0n, liquidCents: 0n, outstandingCents: 0n, accruedInterestCents: 0n, valuationValidUntil: 0n, SME_CAP_CENTS: 10_000_000n, paused: false }, timestamp: 0n, invoices: [], concentrations: [],
  subscriptions: [{ status: 0n }, { status: 2n }, { status: 3n }], redemptions: [{ status: 0n, units: 0n }, { status: 3n, units: 0n }] };
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: null, loading: false, error: null, now, refresh: vi.fn() }) }));

const invoice = (id: number, status: ChainInvoice['status'], dueInDays: number) => ({ id: BigInt(id), sme: '0x' + '22'.repeat(20), payer: `Payer ${id}`, amount: 100n, maturity: now + BigInt(dueInDays) * DAY, status, rejectionReason: '' }) as ChainInvoice;
const invoices = [invoice(1, 'Repaid', 5), invoice(2, 'Financed', -2), invoice(3, 'Financed', 3), invoice(4, 'Approved', 30), invoice(5, 'Submitted', 40), invoice(6, 'Submitted', 50)];

beforeEach(() => {
  vi.mocked(useLedger).mockReturnValue({ networkOk: true, isV2Manager: true, loading: false, events: [],
    snapshot: { role: 'manager', manager: '0x' + '79'.repeat(20), totalFundSize: 3200n, availableFunds: 2950n, invoiceCount: 6n, connectedBalance: 0n, invoices } } as unknown as ReturnType<typeof useLedger>);
});
afterEach(cleanup);

describe('manager Home', () => {
  it('replaces the overview with what the manager needs to review', async () => {
    const onNavigate = vi.fn();
    render(<Dashboard onNavigate={onNavigate} />);
    expect(screen.queryByText('Fund manager overview')).toBeNull();
    const review = within(screen.getByRole('heading', { name: 'Needs your review' }).parentElement!);
    const count = (label: string) => review.getByText(label).closest('div')!.querySelector('strong')!.textContent;
    expect(count('Invoices awaiting approval')).toBe('2');
    expect(count('Approved invoices to finance')).toBe('1');
    expect(count('Overdue invoices')).toBe('1');
    expect(count('Repayments due within 7 days')).toBe('1');
    await waitFor(() => expect(count('Investor & SME applications')).toBe('2'));
    expect(count('RLU subscription requests')).toBe('2');
    expect(count('RLU redemption requests')).toBe('1');
    fireEvent.click(review.getByRole('button', { name: 'Review invoices awaiting approval' }));
    expect(onNavigate).toHaveBeenCalledWith('invoices');
    fireEvent.click(review.getByRole('button', { name: 'Review investor & sme applications' }));
    expect(onNavigate).toHaveBeenCalledWith('applications');
  });

  it('shows the latest 3 invoices and expands to all', () => {
    render(<Dashboard />);
    const table = () => within(screen.getByRole('heading', { name: 'Latest invoices' }).closest('section')!);
    expect(table().getAllByRole('row')).toHaveLength(4); // header + 3
    expect(table().getByText('#6')).toBeTruthy();
    expect(table().queryByText('#3')).toBeNull();
    fireEvent.click(table().getByRole('button', { name: 'Show all 6 invoices' }));
    expect(table().getAllByRole('row')).toHaveLength(7);
    fireEvent.click(table().getByRole('button', { name: 'Show latest 3 invoices' }));
    expect(table().getAllByRole('row')).toHaveLength(4);
  });
});

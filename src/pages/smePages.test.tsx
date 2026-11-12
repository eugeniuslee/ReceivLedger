// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';
import { CostCalculator, Repayments, SmeHome } from './Sme';
import { Invoices } from './Invoices';

const DAY = 86_400n;
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
const me = '0x' + 'aa'.repeat(20), other = '0x' + 'bb'.repeat(20);
let ledger: Record<string, unknown>;
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => ledger }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
vi.mock('../registration/access', () => ({ useRegistrationAccess: () => ({ invoiceAllowed: true, transferAllowed: false, reason: '', authorize: vi.fn() }) }));

const invoice = (id: number, sme: string, amount: number, status: ChainInvoice['status'], dueInDays: number, payer = `Payer ${id}`) => ({ id: BigInt(id), sme, payer, amount: BigInt(amount), maturity: now + BigInt(dueInDays) * DAY, status, rejectionReason: '' }) as ChainInvoice;
// Mine: S$1,000 financed 10 days ago (due in 3 days), S$500 submitted. Another SME: S$2,000 financed.
const mine = [invoice(1, me, 1000, 'Financed', 3), invoice(2, me, 500, 'Submitted', 40)];
const all = [...mine, invoice(3, other, 2000, 'Financed', 30)];
const lifecycle = [{ name: 'InvoiceFinanced', detail: '', invoiceId: 1n, participants: [], timestamp: Number(now - 10n * DAY), blockNumber: 1, logIndex: 0, transactionHash: '0x1' }] as unknown as ChainEvent[];
// Fund: S$10,000 capital, S$7,000 available.
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: { blockNumber: 1, blockTimestamp: now, totalSupply: 10_000n, connectedBalance: 0n, totalFundSize: 10_000n, availableFunds: 7_000n, maxPayerExposure: 1_000n, maxMaturityDays: 90n, invoices: all }, loading: false, error: null, now, refresh: vi.fn() }) }));
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ledger = { account: me, role: 'sme', networkOk: true, snapshot: { role: 'sme', invoices: mine }, events: [], lifecycleEvents: lifecycle, transactionPending: false, loading: false, ledger: null, runTransaction: vi.fn() };
  vi.mocked(useLedger).mockImplementation(() => ledger as unknown as ReturnType<typeof useLedger>);
  request = vi.fn(async (input: unknown) => input instanceof FormData ? {} : (input as { action: string }).action === 'documents' ? [] : {});
  vi.mocked(useRegistry).mockReturnValue({ configured: true, authenticated: true, busy: false, error: null, application: null, registeredName: 'Alpha SME', request, displayName: () => null, signIn: vi.fn(), nameInUse: () => false } as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);

describe('SME Home', () => {
  it('shows the cash advance limit, amount owed and what needs attention', () => {
    render(<SmeHome onNavigate={vi.fn()} />);
    const metrics = within(screen.getByLabelText('Your financing'));
    // Limit: min(S$100,000 - S$1,000 exposure, S$7,000 cash) = S$7,000 → 90% cash = S$6,300.
    expect(within(metrics.getByText('Cash advance limit').parentElement!).getByText('S$6,300.00')).toBeTruthy();
    // Owed: S$900 advance + S$1.00 fee + 900×5%×10/365 = S$1.23 interest.
    expect(within(metrics.getByText('Amount owed today').parentElement!).getByText('S$902.23')).toBeTruthy();
    const attention = within(screen.getByRole('heading', { name: 'Needs your attention' }).parentElement!);
    expect(within(attention.getByText('Repayments due within 7 days').closest('.review-card') as HTMLElement).getByText('1')).toBeTruthy();
    expect(within(attention.getByText('Invoices awaiting approval').closest('.review-card') as HTMLElement).getByText('1')).toBeTruthy();
  });
});

describe('Repayments', () => {
  it('lists what is owed and uploads a payment proof PDF for the invoice', async () => {
    render(<Repayments />);
    const owed = within(screen.getByRole('heading', { name: 'Funds owed' }).closest('section')!);
    expect(owed.getByText('S$902.23')).toBeTruthy();
    fireEvent.click(await owed.findByRole('button', { name: 'Upload proof' }));
    fireEvent.change(owed.getByLabelText('Payment proof (PDF)'), { target: { files: [new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(owed.getByRole('checkbox'));
    fireEvent.click(owed.getByRole('button', { name: 'Send proof' }));
    await waitFor(() => expect(request.mock.calls.some(([body]) => body instanceof FormData)).toBe(true));
    const body = request.mock.calls.find(([value]) => value instanceof FormData)![0] as FormData;
    expect(body.get('purpose')).toBe('repayment');
    expect(body.get('invoice_id')).toBe('1');
  });
});

describe('Cost calculator', () => {
  it('prices different inputs, shows costs by repayment day and checks the rules', () => {
    render(<CostCalculator />);
    fireEvent.change(screen.getByLabelText('Invoice amount (S$)'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Invoice due date'), { target: { value: '2027-01-11' } }); // 60 days
    expect(screen.getAllByText('S$181.68')).toHaveLength(2); // the S$200 / 60-day example: breakdown and the 60-day row
    const byDay = within(screen.getByRole('heading', { name: 'Cost by repayment day' }).closest('section')!);
    expect(byDay.getByText('30 day(s)')).toBeTruthy();
    expect(byDay.getByText('S$180.94')).toBeTruthy(); // repaid after 30 days
    const rules = within(screen.getByLabelText('Financing eligibility'));
    expect(rules.getByText('Eligible with fund manager review')).toBeTruthy(); // 60 days > 30-day automatic limit
  });
});

describe('Request Funds', () => {
  it('shows the financing rules while the SME fills in the form', () => {
    render(<Invoices mode="submit" />);
    fireEvent.change(screen.getByLabelText('Payer name'), { target: { value: 'Big Buyer' } });
    fireEvent.change(screen.getByLabelText('Invoice amount (SGD)'), { target: { value: '8000' } });
    const rules = within(screen.getByLabelText('Financing eligibility'));
    // S$8,000 exceeds the S$7,000 available cash.
    expect(rules.getByText('Not eligible as entered')).toBeTruthy();
    expect(within(rules.getByText('Funding availability').closest('tr')!).getByText('Not met')).toBeTruthy();
  });
});

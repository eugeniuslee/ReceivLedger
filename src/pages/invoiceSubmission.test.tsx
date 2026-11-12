// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface } from 'ethers';
import { Invoices } from './Invoices';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { RECEIVLEDGER_ABI, RECEIVLEDGER_ADDRESS } from '../chain/abi';
import { resetBrowserStorage } from '../test/browserStorage';
import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';

// 12 Nov 2026, 09:00 SGT
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
const DAY = 86_400n;
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: vi.fn() }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: null, loading: false, error: null, now, refresh: vi.fn() }) }));

const sme = '0x2222222222222222222222222222222222222222';
const dateIn = (days: number) => new Date(Date.UTC(2026, 10, 12 + days)).toISOString().slice(0, 10);
let wallet: ReturnType<typeof useLedger>;
let registry: ReturnType<typeof useRegistry>;

function submittedReceipt(id: bigint) {
  const iface = new Interface(RECEIVLEDGER_ABI);
  const log = iface.encodeEventLog(iface.getEvent('InvoiceSubmitted')!, [id, sme, 'Payer Co', 200n]);
  return { status: 1, logs: [{ address: RECEIVLEDGER_ADDRESS, topics: log.topics, data: log.data }] };
}
function fill({ amount = '200', due = dateIn(60), expected = dateIn(60), pdf = true }: { amount?: string; due?: string; expected?: string; pdf?: boolean } = {}) {
  fireEvent.change(screen.getByLabelText('Payer name'), { target: { value: 'Payer Co' } });
  fireEvent.change(screen.getByLabelText('Invoice amount (SGD)'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Invoice due date'), { target: { value: due } });
  fireEvent.change(screen.getByLabelText('Expected payment received date'), { target: { value: expected } });
  if (pdf) fireEvent.change(screen.getByLabelText('Invoice PDF'), { target: { files: [new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('checkbox', { name: /fictional demonstration/ }));
}
const breakdown = () => within(screen.getByRole('region', { name: 'Live financing breakdown' }));

beforeEach(() => {
  resetBrowserStorage();
  wallet = { account: sme, role: 'sme', networkOk: true, snapshot: { role: 'sme', invoices: [] }, loading: false, events: [], eventsLoading: false,
    transactionPending: false, ledger: null, runTransaction: vi.fn().mockResolvedValue(submittedReceipt(7n)) } as unknown as ReturnType<typeof useLedger>;
  registry = { configured: true, authenticated: true, busy: false, error: null, application: null, registeredName: null, isManager: false,
    signIn: vi.fn(), signOut: vi.fn(), reload: vi.fn(), request: vi.fn().mockResolvedValue({}), displayName: () => null };
  vi.mocked(useLedger).mockImplementation(() => wallet); vi.mocked(useRegistry).mockImplementation(() => registry);
});
afterEach(cleanup);

describe('SME invoice submission', () => {
  it('shows the live breakdown for the S$200 / 60-day example', () => {
    render(<Invoices mode="submit" />);
    fill({ pdf: false });
    const b = breakdown();
    expect(b.getAllByText('60 day(s)')).toHaveLength(2); // maximum period and estimated duration
    for (const value of ['S$180.00', 'S$20.00', 'S$0.20', 'S$1.48', 'S$181.68', 'S$18.32']) expect(b.getByText(value)).toBeTruthy();
  });

  it('updates immediately when the expected payment date changes', () => {
    render(<Invoices mode="submit" />);
    fill({ expected: dateIn(30), pdf: false });
    expect(breakdown().getByText('S$0.74')).toBeTruthy();
    expect(breakdown().getByText('S$180.94')).toBeTruthy();
  });

  it('warns and caps the estimate when payment is expected after the due date', () => {
    render(<Invoices mode="submit" />);
    fill({ expected: dateIn(75), pdf: false });
    expect(breakdown().getByText(/after the invoice due date/)).toBeTruthy();
    expect(breakdown().getByText('S$181.68')).toBeTruthy();
  });

  it('requires the invoice PDF before any transaction', async () => {
    render(<Invoices mode="submit" />);
    fill({ pdf: false });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit invoice' }).closest('form')!);
    expect(await screen.findByText('Attach the invoice PDF.')).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects a past expected payment date', async () => {
    render(<Invoices mode="submit" />);
    fill({ expected: dateIn(-1) });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit invoice' }).closest('form')!);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/earlier than today/);
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });

  it('submits on-chain, then stores the PDF privately under the new invoice ID', async () => {
    render(<Invoices mode="submit" />);
    fill();
    fireEvent.submit(screen.getByRole('button', { name: 'Submit invoice' }).closest('form')!);
    expect(await screen.findByText('Invoice #7 submitted on Sepolia and its PDF was stored privately.')).toBeTruthy();
    expect(wallet.runTransaction).toHaveBeenCalledTimes(1);
    const body = vi.mocked(registry.request).mock.calls.at(-1)![0] as FormData;
    expect(body.get('purpose')).toBe('invoice');
    expect(body.get('invoice_id')).toBe('7');
    expect((body.get('file') as File).name).toBe('invoice.pdf');
  });

  it('requires a private wallet session so the PDF can be stored', async () => {
    registry.authenticated = false;
    render(<Invoices mode="submit" />);
    fill();
    fireEvent.submit(screen.getByRole('button', { name: 'Submit invoice' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Sign in with this wallet first/));
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
});

describe('financed invoice charges', () => {
  const invoice = (status: ChainInvoice['status']) => ({ id: 6n, sme, payer: 'xyz', amount: 200n, maturity: now + 60n * DAY, status, rejectionReason: '' }) as ChainInvoice;
  const event = (name: string, at: bigint) => ({ name, detail: '', invoiceId: 6n, participants: [], timestamp: Number(at), blockNumber: 1, logIndex: 0, transactionHash: '0x1' }) as unknown as ChainEvent;

  it('uses actual days outstanding once repayment is confirmed (early repayment)', () => {
    wallet.role = 'manager';
    wallet.snapshot = { role: 'manager', invoices: [invoice('Repaid')], availableFunds: 1000n } as unknown as typeof wallet.snapshot;
    wallet.events = [event('InvoiceFinanced', now - 40n * DAY), event('InvoiceRepaid', now - 10n * DAY)];
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#6' }));
    const panel = within(screen.getByText('Financing charges · repaid').closest('details')!);
    expect(panel.getByText('30 day(s)')).toBeTruthy();
    expect(panel.getByText('S$0.74')).toBeTruthy();
    expect(panel.getByText('S$180.94')).toBeTruthy();
  });
});

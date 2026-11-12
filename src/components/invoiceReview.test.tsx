// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';
import type { FundRequest, PrivateDocument } from '../../supabase/functions/_shared/domain';
import { Invoices } from '../pages/Invoices';
import { buildManagerNotices, buildNotices } from '../registration/notifications';
import type { InvoiceReview } from '../registration/invoiceReviews';
import { setCreditsForTest } from '../finance/credits';

const DAY = 86_400n;
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
const sme = '0x24cc621bba6c6d4bc16b54b37568e87ca6e9127c';
let ledger: Record<string, unknown>;
let invoices: ChainInvoice[];
let documents: PrivateDocument[];
let reviews: InvoiceReview[];
let applications: unknown[];
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => ledger }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
vi.mock('../registration/access', () => ({ useRegistrationAccess: () => ({ invoiceAllowed: true, transferAllowed: false, reason: '', authorize: vi.fn() }) }));
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: { blockNumber: 1, blockTimestamp: now, totalSupply: 3_200n, connectedBalance: 0n, totalFundSize: 3_200n, availableFunds: 2_750n, maxPayerExposure: 320n, maxMaturityDays: 90n, invoices }, loading: false, error: null, now, refresh: vi.fn() }) }));
const invoice = (id: number, amount: number, status: ChainInvoice['status'], dueInDays: bigint) => ({ id: BigInt(id), sme, payer: '123', amount: BigInt(amount), maturity: now + dueInDays * DAY, status, rejectionReason: '' }) as ChainInvoice;
const proof = (patch: Partial<PrivateDocument> = {}) => ({ id: 'p1', owner_id: 'u', application_id: null, invoice_id: '6', fund_request_id: null, purpose: 'repayment', filename: 'paid.pdf', storage_path: 'x', byte_size: 1, sha256: 'a', status: 'pending', version: 1, review_note: null, created_at: '2026-11-12T00:00:00Z', ...patch }) as PrivateDocument;
let request: ReturnType<typeof vi.fn>;
let runTransaction: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setCreditsForTest(new Map());
  documents = []; reviews = []; applications = [];
  runTransaction = vi.fn().mockResolvedValue({ status: 1, logs: [] });
  ledger = { account: '0x' + '79'.repeat(20), role: 'manager', networkOk: true, events: [], lifecycleEvents: [], transactionPending: false, loading: false,
    ledger: { getPayerExposure: vi.fn().mockResolvedValue(200n), getMaxPayerExposure: vi.fn().mockResolvedValue(320n) }, runTransaction };
  vi.mocked(useLedger).mockImplementation(() => ledger as unknown as ReturnType<typeof useLedger>);
  request = vi.fn(async (input: Record<string, unknown>) => input.action === 'documents' ? documents : input.action === 'applications' ? applications : input.action === 'invoice_reviews' ? reviews : {});
  vi.mocked(useRegistry).mockReturnValue({ configured: true, authenticated: true, request, displayName: (wallet: string) => wallet === sme ? 'SME 2' : null } as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);
function setInvoices(rows: ChainInvoice[], events: ChainEvent[] = []) { invoices = rows; ledger.snapshot = { role: 'manager', invoices: rows, availableFunds: 2_750n }; ledger.events = events; ledger.lifecycleEvents = events; }

describe('manager invoice list', () => {
  it('shows invoice number, SME name, SME wallet, latest pay date and status', () => {
    setInvoices([invoice(7, 1_000, 'Submitted', 33n)]);
    render(<Invoices mode="list" />);
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Invoice', 'SME name', 'SME wallet', 'Latest pay date (SGT)', 'Status / timing', 'Action']);
    const row = screen.getByRole('button', { name: '#7' }).closest('tr')!;
    expect(within(row).getByText('SME 2')).toBeTruthy();
    expect(within(row).getByText('0x24cc6...9127c')).toBeTruthy();
  });

  it('flags invoices with a repayment proof to review', async () => {
    setInvoices([invoice(6, 150, 'Financed', 49n)]);
    documents = [proof()];
    render(<Invoices mode="list" />);
    expect(await screen.findByText('Payment proof to review')).toBeTruthy();
  });
});

describe('invoice review', () => {
  it('leads with what to fund, when it is repaid and what the fund earns', async () => {
    setInvoices([invoice(7, 1_000, 'Submitted', 33n)]);
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#7' }));
    const glance = within(screen.getByLabelText('Invoice at a glance'));
    // 90% advance S$900; 33 days: interest 900 × 5% × 33/365 = S$4.07; fee S$1.00 → repaid S$905.07, earns S$5.07.
    expect(glance.getByText(/If funded today, the fund pays/).textContent).toContain('S$905.07');
    expect(glance.getAllByText('S$900.00').length).toBe(2); // in the sentence and as "Cash to advance"
    expect(glance.getAllByText('S$5.07').length).toBeGreaterThan(0);
    const checks = within(screen.getByLabelText('Checks'));
    expect(await checks.findByText(/contract will reject financing/)).toBeTruthy(); // S$1,200 vs S$320 payer limit (read from the chain)
    expect(checks.getAllByRole('listitem').map(item => item.textContent?.split(' · ')[0].replace(/^[✓⚠] /, ''))).toEqual(['Sufficient funds', 'Maturity less than 90 days', 'Max loan of S$100,000', 'SME concentration of 1% of NAV']);
    expect(screen.getByText('More details')).toBeTruthy();
  });

  it('accepts a repayment proof and records the repayment on-chain in one step', async () => {
    setInvoices([invoice(6, 150, 'Financed', 49n)], [{ name: 'InvoiceFinanced', detail: '', invoiceId: 6n, participants: [], timestamp: Number(now - 3n * DAY), blockNumber: 1, logIndex: 0, transactionHash: '0x6' } as unknown as ChainEvent]);
    documents = [proof()];
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#6' }));
    const panel = within(screen.getByLabelText('Repayment proof'));
    fireEvent.click(await panel.findByRole('button', { name: 'Accept & record repayment' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'review_document', id: 'p1', version: 1, decision: 'verified', note: 'Repayment received' }));
    await waitFor(() => expect(runTransaction).toHaveBeenCalledWith('manager', expect.any(Function)));
  });

  it('can ask the SME for a new proof', async () => {
    setInvoices([invoice(6, 150, 'Financed', 49n)]);
    documents = [proof()];
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#6' }));
    const panel = within(screen.getByLabelText('Repayment proof'));
    fireEvent.click(await panel.findByRole('button', { name: 'Ask for new proof' }));
    fireEvent.change(panel.getByLabelText('What is wrong with the proof'), { target: { value: 'Wrong amount' } });
    fireEvent.click(panel.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'review_document', id: 'p1', version: 1, decision: 'rejected', note: 'Wrong amount' }));
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('manager notices', () => {
  it('tells the manager about repayment and subscription payment proofs to check', () => {
    const requests = [{ id: 'r1', wallet: '0x' + 'ab'.repeat(20) } as FundRequest];
    const notices = buildManagerNotices([proof(), proof({ id: 'p2', purpose: 'subscription', invoice_id: null, fund_request_id: 'r1' }), proof({ id: 'p3', status: 'verified' })], requests, () => 'Ivy');
    expect(notices.map(notice => [notice.title, notice.page])).toEqual(expect.arrayContaining([['Repayment proof received for invoice #6', 'invoices'], ['Subscription payment proof from Ivy', 'funds']]));
    expect(notices).toHaveLength(2);
  });
});

const review = (patch: Partial<InvoiceReview> = {}) => ({ invoice_id: '7', sme_wallet: sme, status: 'needs_info', note: 'Send the purchase order', version: 1, decided_at: '2026-11-12T02:00:00Z', responded_at: null, ...patch }) as InvoiceReview;

describe('rejecting an invoice or asking for more information', () => {
  it('lets the manager ask the SME for more information, with a note', async () => {
    setInvoices([invoice(7, 1_000, 'Submitted', 33n)]);
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#7' }));
    const panel = within(await screen.findByLabelText('Invoice decision'));
    fireEvent.click(panel.getByRole('button', { name: 'Request more information' }));
    expect((panel.getByRole('button', { name: 'Send request' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(panel.getByLabelText('What should the SME send?'), { target: { value: 'Signed purchase order' } });
    fireEvent.click(panel.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'review_invoice', invoice_id: '7', decision: 'needs_info', note: 'Signed purchase order', version: null }));
  });

  it('lets the manager reject with a reason, hides Approve, and can undo', async () => {
    setInvoices([invoice(7, 1_000, 'Submitted', 33n)]);
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#7' }));
    const panel = within(await screen.findByLabelText('Invoice decision'));
    fireEvent.click(panel.getByRole('button', { name: 'Reject invoice' }));
    fireEvent.change(panel.getByLabelText(/Reason for rejecting/), { target: { value: 'Payer unknown' } });
    reviews = [review({ status: 'rejected', note: 'Payer unknown' })];
    fireEvent.click(panel.getByRole('button', { name: 'Reject invoice' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'review_invoice', invoice_id: '7', decision: 'rejected', note: 'Payer unknown', version: null }));
    expect(await panel.findByRole('button', { name: 'Undo rejection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve invoice' })).toBeNull();
    expect(screen.getAllByText('Rejected by fund manager').length).toBeGreaterThan(0);
  });

  it('shows the manager when the SME has answered, and does not count invoices waiting on the SME', async () => {
    reviews = [review({ status: 'info_provided', version: 2, responded_at: '2026-11-12T03:00:00Z' })];
    setInvoices([invoice(7, 1_000, 'Submitted', 33n)]);
    render(<Invoices mode="list" />);
    expect(await screen.findByText('SME sent more documents')).toBeTruthy();
    const notices = buildManagerNotices([], [], () => 'SME 2', reviews);
    expect(notices[0]).toMatchObject({ title: 'SME 2 sent more documents for invoice #7', page: 'invoices' });
  });

  it('tells the SME what the manager needs and lets it upload documents', async () => {
    reviews = [review()];
    ledger = { ...ledger, account: sme, role: 'sme' };
    setInvoices([invoice(7, 1_000, 'Submitted', 33n)]);
    ledger.snapshot = { role: 'sme', invoices };
    render(<Invoices mode="list" />);
    expect(await screen.findByText('Send the purchase order')).toBeTruthy(); // note in the table
    fireEvent.click(screen.getByRole('button', { name: '#7' }));
    const panel = within(await screen.findByLabelText('Fund manager decision'));
    expect(panel.getByText(/Send the purchase order/)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Upload documents' }));
    expect(panel.getAllByText(/PDF/).length).toBeGreaterThan(0);
    const [notice] = buildNotices({ application: null, documents: [], requests: [], invoiceReviews: reviews });
    expect(notice).toMatchObject({ tone: 'action', title: 'More information requested for invoice #7', page: 'invoices', actionLabel: 'Upload documents' });
  });
});

describe('invoice More details', () => {
  it('shows documents, SME profile, cash disbursement breakdown and guideline figures', async () => {
    documents = [proof({ id: 'd1', purpose: 'invoice', invoice_id: '7', filename: 'INV-7.pdf' })];
    applications = [{ id: 'a', wallet: sme, kind: 'sme', status: 'approved', display_name: 'SME 2', company_number: '202612345K', contact_email: 'ops@sme.test', contact_phone: '', details: { country: 'Singapore', business_address: '1 Demo Road', contact_name: 'Tan', website: '' } }];
    setInvoices([invoice(7, 1_000, 'Submitted', 33n)]);
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#7' }));
    const docs = within(await screen.findByLabelText('Documents'));
    expect(await docs.findByText(/INV-7\.pdf/)).toBeTruthy();
    expect(docs.getByRole('button', { name: 'View document' })).toBeTruthy();
    expect(await within(screen.getByLabelText('SME profile')).findByText('202612345K')).toBeTruthy();
    const cash = within(screen.getByLabelText('Cash disbursement breakdown'));
    expect(cash.getByText('S$900.00')).toBeTruthy(); // 90% paid now
    expect(cash.getByText('S$905.07')).toBeTruthy(); // fund gets back
    const rules = within(screen.getByLabelText('Risk management guidelines'));
    expect(rules.getByText('Funds available')).toBeTruthy();
    expect(rules.getAllByText('S$2,750.00').length).toBeGreaterThan(0);
  });
});

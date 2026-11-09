// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { Purchases, PurchaseRequestsPanel } from './Purchases';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { PurchaseRequest } from '../../supabase/functions/_shared/purchases';
import { PURCHASE_PRICING, PURCHASE_PRICING_BASIS } from '../../supabase/functions/_shared/purchasePricing';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
const investor = '0x1111111111111111111111111111111111111111';
const manager = '0x2222222222222222222222222222222222222222';
const row: PurchaseRequest = { id: '11111111-1111-4111-8111-111111111111', owner_id: 'owner', wallet: investor,
  units: '100', amount_cents: '10000', pricing_basis: PURCHASE_PRICING_BASIS, chain_id: 11155111, contract_address: '0x18c6751a1a116053e413459464c9b1af356dbf1f',
  status: 'draft', version: 1, note: '', review_note: null, created_at: '2026-11-09T00:00:00Z', submitted_at: null,
  reviewed_at: null, issuance_tx_hash: null, proof_filename: null, proof_sha256: null, proof_bytes: null };
let wallet: ReturnType<typeof useLedger>;
let registry: ReturnType<typeof useRegistry>;
let saved: PurchaseRequest[];
const request = vi.fn();
beforeEach(() => {
  saved = []; request.mockReset();
  wallet = { account: investor, role: 'investor', networkOk: true, walletEpoch: 0, runTransaction: vi.fn() } as unknown as typeof wallet;
  registry = { request, isManager: false, configured: true, authenticated: true, busy: false, signIn: vi.fn(), reload: vi.fn().mockResolvedValue(undefined), displayName: () => null } as unknown as typeof registry;
  vi.mocked(useLedger).mockImplementation(() => wallet); vi.mocked(useRegistry).mockImplementation(() => registry);
  request.mockImplementation(async (input: Record<string, unknown> | FormData) => {
    if (input instanceof FormData) {
      saved[0] = { ...saved[0], proof_filename: 'receipt.pdf', proof_sha256: 'abc', proof_bytes: 100, version: 2 };
      return saved[0];
    }
    if (input.action === 'purchase_list') return [...saved];
    if (input.action === 'purchase_pricing') return PURCHASE_PRICING;
    if (input.action === 'purchase_create') { saved = [{ ...row, id: String(input.id), units: String(input.units), amount_cents: (BigInt(String(input.units)) * 100n).toString() }]; return saved[0]; }
    if (input.action === 'purchase_submit') { saved[0] = { ...saved[0], status: 'pending', version: 3 }; return saved[0]; }
    if (input.action === 'purchase_review') { saved[0] = { ...saved[0], status: input.decision as 'approved' | 'rejected', review_note: String(input.note), version: 4 }; return saved[0]; }
    if (input.action === 'purchase_fulfill') { saved[0] = { ...saved[0], status: 'fulfilled', issuance_tx_hash: String(input.tx_hash), version: 5 }; return saved[0]; }
    throw new Error('Unexpected action');
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function openRequest() {
  await screen.findByRole('button', { name: `View request ${saved[0].id}` });
  fireEvent.click(screen.getByRole('button', { name: `View request ${saved[0].id}` }));
}
describe('Purchase manager access', () => {
  function publicManagerWithoutReviewAccess() {
    wallet = { ...wallet, role: 'manager', isV2Manager: true,
      snapshot: { role: 'provisional', manager, approved: false, connectedBalance: 0n } };
  }

  it('explains the wallet mismatch without loading an empty personal purchase list', () => {
    publicManagerWithoutReviewAccess();
    render(<Purchases />);
    expect(screen.getByRole('heading', { name: 'RLU purchase manager access required' })).toBeTruthy();
    expect(screen.getByText(manager)).toBeTruthy();
    expect(screen.getByText(investor)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Buy RLU' })).toBeNull();
    expect(screen.queryByText('No purchase requests yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve purchase request' })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['provisional', 'sme', null] as const)('explains RLU2 ownership without exposing the RLU review queue for role %s', role => {
    wallet = { ...wallet, role, isV2Manager: true,
      snapshot: { role: 'provisional', manager, approved: false, connectedBalance: 0n } };
    saved = [{ ...row, status: 'pending', proof_filename: 'private-payment.pdf' }];
    render(<Purchases />);
    expect(screen.getByText(/These purchase requests belong to the separate RLU fund/)).toBeTruthy();
    expect(screen.getByText(manager)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recheck manager access' })).toBeTruthy();
    expect(screen.queryByText('No purchase requests yet.')).toBeNull();
    expect(screen.queryByText('private-payment.pdf')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve purchase request' })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps Buy RLU available to an approved RLU investor who also owns RLU2', async () => {
    wallet = { ...wallet, isV2Manager: true };
    render(<Purchases />);
    await screen.findByText('No purchase requests yet.');
    expect(screen.getByRole('heading', { name: 'Buy RLU' })).toBeTruthy();
    expect(screen.queryByText('RLU purchase manager access required')).toBeNull();
    createInputs();
    await screen.findByText('Request saved. Attach your payment proof, then submit it for review.');
    expect(saved[0].units).toBe('100');
    expect(request.mock.calls.some(([input]) => input.action === 'purchase_review')).toBe(false);
  });

  it('explains a known different RLU manager before asking an RLU2 owner to sign in', () => {
    wallet = { ...wallet, role: 'provisional', isV2Manager: true,
      snapshot: { role: 'provisional', manager, approved: false, connectedBalance: 0n } };
    registry.authenticated = false;
    render(<Purchases />);
    expect(screen.getByRole('heading', { name: 'RLU purchase manager access required' })).toBeTruthy();
    expect(screen.getByText(manager)).toBeTruthy();
    expect(screen.getByText(/Your connected wallet does not match the RLU fund manager/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in|Verify Fund Manager Wallet|Recheck manager access/ })).toBeNull();
    expect(registry.signIn).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps existing own purchases visible to an inactive RLU investor who also owns RLU2', async () => {
    wallet = { ...wallet, role: 'inactiveInvestor', isV2Manager: true }; saved = [{ ...row }];
    render(<Purchases />); await openRequest();
    expect(screen.getByRole('heading', { name: 'Your requests' })).toBeTruthy();
    expect(screen.queryByText('RLU purchase manager access required')).toBeNull();
    expect(screen.queryByLabelText('Requested RLU')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve purchase request' })).toBeNull();
  });

  it('keeps the review queue closed and allows retry when rechecking access fails', async () => {
    publicManagerWithoutReviewAccess();
    vi.mocked(registry.reload).mockRejectedValueOnce(new Error('Manager access service could not be reached.'));
    render(<Purchases />);
    fireEvent.click(screen.getByRole('button', { name: 'Recheck manager access' }));
    await screen.findByText('Manager access service could not be reached.');
    expect((screen.getByRole('button', { name: 'Recheck manager access' }) as HTMLButtonElement).disabled).toBe(false);
    expect(registry.reload).toHaveBeenCalledOnce();
    expect(registry.signIn).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck manager access' }));
    await screen.findByText('Manager access rechecked.');
    expect(screen.queryByText('Manager access service could not be reached.')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('loads the review queue only after the backend confirms manager access', async () => {
    publicManagerWithoutReviewAccess(); saved = [{ ...row, status: 'pending', proof_filename: 'receipt.pdf' }];
    const view = render(<Purchases />);
    fireEvent.click(screen.getByRole('button', { name: 'Recheck manager access' }));
    await screen.findByText('Manager access rechecked.');
    expect(request).not.toHaveBeenCalled();
    registry.isManager = true;
    view.rerender(<Purchases />);
    await openRequest();
    expect(screen.getByRole('heading', { name: 'Review queue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve purchase request' })).toBeTruthy();
    expect(screen.queryByText('RLU purchase manager access required')).toBeNull();
    expect(registry.signIn).not.toHaveBeenCalled();
  });

  it('preserves backend-confirmed manager access when the public role is unavailable', async () => {
    wallet = { ...wallet, account: manager, role: null }; registry.isManager = true;
    saved = [{ ...row, status: 'pending', proof_filename: 'receipt.pdf' }];
    render(<Purchases />); await openRequest();
    expect(screen.getByRole('heading', { name: 'Review queue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve purchase request' })).toBeTruthy();
  });

  it('requires private sign-in before checking or displaying manager access', () => {
    publicManagerWithoutReviewAccess(); registry.authenticated = false;
    render(<Purchases />);
    expect(screen.getByRole('button', { name: 'Verify Fund Manager Wallet' })).toBeTruthy();
    expect(screen.queryByText('RLU purchase manager access required')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(registry.reload).not.toHaveBeenCalled();
  });
});
function createInputs(units = '100') {
  fireEvent.change(screen.getByLabelText('Requested RLU'), { target: { value: units } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment proof' }));
}
describe('Private purchase workflow', () => {
  it('calculates a read-only payment from the quantity and ignores a changed payment DOM value', async () => {
    render(<Purchases />); await screen.findByText('No purchase requests yet.');
    const payment = screen.getByLabelText('Required payment (S$)') as HTMLInputElement;
    expect(payment.readOnly).toBe(true); expect(payment.value).toBe('');
    fireEvent.change(screen.getByLabelText('Requested RLU'), { target: { value: '1' } });
    expect(payment.value).toBe('1.00');
    fireEvent.change(screen.getByLabelText('Requested RLU'), { target: { value: '100' } });
    expect(payment.value).toBe('100.00');
    fireEvent.change(payment, { target: { value: '1000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment proof' }));
    await screen.findByText('Request saved. Attach your payment proof, then submit it for review.');
    expect(saved[0].amount_cents).toBe('10000');
    expect(request.mock.calls.find(([input]) => input.action === 'purchase_create')?.[0]).not.toHaveProperty('amount_cents');
  });
  it('keeps existing requests visible and calculates a preview while the hosted pricing update is missing', async () => {
    saved = [{ ...row, pricing_basis: undefined, proof_filename: 'receipt.pdf', version: 2 }];
    const base = request.getMockImplementation()!;
    let updated = false;
    request.mockImplementation(async input => {
      if (input.action === 'purchase_pricing' && !updated) throw new Error('Unknown purchase action.');
      return base(input);
    });
    render(<Purchases />); await openRequest();
    await screen.findByText(/Purchase pricing needs a server update/);
    fireEvent.change(screen.getByLabelText('Requested RLU'), { target: { value: '100' } });
    expect((screen.getByLabelText('Required payment (S$)') as HTMLInputElement).value).toBe('100.00');
    expect((screen.getByLabelText('Requested RLU') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Continue to payment proof' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Submit purchase request' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Download payment proof' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Originally reported payment')).toBeTruthy();
    updated = true; fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Continue to payment proof' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/Purchase pricing needs a server update/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Submit purchase request' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each([
    { ...PURCHASE_PRICING, currency: 'USD' },
    { ...PURCHASE_PRICING, unit_price_cents: '1000' },
    { ...PURCHASE_PRICING, pricing_basis: 'unknown' },
  ])('blocks submission when the server returns an unsupported pricing rule', async pricing => {
    const base = request.getMockImplementation()!;
    request.mockImplementation(async input => input.action === 'purchase_pricing' ? pricing : base(input));
    render(<Purchases />); await screen.findByText(/Purchase pricing needs a server update/);
    expect((screen.getByRole('button', { name: 'Continue to payment proof' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No purchase requests yet.')).toBeTruthy();
  });
  it('explains an older backend and keeps creation disabled until a successful refresh', async () => {
    request.mockRejectedValueOnce(new Error('Unknown action.'));
    render(<Purchases />);
    await screen.findByText(/Purchase requests are not available on this server yet/);
    expect((screen.getByRole('button', { name: 'Continue to payment proof' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Unknown action.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
    await screen.findByText('No purchase requests yet.');
    expect((screen.getByRole('button', { name: 'Continue to payment proof' }) as HTMLButtonElement).disabled).toBe(false);
    createInputs();
    await screen.findByText('Request saved. Attach your payment proof, then submit it for review.');
  });
  it('disables creation while the initial request history is loading', async () => {
    let resolve!: (value: PurchaseRequest[]) => void;
    request.mockImplementationOnce(() => new Promise<PurchaseRequest[]>(done => { resolve = done; }));
    render(<Purchases />);
    expect((screen.getByRole('button', { name: 'Continue to payment proof' }) as HTMLButtonElement).disabled).toBe(true);
    resolve([]); await screen.findByText('No purchase requests yet.');
    expect((screen.getByRole('button', { name: 'Continue to payment proof' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('ignores an obsolete load error after a successful StrictMode reload', async () => {
    let reject!: (cause: Error) => void;
    request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<StrictMode><Purchases /></StrictMode>); await screen.findByText('No purchase requests yet.');
    reject(new Error('Obsolete error'));
    await waitFor(() => expect(screen.queryByText('Obsolete error')).toBeNull());
  });
  it('loads older requests without hiding the first page', async () => {
    const page = Array.from({ length: 50 }, (_, index) => ({ ...row, id: `request-${index}` }));
    request.mockImplementation(async input => input.action === 'purchase_pricing' ? PURCHASE_PRICING : input.offset === 50 ? [{ ...row, id: 'older-request' }] : page);
    render(<Purchases />); fireEvent.click(await screen.findByRole('button', { name: 'Load older requests' }));
    await screen.findByRole('button', { name: 'View request older-request' });
    expect(screen.getByRole('button', { name: 'View request request-0' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older requests' })).toBeNull();
  });
  it('sends quantity and fixed pricing basis without an editable payment, then requires proof and explicit submission', async () => {
    render(<Purchases />);
    await screen.findByText('No purchase requests yet.'); createInputs();
    await screen.findByText('Request saved. Attach your payment proof, then submit it for review.');
    expect(saved[0].amount_cents).toBe('10000');
    const creation = request.mock.calls.find(([input]) => input.action === 'purchase_create')?.[0];
    expect(creation).toMatchObject({ units: '100', pricing_basis: PURCHASE_PRICING_BASIS });
    expect(creation).not.toHaveProperty('amount_cents');
    expect(screen.queryByRole('button', { name: 'Submit purchase request' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Payment proof PDF'), { target: { files: [new File(['%PDF-1.7\nproof'], 'receipt.pdf', { type: 'application/pdf' })] } });
    // jsdom does not update the native file input value from a FileList change.
    fireEvent.submit(screen.getByLabelText('Payment proof PDF').closest('form')!);
    await screen.findByText('Payment proof attached privately. You can now submit the request.');
    const body = request.mock.calls.find(([input]) => input instanceof FormData)?.[0] as FormData;
    expect(body.get('request_id')).toBe(saved[0].id); expect(body.get('action')).toBe('purchase_upload');
    expect(saved[0].status).toBe('draft');
    fireEvent.click(screen.getByRole('button', { name: 'Submit purchase request' }));
    await screen.findByText('Purchase request submitted to the fund manager.');
    expect(saved[0].status).toBe('pending'); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it.each(['1.5', '0', '-1', '01', '10000000000000'])('rejects invalid or excessive units %s', async units => {
    render(<PurchaseRequestsPanel />); await screen.findByText('No purchase requests yet.'); createInputs(units);
    await screen.findByRole('alert'); expect(request.mock.calls.some(([input]) => input.action === 'purchase_create')).toBe(false);
  });
  it('reuses the request ID after an ambiguous create failure rather than making another purchase', async () => {
    const base = request.getMockImplementation()!; let attempts = 0;
    request.mockImplementation(async input => { if (input.action === 'purchase_create' && ++attempts === 1) throw new Error('Connection interrupted'); return base(input); });
    render(<PurchaseRequestsPanel />); await screen.findByText('No purchase requests yet.'); createInputs();
    await screen.findByText('Connection interrupted');
    expect((screen.getByLabelText('Requested RLU') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Required payment (S$)') as HTMLInputElement).value).toBe('100.00');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment proof' }));
    await screen.findByText('Request saved. Attach your payment proof, then submit it for review.');
    const calls = request.mock.calls.filter(([input]) => input.action === 'purchase_create'); expect(calls).toHaveLength(2); expect(calls[0][0].id).toBe(calls[1][0].id);
  });
  it('resumes a saved proof without uploading again after reload', async () => {
    saved = [{ ...row, pricing_basis: 'legacy_reported', proof_filename: 'receipt.pdf', version: 2 }];
    render(<Purchases />); await openRequest();
    expect(screen.queryByLabelText('Payment proof PDF')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Submit purchase request' }));
    await screen.findByText('Purchase request submitted to the fund manager.');
  });
  it('preserves a mismatched legacy draft and blocks uploading or submitting it', async () => {
    saved = [{ ...row, pricing_basis: 'legacy_reported', amount_cents: '100000' }];
    const view = render(<Purchases />); await openRequest();
    expect(screen.getByText('Originally reported payment')).toBeTruthy();
    expect(screen.getByText(/The original payment differs/)).toBeTruthy();
    expect(screen.getByText('S$100.00', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByLabelText('Payment proof PDF')).toBeNull();
    expect(saved[0].amount_cents).toBe('100000');
    view.unmount();
    saved = [{ ...saved[0], proof_filename: 'receipt.pdf', version: 2 }];
    render(<Purchases />); await openRequest();
    expect(screen.getByRole('heading', { name: '100 RLU · Amount needs review' })).toBeTruthy();
    expect(screen.queryByText('Ready to submit')).toBeNull();
    expect((screen.getByRole('button', { name: 'Submit purchase request' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Download payment proof' }) as HTMLButtonElement).disabled).toBe(false);
    expect(request.mock.calls.some(([input]) => input.action === 'purchase_submit')).toBe(false);
  });
  it.each(['draft', 'pending', 'approved'] as const)('allows manager rejection but no approval or issuance for a legacy %s payment mismatch', async status => {
    wallet = { ...wallet, account: manager, role: 'manager' }; registry.isManager = true;
    saved = [{ ...row, pricing_basis: 'legacy_reported', status, amount_cents: '100000', proof_filename: status === 'draft' ? null : 'receipt.pdf', version: 3 }];
    const openInvestors = vi.fn();
    render(<Purchases onInvestors={openInvestors} />); await openRequest();
    expect(screen.getByRole('heading', { name: '100 RLU · Amount needs review' })).toBeTruthy();
    expect(screen.getByText('S$100.00', { selector: 'strong' })).toBeTruthy();
    if (status === 'approved') {
      expect(screen.getByText('This request was already approved. Check for existing token issuance before closing it.')).toBeTruthy();
      expect(screen.getByText(/Check transaction history and preserve any existing issuance receipt/)).toBeTruthy();
      expect(screen.getByText(/Do not issue tokens again or create a replacement until the payment and any existing token issuance have been reconciled/)).toBeTruthy();
      expect(screen.queryByText(/Review the original payment and reject this request with a note/)).toBeNull();
    }
    const approve = screen.queryByRole('button', { name: 'Approve purchase request' }) as HTMLButtonElement | null;
    expect(approve === null || approve.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Open investor administration' })).toBeNull();
    expect(screen.queryByLabelText('Issuance transaction hash')).toBeNull();
    fireEvent.change(screen.getByLabelText('Review note'), { target: { value: 'Reconcile earlier payment before making a corrected request.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }));
    await screen.findByText('Request rejected. The investor can see your note.');
    expect(saved[0].status).toBe('rejected'); expect(saved[0].amount_cents).toBe('100000');
    expect(openInvestors).not.toHaveBeenCalled(); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it.each(['pending', 'approved'] as const)('blocks manager payment-sensitive actions for %s requests until pricing is ready', async status => {
    wallet = { ...wallet, account: manager, role: 'manager' }; registry.isManager = true;
    saved = [{ ...row, status, proof_filename: 'receipt.pdf', version: 3 }];
    const base = request.getMockImplementation()!;
    request.mockImplementation(async input => {
      if (input.action === 'purchase_pricing') throw new Error('Pricing schema missing');
      return base(input);
    });
    render(<Purchases onInvestors={vi.fn()} />); await openRequest();
    await screen.findByText(/Purchase pricing needs a server update/);
    if (status === 'pending') {
      expect((screen.getByRole('button', { name: 'Approve purchase request' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Reject request' }) as HTMLButtonElement).disabled).toBe(false);
    } else {
      expect((screen.getByRole('button', { name: 'Open investor administration' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Verify issuance receipt' }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
  it('requires a manager note and records rejection without a blockchain transaction', async () => {
    wallet = { ...wallet, account: manager, role: 'manager' }; registry.isManager = true;
    saved = [{ ...row, status: 'pending', proof_filename: 'receipt.pdf', version: 3 }];
    render(<Purchases />); await openRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' })); await screen.findByText('Enter a review note for the investor.');
    fireEvent.change(screen.getByLabelText('Review note'), { target: { value: 'Payment reference does not match.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' })); await screen.findByText('Request rejected. The investor can see your note.');
    expect(saved[0].review_note).toBe('Payment reference does not match.'); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('keeps an approved request open when receipt verification fails and permits the same receipt retry', async () => {
    wallet = { ...wallet, account: manager, role: 'manager' }; registry.isManager = true;
    saved = [{ ...row, status: 'approved', proof_filename: 'receipt.pdf', version: 4 }];
    const base = request.getMockImplementation()!; let attempts = 0;
    request.mockImplementation(async input => { if (input.action === 'purchase_fulfill' && ++attempts === 1) throw new Error('Wait for two confirmations.'); return base(input); });
    render(<Purchases />); await openRequest(); const hash = `0x${'a'.repeat(64)}`;
    fireEvent.change(screen.getByLabelText('Issuance transaction hash'), { target: { value: hash } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify issuance receipt' })); await screen.findByText('Wait for two confirmations.');
    expect(saved[0].status).toBe('approved');
    fireEvent.click(screen.getByRole('button', { name: 'Verify issuance receipt' })); await screen.findByText('Issuance receipt verified. This purchase request is complete.');
    expect(screen.getByRole('link', { name: /View token issuance/ }).getAttribute('href')).toContain(hash); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('hides purchase creation for revoked investors while preserving their request history', async () => {
    wallet.role = 'inactiveInvestor'; saved = [{ ...row, status: 'pending' }];
    render(<Purchases />); await openRequest(); expect(screen.queryByLabelText('Requested RLU')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve purchase request' })).toBeNull();
  });
  it('clears old wallet records and ignores a late response after switching wallets', async () => {
    let resolve!: (value: PurchaseRequest[]) => void;
    request.mockImplementationOnce(() => new Promise<PurchaseRequest[]>(done => { resolve = done; }));
    const view = render(<Purchases />);
    wallet = { ...wallet, account: '0x3333333333333333333333333333333333333333', walletEpoch: 1 };
    view.rerender(<Purchases />); await screen.findByText('No purchase requests yet.');
    resolve([{ ...row, note: 'Private investor note' }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: `View request ${row.id}` })).toBeNull());
    expect(screen.queryByText('Private investor note')).toBeNull();
  });
});

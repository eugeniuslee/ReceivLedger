// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNotices, NoticeBanner, useNotices } from './notifications';
import { applicationsNeedingReview, fundRequestsNeedingManager } from '../chain/ReviewCounts';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from './RegistryContext';
import { Applications } from '../pages/Applications';
import { RegistrationSummary } from '../pages/Registration';
import { resetBrowserStorage } from '../test/browserStorage';
import type { Application, FundRequest, PrivateDocument } from '../../supabase/functions/_shared/domain';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
vi.mock('./RegistryContext', () => ({ useRegistry: vi.fn() }));
const wallet = '0x' + 'ab'.repeat(20);
const app = (patch: Partial<Application> = {}) => ({ id: 'app-1', user_id: 'u', wallet, kind: 'sme', display_name: 'Alpha SME', company_number: 'UEN', contact_email: 'a@b.test', contact_phone: '1', status: 'pending', version: 1, review_note: null, approval_tx_hash: null, reviewed_at: null, created_at: '2026-11-10T00:00:00Z', submitted_at: '2026-11-10T00:00:00Z', ...patch }) as Application;
const doc = (patch: Partial<PrivateDocument> = {}) => ({ id: 'doc-1', owner_id: 'u', application_id: 'app-1', invoice_id: null, purpose: 'kyc', filename: 'KYC.pdf', storage_path: 'x', byte_size: 1, sha256: 'a', status: 'pending', version: 1, review_note: null, created_at: '2026-11-11T00:00:00Z', reviewed_at: null, ...patch }) as PrivateDocument;
let registry: Record<string, unknown>;
beforeEach(() => {
  resetBrowserStorage();
  vi.mocked(useLedger).mockReturnValue({ account: wallet, role: 'provisional', transactionPending: false, runTransaction: vi.fn() } as unknown as ReturnType<typeof useLedger>);
  registry = { authenticated: true, isManager: false, application: null, reload: vi.fn().mockResolvedValue(undefined), request: vi.fn(async () => []) };
  vi.mocked(useRegistry).mockImplementation(() => registry as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);

describe('notices for the user', () => {
  it('turns a request for more information into an action notice with the manager’s note', () => {
    const [notice] = buildNotices({ application: app({ status: 'needs_info', version: 2, reviewed_at: '2026-11-12T01:00:00Z', review_note: 'Upload a clearer KYC scan' }), documents: [], requests: [] });
    expect(notice).toMatchObject({ tone: 'action', title: 'More information requested', page: 'registration' });
    expect(notice.message).toContain('Upload a clearer KYC scan');
  });

  it('covers rejected documents, confirmed payments and decided fund requests', () => {
    const notices = buildNotices({ application: null, requests: [{ id: 'r', kind: 'subscription', amount: '500', status: 'rejected', manager_note: 'Over limit', version: 2, decided_at: '2026-11-12T00:00:00Z' } as FundRequest],
      documents: [doc({ id: 'd1', purpose: 'kyc', status: 'rejected', reviewed_at: '2026-11-12T00:00:00Z', review_note: 'Blurry' }), doc({ id: 'd2', purpose: 'repayment', invoice_id: '6', application_id: null, status: 'verified', reviewed_at: '2026-11-12T00:00:00Z' })] });
    expect(notices.map(item => item.title)).toEqual(expect.arrayContaining(['Document “KYC.pdf” rejected', 'Payment confirmed', 'Subscription of S$500 rejected']));
  });

  it('shows the banner until dismissed and counts it for Home', async () => {
    registry.application = app({ status: 'rejected', version: 2, reviewed_at: '2026-11-12T01:00:00Z', review_note: 'Wrong UEN' });
    const onNavigate = vi.fn();
    function Harness() { const { unread, dismiss } = useNotices(); return <><span data-testid="count">{unread.length}</span><NoticeBanner unread={unread} dismiss={dismiss} onNavigate={onNavigate} /></>; }
    render(<Harness />);
    const banner = within(await screen.findByLabelText('Notifications'));
    expect(banner.getByText('Application rejected')).toBeTruthy();
    expect(banner.getByText(/Wrong UEN/)).toBeTruthy();
    expect(screen.getByTestId('count').textContent).toBe('1');
    fireEvent.click(banner.getByRole('button', { name: 'Review application' }));
    expect(onNavigate).toHaveBeenCalledWith('registration');
    fireEvent.click(banner.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByLabelText('Notifications')).toBeNull());
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('does not replay old informational decisions on first visit', () => {
    registry.application = app({ status: 'approved', reviewed_at: '2020-01-01T00:00:00Z' });
    function Harness() { const { unread } = useNotices(); return <span data-testid="count">{unread.length}</span>; }
    render(<Harness />);
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

describe('manager review queue', () => {
  it('counts new or resubmitted applications and those with newly uploaded documents', () => {
    const rows = [app({ id: 'a', status: 'pending' }), app({ id: 'b', status: 'needs_info' }), app({ id: 'c', status: 'needs_info' }), app({ id: 'd', status: 'approved' })];
    const docs = [doc({ application_id: 'b', status: 'pending' }), doc({ application_id: 'c', status: 'rejected' })];
    expect(applicationsNeedingReview(rows, docs).map(row => row.id)).toEqual(['a', 'b']);
  });

  it('labels resubmissions and new documents on the Applications page', async () => {
    vi.mocked(useLedger).mockReturnValue({ account: '0x' + '79'.repeat(20), role: 'manager', transactionPending: false, runTransaction: vi.fn() } as unknown as ReturnType<typeof useLedger>);
    registry = { ...registry, isManager: true, request: vi.fn(async (input: { action: string }) => input.action === 'applications'
      ? [app({ id: 'a', display_name: 'Resubmitted Co', status: 'pending', version: 3 }), app({ id: 'b', display_name: 'Docs Co', status: 'needs_info' }), app({ id: 'c', display_name: 'Done Co', status: 'approved' })]
      : [doc({ application_id: 'b', status: 'pending' })]) };
    render(<Applications />);
    const resubmitted = (await screen.findByText('Resubmitted Co')).closest('tr')!;
    expect(within(resubmitted).getByText('Resubmitted')).toBeTruthy();
    expect(within(screen.getByText('Docs Co').closest('tr')!).getByText('New document')).toBeTruthy();
    expect(screen.queryByText('Done Co')).toBeNull(); // "Needs review" is the default filter
  });

  it('offers approve, reject and ask-again on an application awaiting more information', async () => {
    vi.mocked(useLedger).mockReturnValue({ account: '0x' + '79'.repeat(20), role: 'manager', transactionPending: false, runTransaction: vi.fn() } as unknown as ReturnType<typeof useLedger>);
    registry = { ...registry, isManager: true, request: vi.fn(async (input: { action: string }) => input.action === 'applications' ? [app({ id: 'b', display_name: 'Ben', kind: 'investor', status: 'needs_info', version: 2 })] : [doc({ application_id: 'b', status: 'pending' })]) };
    render(<Applications />);
    fireEvent.click((await screen.findByText('Ben')).closest('tr')!.querySelector('button')!);
    expect(screen.getByRole('button', { name: 'Approve investor on Sepolia' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject application' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask for more information again' })).toBeTruthy();
  });
});

describe('manager badge counts only what the manager can act on', () => {
  const request = (id: string, kind: 'subscription' | 'redemption', status: FundRequest['status']) => ({ id, kind, status, wallet, amount: '100', version: 1 }) as FundRequest;
  const proof = (requestId: string, status: PrivateDocument['status'], created = '2026-11-12T00:00:00Z') => doc({ id: `p-${requestId}-${created}`, purpose: 'subscription', application_id: null, fund_request_id: requestId, status, created_at: created });

  it('does not count an approved subscription that is waiting for the investor to pay', () => {
    expect(fundRequestsNeedingManager([request('a', 'subscription', 'approved')], [])).toHaveLength(0);
  });

  it('counts new requests, proofs to check, proofs accepted (issue RLU) and approved redemptions', () => {
    const requests = [request('new', 'subscription', 'pending'), request('check', 'subscription', 'approved'), request('issue', 'subscription', 'approved'),
      request('asked-again', 'subscription', 'approved'), request('settle', 'redemption', 'approved'), request('done', 'subscription', 'completed')];
    const docs = [proof('check', 'pending'), proof('issue', 'verified'), proof('asked-again', 'pending', '2026-11-11T00:00:00Z'), proof('asked-again', 'rejected', '2026-11-12T00:00:00Z')];
    expect(fundRequestsNeedingManager(requests, docs).map(item => item.id)).toEqual(['new', 'check', 'issue', 'settle']);
  });
});

describe('application approved box on Home', () => {
  it('disappears once the user dismisses the approval notice', async () => {
    window.localStorage.setItem(`receivledger:notices:${wallet}`, JSON.stringify({ since: Date.parse('2026-11-01T00:00:00Z'), seen: [] }));
    registry.application = app({ kind: 'investor', status: 'approved', version: 3, reviewed_at: '2026-11-12T01:00:00Z', review_note: 'gd' });
    function Harness() { const { unread, dismiss } = useNotices(); return <><NoticeBanner unread={unread} dismiss={dismiss} onNavigate={vi.fn()} /><RegistrationSummary onNavigate={vi.fn()} /></>; }
    render(<Harness />);
    expect(screen.getByText('Application: Approved')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Application: Approved')).toBeNull());
    expect(screen.queryByText('Application approved')).toBeNull();
  });
});

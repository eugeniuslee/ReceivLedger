// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Registration } from '../pages/Registration';
import { Applications } from '../pages/Applications';
import { DocumentsPanel } from '../pages/Documents';
import type { Application } from '../../supabase/functions/_shared/domain';
import { useRegistry } from './RegistryContext';
import { useLedger } from '../chain/LedgerContext';

vi.mock('./RegistryContext', () => ({ useRegistry: vi.fn() }));
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
const wallet = '0x2222222222222222222222222222222222222222';
const id = '10000000-0000-0000-0000-000000000001';
const tx = `0x${'a'.repeat(64)}`;
let registry: ReturnType<typeof useRegistry>;
let ledger: ReturnType<typeof useLedger>;
const app: Application = { id, user_id: 'demo-user', wallet, display_name: 'Fictional Investor', kind: 'investor',
  contact_email: 'demo@example.test', company_number: '', contact_phone: '', status: 'pending', version: 1,
  review_note: null, approval_tx_hash: null, reviewed_at: null, created_at: '2026-10-22T00:00:00Z' };
beforeEach(() => {
  registry = { configured: true, authenticated: true, busy: false, error: null, application: null, registeredName: null,
    isManager: false, signIn: vi.fn(), signOut: vi.fn(), reload: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue([]), displayName: () => null };
  ledger = { account: wallet, role: 'investor', networkOk: true, transactionPending: false, runTransaction: vi.fn().mockResolvedValue({ hash: tx }) } as unknown as ReturnType<typeof useLedger>;
  vi.mocked(useRegistry).mockImplementation(() => registry); vi.mocked(useLedger).mockImplementation(() => ledger);
});
afterEach(cleanup);
describe('registration forms and review recovery', () => {
  it('distinguishes document loading, failure and a successfully refreshed empty list', async () => {
    let fail!: (cause: Error) => void;
    vi.mocked(registry.request).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    render(<DocumentsPanel />);
    expect(screen.getByText('Loading private documents…')).toBeTruthy();
    expect(screen.queryByText('No documents were returned for this view.')).toBeNull();
    await act(async () => { fail(new Error('Private document service unavailable.')); });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Private document service unavailable.');
    expect(screen.queryByText('No documents were returned for this view.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh documents' }));
    expect(await screen.findByText('Documents refreshed.')).toBeTruthy();
    expect(screen.getByText('No documents were returned for this view.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('does not publish a stale document response after changing the selected application', async () => {
    registry.isManager = true;
    let finish!: (value: unknown) => void;
    const nextId = '10000000-0000-0000-0000-000000000002';
    vi.mocked(registry.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ id: 'new-doc', application_id: nextId, filename: 'current-application.pdf', purpose: 'kyc', status: 'verified', byte_size: 100, sha256: 'a'.repeat(64) }]);
    const view = render(<DocumentsPanel applicationId={id} />);
    view.rerender(<DocumentsPanel applicationId={nextId} />);
    expect(await screen.findByText('current-application.pdf')).toBeTruthy();
    await act(async () => { finish([{ id: 'old-doc', application_id: id, filename: 'previous-private.pdf', purpose: 'kyc', status: 'verified', byte_size: 100, sha256: 'b'.repeat(64) }]); });
    expect(screen.getByText('current-application.pdf')).toBeTruthy();
    expect(screen.queryByText('previous-private.pdf')).toBeNull();
  });
  it('selects an available document purpose for an approved application', async () => {
    registry.application = { ...app, status: 'approved', approval_tx_hash: tx };
    render(<DocumentsPanel />);
    expect((screen.getByLabelText('Document purpose') as HTMLSelectElement).value).toBe('invoice');
    expect(screen.getByLabelText('On-chain invoice ID')).toBeTruthy();
    await screen.findByText('No documents were returned for this view.');
  });
  it('distinguishes application list failure from a confirmed empty result and recovers on refresh', async () => {
    ledger.role = 'manager'; registry.isManager = true;
    vi.mocked(registry.request).mockRejectedValueOnce(new Error('Application service unavailable.'));
    render(<Applications />);
    expect(screen.getByText('Loading private applications…')).toBeTruthy();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Application service unavailable.');
    expect(screen.queryByText('No applications match this status.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh applications' }));
    expect(await screen.findByText('No applications match this status.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('submits fictional SME details without accepting a client-supplied wallet owner', async () => {
    render(<Registration initialKind="sme" />);
    fireEvent.change(screen.getByLabelText('Registered company name'), { target: { value: 'Fictional SME' } });
    fireEvent.change(screen.getByLabelText('UEN / company registration number'), { target: { value: 'DEMO-123' } });
    fireEvent.change(screen.getByLabelText('Business email'), { target: { value: 'demo@example.test' } });
    fireEvent.change(screen.getByLabelText("Contact person's phone number"), { target: { value: 'DEMO-123' } });
    fireEvent.change(screen.getByLabelText('Registered business address'), { target: { value: 'Fictional address' } });
    fireEvent.change(screen.getByLabelText("Contact person's name"), { target: { value: 'Demo contact' } });
    expect((screen.getByLabelText('Authenticated wallet') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('button', { name: 'Submit application' }).closest('form')!);
    await waitFor(() => expect(registry.request).toHaveBeenCalledWith({ action: 'submit', demo_consent: true,
      application: { kind: 'sme', display_name: 'Fictional SME', company_number: 'DEMO-123', contact_email: 'demo@example.test', contact_phone: 'DEMO-123', details: { country: '', website: '', business_address: 'Fictional address', contact_name: 'Demo contact' } } }));
    expect(await screen.findByText('Application submitted for manager review. No on-chain approval was granted.')).toBeTruthy();
  });
  it('shows rejection notes and permits resubmission while locking approved applications', () => {
    registry.application = { ...app, status: 'rejected', review_note: 'Please correct fictional details.' };
    const view = render(<Registration />);
    expect(screen.getAllByText(/Please correct fictional details/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeTruthy();
    registry = { ...registry, application: { ...app, status: 'approved', approval_tx_hash: tx } };
    view.rerender(<Registration />);
    expect((screen.getByLabelText('Full name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Resubmit for review' })).toBeNull();
  });
  it('blocks application-review UI for a nonmanager', () => {
    render(<Applications />);
    expect(screen.getByText('Fund manager access required.')).toBeTruthy();
    expect(registry.request).not.toHaveBeenCalled();
  });
  it('retains the approval hash and retries finalization without sending another transaction', async () => {
    ledger.role = 'manager'; registry.isManager = true;
    let finalizations = 0;
    vi.mocked(registry.request).mockImplementation(async input => {
      const action = (input as Record<string, unknown>).action;
      if (action === 'applications') return [app];
      if (action === 'documents') return [{ id: 'doc', status: 'verified', purpose: 'kyc', filename: 'fictional.pdf', byte_size: 100, sha256: 'a'.repeat(64) }];
      if (action === 'review_application' && ++finalizations === 1) throw new Error('Wait for two confirmations.');
      return {};
    });
    render(<Applications />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));
    fireEvent.change(screen.getByLabelText('Review note', { selector: 'textarea' }), { target: { value: 'Reviewed fictional KYC.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve investor on Sepolia' }));
    await screen.findByText(/Application finalization is still pending/);
    expect(ledger.runTransaction).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('Approval transaction hash (for finalization retry)') as HTMLInputElement).value).toBe(tx);
    fireEvent.click(screen.getByRole('button', { name: 'Retry application finalization' }));
    await screen.findByText('Application review recorded.');
    expect(ledger.runTransaction).toHaveBeenCalledOnce(); expect(finalizations).toBe(2);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Registration } from '../pages/Registration';
import { Applications } from '../pages/Applications';
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

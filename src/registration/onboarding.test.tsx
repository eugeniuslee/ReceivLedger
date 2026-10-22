// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerApp } from '../App';
import { Registration, ApplicationDashboard } from '../pages/Registration';
import { Invoices } from '../pages/Invoices';
import { Investors } from '../pages/Investors';
import { Applications } from '../pages/Applications';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from './RegistryContext';
import { registrationAccess } from './access';
import { resetBrowserStorage } from '../test/browserStorage';
import type { Application, ApplicationStatus } from '../../supabase/functions/_shared/domain';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), LedgerProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./RegistryContext', () => ({ useRegistry: vi.fn(), RegistryProvider: ({ children }: { children: React.ReactNode }) => children }));
let wallet: ReturnType<typeof useLedger>;
let registry: ReturnType<typeof useRegistry>;
const address = '0x2222222222222222222222222222222222222222';
const application: Application = { id: '10000000-0000-0000-0000-000000000001', user_id: 'owner', wallet: address,
  kind: 'investor', display_name: 'Fictional Applicant', company_number: '', contact_email: 'demo@example.test', contact_phone: 'DEMO-123',
  details: { country: 'Demo country', website: '', business_address: '', contact_name: '' }, status: 'pending', version: 1,
  review_note: null, approval_tx_hash: null, reviewed_at: null, created_at: '2026-10-22T00:00:00Z' };
beforeEach(() => {
  resetBrowserStorage();
  wallet = { account: address, role: 'provisional', networkOk: true, snapshot: null, walletAvailable: true, walletChecking: false,
    loading: false, eventIndexComplete: true, events: [], eventsLoading: false, eventsError: null, error: null,
    transactionPending: false, connectionNotice: null, ledger: null, runTransaction: vi.fn(), refresh: vi.fn(), refreshEvents: vi.fn(), disconnect: vi.fn() } as unknown as ReturnType<typeof useLedger>;
  registry = { configured: true, authenticated: true, busy: false, error: null, application: null, registeredName: null,
    isManager: false, signIn: vi.fn(), signOut: vi.fn(), reload: vi.fn(), request: vi.fn(), displayName: () => null };
  vi.mocked(useLedger).mockImplementation(() => wallet); vi.mocked(useRegistry).mockImplementation(() => registry);
});
afterEach(cleanup);

describe('new-wallet onboarding and secure registration forms', () => {
  it('welcomes an unknown connected wallet with both registration paths', () => {
    render(<LedgerApp />);
    expect(screen.getByRole('button', { name: 'Apply as an Investor' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Register as an SME' }));
    expect(screen.getByLabelText('Registered company name')).toBeTruthy();
    expect(screen.queryByText('Wallet role not established')).toBeNull();
  });
  it('requires wallet authentication before showing an application form and explains absent configuration', () => {
    registry.authenticated = false; registry.configured = false;
    render(<Registration />);
    expect(screen.queryByLabelText('Full name')).toBeNull();
    expect(screen.getByText(/Private registration is not configured yet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign in with this wallet' }) as HTMLButtonElement).disabled).toBe(true);
    expect(registry.request).not.toHaveBeenCalled();
  });
  it('submits the investor fields with the wallet read-only and navigates after saving', async () => {
    const submitted = vi.fn(); vi.mocked(registry.request).mockResolvedValue(application);
    render(<Registration onSubmitted={submitted} />);
    for (const [label, value] of [['Full name', 'Fictional Applicant'], ['Email address', 'demo@example.test'], ['Contact number', 'DEMO-123'], ['Country of residence', 'Demo country']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    expect((screen.getByLabelText('Authenticated wallet') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('button', { name: 'Submit application' }).closest('form')!);
    await waitFor(() => expect(submitted).toHaveBeenCalledOnce());
    expect(registry.request).toHaveBeenCalledWith(expect.objectContaining({ demo_consent: true,
      application: expect.objectContaining({ display_name: 'Fictional Applicant', contact_phone: 'DEMO-123', details: expect.objectContaining({ country: 'Demo country' }) }) }));
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('uses the investor application interface without granting the chain investor role', () => {
    registry.application = application;
    render(<LedgerApp />);
    expect(screen.getByRole('heading', { name: 'Investor application dashboard' })).toBeTruthy();
    expect(screen.getByText(/up to 3 working days/)).toBeTruthy();
    const navigation = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    fireEvent.click(navigation.getByRole('button', { name: /Transfer RLU/ }));
    expect(screen.getByText(/Manager verification is pending/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Transfer unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(wallet.role).toBe('provisional'); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it.each<ApplicationStatus>(['pending', 'needs_info', 'rejected', 'suspended', 'revoked', 'approved'])('shows %s and the saved applicant information without inventing a chain balance', status => {
    registry.application = { ...application, status, review_note: 'Fictional review note' };
    render(<ApplicationDashboard onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Fictional Applicant' })).toBeTruthy();
    expect(screen.getByText('Demo country')).toBeTruthy();
    expect(screen.getAllByText(/Fictional review note/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/S\$0\.00/)).toBeNull();
    expect(registrationAccess('provisional', registry.application, true).transferAllowed).toBe(false);
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
});

describe('website transaction restrictions and existing-wallet compatibility', () => {
  it.each<ApplicationStatus>(['pending', 'needs_info', 'rejected', 'suspended', 'revoked'])('blocks new SME invoice submission in %s even through a submitted form event', async status => {
    registry.application = { ...application, kind: 'sme', status };
    render(<Invoices />);
    const submit = screen.getByRole('button', { name: 'Submit invoice' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.submit(submit.closest('form')!);
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('rechecks an approved SME application and denies a newly suspended status before a transaction', async () => {
    registry.application = { ...application, kind: 'sme', status: 'approved' };
    vi.mocked(registry.request).mockResolvedValue({ application: { ...registry.application, status: 'suspended' } });
    render(<Invoices />);
    fireEvent.submit(screen.getByRole('button', { name: 'Submit invoice' }).closest('form')!);
    await screen.findAllByText(/application is suspended/);
    expect(registry.request).toHaveBeenCalledWith({ action: 'bootstrap' });
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('requires restored application authentication for an enrolled SME after sign-out', () => {
    wallet.role = 'sme'; registry.authenticated = false; registry.requiresRegistrationSession = true;
    render(<Invoices />);
    expect(screen.getByText(/Sign in again with this wallet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Submit invoice' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps an established SME without an application usable when Supabase is absent', () => {
    wallet.role = 'sme'; registry.configured = false; registry.authenticated = false;
    render(<Invoices />);
    expect((screen.getByRole('button', { name: 'Submit invoice' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/not enforced by the contract/)).toBeTruthy();
    expect(registry.request).not.toHaveBeenCalled();
  });
  it('keeps existing approved-investor transfers available but never enables a revoked investor', () => {
    wallet.role = 'investor'; registry.configured = false; registry.authenticated = false;
    const view = render(<Investors investorTransferOnly />);
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeTruthy();
    wallet.role = 'inactiveInvestor'; view.rerender(<Investors investorTransferOnly />);
    expect(screen.getByRole('button', { name: 'Transfer unavailable' })).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('offers audited additional-information review to the manager without sending a transaction', async () => {
    wallet.role = 'manager'; registry.isManager = true;
    vi.mocked(registry.request).mockImplementation(async input => (input as Record<string, unknown>).action === 'applications' ? [application] : []);
    render(<Applications />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));
    expect(screen.getByText('Submitted')).toBeTruthy(); expect(screen.getByText('Reviewed')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Review note', { selector: 'textarea' }), { target: { value: 'Please add fictional details.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request additional information' }));
    await waitFor(() => expect(registry.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'review_application', decision: 'needs_info' })));
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
});

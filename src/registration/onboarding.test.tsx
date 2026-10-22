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
    isManager: false, signIn: vi.fn(), signOut: vi.fn(), reload: vi.fn(), request: vi.fn().mockResolvedValue([]), displayName: () => null };
  vi.mocked(useLedger).mockImplementation(() => wallet); vi.mocked(useRegistry).mockImplementation(() => registry);
});
afterEach(cleanup);

describe('new-wallet onboarding and secure registration forms', () => {
  it('offers a public connection entry point and official installation help without requesting a signature', () => {
    wallet.account = null; wallet.role = null; wallet.walletAvailable = false; wallet.connect = vi.fn();
    render(<LedgerApp />);
    expect((screen.getByRole('button', { name: 'Connect Your Wallet' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'official MetaMask website' }).getAttribute('href')).toBe('https://metamask.io/download/');
    expect(wallet.connect).not.toHaveBeenCalled(); expect(registry.signIn).not.toHaveBeenCalled();
  });
  it('disables the pending-dashboard financial action and displays the review reason', () => {
    registry.application = application;
    render(<ApplicationDashboard onNavigate={vi.fn()} />);
    expect(screen.getByText('Application: Pending Review')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Transfer RLU' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Manager verification is pending/)).toBeTruthy();
  });
  it('never turns unavailable manager invoice records into a zero count', () => {
    wallet.role = 'manager'; wallet.snapshot = null;
    render(<Invoices />);
    expect(screen.getByText(/missing records are not treated as zero invoices/)).toBeTruthy();
    expect(screen.queryByText('No invoices match this status.')).toBeNull();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('reports application refresh failure and success with a recoverable button', async () => {
    vi.mocked(registry.reload).mockRejectedValueOnce(new Error('Registration service unavailable.')).mockResolvedValue(undefined);
    render(<Registration />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh application' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Registration service unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh application' }));
    expect(await screen.findByText('Application refreshed from the registration service.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('welcomes an unknown connected wallet with both registration paths', () => {
    render(<LedgerApp />);
    expect(screen.getByRole('button', { name: 'Investor' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'SME' }));
    expect(screen.getByLabelText('Registered company name')).toBeTruthy();
    expect(screen.queryByText('Wallet role not established')).toBeNull();
  });
  it('requires wallet authentication before showing an application form and explains absent configuration', () => {
    registry.authenticated = false; registry.configured = false;
    render(<Registration />);
    expect(screen.queryByLabelText('Full name')).toBeNull();
    expect(screen.getByText('Frontend Supabase configuration unavailable')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign in with this wallet' }) as HTMLButtonElement).disabled).toBe(true);
    expect(registry.request).not.toHaveBeenCalled();
  });
  it.each(['Supabase authentication failed: Ethereum provider is disabled.', 'Registration service failed: Registration RPC is unavailable.'])('keeps frontend readiness separate from a later failure: %s', error => {
    registry.authenticated = false; registry.error = error; registry.frontendConfigurationError = null;
    render(<Registration />);
    expect(screen.getByText(/Frontend Supabase configuration loaded/)).toBeTruthy();
    expect(screen.queryByText('Frontend Supabase configuration unavailable')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(error);
    expect((screen.getByRole('button', { name: 'Sign in with this wallet' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows the rejected frontend field without echoing a supplied value', () => {
    registry.authenticated = false; registry.configured = false;
    registry.frontendConfigurationError = 'Invalid VITE_SUPABASE_PUBLISHABLE_KEY in this build.';
    render(<Registration />);
    expect(screen.getByText('Invalid VITE_SUPABASE_PUBLISHABLE_KEY in this build.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign in with this wallet' }) as HTMLButtonElement).disabled).toBe(true);
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
    fireEvent.click(navigation.getByRole('button', { name: /My Assets/ }));
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


describe('restructured onboarding and navigation regressions', () => {
  it('keeps the disconnected welcome minimal, with the exact requested copy', () => {
    wallet.account = null; wallet.role = null; wallet.connect = vi.fn();
    render(<LedgerApp />);
    expect(screen.getByRole('heading', { name: 'Register your ReceivLedger Account' })).toBeTruthy();
    expect(screen.getByText('Connect your wallet to get started.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Your Wallet' }));
    expect(wallet.connect).toHaveBeenCalledOnce(); expect(registry.signIn).not.toHaveBeenCalled();
  });
  it('waits for chain recognition and offers explicit restoration without an automatic signature', () => {
    wallet.eventIndexComplete = false; registry.authenticated = false;
    const view = render(<LedgerApp />);
    expect(screen.queryByRole('button', { name: 'Investor' })).toBeNull();
    expect(registry.signIn).not.toHaveBeenCalled();
    wallet.eventIndexComplete = true; view.rerender(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to restore account' }));
    expect(registry.signIn).toHaveBeenCalledOnce();
    registry.authenticated = true; registry.application = { ...application, status: 'rejected' }; view.rerender(<LedgerApp />);
    expect(screen.getByText('Application: Rejected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'SME' })).toBeNull();
    expect(registry.signIn).toHaveBeenCalledOnce();
  });
  it('does not carry an account-type selection into another wallet', () => {
    const view = render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: 'SME' }));
    expect(screen.getByLabelText('Registered company name')).toBeTruthy();
    wallet.account = '0x3333333333333333333333333333333333333333'; view.rerender(<LedgerApp />);
    expect(screen.queryByLabelText('Registered company name')).toBeNull();
    expect(screen.getByRole('heading', { name: 'What type of account would you like to register?' })).toBeTruthy();
    expect(registry.signIn).not.toHaveBeenCalled();
  });
  it('separates the SME invoice list from submission and keeps the exact primary menu', () => {
    wallet.role = 'sme';
    render(<LedgerApp />);
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(nav.getAllByRole('button').map(button => button.textContent?.replace(/^[^A-Za-z]+/, ''))).toEqual(['Home', 'My Invoices', 'Submit Invoice', 'Transaction History']);
    fireEvent.click(nav.getByRole('button', { name: /My Invoices/ }));
    expect(screen.queryByRole('button', { name: 'Submit invoice' })).toBeNull();
    fireEvent.click(nav.getByRole('button', { name: /Submit Invoice/ }));
    expect(screen.getByRole('button', { name: 'Submit invoice' })).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
});

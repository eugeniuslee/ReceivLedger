// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerApp } from './App';
import { useLedger } from './chain/LedgerContext';
import { NAVIGATION_KEY } from './chain/navigation';
import type { WalletRole } from './chain/chainLedger';
import { resetBrowserStorage } from './test/browserStorage';
import { V2Ledger } from './v2/V2Ledger';
import * as Registry from './registration/RegistryContext';

vi.mock('./chain/LedgerContext', () => ({ useLedger: vi.fn(), LedgerProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => <div>Wallet home content</div> }));
vi.mock('./pages/History', () => ({ History: () => <div>Wallet history content</div> }));
vi.mock('./pages/Investors', () => ({ Investors: () => <div>Investor controls</div> }));
vi.mock('./pages/Invoices', () => ({ Invoices: () => <div>Invoice controls</div> }));

const walletA = '0x1111111111111111111111111111111111111111';
const walletB = '0x2222222222222222222222222222222222222222';
let wallet: ReturnType<typeof useLedger>;
beforeEach(() => {
  resetBrowserStorage();
  vi.spyOn(V2Ledger.prototype,'readReport').mockReturnValue(new Promise(()=>{}));
  wallet = {
    account: walletA, role: 'manager', networkOk: true, walletAvailable: true, walletChecking: false, walletEpoch: 0,
    isManager: true, isInvestor: false, isSme: false, snapshot: null, events: [], eventIndexComplete: true,
    loading: false, eventsLoading: false, transactionPending: false, error: null, eventsError: null, connectionNotice: null,
    connect: vi.fn(), disconnect: vi.fn(), signWalletMessage: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined), refreshEvents: vi.fn().mockResolvedValue(undefined),
    ledger: null, runTransaction: vi.fn(),
  };
  vi.mocked(useLedger).mockImplementation(() => wallet);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

function openProfileMenu() { fireEvent.click(screen.getByRole('button', { name: /^Account:/ })); }

describe('Stage A wallet navigation and account controls', () => {
  it.each(['provisional', null] as const)('keeps public fund tools and purchase-access guidance available when the RLU role is %s', role => {
    wallet = { ...wallet, role, isManager: false, isV2Manager: true };
    render(<LedgerApp />);
    const main = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(main).getAllByRole('button').map(button => button.textContent?.replace(/^[^A-Za-z]+/, ''))).toEqual([
      'Home', 'Financial Reports', 'RLU Purchase Requests', 'Financing & Fund Requests',
    ]);
    expect(screen.getByRole('button', { name: 'Account: RLU2 fund owner' })).toBeTruthy();
    expect(screen.getByText('Wallet home content')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review applications' })).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: /Financial Reports/ }));
    expect(screen.getByRole('heading', { name: 'RLU2 fund report' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify Fund Manager Wallet' })).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: /Financing & Fund Requests/ }));
    expect(screen.getByRole('heading', { name: 'Fund overview' })).toBeTruthy();
    expect(screen.getByText('Execution disabled')).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
    expect(wallet.signWalletMessage).not.toHaveBeenCalled();
  });

  it('preserves the RLU investor workflow alongside RLU2 ownership', () => {
    wallet = { ...wallet, role: 'investor', isManager: false, isInvestor: true, isV2Manager: true };
    render(<LedgerApp />);
    const main = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(main).getByRole('button', { name: /Buy RLU/ })).toBeTruthy();
    expect(within(main).getByRole('button', { name: /My Assets/ })).toBeTruthy();
    expect(within(main).getByRole('button', { name: /Financial Reports/ })).toBeTruthy();
    expect(within(main).queryByRole('button', { name: /Applications|Investors|Invoices|Purchase Requests/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Account: Approved investor · RLU2 fund owner' })).toBeTruthy();
    fireEvent.click(within(main).getByRole('button', { name: /Buy RLU/ }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Buy RLU');
    expect(screen.queryByRole('button', { name: 'Verify Fund Manager Wallet' })).toBeNull();
  });

  it('restores the purchase route as access guidance without loading private investor requests', () => {
    const request = vi.fn();
    vi.spyOn(Registry, 'useRegistry').mockReturnValue({ configured: true, authenticated: true, busy: false,
      error: null, application: null, registeredName: null, isManager: false,
      signIn: vi.fn(), signOut: vi.fn(), reload: vi.fn(), request, displayName: vi.fn() });
    window.sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify({ account: walletA, page: 'purchases' }));
    wallet = { ...wallet, role: 'provisional', isManager: false, isV2Manager: true,
      snapshot: { role: 'provisional', manager: walletB, approved: false, connectedBalance: 0n } };
    render(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('RLU Purchase Requests');
    expect(screen.getByRole('heading', { name: 'RLU purchase manager access required' })).toBeTruthy();
    expect(screen.getByText(walletB)).toBeTruthy();
    expect(screen.queryByText('No purchase requests yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve purchase request' })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['applications', 'investors', 'invoices'])('rejects a saved RLU manager %s route for an RLU2-only owner', page => {
    window.sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify({ account: walletA, page }));
    wallet = { ...wallet, role: 'provisional', isManager: false, isV2Manager: true };
    render(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.getByText('Wallet home content')).toBeTruthy();
    expect(screen.queryByText('Investor controls')).toBeNull();
    expect(screen.queryByText('Invoice controls')).toBeNull();
  });

  it('clears RLU manager navigation on a wallet change and removes public reports when ownership is lost', () => {
    const view = render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /Investors/ }));
    expect(screen.getByText('Investor controls')).toBeTruthy();
    wallet = { ...wallet, account: walletB, role: 'provisional', isManager: false, isV2Manager: true, walletEpoch: 1 };
    view.rerender(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.queryByText('Investor controls')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Financial Reports/ }));
    expect(screen.getByRole('heading', { name: 'RLU2 fund report' })).toBeTruthy();
    wallet = { ...wallet, isV2Manager: false };
    view.rerender(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.queryByRole('button', { name: /Financial Reports/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'RLU2 fund report' })).toBeNull();
  });

  it.each<WalletRole>(['manager','investor','sme'])('opens the shared fund tools from %s Home', role => {
    wallet.role=role;
    render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button',{name:role==='manager'?'Review fund requests':role==='sme'?'Explore financing':'View investment tools'}));
    expect(screen.getByRole('heading',{level:1}).textContent).toBe('Financing & Fund Requests');
    expect(screen.getByText(role==='manager'?'Execution disabled':/Requests are not available from this workspace yet/)).toBeTruthy();
    expect(screen.queryByRole('navigation',{name:'V2 preview sections'})).toBeNull();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
    expect(wallet.signWalletMessage).not.toHaveBeenCalled();
  });
  it('restores the shared fund route for the same wallet and clears it on a wallet switch',()=>{
    window.sessionStorage.setItem(NAVIGATION_KEY,JSON.stringify({account:walletA,page:'fund'}));
    const view=render(<LedgerApp/>);
    expect(screen.getByRole('heading',{level:1}).textContent).toBe('Financing & Fund Requests');
    wallet={...wallet,account:walletB,role:'sme',walletEpoch:1};
    view.rerender(<LedgerApp/>);
    expect(screen.getByRole('heading',{level:1}).textContent).toBe('Home');
    expect(screen.queryByText('V2 is deployed on Sepolia. Financial execution remains disabled.')).toBeNull();
  });

  it('orders the manager workflow and keeps a compact network note below support links', () => {
    render(<LedgerApp />);
    const main = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(main).getAllByRole('button').map(button => button.textContent?.replace(/^[^A-Za-z]+/, ''))).toEqual([
      'Home', 'Financial Reports', 'Applications', 'Purchase Requests', 'Investors', 'Invoices', 'Transaction History', 'Financing & Fund Requests',
    ]);
    const footer = screen.getByRole('navigation', { name: 'Support navigation' }).parentElement!;
    expect(footer.className).toBe('side-footer');
    expect(within(footer).getByText('Ethereum Sepolia')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /About ReceivLedger/ }));
    expect(screen.getByRole('heading', { name: 'About ReceivLedger', level: 2 })).toBeTruthy();
    expect(screen.queryByText(/ReceiveLedger/)).toBeNull();
  });
  it('describes inactive investor approval without inventing a revocation event', () => {
    wallet.role = 'inactiveInvestor';
    render(<LedgerApp />);
    expect(screen.getByText('Investor wallet is not currently approved.')).toBeTruthy();
    expect(screen.queryByText('Investor approval revoked.')).toBeNull();
  });
  it('closes manager financial reporting when switching to an investor and rejects saved report access', () => {
    const view = render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /Financial Reports/ }));
    expect(screen.getByRole('heading', { name: 'Fund financial reporting' })).toBeTruthy();
    wallet = { ...wallet, account: walletB, role: 'investor' };
    view.rerender(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.queryByRole('button', { name: /Financial Reports/ })).toBeNull();
    view.unmount();
    window.sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify({ account: walletB, page: 'reports' }));
    render(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.queryByRole('heading', { name: 'Fund financial reporting' })).toBeNull();
  });
  it.each<WalletRole>(['manager', 'investor', 'inactiveInvestor', 'sme', 'provisional'])('uses Home for %s', role => {
    wallet.role = role;
    render(<LedgerApp />);
    expect(screen.getByRole('button', { name: /Home/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
  });

  it('returns Home when switching to a different wallet with the same role', () => {
    const view = render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /Transaction History/ }));
    expect(screen.getByText('Wallet history content')).toBeTruthy();
    wallet = { ...wallet, account: walletB };
    view.rerender(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.queryByText('Wallet history content')).toBeNull();
  });

  it('preserves the current page during same-wallet refresh and tab reload', () => {
    const view = render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /Transaction History/ }));
    wallet = { ...wallet, account: walletA.toUpperCase().replace('0X', '0x'), loading: true };
    view.rerender(<LedgerApp />);
    expect(screen.getByText('Wallet history content')).toBeTruthy();
    view.unmount();
    render(<LedgerApp />);
    expect(screen.getByText('Wallet history content')).toBeTruthy();
  });

  it('does not reopen a saved manager route for an investor wallet', () => {
    window.sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify({ account: walletA, page: 'investors' }));
    wallet.role = 'investor';
    render(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.queryByText('Investor controls')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Investors$/ })).toBeNull();
  });

  it('preserves assets but removes transfer access when approval changes without switching wallets', () => {
    wallet.role = 'investor';
    const view = render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /My Assets/ }));
    wallet = { ...wallet, role: 'inactiveInvestor' };
    view.rerender(<LedgerApp />);
    expect(screen.queryByRole('button', { name: 'Transfer' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My Assets');
  });

  it('refreshes both role-specific records and event history', async () => {
    render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh blockchain/ }));
    await waitFor(() => expect(wallet.refreshEvents).toHaveBeenCalledWith(true));
    expect(wallet.refresh).toHaveBeenCalledWith(true);
    expect(await screen.findByText('Blockchain refresh completed.')).toBeTruthy();
  });

  it('shows refresh loading and failure feedback', () => {
    wallet = { ...wallet, eventsLoading: true, eventsError: 'RPC unavailable' };
    const view = render(<LedgerApp />);
    expect((screen.getByRole('button', { name: /Refreshing/ }) as HTMLButtonElement).disabled).toBe(true);
    wallet = { ...wallet, eventsLoading: false };
    view.rerender(<LedgerApp />);
    expect(screen.getByRole('alert').textContent).toContain('RPC unavailable');
    expect(screen.getByText('Some data could not be refreshed. See the error message.')).toBeTruthy();
  });

  it('copies only the current wallet and closes the disclosure with Escape', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    render(<LedgerApp />);
    openProfileMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Wallet Address' }));
    await screen.findByText('Wallet address copied.');
    expect(copy).toHaveBeenCalledWith(walletA);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'My Profile' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Account:/ }));
  });

  it('isolates the profile view when the account changes', () => {
    const view = render(<LedgerApp />);
    openProfileMenu();
    fireEvent.click(screen.getByRole('button', { name: 'My Profile' }));
    expect(screen.getByText(walletA)).toBeTruthy();
    expect(screen.getByText('No registration profile is connected yet.')).toBeTruthy();
    wallet = { ...wallet, account: walletB, role: 'inactiveInvestor' };
    view.rerender(<LedgerApp />);
    expect(screen.queryByText(walletA)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
  });

  it('offers useful support pages without a wallet', () => {
    wallet = { ...wallet, account: null, role: null, networkOk: false };
    render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /Help & Support/ }));
    expect(screen.getByText('No project support contact has been configured.', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /About ReceivLedger/ }));
    expect(screen.getByText('How ReceivLedger works')).toBeTruthy();
  });

  it('honours the preference to forget the current page on reload', () => {
    const view = render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Remember my page/ }));
    view.unmount();
    render(<LedgerApp />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(window.sessionStorage.getItem(NAVIGATION_KEY)).toBeNull();
  });

  it('disconnects through the account menu and blocks it during transactions', () => {
    const view = render(<LedgerApp />);
    openProfileMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(wallet.disconnect).toHaveBeenCalledOnce();
    wallet = { ...wallet, transactionPending: true };
    view.rerender(<LedgerApp />);
    openProfileMenu();
    expect((screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement).disabled).toBe(true);
  });
});


// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerApp } from './App';
import { useLedger } from './chain/LedgerContext';
import { NAVIGATION_KEY } from './chain/navigation';
import type { WalletRole } from './chain/chainLedger';
import { resetBrowserStorage } from './test/browserStorage';
import { V2Ledger } from './v2/V2Ledger';

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
  it.each<WalletRole>(['manager','investor','sme'])('opens the shared fund tools from %s Home', role => {
    wallet.role=role;
    render(<LedgerApp />);
    fireEvent.click(screen.getByRole('button',{name:'Open financing and fund tools'}));
    expect(screen.getByRole('heading',{level:1}).textContent).toBe('Financing & Fund Requests');
    expect(screen.getByText(role==='manager'?'Execution disabled':'V2 is deployed on Sepolia. Financial execution remains disabled.')).toBeTruthy();
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

  it('orders the manager workflow and groups support links above the prototype note', () => {
    render(<LedgerApp />);
    const main = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(main).getAllByRole('button').map(button => button.textContent?.replace(/^[^A-Za-z]+/, ''))).toEqual([
      'Home', 'Financial Reports', 'Applications', 'Investors', 'Invoices', 'Transaction History', 'Financing & Fund Requests',
    ]);
    const footer = screen.getByRole('navigation', { name: 'Support navigation' }).parentElement!;
    expect(footer.className).toBe('side-footer');
    expect(within(footer).getByText('Ethereum Sepolia · University prototype')).toBeTruthy();
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
    expect(screen.getByText('What the prototype represents')).toBeTruthy();
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


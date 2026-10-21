import type { WalletRole } from './chainLedger';

export type PageId = 'dashboard' | 'invoices' | 'investors' | 'transfer' | 'history';
export interface NavItem { id: PageId; title: string; icon: string }

export const ROLE_PAGES: Record<WalletRole, NavItem[]> = {
  manager: [
    { id: 'dashboard', title: 'Dashboard', icon: '◫' },
    { id: 'invoices', title: 'Invoice management', icon: '▤' },
    { id: 'investors', title: 'Investors', icon: '◉' },
    { id: 'history', title: 'Transaction history', icon: '≋' },
  ],
  investor: [
    { id: 'dashboard', title: 'My dashboard', icon: '◫' },
    { id: 'transfer', title: 'Transfer RLU', icon: '⇄' },
    { id: 'history', title: 'My history', icon: '≋' },
  ],
  inactiveInvestor: [
    { id: 'dashboard', title: 'My dashboard', icon: '◫' },
    { id: 'history', title: 'My history', icon: '≋' },
  ],
  sme: [
    { id: 'dashboard', title: 'My dashboard', icon: '◫' },
    { id: 'invoices', title: 'My invoices', icon: '▤' },
    { id: 'history', title: 'My history', icon: '≋' },
  ],
  provisional: [
    { id: 'dashboard', title: 'Dashboard', icon: '◫' },
    { id: 'invoices', title: 'Submit invoice', icon: '▤' },
  ],
};

export function canAccessPage(role: WalletRole | null, page: PageId): boolean {
  return role !== null && ROLE_PAGES[role].some(item => item.id === page);
}
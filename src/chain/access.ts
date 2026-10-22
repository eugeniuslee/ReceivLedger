import type { WalletRole } from './chainLedger';

export type PageId = 'dashboard' | 'invoices' | 'investors' | 'transfer' | 'history' | 'profile' | 'settings' | 'help' | 'about' | 'registration' | 'applications' | 'documents' | 'reports';
export interface NavItem { id: PageId; title: string; icon: string }

export const ROLE_PAGES: Record<WalletRole, NavItem[]> = {
  manager: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'invoices', title: 'Invoice management', icon: '▤' },
    { id: 'investors', title: 'Investors', icon: '◉' },
    { id: 'history', title: 'Transaction history', icon: '≋' },
  ],
  investor: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'transfer', title: 'Transfer RLU', icon: '⇄' },
    { id: 'history', title: 'My history', icon: '≋' },
  ],
  inactiveInvestor: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'history', title: 'My history', icon: '≋' },
  ],
  sme: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'invoices', title: 'My invoices', icon: '▤' },
    { id: 'history', title: 'My history', icon: '≋' },
  ],
  provisional: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'invoices', title: 'Submit invoice', icon: '▤' },
  ],
};

export function canAccessPage(role: WalletRole | null, page: PageId): boolean {
  if (page === 'reports') return role === 'manager';
  if (page === 'applications') return role === 'manager';
  if (page === 'registration') return role !== 'manager';
  if (page === 'documents') return role !== null;
  if (SUPPORT_PAGES.some(item => item.id === page)) return true;
  if (page === 'profile') return role !== null;
  return role !== null && ROLE_PAGES[role].some(item => item.id === page);
}

export function navigationForRole(role: WalletRole | null): NavItem[] {
  if (!role) return [];
  return [...ROLE_PAGES[role], role === 'manager'
    ? { id: 'applications', title: 'Applications', icon: '✓' }
    : { id: 'registration', title: 'Registration', icon: '+' },
  { id: 'documents', title: 'Documents', icon: '▧' }, ...(role === 'manager' ? [{ id: 'reports' as PageId, title: 'Financial reports', icon: '▥' }] : [])];
}

export const SUPPORT_PAGES: NavItem[] = [
  { id: 'settings', title: 'Settings', icon: '⚙' },
  { id: 'help', title: 'Help & Support', icon: '?' },
  { id: 'about', title: 'About ReceiveLedger', icon: 'ⓘ' },
];



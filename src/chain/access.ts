import type { WalletRole } from './chainLedger';

export type PageId = 'dashboard' | 'assets' | 'submitInvoice' | 'invoices' | 'investors' | 'transfer' | 'history' | 'profile' | 'settings' | 'help' | 'about' | 'registration' | 'applications' | 'documents' | 'reports' | 'fund' | 'funds' | 'smes' | 'invest' | 'performance' | 'repayments' | 'calculator';
export interface NavItem { id: PageId; title: string; icon: string }

export const ROLE_PAGES: Record<WalletRole, NavItem[]> = {
  manager: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'reports', title: 'Finances', icon: '▥' },
    { id: 'funds', title: 'Funds', icon: '◈' },
    { id: 'invoices', title: 'Invoices', icon: '▤' },
    { id: 'applications', title: 'Applications', icon: '✓' },
    { id: 'investors', title: 'Investors', icon: '◉' },
    { id: 'smes', title: 'SME', icon: '▦' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  investor: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'assets', title: 'Portfolio', icon: '◉' },
    { id: 'invest', title: 'Invest', icon: '⇄' },
    { id: 'performance', title: 'Fund Performance', icon: '▥' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  // Not currently approved: can view holdings and fund performance, but cannot subscribe, redeem or transfer.
  inactiveInvestor: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'assets', title: 'Portfolio', icon: '◉' },
    { id: 'performance', title: 'Fund Performance', icon: '▥' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  sme: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'submitInvoice', title: 'Request Funds', icon: '+' },
    { id: 'invoices', title: 'My Invoices', icon: '▤' },
    { id: 'repayments', title: 'Repayments', icon: '↩' },
    { id: 'calculator', title: 'Cost Calculator', icon: '▦' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  provisional: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
  ],
};

export function canAccessPage(role: WalletRole | null, page: PageId): boolean {
  // Managers use Finances ('reports') and Funds ('funds') instead.
  // Retired preview tab: every role now has its own pages. Saved routes fall back to Home.
  if (page === 'fund') return false;
  if (page === 'reports') return role === 'manager';
  if (page === 'applications') return role === 'manager';
  if (page === 'registration') return role !== 'manager';
  if (page === 'documents') return role !== null;
  if (page === 'transfer') return role === 'investor'; // Compatibility for saved routes; opens Invest.
  if (page === 'submitInvoice') return role === 'sme' || role === 'provisional';
  if (SUPPORT_PAGES.some(item => item.id === page)) return true;
  if (page === 'profile') return role !== null;
  return role !== null && ROLE_PAGES[role].some(item => item.id === page);
}

export function navigationForRole(role: WalletRole | null): NavItem[] {
  if (!role) return [];
  return ROLE_PAGES[role];
}

export const SUPPORT_PAGES: NavItem[] = [
  { id: 'settings', title: 'Settings', icon: '⚙' },
  { id: 'help', title: 'Help & Support', icon: '?' },
  { id: 'about', title: 'About ReceivLedger', icon: 'ⓘ' },
];



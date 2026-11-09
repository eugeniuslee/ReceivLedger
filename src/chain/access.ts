import type { WalletRole } from './chainLedger';

export type PageId = 'dashboard' | 'assets' | 'submitInvoice' | 'invoices' | 'investors' | 'transfer' | 'history' | 'profile' | 'settings' | 'help' | 'about' | 'registration' | 'applications' | 'documents' | 'reports' | 'fund' | 'purchases';
export interface NavItem { id: PageId; title: string; icon: string }

export const ROLE_PAGES: Record<WalletRole, NavItem[]> = {
  manager: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'reports', title: 'Financial Reports', icon: '▥' },
    { id: 'applications', title: 'Applications', icon: '✓' },
    { id: 'purchases', title: 'Purchase Requests', icon: '＋' },
    { id: 'investors', title: 'Investors', icon: '◉' },
    { id: 'invoices', title: 'Invoices', icon: '▤' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  investor: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'purchases', title: 'Buy RLU', icon: '＋' },
    { id: 'assets', title: 'My Assets', icon: '◉' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  inactiveInvestor: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'purchases', title: 'Purchase Requests', icon: '＋' },
    { id: 'assets', title: 'My Assets', icon: '◉' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  sme: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
    { id: 'invoices', title: 'My Invoices', icon: '▤' },
    { id: 'submitInvoice', title: 'Submit Invoice', icon: '+' },
    { id: 'history', title: 'Transaction History', icon: '≋' },
  ],
  provisional: [
    { id: 'dashboard', title: 'Home', icon: '◫' },
  ],
};

export function canAccessPage(role: WalletRole | null, page: PageId, isV2Manager = false): boolean {
  if (isV2Manager && (page === 'dashboard' || page === 'profile')) return true;
  // Opening this page does not grant private purchase-review permission.
  if (isV2Manager && page === 'purchases') return true;
  if (page === 'fund') return isV2Manager || role !== null && role !== 'provisional';
  if (page === 'reports') return isV2Manager || role === 'manager';
  if (page === 'applications') return role === 'manager';
  if (page === 'registration') return role !== 'manager';
  if (page === 'documents') return role !== null;
  if (page === 'transfer') return role === 'investor'; // Compatibility for saved routes; no permanent tab.
  if (page === 'submitInvoice') return role === 'sme' || role === 'provisional';
  if (SUPPORT_PAGES.some(item => item.id === page)) return true;
  if (page === 'profile') return role !== null;
  return role !== null && ROLE_PAGES[role].some(item => item.id === page);
}

export function navigationForRole(role: WalletRole | null, isV2Manager = false): NavItem[] {
  if (!role && !isV2Manager) return [];
  const navigation = [...ROLE_PAGES[role ?? 'provisional']];
  if (isV2Manager && role !== 'manager') navigation.splice(1, 0, { id: 'reports', title: 'Financial Reports', icon: '▥' });
  if (isV2Manager && !navigation.some(item => item.id === 'purchases')) navigation.push({ id: 'purchases', title: 'RLU Purchase Requests', icon: '＋' });
  if (isV2Manager || role !== 'provisional') navigation.push({ id: 'fund', title: 'Financing & Fund Requests', icon: '◇' });
  return navigation;
}

export const SUPPORT_PAGES: NavItem[] = [
  { id: 'settings', title: 'Settings', icon: '⚙' },
  { id: 'help', title: 'Help & Support', icon: '?' },
  { id: 'about', title: 'About ReceivLedger', icon: 'ⓘ' },
];



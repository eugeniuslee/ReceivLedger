import { canAccessPage, ROLE_PAGES, SUPPORT_PAGES, type PageId } from './access';
import type { WalletRole } from './chainLedger';

export interface NavigationState { account: string | null; page: PageId }
export const NAVIGATION_KEY = 'receivledger:navigation:v1';
export const REMEMBER_PAGE_KEY = 'receivledger:remember-page';
const pages = new Set<string>(['fund', 'profile', 'registration', 'applications', 'documents', 'reports', 'transfer', ...SUPPORT_PAGES.map(item => item.id), ...Object.values(ROLE_PAGES).flat().map(item => item.id)]);

export function readNavigation(storage: Pick<Storage, 'getItem'>): NavigationState {
  try {
    const saved = JSON.parse(storage.getItem(NAVIGATION_KEY) ?? 'null');
    if (saved && /^0x[\da-f]{40}$/i.test(saved.account) && pages.has(saved.page)) return saved;
  } catch { /* Navigation is optional; unavailable storage must not block the wallet. */ }
  return { account: null, page: 'dashboard' };
}

export function resolveWalletNavigation(previous: NavigationState, account: string | null, role: WalletRole | null, isV2Manager = false): NavigationState {
  if (!account) return previous;
  const sameWallet = previous.account?.toLowerCase() === account.toLowerCase();
  const page = sameWallet && (role === null && !isV2Manager || canAccessPage(role, previous.page, isV2Manager)) ? previous.page : 'dashboard';
  return { account, page };
}

export const WALLET_ROLE_LABELS: Record<WalletRole, string> = {
  manager: 'Fund manager', investor: 'Approved investor', inactiveInvestor: 'Inactive investor',
  sme: 'Invoice wallet', provisional: 'Unregistered wallet',
};

export function walletIdentity(role: WalletRole | null, isV2Manager = false) {
  const rluName = role ? WALLET_ROLE_LABELS[role] : 'Connected wallet';
  const name = isV2Manager && role !== 'manager'
    ? role && role !== 'provisional' ? `${rluName} · RLU2 fund owner` : 'RLU2 fund owner'
    : rluName;
  return { name, initials: name.split(' ').map(word => word[0]).slice(0, 2).join('').toUpperCase() };
}

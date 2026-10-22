import type { WalletRole } from '../chain/chainLedger';
import type { Application, RegistrySnapshot } from '../../supabase/functions/_shared/domain';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from './RegistryContext';

/** Website policy only. These checks never grant a smart-contract role. */
export function registrationAccess(role: WalletRole | null, app: Application | null, authenticated: boolean, requiresSession = false) {
  const status = app?.status;
  const reason = status === 'pending' ? 'Manager verification is pending. Financial actions are unavailable until the required approval is complete.'
    : status === 'needs_info' ? 'The manager requested additional information. Update your application and resubmit before financial actions are available.'
    : status === 'rejected' ? 'Your application was rejected. Review the manager note and resubmit corrected fictional details.'
    : status === 'suspended' || status === 'revoked' ? `Your off-chain application is ${status}. Contact the manager; website financial actions are restricted.`
    : app?.kind === 'investor' ? 'Live on-chain investor approval is required. An off-chain status alone cannot enable RLU transfers.'
    : 'Sign in and complete SME registration and manager verification before submitting an invoice through this website.';
  if (requiresSession && (!authenticated || !app)) return { invoiceAllowed: false, transferAllowed: false, reason: 'Sign in again with this wallet to restore your saved application and verify its current approval status.' };
  return {
    // Established wallets without an application keep their existing functions.
    invoiceAllowed: (role === 'sme' && !app) || (authenticated && app?.kind === 'sme' && status === 'approved' && (role === 'sme' || role === 'provisional')),
    transferAllowed: role === 'investor' && (!app || status === 'approved'), reason,
  };
}
export function useRegistrationAccess() {
  const { role } = useLedger(); const { application, authenticated, request, requiresRegistrationSession } = useRegistry();
  const access = registrationAccess(role, application, authenticated, requiresRegistrationSession);
  async function authorize(action: 'invoice' | 'transfer') {
    if (!(action === 'invoice' ? access.invoiceAllowed : access.transferAllowed)) throw new Error(access.reason);
    if (application) {
      const snapshot = await request<RegistrySnapshot>({ action: 'bootstrap' });
      if (!snapshot.application) throw new Error('Saved application unavailable. Sign in and refresh before continuing.');
      const latest = registrationAccess(role, snapshot.application, true);
      if (!(action === 'invoice' ? latest.invoiceAllowed : latest.transferAllowed)) throw new Error(latest.reason);
    }
  }
  return { ...access, authorize };
}

import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { V2App } from './V2App';
function useStakeholder() {
  const { role } = useLedger(); const { application } = useRegistry();
  return role === 'manager' ? 'manager' : application?.kind ?? (role === 'sme' ? 'sme' : role === 'investor' || role === 'inactiveInvestor' ? 'investor' : null);
}
export function FundOverview({ onOpen }: { onOpen: () => void }) {
  const stakeholder = useStakeholder();
  if (!stakeholder) return null;
  return <section className="section-block"><div className="section-heading"><h2>{stakeholder === 'manager' ? 'Fund operations' : stakeholder === 'sme' ? 'Your financing tools' : 'Your investment tools'}</h2><span className="source-tag illustrative">Execution inactive</span></div>
    <p className="support-copy">{stakeholder === 'manager' ? 'Review investment, redemption and invoice workflows; inspect liquidity, income and concentration from the deployed V2 contract.' : stakeholder === 'sme' ? 'Explore the S$20 processing fee, 8% annual interest, S$5,000 automatic invoice threshold and financing capacity.' : 'Explore the S$10,000 cumulative automatic investment allowance, manager review and redemption requests.'}</p>
    <button className="btn o" onClick={onOpen}>Open financing and fund tools</button>
  </section>;
}
export function UnifiedWorkspace() {
  const { account, walletEpoch = 0, networkOk } = useLedger();
  const { application, authenticated, requiresRegistrationSession } = useRegistry();
  const stakeholder = useStakeholder();
  if (!account || !stakeholder) return <p className="notice info">Choose an Investor or SME application to explore the matching fund tools.</p>;
  const status = application ? `${application.kind === 'sme' ? 'SME' : 'Investor'} application: ${application.status}`
    : requiresRegistrationSession ? 'Sign in to restore your application status.' : 'No current private application loaded; V1 roles do not grant V2 permissions.';
  return <><p className="support-copy" role="status">{status} {application && !authenticated ? 'A private wallet session is required to recheck this status.' : ''}</p>
    {application && application.status !== 'approved' && <p className="notice warning">Financial transactions are unavailable while your application is {application.status}. Quotations do not grant approval.</p>}
    <V2App key={`${account.toLowerCase()}:${walletEpoch}:${stakeholder}`} stakeholder={stakeholder} connectedWallet={account} walletEpoch={walletEpoch} networkOk={networkOk} />
  </>;
}

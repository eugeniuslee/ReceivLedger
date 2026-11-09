import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { V2App } from './V2App';
function useStakeholder() {
  const { role, isV2Manager } = useLedger(); const { application } = useRegistry();
  return role === 'manager' || isV2Manager ? 'manager' : application?.kind ?? (role === 'sme' ? 'sme' : role === 'investor' || role === 'inactiveInvestor' ? 'investor' : null);
}
export function FundOverview({ onOpen }: { onOpen: () => void }) {
  const stakeholder = useStakeholder();
  if (!stakeholder) return null;
  return <section className="section-block"><div className="section-heading"><h2>{stakeholder === 'manager' ? 'Fund operations' : stakeholder === 'sme' ? 'Financing' : 'Investments'}</h2>
    <button className="btn o" onClick={onOpen}>{stakeholder === 'manager' ? 'Review fund requests' : stakeholder === 'sme' ? 'Explore financing' : 'View investment tools'}</button></div>
    <p className="support-copy">{stakeholder === 'manager' ? 'Review requests, available liquidity, and financing exposure.' : stakeholder === 'sme' ? 'Estimate financing proceeds, fees, and repayment.' : 'Review investment allowances and plan a redemption.'}</p>
  </section>;
}
export function UnifiedWorkspace() {
  const { account, walletEpoch = 0, networkOk, ledger } = useLedger();
  const readProvider = ledger?.contract?.runner?.provider ?? null;
  const { application, authenticated, requiresRegistrationSession } = useRegistry();
  const stakeholder = useStakeholder();
  if (!account || !stakeholder) return <p className="notice info">Choose an Investor or SME application to explore the matching fund tools.</p>;
  if (stakeholder === 'manager') return <V2App stakeholder="manager" connectedWallet={account} walletEpoch={walletEpoch} networkOk={networkOk} readProvider={readProvider} />;
  const status = application ? `${application.kind === 'sme' ? 'SME' : 'Investor'} application: ${application.status}`
    : requiresRegistrationSession ? 'Sign in to restore your application status.' : 'Sign in to check your application status.';
  return <><p className="support-copy" role="status">{status} {application && !authenticated ? 'A private wallet session is required to recheck this status.' : ''}</p>
    {application && application.status !== 'approved' && <p className="notice warning">Financial transactions are unavailable while your application is {application.status}. Quotations do not grant approval.</p>}
    <V2App key={`${account.toLowerCase()}:${walletEpoch}:${stakeholder}`} stakeholder={stakeholder} connectedWallet={account} walletEpoch={walletEpoch} networkOk={networkOk} readProvider={readProvider} />
  </>;
}

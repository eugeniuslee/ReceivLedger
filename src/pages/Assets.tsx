import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { formatInteger } from '../chain/presentation';
import { InvestorReporting } from './Reports';
import { Investors } from './Investors';
import { History } from './History';

export function Assets() {
  const { account, role, snapshot } = useLedger();
  const { application, registeredName } = useRegistry();
  if (role !== 'investor' && role !== 'inactiveInvestor' && !(role === 'provisional' && application?.kind === 'investor')) return <p className="notice error">Investor account required to view My Assets.</p>;
  const balance = snapshot && 'connectedBalance' in snapshot ? snapshot.connectedBalance : null;
  return <>
    <section className="section-block"><h2>My Assets</h2><p>{registeredName ?? 'Your connected investor wallet'}</p><p className="mono selectable-address">{account}</p>
      <dl className="detail-list"><div><dt>RLU holdings</dt><dd>{balance === null ? 'Live balance unavailable. Refresh blockchain.' : `${formatInteger(balance)} RLU`}</dd></div></dl>
      <p className="footnote">RLU has no cash redemption function. Illustrative NAV and portfolio value below are not realised profit, a withdrawal balance or a payment commitment.</p>
    </section>
    <InvestorReporting />
    <Investors investorTransferOnly />
    <History />
  </>;
}

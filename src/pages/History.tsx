import { useMemo, useState } from 'react';
import { SEPOLIA_EXPLORER } from '../chain/abi';
import { groupEventsByTransaction } from '../chain/activity';
import { useLedger } from '../chain/LedgerContext';
import { formatTimestamp, shortAddress } from '../chain/presentation';
import { useRegistry } from '../registration/RegistryContext';

export function History() {
  const { account, events, eventsLoading, eventsError, networkOk, role, refreshEvents } = useLedger();
  const { displayName } = useRegistry();
  const addressLabel = (address: string) => { const name = displayName(address); return name ? `${name} (${shortAddress(address)})` : shortAddress(address); };
  const [eventType, setEventType] = useState('All');
  const activities = useMemo(() => role ? groupEventsByTransaction(events, role, account ?? undefined) : [], [events, role, account]);
  const types = useMemo(() => ['All', ...new Set(events.map(event => event.name))], [events]);
  const visibleActivities = useMemo(() => activities.filter(activity => eventType === 'All' || activity.events.some(event => event.name === eventType)), [activities, eventType]);

  if (!networkOk) return <div className="empty-state">Switch to Sepolia to query contract events.</div>;
  if (!role) return <div className="empty-state">Resolve the connected wallet role before loading history.</div>;

  return <section className="section-block">
    <div className="section-heading table-heading">
      <div><span className="eyebrow">Sepolia contract logs</span><h2>Transaction history</h2></div>
      <div className="history-controls"><label>Event<select value={eventType} onChange={event => setEventType(event.target.value)}>{types.map(type => <option key={type}>{type}</option>)}</select></label>
        <button className="btn outline" disabled={eventsLoading} onClick={() => void refreshEvents()}>{eventsLoading ? 'Loading logs…' : 'Refresh logs'}</button>
      </div>
    </div>
    <p className="support-copy">{role === 'manager' ? 'All contract events' : role === 'investor' ? 'Events involving this investor wallet' : role === 'inactiveInvestor' ? 'Public events involving this inactive investor wallet' : role === 'sme' ? 'Lifecycle events for invoices submitted by this wallet' : 'Public events involving this wallet'} are indexed from contract deployment in 2,000-block RPC requests, cached locally, then incrementally refreshed. A public RPC may still limit historical queries. Event amounts mix RLU token units and simulated S$ invoice accounting.</p>
    {eventsError && <div className="notice error" role="alert">Could not load transaction history: {eventsError}</div>}
    {eventsLoading && !events.length ? <div className="empty-state">Querying Sepolia logs…</div> : visibleActivities.length ? <div className="table-scroll"><table><thead><tr><th>Time</th><th>Activity</th><th>Details</th><th>Status</th><th>Block</th><th>Transaction</th></tr></thead>
      <tbody>{visibleActivities.map(activity => <tr key={activity.transactionHash}>
        <td>{formatTimestamp(activity.timestamp)}</td><td><span className="event-name">{activity.title}</span></td>
        <td>{activity.details.replace(/0x[a-fA-F0-9]{40}/g, addressLabel)}<details className="raw-events"><summary>View {activity.events.length} underlying event{activity.events.length === 1 ? '' : 's'}</summary>
          <ul>{activity.events.map(event => <li key={`${event.logIndex}-${event.name}`}><b>{event.name}</b> · {event.detail.replace(/0x[a-fA-F0-9]{40}/g, addressLabel)}{event.amount !== undefined ? ` · ${event.amount.toString()}` : ''}</li>)}</ul>
        </details></td>
        <td>Confirmed</td><td>{activity.blockNumber.toLocaleString('en-SG')}</td>
        <td><a className="mono tx-link" href={`${SEPOLIA_EXPLORER}/tx/${activity.transactionHash}`} target="_blank" rel="noreferrer" title={activity.transactionHash}>{shortAddress(activity.transactionHash)}</a></td>
      </tr>)}</tbody>
    </table></div> : <div className="empty-state compact">No matching events were found in the queried block window.</div>}
  </section>;
}

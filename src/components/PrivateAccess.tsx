import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';

export function PrivateAccess({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  const { account, role, networkOk, transactionPending } = useLedger();
  const { configured, authenticated, busy, signIn, error, frontendConfigurationError } = useRegistry();
  if (authenticated) return <>{children}</>;
  return <section className={compact ? 'private-access' : 'section-block private-access'}>
    {compact ? <p>Sign in to view these private documents. Public invoice review needs no private sign-in.</p> : <><h2>Sign in with your wallet</h2>
    <p>{role === 'manager' ? 'Your wallet is recognised as the on-chain fund manager. Applications and KYC are private: sign in once with this manager wallet to review them. Switching from an applicant wallet clears that applicant session.' : 'Your public blockchain dashboard remains available without private sign-in. Sign in only to access private registration details and documents.'} This signs a ReceivLedger sign-in message, not a blockchain transaction.</p></>}
    {!configured ? <div className="notice info"><b>Frontend Supabase configuration unavailable</b><p>{frontendConfigurationError ?? 'This build must include VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Check the Vercel Preview build environment or local .env.local configuration.'}</p><p>Existing blockchain features remain available.</p></div>
      : !compact && <p className="notice info" role="status">Frontend Supabase configuration loaded. Wallet authentication and the registration service still need to be verified by signing in.</p>}
    {!account && <p className="support-copy">Connect MetaMask first using the button above.</p>}
    {account && !networkOk && <p className="support-copy">Switch the connected wallet to Sepolia before signing in.</p>}
    {transactionPending && <p className="support-copy">Wait for the current wallet transaction to finish before signing in.</p>}
    {configured && error && <p className="inline-error" role="alert">{error}</p>}
    <button className="btn" disabled={!configured || !account || !networkOk || busy || transactionPending} onClick={() => void signIn()}>{busy ? 'Waiting for wallet sign-in…' : 'Sign in with this wallet'}</button>
  </section>;
}


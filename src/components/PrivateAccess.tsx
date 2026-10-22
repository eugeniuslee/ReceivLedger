import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';

export function PrivateAccess({ children }: { children: React.ReactNode }) {
  const { account, networkOk, transactionPending } = useLedger();
  const { configured, authenticated, busy, signIn, error, frontendConfigurationError } = useRegistry();
  if (authenticated) return <>{children}</>;
  return <section className="section-block private-access"><h2>Sign in with your wallet</h2>
    <p>Sign a ReceivLedger sign-in message to access private applications and documents. Signing in does not send a blockchain transaction or grant investor approval.</p>
    {!configured ? <div className="notice info"><b>Frontend Supabase configuration unavailable</b><p>{frontendConfigurationError ?? 'This build must include VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Check the Vercel Preview build environment or local .env.local configuration.'}</p><p>Existing blockchain features remain available.</p></div>
      : <p className="notice info" role="status">Frontend Supabase configuration loaded. Wallet authentication and the registration service still need to be verified by signing in.</p>}
    {!account && <p className="support-copy">Connect MetaMask first using the button above.</p>}
    {account && !networkOk && <p className="support-copy">Switch the connected wallet to Sepolia before signing in.</p>}
    {transactionPending && <p className="support-copy">Wait for the current wallet transaction to finish before signing in.</p>}
    {configured && error && <p className="inline-error" role="alert">{error}</p>}
    <button className="btn" disabled={!configured || !account || !networkOk || busy || transactionPending} onClick={() => void signIn()}>{busy ? 'Waiting for wallet sign-in…' : 'Sign in with this wallet'}</button>
  </section>;
}


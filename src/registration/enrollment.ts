// A public-wallet boolean restores the sign-in gate, never an approval/status.
// No name, application details, document data or token is stored here.
const key = (wallet: string) => `receivledger:application-wallet:${wallet.toLowerCase()}`;
export function needsApplicationSession(wallet: string | null) {
  try { return Boolean(wallet && window.localStorage.getItem(key(wallet)) === 'true'); } catch { return false; }
}
export function rememberApplicationWallet(wallet: string) {
  try { window.localStorage.setItem(key(wallet), 'true'); } catch { /* Backend records remain authoritative; sign-in can restore them manually. */ }
}

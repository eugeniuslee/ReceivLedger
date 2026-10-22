/** Keep provider payloads and credentials out of user-facing feedback. */
function causes(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || depth > 4) return [];
  const error = value as Record<string, unknown>;
  return [error, ...['error', 'cause', 'info', 'data'].flatMap(key => causes(error[key], depth + 1))];
}

export function isWalletRejection(error: unknown) {
  return causes(error).some(item => item.code === 4001 || item.code === '4001' || item.code === 'ACTION_REJECTED');
}

export function userFacingError(error: unknown, fallback = 'The request could not be completed. Please try again.'): string {
  const entries = causes(error);
  const candidate = entries.flatMap(item => [item.reason, item.shortMessage, item.message])
    .find(value => typeof value === 'string' && value.trim()) ?? (typeof error === 'string' ? error : '');
  if (typeof candidate !== 'string') return fallback;
  const message = candidate.trim();
  if (!message || message.length > 260 || /[{}\r\n]|https?:\/\/|0x[\da-f]{128,}|\b(?:sb_secret_|sbp_|Bearer\s|eyJ[A-Za-z0-9_-]{10})|access_token|service_role|private_key|seed_phrase/i.test(message)) return fallback;
  return message;
}

export function walletErrorMessage(error: unknown, action: 'connection' | 'signature' | 'transaction' | 'read') {
  if (isWalletRejection(error)) return action === 'signature' ? 'Sign-in cancelled. No changes were made.'
    : action === 'connection' ? 'Wallet connection cancelled.'
    : 'Transaction cancelled in MetaMask. No confirmed action was recorded.';
  if (causes(error).some(item => item.code === -32002)) return 'A MetaMask request is already open. Open MetaMask to complete or cancel it.';
  if (causes(error).some(item => item.code === 4100)) return 'Unlock MetaMask and reconnect the intended account.';
  return userFacingError(error, action === 'connection' ? 'Could not connect to MetaMask. Unlock the wallet and try again.'
    : action === 'signature' ? 'Wallet sign-in could not be completed. Check MetaMask without bypassing any security warning.'
    : action === 'transaction' ? 'The transaction could not be confirmed. Check its status before trying again.'
    : 'The Sepolia read failed. Check your connection and refresh.');
}

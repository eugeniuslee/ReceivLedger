export function isCurrentWalletRequest(
  requestVersion: number,
  activeVersion: number,
  requestAccount: string | null,
  activeAccount: string | null,
): boolean {
  return requestVersion === activeVersion && requestAccount !== null && activeAccount !== null &&
    requestAccount.toLowerCase() === activeAccount.toLowerCase();
}

export function didWalletAddressChange(previousAccount: string | null, nextAccount: string | null): boolean {
  return (previousAccount ?? '').toLowerCase() !== (nextAccount ?? '').toLowerCase();
}
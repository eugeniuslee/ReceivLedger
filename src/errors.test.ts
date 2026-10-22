import { describe, expect, it } from 'vitest';
import { isWalletRejection, userFacingError, walletErrorMessage } from './errors';

describe('safe action-specific feedback', () => {
  it.each([4001, '4001', 'ACTION_REJECTED'])('recognises nested wallet rejection %s without displaying its payload', code => {
    const error = { message: 'sensitive provider payload', info: { error: { code } } };
    expect(isWalletRejection(error)).toBe(true);
    expect(walletErrorMessage(error, 'connection')).toBe('Wallet connection cancelled.');
    expect(walletErrorMessage(error, 'signature')).toBe('Sign-in cancelled. No changes were made.');
    expect(walletErrorMessage(error, 'transaction')).toContain('No confirmed action was recorded.');
  });
  it.each(['{"payload":"private"}', 'error\nstack', 'x'.repeat(261), 'sb_secret_do_not_show', 'Bearer test-session', 'access_token=test', 'Failed https://rpc.test/v2/credential', `signature 0x${'a'.repeat(130)}`])('withholds structured, verbose or sensitive error text %#', message => {
    expect(userFacingError(new Error(message), 'Safe retry message.')).toBe('Safe retry message.');
  });
  it('preserves useful validation and service feedback', () => {
    expect(userFacingError(new Error('Enter a review note.'))).toBe('Enter a review note.');
    expect(userFacingError({ reason: 'Invoice has already been repaid.' })).toBe('Invoice has already been repaid.');
  });
  it('handles locked, pending and cyclic provider errors safely', () => {
    expect(walletErrorMessage({ code: 4100 }, 'connection')).toContain('Unlock MetaMask');
    expect(walletErrorMessage({ info: { error: { code: -32002 } } }, 'connection')).toContain('already open');
    const error: { cause?: unknown } = {}; error.cause = error;
    expect(userFacingError(error, 'Retry safely.')).toBe('Retry safely.');
  });
});

import { useEffect, useRef, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { shortAddress } from '../chain/presentation';
import { walletIdentity } from '../chain/navigation';
import type { PageId } from '../chain/access';
import { useRegistry } from '../registration/RegistryContext';

export function ProfileMenu({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { account, role, disconnect, transactionPending } = useLedger();
  const { registeredName, authenticated, signOut } = useRegistry();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const identity = walletIdentity(role);
  const name = registeredName ?? identity.name;
  const initials = name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('.profile-dropdown button')?.focus();
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', keyboard); };
  }, [open]);

  if (!account) return null;
  function navigate(page: PageId) { setOpen(false); onNavigate(page); trigger.current?.focus(); }
  async function copyAddress() {
    try { await navigator.clipboard.writeText(account!); setFeedback('Wallet address copied.'); }
    catch { setFeedback('Copy unavailable. Open My Profile to select the full wallet address.'); }
  }

  return <div className="profile-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button className="profile-trigger" ref={trigger} aria-label={`Account: ${name}`} aria-expanded={open} aria-controls="profile-options" onClick={() => { setFeedback(''); setOpen(value => !value); }}>
      <span className="avatar" aria-hidden="true">{initials}</span>
      <span className="profile-summary"><strong>{name}</strong><span>{registeredName ? `${identity.name} · ` : ''}{shortAddress(account)}</span></span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="profile-dropdown" id="profile-options" aria-label="Account options">
      <p className="profile-caption">{authenticated ? 'Signed-in wallet profile' : role ? 'Wallet role · sign in for your profile' : 'Resolving wallet role…'}</p>
      <button disabled={!role} onClick={() => navigate('profile')}>My Profile</button>
      <button onClick={() => void copyAddress()}>Copy Wallet Address</button>
      <button onClick={() => navigate('settings')}>Settings</button>
      <button disabled={transactionPending} onClick={() => { setOpen(false); void disconnect(); void signOut(); }}>Disconnect</button>
      {feedback && <p className="profile-feedback" role="status">{feedback}</p>}
    </div>}
  </div>;
}

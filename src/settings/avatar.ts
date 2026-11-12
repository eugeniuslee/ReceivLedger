import { useSyncExternalStore } from 'react';

/** Profile icons a wallet can choose. 'initials' shows the name's initials. Stored per wallet in this browser only. */
export const AVATAR_CHOICES = ['initials', '🦁', '🐼', '🦊', '🐯', '🐨', '🦉', '🐬', '🌿', '🚀', '💼', '⭐'] as const;
export type AvatarChoice = typeof AVATAR_CHOICES[number];

const listeners = new Set<() => void>();
const key = (wallet: string) => `receivledger:avatar:${wallet.toLowerCase()}`;

function read(wallet: string | null): AvatarChoice {
  if (!wallet) return 'initials';
  try {
    const saved = window.localStorage.getItem(key(wallet));
    return (AVATAR_CHOICES as readonly string[]).includes(saved ?? '') ? saved as AvatarChoice : 'initials';
  } catch { return 'initials'; }
}

export function useAvatar(wallet: string | null) {
  const avatar = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => read(wallet), () => 'initials' as AvatarChoice);
  return {
    avatar,
    setAvatar(choice: AvatarChoice): boolean {
      if (!wallet) return false;
      let saved = true;
      try { window.localStorage.setItem(key(wallet), choice); } catch { saved = false; }
      listeners.forEach(listener => listener());
      return saved;
    },
  };
}

export function initialsOf(name: string) {
  return name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
}

import { create } from 'zustand';
import type { Playlist } from '../lib/api';

interface PlayerState {
  screenId: string | null;
  token: string | null;
  playlist: Playlist | null;
  currentIndex: number;
  // Set by `unpair()`, read once by PairingPage's mount effect. Carried through the store
  // rather than router navigation state — PlayerPage's own `[token]`-watching effect also
  // navigates to '/' as soon as `token` goes null, racing our explicit navigate call, so
  // router state isn't a reliable way to hand this off; the store update lands atomically
  // with the token clear regardless of which navigate call ends up mounting PairingPage.
  pendingPairingCode: string | null;
  setScreenId: (id: string) => void;
  setToken: (token: string) => void;
  setPlaylist: (p: Playlist | null) => void;
  nextItem: () => void;
  unpair: (pairingCode: string) => void;
  clearPendingPairingCode: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  screenId: localStorage.getItem('screen_id'),
  token: localStorage.getItem('player_token'),
  playlist: null,
  currentIndex: 0,
  pendingPairingCode: null,

  setScreenId(id) {
    localStorage.setItem('screen_id', id);
    set({ screenId: id });
  },

  setToken(token) {
    localStorage.setItem('player_token', token);
    set({ token });
  },

  setPlaylist(p) {
    set({ playlist: p, currentIndex: 0 });
  },

  nextItem() {
    const { playlist, currentIndex } = get();
    if (!playlist || playlist.items.length === 0) return;
    set({ currentIndex: (currentIndex + 1) % playlist.items.length });
  },

  // Drops the stale token (dead credentials) so the router falls back to PairingPage —
  // `screenId` is kept so re-pairing lands back on the *same* screen entity (name/history/
  // settings) instead of the device minting a brand new orphan one.
  unpair(pairingCode) {
    localStorage.removeItem('player_token');
    set({ token: null, playlist: null, currentIndex: 0, pendingPairingCode: pairingCode });
  },

  clearPendingPairingCode() {
    set({ pendingPairingCode: null });
  },
}));

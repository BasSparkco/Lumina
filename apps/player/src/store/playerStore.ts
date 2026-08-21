import { create } from 'zustand';

// Playback position/current playlist are NOT tracked here — that lives in ZonePlayer's own local
// state, since each zone plays independently. This store is purely pairing/auth identity.
interface PlayerState {
  screenId: string | null;
  token: string | null;
  // Set by `unpair()`, read once by PairingPage's mount effect. Carried through the store
  // rather than router navigation state — PlayerPage's own `[token]`-watching effect also
  // navigates to '/' as soon as `token` goes null, racing our explicit navigate call, so
  // router state isn't a reliable way to hand this off; the store update lands atomically
  // with the token clear regardless of which navigate call ends up mounting PairingPage.
  pendingPairingCode: string | null;
  setScreenId: (id: string) => void;
  setToken: (token: string) => void;
  unpair: (pairingCode: string) => void;
  forget: () => void;
  clearPendingPairingCode: () => void;
}

export const usePlayerStore = create<PlayerState>(set => ({
  screenId: localStorage.getItem('screen_id'),
  token: localStorage.getItem('player_token'),
  pendingPairingCode: null,

  setScreenId(id) {
    localStorage.setItem('screen_id', id);
    set({ screenId: id });
  },

  setToken(token) {
    localStorage.setItem('player_token', token);
    set({ token });
  },

  // Drops the stale token (dead credentials) so the router falls back to PairingPage —
  // `screenId` is kept so re-pairing lands back on the *same* screen entity (name/history/
  // settings) instead of the device minting a brand new orphan one.
  unpair(pairingCode) {
    localStorage.removeItem('player_token');
    set({ token: null, pendingPairingCode: pairingCode });
  },

  // Unlike `unpair`, the underlying screen row is gone — there's no old screenId left to
  // re-pair back into, so this also drops screenId, forcing PairingPage down its `api.init()`
  // path to mint a brand new screen entity instead of polling a dead id forever.
  forget() {
    localStorage.removeItem('player_token');
    localStorage.removeItem('screen_id');
    set({ token: null, screenId: null, pendingPairingCode: null });
  },

  clearPendingPairingCode() {
    set({ pendingPairingCode: null });
  },
}));

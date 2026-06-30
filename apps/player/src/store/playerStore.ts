import { create } from 'zustand';
import type { Playlist } from '../lib/api';

interface PlayerState {
  screenId: string | null;
  token: string | null;
  playlist: Playlist | null;
  currentIndex: number;
  setScreenId: (id: string) => void;
  setToken: (token: string) => void;
  setPlaylist: (p: Playlist | null) => void;
  nextItem: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  screenId: localStorage.getItem('screen_id'),
  token: localStorage.getItem('player_token'),
  playlist: null,
  currentIndex: 0,

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
}));

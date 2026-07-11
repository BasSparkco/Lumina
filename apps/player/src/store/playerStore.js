import { create } from 'zustand';
export const usePlayerStore = create((set, get) => ({
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
        if (!playlist || playlist.items.length === 0)
            return;
        set({ currentIndex: (currentIndex + 1) % playlist.items.length });
    },
}));
//# sourceMappingURL=playerStore.js.map
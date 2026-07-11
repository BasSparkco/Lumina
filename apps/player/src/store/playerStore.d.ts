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
export declare const usePlayerStore: import("zustand").UseBoundStore<import("zustand").StoreApi<PlayerState>>;
export {};
//# sourceMappingURL=playerStore.d.ts.map
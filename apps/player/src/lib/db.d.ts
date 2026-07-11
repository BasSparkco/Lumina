import type { Playlist, PlayerState } from './api';
export declare const cache: {
    savePlaylist(playlist: Playlist): Promise<void>;
    getPlaylist(): Promise<Playlist | undefined>;
    set(key: string, value: string): Promise<void>;
    get(key: string): Promise<string | undefined>;
    saveState(state: PlayerState): Promise<void>;
    getState(): Promise<PlayerState | undefined>;
    clear(): Promise<void>;
};
//# sourceMappingURL=db.d.ts.map
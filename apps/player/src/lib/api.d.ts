export interface PairingInitResponse {
    pairingCode: string;
    screenId: string;
}
export type CheckResponse = {
    paired: false;
} | {
    paired: true;
    token: string;
};
export interface PlaylistItem {
    id: string;
    position: number;
    durationSecs: number;
    asset: {
        id: string;
        name: string;
        type: 'IMAGE' | 'VIDEO' | 'AUDIO';
        mimeType: string;
        url: string;
        thumbnailUrl: string | null;
    };
}
export interface Playlist {
    id: string;
    name: string;
    items: PlaylistItem[];
}
export interface ScheduleRule {
    id: string;
    priority: number;
    startTime: string | null;
    endTime: string | null;
    daysOfWeek: number[];
    startDate: string | null;
    endDate: string | null;
    playlistId: string;
    playlist: Playlist | null;
}
export type ZoneType = 'MEDIA' | 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER';
export interface Zone {
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    zoneType: ZoneType;
    widgetConfig: Record<string, unknown> | null;
    playlist: Playlist | null;
}
export interface PlayerState {
    screenId: string;
    timezone: string;
    latitude: number | null;
    longitude: number | null;
    prayerMethod: string;
    athanEnabled: boolean;
    emergencyActive: boolean;
    emergencyPlaylist: Playlist | null;
    layout: {
        id: string;
        name: string;
        zones: Zone[];
    } | null;
    scheduleRules: ScheduleRule[];
    resolvedPlaylistId: string | null;
    defaultPlaylist: Playlist | null;
}
export declare const api: {
    init: () => Promise<PairingInitResponse>;
    checkPairing: (screenId: string) => Promise<{
        paired: false;
    } | {
        paired: true;
        token: string;
    }>;
    getPlaylist: () => Promise<Playlist | null>;
    getState: () => Promise<PlayerState>;
    heartbeat: (currentAssetId: string | null) => Promise<unknown>;
    getWeather: (lat: number, lon: number) => Promise<WeatherData | null>;
    getCurrency: (base?: string) => Promise<CurrencyData | null>;
    getTicker: (url: string) => Promise<TickerData | null>;
};
export interface WeatherData {
    temperature: number;
    feelsLike: number;
    humidity: number;
    windKmh: number;
    weatherCode: number;
    condition: string;
    icon: string;
    fetchedAt: string;
}
export interface CurrencyData {
    base: string;
    rates: Record<string, number>;
    fetchedAt: string;
}
export interface TickerItem {
    title: string;
    link: string;
}
export interface TickerData {
    url: string;
    items: TickerItem[];
    fetchedAt: string;
}
//# sourceMappingURL=api.d.ts.map
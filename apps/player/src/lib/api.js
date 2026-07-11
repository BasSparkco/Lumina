const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/v1';
async function request(path, options = {}) {
    const token = localStorage.getItem('player_token');
    const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers ?? {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message ?? res.statusText);
    }
    return res.json();
}
export const api = {
    init: () => request('/player/init', { method: 'POST' }),
    checkPairing: (screenId) => request(`/player/check?screenId=${screenId}`),
    getPlaylist: () => request('/player/playlist'),
    getState: () => request('/player/state'),
    heartbeat: (currentAssetId) => request('/player/heartbeat', { method: 'POST', body: JSON.stringify({ currentAssetId }) }),
    getWeather: (lat, lon) => request(`/feeds/weather?lat=${lat}&lon=${lon}`),
    getCurrency: (base = 'USD') => request(`/feeds/currency?base=${base}`),
    getTicker: (url) => request(`/feeds/ticker?url=${encodeURIComponent(url)}`),
};
//# sourceMappingURL=api.js.map
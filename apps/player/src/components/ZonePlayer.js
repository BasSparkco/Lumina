import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
export default function ZonePlayer({ playlist, onAssetChange }) {
    const [index, setIndex] = useState(0);
    const [item, setItem] = useState(null);
    const timerRef = useRef(null);
    const videoRef = useRef(null);
    const preloadRef = useRef(null);
    // When playlist changes (publish command) reset to beginning
    useEffect(() => {
        setIndex(0);
    }, [playlist.id]);
    useEffect(() => {
        if (!playlist.items.length)
            return;
        const current = playlist.items[index % playlist.items.length];
        if (!current)
            return;
        setItem(current);
        onAssetChange?.(current.asset.id);
        if (timerRef.current)
            clearTimeout(timerRef.current);
        if (current.asset.type === 'IMAGE') {
            timerRef.current = setTimeout(advance, current.durationSecs * 1000);
        }
        // VIDEO: onEnded triggers advance
        // Preload next video
        const nextIdx = (index + 1) % playlist.items.length;
        const next = playlist.items[nextIdx];
        if (next?.asset.type === 'VIDEO' && preloadRef.current) {
            preloadRef.current.src = next.asset.url;
            preloadRef.current.load();
        }
        return () => { if (timerRef.current)
            clearTimeout(timerRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index, playlist]);
    function advance() {
        setIndex(i => (i + 1) % playlist.items.length);
    }
    if (!item)
        return null;
    return (_jsxs("div", { style: { width: '100%', height: '100%', background: '#000', position: 'relative' }, children: [item.asset.type === 'IMAGE' && (_jsx("img", { src: item.asset.url, alt: item.asset.name, style: { width: '100%', height: '100%', objectFit: 'contain' } }, item.id)), item.asset.type === 'VIDEO' && (_jsx("video", { ref: videoRef, src: item.asset.url, autoPlay: true, muted: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'contain' }, onEnded: advance }, item.id)), _jsx("video", { ref: preloadRef, style: { display: 'none' }, preload: "auto", muted: true })] }));
}
//# sourceMappingURL=ZonePlayer.js.map
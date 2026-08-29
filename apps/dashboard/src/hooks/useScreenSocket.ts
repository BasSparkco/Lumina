'use client';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

interface ScreenStatusEvent {
  screenId: string;
  status: 'ONLINE' | 'OFFLINE';
}

// Mirrors apps/api/src/modules/ws/screen.gateway.ts's PlaybackProgress — emitted by a player
// roughly once a second while a controllable video is playing (Custom Player, appsroadmap.md
// Phase 9). Consumed by the Screens tab's Custom Player panel (Phase 11) to drive a live,
// scrubbable position without polling.
export interface PlaybackProgress {
  screenId: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  rate: number;
}

export function useScreenSocket() {
  const [statuses, setStatuses] = useState<Record<string, 'ONLINE' | 'OFFLINE'>>({});
  const [playbackProgress, setPlaybackProgress] = useState<Record<string, PlaybackProgress>>({});

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socket.on('screen-status', (event: ScreenStatusEvent) => {
      setStatuses(prev => ({ ...prev, [event.screenId]: event.status }));
    });

    socket.on('playback-progress', (event: PlaybackProgress) => {
      setPlaybackProgress(prev => ({ ...prev, [event.screenId]: event }));
    });

    // Navigating away makes the page bfcache-eligible: the browser freezes all JS and force-
    // closes any open WebSocket (the "Page entered Back-Forward Cache" console message is just
    // that, expected and harmless). React doesn't remount on a bfcache restore though — this
    // effect never re-runs — so without an explicit nudge here, reconnecting depends entirely on
    // socket.io's own backoff timer picking back up after the freeze, which can leave screen
    // status/playback data stale for longer than necessary. `pageshow` with `persisted: true`
    // fires exactly on that restore, so force a reconnect immediately instead of waiting on it.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && !socket.connected) socket.connect();
    };
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      socket.disconnect();
    };
  }, []);

  return { statuses, playbackProgress };
}

'use client';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

interface ScreenStatusEvent {
  screenId: string;
  status: 'ONLINE' | 'OFFLINE';
}

export function useScreenSocket() {
  const [statuses, setStatuses] = useState<Record<string, 'ONLINE' | 'OFFLINE'>>({});

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

    return () => { socket.disconnect(); };
  }, []);

  return statuses;
}

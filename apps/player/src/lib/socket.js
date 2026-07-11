import { io } from 'socket.io-client';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:4000';
let socket = null;
export function connectSocket(token) {
    if (socket?.connected)
        return socket;
    socket = io(WS_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
    });
    return socket;
}
export function disconnectSocket() {
    socket?.disconnect();
    socket = null;
}
export function getSocket() {
    return socket;
}
//# sourceMappingURL=socket.js.map
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:5000';

let socket: Socket | null = null;
let hasLoggedSocketFailure = false;

export const getSocket = (): Socket => {
    if (!socket) {
        socket = io(WS_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
        });

        socket.on('connect', () => {
            hasLoggedSocketFailure = false;
            console.log('Socket connected:', socket?.id);
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected');
        });

        socket.on('connect_error', () => {
            if (!hasLoggedSocketFailure) {
                hasLoggedSocketFailure = true;
                console.warn(`Socket unavailable at ${WS_URL}. Falling back to non-realtime refresh.`);
            }
        });
    }

    return socket;
};

export const disconnectSocket = () => {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
};

export default getSocket;

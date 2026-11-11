import { io } from 'socket.io-client';
import { SERVER_URL } from './config';

export const initSocket = async () => {
    const options = {
        forceNew: true,
        reconnectionAttempts: Infinity,
        timeout: 10000,
        transports: ['websocket'],
    };
    return io(SERVER_URL, options);
};

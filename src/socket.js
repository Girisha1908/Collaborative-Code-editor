import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempt: 'Infinity',
        timeout: 10000,
        transports: ['websocket'],
    };
    // Use localhost:5000 in development, otherwise use the environment variable
    const serverUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
    return io(serverUrl, options);
};

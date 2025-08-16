import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempt: 'Infinity',
        timeout: 10000,
        transports: ['websocket'],
    };
    
    // Simple production detection: if we're on render.com, use same origin
    const isProduction = window.location.hostname.includes('onrender.com');
    const serverUrl = isProduction ? window.location.origin : 'http://localhost:5000';
    
    console.log('Connecting to:', serverUrl);
    return io(serverUrl, options);
};

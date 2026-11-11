// In dev the React app runs on :3000 and the API/WebSocket server on :5000.
// In production the server serves the built app, so everything is same-origin.
const explicit = process.env.REACT_APP_SERVER_URL;
const isCraDevServer = window.location.port === '3000';

export const SERVER_URL =
    explicit || (isCraDevServer ? 'http://localhost:5000' : window.location.origin);

export const WS_URL = SERVER_URL.replace(/^http/, 'ws');

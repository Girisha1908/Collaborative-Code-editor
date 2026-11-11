// Interactive terminal streaming: browser xterm.js <-> WebSocket <-> docker exec (TTY).
//
// Protocol (client -> server, JSON text frames):
//   { "type": "input",  "data": "<keystrokes>" }
//   { "type": "resize", "cols": 120, "rows": 30 }
// Server -> client: raw terminal output as binary frames.
const { WebSocketServer } = require('ws');
const sandbox = require('./sandbox');

const MAX_TERMINALS_PER_ROOM = Number(process.env.MAX_TERMINALS_PER_ROOM || 8);
const terminalsPerRoom = new Map();

function clampDim(n, fallback, max) {
    n = Number(n);
    return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
}

function attachTerminalServer(httpServer) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/ws/terminal') return; // socket.io handles its own path
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, url));
    });

    wss.on('connection', async (ws, url) => {
        const roomId = url.searchParams.get('roomId');
        const cols = clampDim(url.searchParams.get('cols'), 80, 500);
        const rows = clampDim(url.searchParams.get('rows'), 24, 200);

        if (!sandbox.isValidRoomId(roomId)) {
            ws.close(1008, 'Invalid room id');
            return;
        }
        const count = terminalsPerRoom.get(roomId) || 0;
        if (count >= MAX_TERMINALS_PER_ROOM) {
            ws.close(1013, 'Too many terminals in this room');
            return;
        }
        terminalsPerRoom.set(roomId, count + 1);
        sandbox.acquire(roomId);

        let shell = null;
        let closed = false;
        const cleanup = () => {
            if (closed) return;
            closed = true;
            terminalsPerRoom.set(roomId, (terminalsPerRoom.get(roomId) || 1) - 1);
            sandbox.release(roomId);
            if (shell) shell.stream.end();
            if (ws.readyState === ws.OPEN) ws.close();
        };
        ws.on('close', cleanup);
        ws.on('error', cleanup);

        // Buffer keystrokes typed while the container is still starting.
        const queued = [];
        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return;
            }
            if (!shell) {
                queued.push(msg);
                return;
            }
            handle(msg);
        });
        const handle = (msg) => {
            if (msg.type === 'input' && typeof msg.data === 'string') {
                shell.stream.write(msg.data);
            } else if (msg.type === 'resize') {
                shell.resize(clampDim(msg.cols, 80, 500), clampDim(msg.rows, 24, 200));
            }
        };

        try {
            ws.send(Buffer.from('\x1b[2mStarting sandbox…\x1b[0m\r\n'));
            shell = await sandbox.openShell(roomId, cols, rows);
        } catch (err) {
            console.error('[terminal] failed to open shell:', err.message);
            if (ws.readyState === ws.OPEN) {
                ws.send(Buffer.from(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`));
            }
            cleanup();
            return;
        }
        if (closed) {
            shell.stream.end();
            return;
        }

        shell.stream.on('data', (chunk) => {
            if (ws.readyState === ws.OPEN) ws.send(chunk);
        });
        shell.stream.on('end', () => {
            if (ws.readyState === ws.OPEN) {
                ws.send(Buffer.from('\r\n\x1b[2m[shell exited]\x1b[0m\r\n'));
            }
            cleanup();
        });
        queued.splice(0).forEach(handle);
    });

    return wss;
}

module.exports = { attachTerminalServer };

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('../src/Actions');
const { LANGUAGES, DEFAULT_LANGUAGE } = require('../src/languages');
const sandbox = require('./sandbox');
const store = require('./store');
const rag = require('./rag');
const { attachTerminalServer } = require('./terminal');

const PORT = process.env.PORT || 5000;
const SAVE_DEBOUNCE_MS = 2000;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim());

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: CLIENT_ORIGINS, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e6,
});

let dockerReady = false;
app.get('/api/health', (req, res) => {
    res.json({ ok: true, docker: dockerReady });
});
app.get('/api/ai/health', async (req, res) => {
    res.json(await rag.health());
});
app.get('/api/languages', (req, res) => {
    res.json(
        Object.fromEntries(
            Object.entries(LANGUAGES).map(([id, l]) => [id, { label: l.label, file: l.file }])
        )
    );
});

const buildDir = path.join(__dirname, '..', 'build');
app.use(express.static(buildDir));
app.use((req, res) => res.sendFile(path.join(buildDir, 'index.html')));

// ---------------------------------------------------------------------------
// Room state: the server holds the authoritative copy of each open workspace,
// flushes it to PostgreSQL (debounced), and hands it to anyone who joins.
// ---------------------------------------------------------------------------
const rooms = new Map(); // roomId -> { language, code, saveTimer, loading, running }
const usernames = {}; // socketId -> username

async function getRoom(roomId) {
    let room = rooms.get(roomId);
    if (room) return room.loading ? room.loading : room;

    room = { language: DEFAULT_LANGUAGE, code: '', saveTimer: null, running: false };
    room.loading = (async () => {
        try {
            const saved = await store.loadWorkspace(roomId);
            if (saved && LANGUAGES[saved.language]) {
                room.language = saved.language;
                room.code = saved.code;
            } else {
                room.code = LANGUAGES[DEFAULT_LANGUAGE].template;
            }
        } catch (err) {
            console.error('[store] load failed:', err.message);
            room.code = LANGUAGES[DEFAULT_LANGUAGE].template;
        }
        delete room.loading;
        return room;
    })();
    rooms.set(roomId, room);
    return room.loading;
}

async function flush(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.loading) return null;
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
    await store.saveWorkspace(roomId, { language: room.language, code: room.code });
    // Keep the RAG index fresh in the background; the AI being offline must not break saving.
    rag.indexWorkspace(roomId, room.code).catch(() => {});
    return new Date().toISOString();
}

function scheduleSave(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => {
        flush(roomId).catch((err) => console.error('[store] save failed:', err.message));
    }, SAVE_DEBOUNCE_MS);
}

function clientsIn(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map((socketId) => ({
        socketId,
        username: usernames[socketId],
    }));
}

io.on('connection', (socket) => {
    socket.on(ACTIONS.JOIN, async ({ roomId, username } = {}) => {
        if (!sandbox.isValidRoomId(roomId) || !username || socket.data.roomId) return;
        socket.data.roomId = roomId;
        usernames[socket.id] = String(username).slice(0, 40);
        socket.join(roomId);
        sandbox.acquire(roomId);

        const room = await getRoom(roomId);
        socket.emit(ACTIONS.SYNC_CODE, {
            code: room.code,
            language: room.language,
            running: room.running,
        });
        io.to(roomId).emit(ACTIONS.JOINED, {
            clients: clientsIn(roomId),
            username: usernames[socket.id],
            socketId: socket.id,
        });
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ code, changes } = {}) => {
        const roomId = socket.data.roomId;
        const room = rooms.get(roomId);
        if (!room || room.loading || typeof code !== 'string') return;
        room.code = code;
        socket.to(roomId).emit(ACTIONS.CODE_CHANGE, { code, changes });
        scheduleSave(roomId);
    });

    socket.on(ACTIONS.LANGUAGE_CHANGE, ({ language, code } = {}) => {
        const roomId = socket.data.roomId;
        const room = rooms.get(roomId);
        if (!room || room.loading || !LANGUAGES[language]) return;
        room.language = language;
        if (typeof code === 'string') room.code = code;
        socket.to(roomId).emit(ACTIONS.LANGUAGE_CHANGE, {
            language,
            code: room.code,
            username: usernames[socket.id],
        });
        scheduleSave(roomId);
    });

    socket.on(ACTIONS.SAVE, async () => {
        const roomId = socket.data.roomId;
        try {
            const savedAt = await flush(roomId);
            if (savedAt) {
                io.to(roomId).emit(ACTIONS.SAVED, { savedAt, username: usernames[socket.id] });
            }
        } catch (err) {
            socket.emit(ACTIONS.SAVED, { error: 'Could not save workspace' });
            console.error('[store] save failed:', err.message);
        }
    });

    socket.on(ACTIONS.RUN, async () => {
        const roomId = socket.data.roomId;
        const room = rooms.get(roomId);
        if (!room || room.loading) return;
        if (room.running) {
            socket.emit(ACTIONS.RUN_OUTPUT, { stream: 'stderr', data: 'A run is already in progress.\n' });
            return;
        }
        room.running = true;
        io.to(roomId).emit(ACTIONS.RUN_STARTED, {
            language: room.language,
            username: usernames[socket.id],
        });
        const started = Date.now();
        let output = '';
        try {
            const result = await sandbox.runCode(roomId, room.language, room.code, (stream, data) => {
                if (output.length < 4000) output += data; // kept as context for the AI assistant
                io.to(roomId).emit(ACTIONS.RUN_OUTPUT, { stream, data });
            });
            room.lastRun = { exitCode: result.exitCode, output: output.slice(0, 4000) };
            io.to(roomId).emit(ACTIONS.RUN_EXIT, { ...result, durationMs: Date.now() - started });
        } catch (err) {
            io.to(roomId).emit(ACTIONS.RUN_OUTPUT, { stream: 'stderr', data: `${err.message}\n` });
            io.to(roomId).emit(ACTIONS.RUN_EXIT, { exitCode: -1, durationMs: Date.now() - started });
        } finally {
            room.running = false;
        }
    });

    // --- Local RAG assistant: answers stream token-by-token to the asker ---
    socket.on(ACTIONS.AI_ASK, async ({ requestId, question } = {}) => {
        const roomId = socket.data.roomId;
        const room = rooms.get(roomId);
        if (!room || room.loading || typeof question !== 'string' || !question.trim()) return;
        if (socket.data.aiAbort) {
            socket.emit(ACTIONS.AI_DONE, { requestId, error: 'Wait for the current answer to finish.' });
            return;
        }
        const controller = new AbortController();
        socket.data.aiAbort = controller;
        try {
            const { sources } = await rag.ask({
                roomId,
                question: question.slice(0, 2000),
                code: room.code,
                language: LANGUAGES[room.language].label,
                fileName: LANGUAGES[room.language].file,
                lastRun: room.lastRun,
                signal: controller.signal,
                onToken: (token) => socket.emit(ACTIONS.AI_TOKEN, { requestId, token }),
            });
            socket.emit(ACTIONS.AI_DONE, { requestId, sources });
        } catch (err) {
            const aborted = err.name === 'AbortError';
            socket.emit(ACTIONS.AI_DONE, { requestId, error: aborted ? null : err.message, aborted });
        } finally {
            socket.data.aiAbort = null;
        }
    });

    socket.on(ACTIONS.AI_CANCEL, () => socket.data.aiAbort?.abort());

    socket.on('disconnecting', () => {
        socket.data.aiAbort?.abort();
        const roomId = socket.data.roomId;
        if (!roomId) return;
        socket.to(roomId).emit(ACTIONS.DISCONNECTED, {
            socketId: socket.id,
            username: usernames[socket.id],
        });
        sandbox.release(roomId);
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        delete usernames[socket.id];
        if (roomId && !io.sockets.adapter.rooms.get(roomId)) {
            // Last editor left: persist and drop the in-memory copy.
            flush(roomId)
                .catch((err) => console.error('[store] save failed:', err.message))
                .finally(() => {
                    if (!io.sockets.adapter.rooms.get(roomId)) rooms.delete(roomId);
                });
        }
    });
});

attachTerminalServer(server);

async function start() {
    await store.init();
    await rag.init();
    try {
        await sandbox.checkDocker();
        await sandbox.cleanupStale();
        dockerReady = true;
        console.log('[sandbox] Docker engine reachable');
    } catch (err) {
        console.error(`[sandbox] Docker unavailable: ${err.message}`);
        console.error('[sandbox] Editing still works; Run and Terminal will fail until Docker is reachable.');
    }
    server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
}

async function stop() {
    console.log('Shutting down…');
    await Promise.all([...rooms.keys()].map((id) => flush(id).catch(() => {})));
    await sandbox.shutdown().catch(() => {});
    await store.close().catch(() => {});
    process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

start().catch((err) => {
    console.error(err);
    process.exit(1);
});

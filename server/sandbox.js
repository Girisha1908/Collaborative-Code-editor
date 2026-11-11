// Sandbox manager: one isolated Docker container per room, driven through the
// Docker Engine SDK (dockerode). Code runs and terminal shells are both
// `docker exec` sessions inside that container.
const Docker = require('dockerode');
const { PassThrough } = require('stream');
const { LANGUAGES } = require('../src/languages');

const IMAGE = process.env.SANDBOX_IMAGE || 'coco-sandbox:latest';
const RUN_TIMEOUT_SEC = Number(process.env.SANDBOX_RUN_TIMEOUT || 10);
const IDLE_MS = Number(process.env.SANDBOX_IDLE_MS || 5 * 60 * 1000);
const MAX_SANDBOXES = Number(process.env.SANDBOX_MAX || 20);
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const LABEL = 'coco.sandbox';

const docker = new Docker(
    process.env.DOCKER_HOST ? undefined : { socketPath: defaultSocket() }
);

function defaultSocket() {
    return process.platform === 'win32'
        ? '//./pipe/docker_engine'
        : '/var/run/docker.sock';
}

const ROOM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
function isValidRoomId(roomId) {
    return typeof roomId === 'string' && ROOM_ID_RE.test(roomId);
}

function containerName(roomId) {
    return `coco-sandbox-${roomId}`;
}

const pending = new Map(); // roomId -> Promise<Container> (dedupes concurrent creates)
const refs = new Map(); // roomId -> number of active users/terminals
const idleTimers = new Map(); // roomId -> Timeout

async function checkDocker() {
    await docker.ping();
    try {
        await docker.getImage(IMAGE).inspect();
    } catch (err) {
        throw new Error(
            `Sandbox image "${IMAGE}" not found. Build it with: npm run sandbox:build`
        );
    }
}

async function countSandboxes() {
    const list = await docker.listContainers({
        all: true,
        filters: { label: [LABEL] },
    });
    return list.length;
}

async function createContainer(roomId) {
    if ((await countSandboxes()) >= MAX_SANDBOXES) {
        throw new Error('Sandbox capacity reached, try again later.');
    }
    const container = await docker.createContainer({
        name: containerName(roomId),
        Image: IMAGE,
        Labels: { [LABEL]: 'true', 'coco.room': roomId },
        User: '1000:1000',
        WorkingDir: '/workspace',
        Tty: false,
        HostConfig: {
            NetworkMode: 'none', // no network access from user code
            Memory: 512 * 1024 * 1024,
            MemorySwap: 512 * 1024 * 1024,
            NanoCpus: 1_000_000_000, // 1 CPU
            PidsLimit: 256, // fork-bomb protection
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges'],
            ReadonlyRootfs: true,
            Tmpfs: {
                '/workspace': 'rw,exec,size=64m,uid=1000,gid=1000',
                '/tmp': 'rw,exec,size=256m,mode=1777',
                '/home/coder': 'rw,size=16m,uid=1000,gid=1000',
            },
            AutoRemove: false,
        },
    });
    await container.start();
    return container;
}

async function getOrCreate(roomId) {
    const name = containerName(roomId);
    const container = docker.getContainer(name);
    try {
        const info = await container.inspect();
        if (!info.State.Running) await container.start();
        return container;
    } catch (err) {
        if (err.statusCode !== 404) throw err;
        return createContainer(roomId);
    }
}

/** Returns the room's running sandbox container, creating it if needed. */
function getSandbox(roomId) {
    if (!isValidRoomId(roomId)) {
        return Promise.reject(new Error('Invalid room id'));
    }
    if (!pending.has(roomId)) {
        const p = getOrCreate(roomId).finally(() => pending.delete(roomId));
        pending.set(roomId, p);
    }
    return pending.get(roomId);
}

async function destroySandbox(roomId) {
    try {
        await docker.getContainer(containerName(roomId)).remove({ force: true });
        console.log(`[sandbox] removed ${containerName(roomId)}`);
    } catch (err) {
        if (err.statusCode !== 404) console.error('[sandbox] remove failed', err.message);
    }
}

/** Reference counting: the sandbox is torn down IDLE_MS after its last user leaves. */
function acquire(roomId) {
    refs.set(roomId, (refs.get(roomId) || 0) + 1);
    clearTimeout(idleTimers.get(roomId));
    idleTimers.delete(roomId);
}

function release(roomId) {
    const n = (refs.get(roomId) || 1) - 1;
    if (n > 0) {
        refs.set(roomId, n);
        return;
    }
    refs.delete(roomId);
    idleTimers.set(
        roomId,
        setTimeout(() => {
            idleTimers.delete(roomId);
            if (!refs.has(roomId)) destroySandbox(roomId);
        }, IDLE_MS)
    );
}

/**
 * Writes `code` to the language's file and runs it with a hard timeout.
 * onOutput(stream: 'stdout'|'stderr', chunk: string) is called as output arrives.
 * Resolves with { exitCode, timedOut, truncated }.
 */
async function runCode(roomId, language, code, onOutput) {
    const lang = LANGUAGES[language];
    if (!lang) throw new Error(`Unsupported language: ${language}`);
    if (Buffer.byteLength(code || '', 'utf8') > MAX_SOURCE_BYTES) {
        throw new Error('Source file too large');
    }

    const container = await getSandbox(roomId);
    // The source travels as an env var, so no shell quoting of user code is needed.
    const script = `printf '%s' "$COCO_SRC" > ${lang.file} && unset COCO_SRC && ${lang.run}`;
    const exec = await container.exec({
        Cmd: ['timeout', '-s', 'KILL', `${RUN_TIMEOUT_SEC}s`, 'bash', '-c', script],
        Env: [`COCO_SRC=${code || ''}`],
        WorkingDir: '/workspace',
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });

    let bytes = 0;
    let truncated = false;
    const forward = (name) => {
        const pt = new PassThrough();
        pt.on('data', (chunk) => {
            if (truncated) return;
            bytes += chunk.length;
            if (bytes > MAX_OUTPUT_BYTES) {
                truncated = true;
                onOutput('stderr', '\n[output truncated]\n');
                stream.destroy();
                return;
            }
            onOutput(name, chunk.toString('utf8'));
        });
        return pt;
    };
    container.modem.demuxStream(stream, forward('stdout'), forward('stderr'));

    await new Promise((resolve) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
        stream.on('error', resolve);
    });

    const { ExitCode } = await exec.inspect();
    // `timeout -s KILL` makes the child exit with 137.
    return { exitCode: ExitCode, timedOut: ExitCode === 137, truncated };
}

/**
 * Opens an interactive bash shell (TTY) in the room's sandbox.
 * Returns { stream, resize(cols, rows) } — stream is a duplex socket.
 */
async function openShell(roomId, cols = 80, rows = 24) {
    const container = await getSandbox(roomId);
    const exec = await container.exec({
        Cmd: ['bash'],
        Env: ['TERM=xterm-256color'],
        WorkingDir: '/workspace',
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        ConsoleSize: [rows, cols],
    });
    const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
    const resize = (c, r) =>
        exec.resize({ w: c, h: r }).catch(() => {
            /* exec may have exited */
        });
    return { stream, resize };
}

/** Remove sandboxes left over from a previous server process. */
async function cleanupStale() {
    const list = await docker.listContainers({
        all: true,
        filters: { label: [LABEL] },
    });
    await Promise.all(
        list.map((c) => docker.getContainer(c.Id).remove({ force: true }).catch(() => {}))
    );
    if (list.length) console.log(`[sandbox] cleaned up ${list.length} stale container(s)`);
}

async function shutdown() {
    const rooms = [...new Set([...refs.keys(), ...idleTimers.keys()])];
    idleTimers.forEach(clearTimeout);
    await cleanupStale();
    return rooms.length;
}

module.exports = {
    isValidRoomId,
    checkDocker,
    getSandbox,
    destroySandbox,
    acquire,
    release,
    runCode,
    openShell,
    cleanupStale,
    shutdown,
};

// Local RAG assistant: code chunks are embedded by a llama.cpp embedding server,
// stored in PostgreSQL/pgvector, retrieved by cosine similarity, and answered by a
// llama.cpp chat server whose tokens are streamed back in real time.
//
// Talks to the OpenAI-compatible API exposed by Ollama (default, which runs llama.cpp
// under the hood) or by llama.cpp's own `llama-server` — just change the URLs/models.
const crypto = require('crypto');
const store = require('./store');

const LLM_URL = (process.env.LLM_URL || 'http://localhost:11434').replace(/\/$/, '');
const EMBED_URL = (process.env.EMBED_URL || process.env.LLM_URL || 'http://localhost:11434').replace(/\/$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5-coder:3b';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const TOP_K = Number(process.env.RAG_TOP_K || 4);
const CHUNK_LINES = 40;
const CHUNK_OVERLAP = 10;
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 512);

let pgvector = false; // true once the pgvector table is ready
const memoryIndex = new Map(); // roomId -> [{ startLine, endLine, content, embedding }]
const indexedHash = new Map(); // roomId -> hash of the code that was last indexed

async function init() {
    const pool = store.getPool();
    if (!pool) return;
    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS code_chunks (
                room_id     TEXT NOT NULL,
                chunk_idx   INT  NOT NULL,
                start_line  INT  NOT NULL,
                end_line    INT  NOT NULL,
                content     TEXT NOT NULL,
                embedding   vector NOT NULL,
                PRIMARY KEY (room_id, chunk_idx)
            )`);
        pgvector = true;
        console.log('[rag] pgvector ready');
    } catch (err) {
        console.warn(`[rag] pgvector unavailable (${err.message}) — using in-memory vectors`);
    }
}

/** Split source into overlapping line windows, keeping line numbers for citations. */
function chunkCode(code) {
    const lines = code.split('\n');
    const chunks = [];
    const step = CHUNK_LINES - CHUNK_OVERLAP;
    for (let start = 0; start < lines.length; start += step) {
        const slice = lines.slice(start, start + CHUNK_LINES);
        if (slice.join('').trim()) {
            chunks.push({
                startLine: start + 1,
                endLine: start + slice.length,
                content: slice.join('\n'),
            });
        }
        if (start + CHUNK_LINES >= lines.length) break;
    }
    return chunks;
}

async function embed(texts) {
    const res = await fetch(`${EMBED_URL}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts, model: EMBED_MODEL }),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`embedding server returned ${res.status}`);
    const json = await res.json();
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

const toVector = (arr) => `[${arr.join(',')}]`;

function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na * nb) || 1);
}

/** (Re)index a workspace. Cheap no-op when the code hasn't changed since last time. */
async function indexWorkspace(roomId, code) {
    const hash = crypto.createHash('sha1').update(code || '').digest('hex');
    if (indexedHash.get(roomId) === hash) return;

    const chunks = chunkCode(code || '');
    const vectors = chunks.length ? await embed(chunks.map((c) => c.content)) : [];

    if (pgvector) {
        const client = await store.getPool().connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM code_chunks WHERE room_id = $1', [roomId]);
            for (let i = 0; i < chunks.length; i++) {
                const c = chunks[i];
                await client.query(
                    `INSERT INTO code_chunks (room_id, chunk_idx, start_line, end_line, content, embedding)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [roomId, i, c.startLine, c.endLine, c.content, toVector(vectors[i])]
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    } else {
        memoryIndex.set(roomId, chunks.map((c, i) => ({ ...c, embedding: vectors[i] })));
    }
    indexedHash.set(roomId, hash);
}

async function retrieve(roomId, question) {
    const [q] = await embed([question]);
    if (pgvector) {
        const { rows } = await store.getPool().query(
            `SELECT start_line, end_line, content, 1 - (embedding <=> $2) AS score
             FROM code_chunks WHERE room_id = $1
             ORDER BY embedding <=> $2 LIMIT $3`,
            [roomId, toVector(q), TOP_K]
        );
        return rows.map((r) => ({
            startLine: r.start_line,
            endLine: r.end_line,
            content: r.content,
            score: Number(r.score),
        }));
    }
    return (memoryIndex.get(roomId) || [])
        .map((c) => ({ ...c, score: cosine(q, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K)
        .map(({ embedding, ...rest }) => rest);
}

function buildPrompt({ question, fileName, language, chunks, lastRun }) {
    const context = chunks
        .map((c) => `--- ${fileName} lines ${c.startLine}-${c.endLine} ---\n${c.content}`)
        .join('\n\n');
    const run = lastRun
        ? `\n\nLast sandbox run (exit code ${lastRun.exitCode}):\n${lastRun.output}`
        : '\n\nThe code has not been run yet in this session.';
    return [
        {
            role: 'system',
            content:
                "You are Coco, a concise coding assistant inside a collaborative IDE. Answer using the " +
                'provided code context and run output. Cite line numbers when relevant. If the context ' +
                "doesn't contain the answer, say so.",
        },
        {
            role: 'user',
            content: `Language: ${language}\n\nRelevant code:\n${context || '(empty workspace)'}${run}\n\nQuestion: ${question}`,
        },
    ];
}

/**
 * Answer a question about a room's workspace, streaming tokens via onToken.
 * Returns { sources } (line ranges used as context). Abort with `signal`.
 */
async function ask({ roomId, question, code, language, fileName, lastRun, onToken, signal }) {
    let chunks;
    try {
        await indexWorkspace(roomId, code);
        chunks = await retrieve(roomId, question);
    } catch (err) {
        // Embedding server down: degrade to plain context (head of the file).
        console.warn('[rag] retrieval failed, using whole-file context:', err.message);
        const lines = (code || '').split('\n').slice(0, 200);
        chunks = [{ startLine: 1, endLine: lines.length, content: lines.join('\n'), score: null }];
    }

    const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: LLM_MODEL,
            messages: buildPrompt({ question, fileName, language, chunks, lastRun }),
            stream: true,
            max_tokens: MAX_TOKENS,
            temperature: 0.2,
        }),
        signal,
    }).catch((err) => {
        if (err.name === 'AbortError') throw err;
        throw new Error(`Local LLM not reachable at ${LLM_URL} — is Ollama running?`);
    });
    if (!res.ok) throw new Error(`LLM server returned ${res.status}`);

    // Parse the Server-Sent Events stream and forward each token as it arrives.
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return { sources: chunks.map(({ content, ...s }) => s) };
            try {
                const token = JSON.parse(data).choices?.[0]?.delta?.content;
                if (token) onToken(token);
            } catch {
                /* ignore keep-alives / partial frames */
            }
        }
    }
    return { sources: chunks.map(({ content, ...s }) => s) };
}

async function health() {
    const ping = (url) =>
        fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(2000) })
            .then((r) => r.ok)
            .catch(() => false);
    const [llm, embedder] = await Promise.all([ping(LLM_URL), ping(EMBED_URL)]);
    return { llm, embedder, pgvector, llmModel: LLM_MODEL, embedModel: EMBED_MODEL };
}

function forget(roomId) {
    memoryIndex.delete(roomId);
    indexedHash.delete(roomId);
}

module.exports = { init, ask, indexWorkspace, health, forget, chunkCode };

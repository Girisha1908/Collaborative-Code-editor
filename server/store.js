// Workspace persistence. Uses PostgreSQL when DATABASE_URL is set, otherwise an
// in-memory map (handy for local hacking without a database).
const fs = require('fs');
const path = require('path');
const { DEFAULT_LANGUAGE } = require('../src/languages');

let pool = null;
const memory = new Map();

async function init() {
    if (!process.env.DATABASE_URL) {
        console.warn('[store] DATABASE_URL not set — workspaces are kept in memory only');
        return;
    }
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
        max: 10,
    });
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('[store] connected to PostgreSQL');
}

/** Returns { language, code, updatedAt } or null. */
async function loadWorkspace(roomId) {
    if (!pool) return memory.get(roomId) || null;
    const { rows } = await pool.query(
        'SELECT language, code, updated_at FROM workspaces WHERE room_id = $1',
        [roomId]
    );
    if (!rows.length) return null;
    return { language: rows[0].language, code: rows[0].code, updatedAt: rows[0].updated_at };
}

async function saveWorkspace(roomId, { language = DEFAULT_LANGUAGE, code = '' }) {
    if (!pool) {
        memory.set(roomId, { language, code, updatedAt: new Date() });
        return;
    }
    await pool.query(
        `INSERT INTO workspaces (room_id, language, code)
         VALUES ($1, $2, $3)
         ON CONFLICT (room_id)
         DO UPDATE SET language = EXCLUDED.language, code = EXCLUDED.code, updated_at = now()`,
        [roomId, language, code]
    );
}

async function close() {
    if (pool) await pool.end();
}

const getPool = () => pool;

module.exports = { init, loadWorkspace, saveWorkspace, close, getPool };

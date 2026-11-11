CREATE TABLE IF NOT EXISTS workspaces (
    room_id     TEXT PRIMARY KEY,
    language    TEXT NOT NULL DEFAULT 'python',
    code        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

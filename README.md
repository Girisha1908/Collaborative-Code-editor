# CocoIDE: Collaborative Cloud IDE with Local AI

A containerized, browser-based cloud IDE with a local RAG coding assistant. Each room gets an isolated Docker sandbox. People edit together in the Monaco Editor, run multi-language code in the sandbox, and use live terminal shells streamed over WebSockets. Workspaces are saved in PostgreSQL, and a local LLM answers questions about the code with tokens streamed live.

## Highlights

- **Isolated Docker sandboxes per room.** The server creates and manages containers through the Docker Engine SDK ([dockerode](https://github.com/apocas/dockerode)). Each sandbox has:
  - no network
  - a read-only root filesystem with tmpfs `/workspace`
  - a non-root user and all capabilities dropped
  - `no-new-privileges`
  - limits of 512 MB memory, 1 CPU and 256 PIDs
  - a hard time limit on every run
- **Multi-language runs.** Supported languages are Python, JavaScript (Node), C, C++, Java, Go and Bash. Output (stdout and stderr) streams live to everyone in the room.
- **Interactive terminals.** xterm.js connects over a WebSocket (`/ws/terminal`) to a TTY `docker exec` bash shell inside the room's container. Terminals resize with the browser window.
- **Monaco Editor.** This is the VS Code editor, with real-time collaboration through Socket.IO edit deltas plus self-healing full-document sync.
- **PostgreSQL workspaces.** The server keeps the authoritative copy of every open room and saves it to Postgres (debounced, on <kbd>Ctrl+S</kbd>, and when the last member leaves). Reopening a room restores its code and language.
- **Local RAG assistant.** Code is split into overlapping 40-line chunks, embedded with `nomic-embed-text` and stored in **pgvector**. For each question, the top-k chunks (by cosine similarity) plus the last run's output go to a local model (Ollama, which runs llama.cpp under the hood). Tokens stream to the browser over Socket.IO as they are generated, and the user can stop them. Nothing leaves the machine. If the embedding model is unavailable, it falls back to sending the start of the file as context.
- **Lifecycle management.** A sandbox starts lazily and is removed after it has been idle (`SANDBOX_IDLE_MS`). Leftover containers are cleaned up when the server starts and stops.

## Architecture

```
Browser (React)                         Node server                          Docker Engine
┌───────────────────┐  Socket.IO   ┌─────────────────────────┐  dockerode  ┌──────────────────────────┐
│ Monaco Editor     │◄────────────►│ rooms: code + language  │────────────►│ coco-sandbox-<roomId>    │
│ Output panel      │  edits/run   │ run → docker exec       │   exec      │  python, node, gcc, g++, │
│ xterm.js terminal │◄────────────►│ /ws/terminal ↔ TTY exec │◄───────────►│  java, go, bash          │
└───────────────────┘  WebSocket   └───────────┬─────────────┘             │  --network none, tmpfs   │
                                               │ pg                        └──────────────────────────┘
                                         ┌─────▼──────┐   embed / chat (SSE)   ┌──────────────────────┐
                                         │ PostgreSQL │◄──── server/rag.js ───►│ Ollama (llama.cpp)   │
                                         │ + pgvector │                        │ qwen2.5-coder · nomic │
                                         └────────────┘                        └──────────────────────┘
   workspaces(room_id, language, code) · code_chunks(room_id, lines, content, embedding vector)
```

| Path | Purpose |
| --- | --- |
| `server/index.js` | Express, Socket.IO rooms, run orchestration, save scheduling |
| `server/sandbox.js` | Docker Engine SDK: create, harden, exec, run and tear down sandboxes |
| `server/terminal.js` | WebSocket ↔ `docker exec` TTY bridge for xterm.js |
| `server/rag.js` | RAG: chunking, embeddings, pgvector search, streaming chat completions |
| `src/components/AiPanel.js` | AI chat panel with live token streaming |
| `server/store.js` | PostgreSQL workspace persistence (falls back to memory without `DATABASE_URL`) |
| `sandbox/Dockerfile` | Multi-language sandbox image |
| `src/languages.js` | Language registry shared by client and server |
| `src/components/Editor.js` | Monaco Editor with collaborative deltas |
| `src/components/Terminal.js` | xterm.js terminal client |

## Running locally

Prerequisites: Node 18 or later, Docker (Docker Desktop on Windows or macOS) and, for the AI assistant, [Ollama](https://ollama.com).

```bash
npm install
npm run sandbox:build        # builds coco-sandbox:latest (one-time, a few minutes)
docker compose up -d db      # PostgreSQL on localhost:5432 (set DB_PORT=5433 if 5432 is taken)
ollama pull qwen2.5-coder:3b     # chat model (~2 GB; use :7b with a GPU)
ollama pull nomic-embed-text     # embedding model (~270 MB)
cp .env.example .env         # adjust DATABASE_URL if you changed the port
```

Then, in two terminals:

```bash
DATABASE_URL=postgres://coco:coco@localhost:5432/coco npm run server:dev   # API + WebSockets on :5000
npm run start:front                                                         # React dev server on :3000
```

Open http://localhost:3000, create a room, and share the Room ID.

For a production-style run, `npm start` builds the React app and serves everything from `:5000`.

## Running everything in Docker

```bash
docker compose --profile build build   # builds the sandbox image and the app image
docker compose up -d                   # app on http://localhost:5000 + PostgreSQL + Ollama
docker compose exec ollama ollama pull qwen2.5-coder:3b
docker compose exec ollama ollama pull nomic-embed-text
```

The app container mounts `/var/run/docker.sock` so it can create sibling sandbox containers.

> **Security note:** access to the Docker socket is root-equivalent on the host. Run this on a dedicated VM or host, and put authentication in front of it before exposing it publicly. Managed platforms without Docker socket access (such as Render's free tier) can host the editor, but Run and Terminal won't work there.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5000` | HTTP/WebSocket port |
| `DATABASE_URL` | – | PostgreSQL connection string (in-memory if unset) |
| `PGSSL` | `false` | Set `true` for managed Postgres that requires SSL |
| `CLIENT_ORIGIN` | `http://localhost:3000` | Allowed CORS origin(s), comma-separated |
| `SANDBOX_IMAGE` | `coco-sandbox:latest` | Image used for sandboxes |
| `SANDBOX_RUN_TIMEOUT` | `10` | Seconds before a run is killed |
| `SANDBOX_IDLE_MS` | `300000` | Remove a room's container this long after its last user leaves |
| `SANDBOX_MAX` | `20` | Maximum concurrent sandboxes |
| `MAX_TERMINALS_PER_ROOM` | `8` | Terminal sessions allowed per room |
| `LLM_URL` | `http://localhost:11434` | OpenAI-compatible chat server (Ollama or llama.cpp `llama-server`) |
| `LLM_MODEL` | `qwen2.5-coder:3b` | Chat model name |
| `EMBED_URL` | `LLM_URL` | OpenAI-compatible embeddings server |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model name |
| `RAG_TOP_K` | `4` | Code chunks retrieved per question |
| `LLM_MAX_TOKENS` | `512` | Maximum answer length |

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> | Run the current file in the sandbox |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> | Save the workspace to PostgreSQL |

## Tech stack

**Frontend:** React 17, Monaco Editor (`@monaco-editor/react`), xterm.js (`@xterm/xterm` + fit addon), Socket.IO client, React Router, React Hot Toast

**Backend:** Node.js, Express, Socket.IO, `ws`, Docker Engine SDK (`dockerode`), PostgreSQL (`pg`) + pgvector

**AI:** Ollama / llama.cpp (Qwen2.5-Coder, nomic-embed-text), retrieval-augmented generation, streaming over SSE → Socket.IO

**Infrastructure:** Docker and Docker Compose, Debian-based multi-language sandbox image

## Future enhancements

- CRDT-based editing (Yjs) for conflict-free concurrent edits and shared cursors
- Multi-file workspaces with a file tree, synced into the sandbox
- Authentication and per-user workspace ownership
- gVisor or Firecracker runtime for stronger sandbox isolation
- WebRTC voice and video during sessions

---

Made by [girisha1908](https://github.com/girisha1908)

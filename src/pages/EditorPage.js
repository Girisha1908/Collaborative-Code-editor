import React, { useState, useRef, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import ACTIONS from '../Actions';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../languages';
import Client from '../components/Client';
import Editor from '../components/Editor';
import Terminal from '../components/Terminal';
import OutputPanel from '../components/OutputPanel';
import AiPanel from '../components/AiPanel';
import { initSocket } from '../socket';
import { useLocation, useNavigate, Navigate, useParams } from 'react-router-dom';

const MAX_OUTPUT_ENTRIES = 2000;

const EditorPage = () => {
    const socketRef = useRef(null);
    const editorRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const reactNavigator = useNavigate();
    const username = location.state?.username;

    const [clients, setClients] = useState([]);
    const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
    const [running, setRunning] = useState(false);
    const [output, setOutput] = useState([]);
    const [panel, setPanel] = useState('output');
    const [savedAt, setSavedAt] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [socketState, setSocketState] = useState(null);

    const appendOutput = useCallback((entry) => {
        setOutput((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_OUTPUT_ENTRIES ? next.slice(-MAX_OUTPUT_ENTRIES) : next;
        });
    }, []);

    useEffect(() => {
        if (!username) return undefined;
        let socket;
        const init = async () => {
            socket = await initSocket();
            socketRef.current = socket;
            setSocketState(socket);

            const handleErrors = (e) => {
                console.log('socket error', e);
                toast.error('Connection failed, try again later.');
                reactNavigator('/');
            };
            socket.on('connect_error', handleErrors);
            socket.on('connect_failed', handleErrors);

            socket.emit(ACTIONS.JOIN, { roomId, username });

            socket.on(ACTIONS.SYNC_CODE, ({ code, language, running }) => {
                setLanguage(language);
                setRunning(Boolean(running));
                editorRef.current?.setValue(code);
            });

            socket.on(ACTIONS.JOINED, ({ clients, username: joined, socketId }) => {
                if (socketId !== socket.id) toast.success(`${joined} joined the room!`);
                setClients(clients);
            });

            socket.on(ACTIONS.DISCONNECTED, ({ socketId, username: left }) => {
                toast.success(`👋 ${left} returned to Earth.`);
                setClients((prev) => prev.filter((c) => c.socketId !== socketId));
            });

            socket.on(ACTIONS.CODE_CHANGE, ({ code, changes }) => {
                editorRef.current?.applyRemote(changes, code);
                setDirty(true);
            });

            socket.on(ACTIONS.LANGUAGE_CHANGE, ({ language, code, username: by }) => {
                setLanguage(language);
                editorRef.current?.setValue(code);
                toast.success(`${by} switched to ${LANGUAGES[language].label}`);
            });

            socket.on(ACTIONS.SAVED, ({ savedAt, error, username: by }) => {
                if (error) {
                    toast.error(error);
                    return;
                }
                if (by === username) toast.success('Workspace saved to PostgreSQL');
                setSavedAt(savedAt);
                setDirty(false);
            });

            socket.on(ACTIONS.RUN_STARTED, ({ language, username: by }) => {
                setRunning(true);
                setPanel('output');
                setOutput([
                    {
                        stream: 'meta',
                        data: `▶ ${by} is running ${LANGUAGES[language].file} (${LANGUAGES[language].label}) in a Docker sandbox…\n\n`,
                    },
                ]);
            });

            socket.on(ACTIONS.RUN_OUTPUT, appendOutput);

            socket.on(ACTIONS.RUN_EXIT, ({ exitCode, timedOut, durationMs }) => {
                setRunning(false);
                const msg = timedOut
                    ? `\n■ Killed: time limit exceeded (${durationMs} ms)\n`
                    : `\n■ Process exited with code ${exitCode} in ${durationMs} ms\n`;
                appendOutput({ stream: exitCode === 0 ? 'meta' : 'stderr', data: msg });
            });
        };
        init();
        return () => {
            socket?.removeAllListeners();
            socket?.disconnect();
        };
    }, [roomId, username, reactNavigator, appendOutput]);

    const handleLocalChange = useCallback((code, changes) => {
        setDirty(true);
        socketRef.current?.emit(ACTIONS.CODE_CHANGE, { code, changes });
    }, []);

    const runCode = useCallback(() => {
        if (running) return;
        socketRef.current?.emit(ACTIONS.RUN);
    }, [running]);

    const saveWorkspace = useCallback(() => {
        socketRef.current?.emit(ACTIONS.SAVE);
    }, []);

    function changeLanguage(e) {
        const next = e.target.value;
        const current = editorRef.current?.getValue() ?? '';
        // Swap in the starter template if the buffer is empty or still the old template.
        const useTemplate = !current.trim() || current === LANGUAGES[language].template;
        const code = useTemplate ? LANGUAGES[next].template : current;
        setLanguage(next);
        if (useTemplate) editorRef.current?.setValue(code);
        socketRef.current?.emit(ACTIONS.LANGUAGE_CHANGE, { language: next, code });
    }

    async function copyRoomId() {
        try {
            await navigator.clipboard.writeText(roomId);
            toast.success('Room ID copied to clipboard!');
        } catch (err) {
            toast.error('Could not copy the Room ID');
            console.error(err);
        }
    }

    if (!username) {
        return <Navigate to="/" />;
    }

    const saveLabel = dirty
        ? 'Unsaved changes'
        : savedAt
        ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
        : 'Saved';

    return (
        <div className="mainWrap">
            <div className="aside">
                <div className="asideInner">
                    <div className="logo">
                        <h2 className="brandTitle">Coco's Playground</h2>
                        <p className="brandSub">Cloud IDE</p>
                    </div>
                    <h3 className="asideHeading">Connected Members</h3>
                    <div className="clientsList">
                        {clients.map((client) => (
                            <Client key={client.socketId} username={client.username} />
                        ))}
                    </div>
                </div>
                <button className="btn copyBtn" onClick={copyRoomId}>
                    Copy Room ID
                </button>
                <button className="btn leaveBtn" onClick={() => reactNavigator('/')}>
                    Leave
                </button>
            </div>

            <div className="editorWrap">
                <div className="toolbar">
                    <select
                        className="langSelect"
                        value={language}
                        onChange={changeLanguage}
                        aria-label="Language"
                    >
                        {Object.entries(LANGUAGES).map(([id, l]) => (
                            <option key={id} value={id}>
                                {l.label}
                            </option>
                        ))}
                    </select>
                    <span className="fileName">{LANGUAGES[language].file}</span>
                    <span className={`saveState ${dirty ? 'isDirty' : ''}`}>{saveLabel}</span>
                    <div className="toolbarSpacer" />
                    <button className="btn toolBtn" onClick={saveWorkspace} title="Ctrl+S">
                        Save
                    </button>
                    <button
                        className="btn runBtn"
                        onClick={runCode}
                        disabled={running}
                        title="Ctrl+Enter"
                    >
                        {running ? 'Running…' : '▶ Run'}
                    </button>
                </div>

                <div className="editorArea">
                    <Editor
                        ref={editorRef}
                        language={LANGUAGES[language].monaco}
                        onLocalChange={handleLocalChange}
                        onRun={runCode}
                        onSave={saveWorkspace}
                    />
                </div>

                <div className="bottomPanel">
                    <div className="panelTabs">
                        <button
                            className={`panelTab ${panel === 'output' ? 'active' : ''}`}
                            onClick={() => setPanel('output')}
                        >
                            Output
                        </button>
                        <button
                            className={`panelTab ${panel === 'terminal' ? 'active' : ''}`}
                            onClick={() => setPanel('terminal')}
                        >
                            Terminal
                        </button>
                        <button
                            className={`panelTab ${panel === 'ai' ? 'active' : ''}`}
                            onClick={() => setPanel('ai')}
                        >
                            ✦ AI
                        </button>
                        <div className="toolbarSpacer" />
                        {panel === 'output' && (
                            <button className="panelTab" onClick={() => setOutput([])}>
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="panelBody" style={{ display: panel === 'output' ? 'block' : 'none' }}>
                        <OutputPanel entries={output} />
                    </div>
                    <div className="panelBody" style={{ display: panel === 'terminal' ? 'block' : 'none' }}>
                        <Terminal roomId={roomId} visible={panel === 'terminal'} />
                    </div>
                    <div className="panelBody" style={{ display: panel === 'ai' ? 'block' : 'none' }}>
                        <AiPanel socket={socketState} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EditorPage;

import React, { useEffect, useRef, useState } from 'react';
import ACTIONS from '../Actions';

// Chat with the local RAG assistant. Tokens stream in over Socket.IO as the
// local model (Ollama / llama.cpp) generates them.
const SUGGESTIONS = ['Explain this code', 'Why did my last run fail?', 'How can I optimize this?'];

const AiPanel = ({ socket }) => {
    const [messages, setMessages] = useState([]); // { role, text, sources?, error?, pending? }
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const requestRef = useRef(null);
    const endRef = useRef(null);

    useEffect(() => {
        if (!socket) return undefined;
        const updateLast = (fn) =>
            setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = fn(next[next.length - 1]);
                return next;
            });

        const onToken = ({ requestId, token }) => {
            if (requestId !== requestRef.current) return;
            updateLast((m) => ({ ...m, text: m.text + token }));
        };
        const onDone = ({ requestId, sources, error, aborted }) => {
            if (requestId !== requestRef.current) return;
            requestRef.current = null;
            setBusy(false);
            updateLast((m) => ({
                ...m,
                pending: false,
                sources,
                error,
                text: m.text || (aborted ? '(stopped)' : ''),
            }));
        };
        socket.on(ACTIONS.AI_TOKEN, onToken);
        socket.on(ACTIONS.AI_DONE, onDone);
        return () => {
            socket.off(ACTIONS.AI_TOKEN, onToken);
            socket.off(ACTIONS.AI_DONE, onDone);
        };
    }, [socket]);

    useEffect(() => {
        // Scroll only this panel (scrollIntoView would also scroll the page).
        const el = endRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);

    function ask(question) {
        question = question.trim();
        if (!question || busy || !socket) return;
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        requestRef.current = requestId;
        setBusy(true);
        setInput('');
        setMessages((prev) => [
            ...prev,
            { role: 'user', text: question },
            { role: 'assistant', text: '', pending: true },
        ]);
        socket.emit(ACTIONS.AI_ASK, { requestId, question });
    }

    return (
        <div className="aiPane">
            <div ref={endRef} className="aiMessages">
                {messages.length === 0 && (
                    <div className="aiEmpty">
                        <span className="outputMeta">
                            Ask Coco about this workspace. Answers come from a local model, grounded in your code
                            (retrieved from pgvector) and the last run's output.
                        </span>
                        <div className="aiSuggestions">
                            {SUGGESTIONS.map((s) => (
                                <button key={s} className="aiChip" onClick={() => ask(s)}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((m, i) => (
                    <div key={i} className={`aiMsg aiMsg-${m.role}`}>
                        <div className="aiRole">{m.role === 'user' ? 'You' : 'Coco AI'}</div>
                        <div className="aiText">
                            {m.text}
                            {m.pending && <span className="aiCursor">▍</span>}
                        </div>
                        {m.error && <div className="output-stderr">⚠ {m.error}</div>}
                        {m.sources?.length > 0 && (
                            <div className="aiSources">
                                Context:{' '}
                                {m.sources.map((s) => `L${s.startLine}–${s.endLine}`).join(', ')}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <form
                className="aiInputRow"
                onSubmit={(e) => {
                    e.preventDefault();
                    ask(input);
                }}
            >
                <input
                    className="aiInput"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about your code…"
                    aria-label="Ask the AI assistant"
                />
                {busy ? (
                    <button type="button" className="btn toolBtn" onClick={() => socket.emit(ACTIONS.AI_CANCEL)}>
                        Stop
                    </button>
                ) : (
                    <button type="submit" className="btn runBtn" disabled={!input.trim()}>
                        Ask
                    </button>
                )}
            </form>
        </div>
    );
};

export default AiPanel;

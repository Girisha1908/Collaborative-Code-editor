import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { WS_URL } from '../config';

// Interactive shell inside the room's Docker sandbox, streamed over a WebSocket.
const Terminal = ({ roomId, visible }) => {
    const containerRef = useRef(null);
    const termRef = useRef(null);
    const fitRef = useRef(null);
    const wsRef = useRef(null);
    const [status, setStatus] = useState('connecting');

    const send = (msg) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const connect = useCallback(() => {
        const term = termRef.current;
        if (!term) return;
        wsRef.current?.close();
        setStatus('connecting');

        const url = `${WS_URL}/ws/terminal?roomId=${encodeURIComponent(roomId)}&cols=${term.cols}&rows=${term.rows}`;
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => setStatus('connected');
        ws.onmessage = (e) => {
            term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
        };
        ws.onclose = (e) => {
            if (wsRef.current !== ws) return;
            setStatus('closed');
            term.write(`\r\n\x1b[2m[disconnected${e.reason ? `: ${e.reason}` : ''}]\x1b[0m\r\n`);
        };
    }, [roomId]);

    useEffect(() => {
        const term = new XTerm({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            theme: {
                background: '#07071a',
                foreground: '#e6e0ff',
                cursor: '#c77dff',
                selectionBackground: '#3c096c',
                magenta: '#c77dff',
                brightMagenta: '#e0aaff',
            },
            scrollback: 5000,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(containerRef.current);
        termRef.current = term;
        fitRef.current = fit;
        try {
            fit.fit();
        } catch {
            /* container may be hidden */
        }

        const dataSub = term.onData((data) => send({ type: 'input', data }));
        const resizeSub = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));

        const observer = new ResizeObserver(() => {
            if (containerRef.current?.offsetParent !== null) {
                try {
                    fit.fit();
                } catch {
                    /* ignore */
                }
            }
        });
        observer.observe(containerRef.current);

        connect();

        return () => {
            observer.disconnect();
            dataSub.dispose();
            resizeSub.dispose();
            const ws = wsRef.current;
            wsRef.current = null;
            ws?.close();
            term.dispose();
        };
    }, [connect]);

    useEffect(() => {
        if (visible && fitRef.current) {
            requestAnimationFrame(() => {
                try {
                    fitRef.current.fit();
                } catch {
                    /* ignore */
                }
                termRef.current?.focus();
            });
        }
    }, [visible]);

    return (
        <div className="terminalPane">
            {status === 'closed' && (
                <button className="reconnectBtn" onClick={connect}>
                    Reconnect
                </button>
            )}
            <div ref={containerRef} className="terminalHost" />
        </div>
    );
};

export default Terminal;

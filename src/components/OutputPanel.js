import React, { useEffect, useRef } from 'react';

// Shows the streamed stdout/stderr of the latest sandbox run (shared by the whole room).
const OutputPanel = ({ entries }) => {
    const endRef = useRef(null);

    useEffect(() => {
        // Scroll only this panel (scrollIntoView would also scroll the page).
        const el = endRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [entries]);

    return (
        <pre ref={endRef} className="outputPane">
            {entries.length === 0 && (
                <span className="outputMeta">Press Run (Ctrl+Enter) to execute the code in an isolated Docker sandbox.</span>
            )}
            {entries.map((e, i) => (
                <span key={i} className={`output-${e.stream}`}>
                    {e.data}
                </span>
            ))}
        </pre>
    );
};

export default OutputPanel;

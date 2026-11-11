import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';

// Monaco-based collaborative editor.
// Local edits are reported through `onLocalChange(code, changes)`; remote edits
// are applied through the imperative handle (`applyRemote`, `setValue`) so the
// local cursor and undo stack are preserved.
const Editor = forwardRef(({ language, onLocalChange, onRun, onSave }, ref) => {
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    const applyingRemote = useRef(false);
    const pendingValue = useRef(null);
    const handlersRef = useRef({});
    handlersRef.current = { onLocalChange, onRun, onSave };

    const replaceAll = (code) => {
        const editor = editorRef.current;
        const model = editor.getModel();
        if (model.getValue() === code) return;
        applyingRemote.current = true;
        try {
            model.pushEditOperations(
                editor.getSelections(),
                [{ range: model.getFullModelRange(), text: code }],
                () => editor.getSelections()
            );
        } finally {
            applyingRemote.current = false;
        }
    };

    useImperativeHandle(ref, () => ({
        setValue(code) {
            if (!editorRef.current) {
                pendingValue.current = code;
                return;
            }
            replaceAll(code);
        },
        applyRemote(changes, code) {
            const editor = editorRef.current;
            if (!editor) {
                pendingValue.current = code;
                return;
            }
            const model = editor.getModel();
            if (Array.isArray(changes) && changes.length) {
                applyingRemote.current = true;
                try {
                    model.applyEdits(
                        changes.map((c) => ({ range: c.range, text: c.text, forceMoveMarkers: true }))
                    );
                } catch (err) {
                    console.warn('Could not apply remote delta, resyncing', err);
                } finally {
                    applyingRemote.current = false;
                }
            }
            // Self-heal if concurrent edits made the documents diverge.
            if (model.getValue() !== code) replaceAll(code);
        },
        getValue() {
            return editorRef.current ? editorRef.current.getValue() : pendingValue.current;
        },
    }));

    function handleMount(editor, monaco) {
        editorRef.current = editor;
        monacoRef.current = monaco;

        if (pendingValue.current !== null) {
            editor.setValue(pendingValue.current);
            pendingValue.current = null;
        }

        editor.onDidChangeModelContent((e) => {
            if (applyingRemote.current) return;
            const changes = e.changes.map(({ range, text }) => ({ range, text }));
            handlersRef.current.onLocalChange?.(editor.getValue(), changes);
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
            handlersRef.current.onRun?.()
        );
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
            handlersRef.current.onSave?.()
        );
    }

    function handleBeforeMount(monaco) {
        monaco.editor.defineTheme('coco-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [{ token: 'comment', foreground: '8b7fb0', fontStyle: 'italic' }],
            colors: {
                'editor.background': '#0a0a1e',
                'editorLineNumber.foreground': '#6c4ea0',
                'editorLineNumber.activeForeground': '#c77dff',
                'editorCursor.foreground': '#c77dff',
                'editor.selectionBackground': '#3c096c88',
                'editor.lineHighlightBackground': '#1a1440',
            },
        });
    }

    return (
        <MonacoEditor
            height="100%"
            theme="coco-dark"
            language={language}
            defaultValue=""
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            loading={<div className="editorLoading">Loading editor…</div>}
            options={{
                fontSize: 16,
                fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                tabSize: 4,
                padding: { top: 16 },
                smoothScrolling: true,
            }}
        />
    );
});

export default Editor;

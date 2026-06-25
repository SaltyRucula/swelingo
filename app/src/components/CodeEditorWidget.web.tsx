import React from 'react';
import Editor from '@monaco-editor/react';

interface Props {
  language: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleEditorMount(editor: any, monaco: any) {
  // Disable Ctrl+V / Cmd+V
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {});
  // Disable Ctrl+Shift+V / Cmd+Shift+V (paste without formatting)
  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV,
    () => {},
  );

  const domNode: HTMLElement | null = editor.getDomNode();
  if (domNode) {
    // Block browser-level paste (context menu, middle-click on Linux, etc.)
    domNode.addEventListener('paste', (e: Event) => e.preventDefault(), true);
    // Block drag-and-drop of text into the editor
    domNode.addEventListener('dragover', (e: Event) => e.preventDefault(), true);
    domNode.addEventListener('drop', (e: Event) => e.preventDefault(), true);
  }
}

export default function CodeEditorWidget({ language, value, onChange, disabled }: Props) {
  return (
    <div
      style={{
        borderRadius: 10,
        overflow: 'hidden',
        border: '2px solid #2D3561',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Editor
        height="320px"
        language={language}
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleEditorMount}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          readOnly: disabled,
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}

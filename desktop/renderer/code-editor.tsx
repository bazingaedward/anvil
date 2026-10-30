import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

const options: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: "anvil",
  fontSize: 13,
  fontFamily: "Menlo, Consolas, monospace",
  minimap: { enabled: false },
  padding: { top: 18 },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  renderWhitespace: "selection",
  // Use the stable textarea input path for native and automated keyboard input.
  editContext: false,
};

export function CodeEditor({
  value,
  language,
  onChange,
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const model = monaco.editor.createModel(value, language);
    const instance = monaco.editor.create(container.current!, {
      ...options,
      model,
    });
    editor.current = instance;
    const listener = model.onDidChangeContent(() =>
      change.current(model.getValue()),
    );
    return () => {
      listener.dispose();
      instance.setModel(null);
      instance.dispose();
      model.dispose();
      editor.current = null;
    };
  }, [language]);
  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value)
      editor.current.setValue(value);
  }, [value]);
  return <div className="code-surface" ref={container} />;
}

export function CodeDiff({
  original,
  modified,
  language,
}: {
  original: string;
  modified: string;
  language: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = monaco.editor.createModel(original, language);
    const after = monaco.editor.createModel(modified, language);
    const instance = monaco.editor.createDiffEditor(container.current!, {
      ...options,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
    });
    instance.setModel({ original: before, modified: after });
    return () => {
      // Detach before disposing models; Monaco can still have a pending diff calculation.
      instance.setModel(null);
      instance.dispose();
      before.dispose();
      after.dispose();
    };
  }, [original, modified, language]);
  return <div className="code-surface" ref={container} />;
}

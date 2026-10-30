import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode2,
  GitBranch,
  GitCompareArrows,
  RefreshCw,
  Save,
  TerminalSquare,
  X,
  Hammer,
  ArrowUpRight,
  Circle,
  PanelBottomClose,
  PanelBottomOpen,
  Search,
} from "lucide-react";
import type {
  DesktopAPI,
  DiffDocument,
  DiffSide,
  Entry,
  FileDocument,
  RepoState,
} from "../shared/api";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { CodeEditor, CodeDiff } from "./code-editor";

declare global {
  interface Window {
    anvil: DesktopAPI;
  }
}
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === "json"
      ? new JsonWorker()
      : ["typescript", "javascript"].includes(label)
        ? new TsWorker()
        : new EditorWorker(),
};

monaco.editor.defineTheme("anvil", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#171b22",
    "editorGutter.background": "#171b22",
    "editor.lineHighlightBackground": "#202733",
    "editorLineNumber.foreground": "#6a778a",
    "editor.selectionBackground": "#33496a",
    "diffEditor.insertedTextBackground": "#3c765630",
    "diffEditor.removedTextBackground": "#9b506030",
  },
});
const api = window.anvil;
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
const language = (file: string) =>
  ({
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    rs: "rust",
    css: "css",
    html: "html",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    toml: "ini",
  })[file.split(".").pop()!] || "plaintext";
function Tree({
  root,
  onOpen,
  active,
  query,
  revision,
  report,
}: {
  root: string;
  onOpen: (path: string) => void;
  active?: string;
  query: string;
  revision: number;
  report: (error: unknown) => void;
}) {
  return (
    <TreeNodes
      root={root}
      onOpen={onOpen}
      active={active}
      query={query}
      revision={revision}
      report={report}
      directory=""
    />
  );
}
function TreeNodes({
  root,
  onOpen,
  active,
  query,
  revision,
  report,
  directory,
  depth = 0,
}: {
  root: string;
  onOpen: (path: string) => void;
  active?: string;
  query: string;
  revision: number;
  report: (error: unknown) => void;
  directory: string;
  depth?: number;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    api.list(directory).then(
      (items) => {
        if (alive) setEntries(items);
      },
      (error) => {
        if (alive) report(error);
      },
    );
    return () => {
      alive = false;
    };
  }, [directory, root, revision]);
  return (
    <>
      {entries
        .filter(
          (entry) =>
            !query ||
            entry.directory ||
            entry.name.toLowerCase().includes(query.toLowerCase()),
        )
        .map((entry) => (
          <React.Fragment key={entry.path}>
            <button
              className={`tree-row ${active === entry.path ? "selected" : ""}`}
              style={{ paddingLeft: 12 + depth * 15 }}
              title={
                entry.symlink ? `${entry.path} (symbolic link)` : entry.path
              }
              disabled={entry.symlink}
              onClick={() =>
                entry.directory
                  ? setExpanded((old) => {
                      const next = new Set(old);
                      next.has(entry.path)
                        ? next.delete(entry.path)
                        : next.add(entry.path);
                      return next;
                    })
                  : onOpen(entry.path)
              }
            >
              {entry.directory ? (
                expanded.has(entry.path) ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )
              ) : (
                <span className="tree-indent" />
              )}
              {entry.directory ? <Folder size={14} /> : <FileCode2 size={14} />}
              <span>{entry.name}</span>
              {entry.symlink && <ArrowUpRight size={12} />}
            </button>
            {entry.directory && expanded.has(entry.path) && (
              <TreeNodes
                root={root}
                onOpen={onOpen}
                active={active}
                query={query}
                revision={revision}
                report={report}
                directory={entry.path}
                depth={depth + 1}
              />
            )}
          </React.Fragment>
        ))}
    </>
  );
}

function TerminalPanel({
  root,
  hidden,
  onError,
}: {
  root: string;
  hidden: boolean;
  onError: (error: unknown) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [exited, setExited] = useState(false);
  useEffect(() => {
    setExited(false);
    const term = new Terminal({
      fontSize: 12,
      fontFamily: "Menlo, Consolas, monospace",
      cursorBlink: true,
      scrollback: 4000,
      theme: {
        background: "#171b22",
        foreground: "#dce4ef",
        cursor: "#87b7f5",
        selectionBackground: "#33496a",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current!);
    const off = api.onTerminal((event) => {
      if (event.type === "data") term.write(event.data);
      else {
        term.writeln(`\r\n[Process exited with code ${event.code}]`);
        setExited(true);
      }
    });
    const input = term.onData((data) => api.terminalInput(data));
    const size = term.onResize(({ cols, rows }) =>
      api.terminalResize(cols, rows),
    );
    const resize = () => {
      if (container.current?.clientHeight && container.current?.clientWidth)
        fit.fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    let alive = true;
    api.startTerminal().then(
      () => {
        if (alive) {
          resize();
          api.terminalResize(term.cols, term.rows);
        }
      },
      (error) => {
        if (alive) {
          setExited(true);
          onError(error);
        }
      },
    );
    return () => {
      alive = false;
      off();
      observer.disconnect();
      input.dispose();
      size.dispose();
      term.dispose();
    };
  }, [root, generation]);
  return (
    <section
      className={`terminal-panel ${hidden ? "hidden" : ""}`}
      aria-label="Terminal"
    >
      <div className="terminal-toolbar">
        <span>
          <TerminalSquare size={14} /> Terminal
        </span>
        <span className="terminal-location">{root}</span>
        <button
          title="Restart terminal (ends running processes)"
          aria-label="Restart terminal"
          onClick={() => setGeneration((value) => value + 1)}
        >
          <RefreshCw size={13} />
          {exited && " Restart"}
        </button>
      </div>
      <div className="terminal-body" ref={container} />
    </section>
  );
}

function App() {
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [view, setView] = useState<"files" | "changes">("files");
  const [document, setDocument] = useState<FileDocument | null>(null);
  const [text, setText] = useState("");
  const [diff, setDiff] = useState<(DiffDocument & { side: DiffSide }) | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [terminalHidden, setTerminalHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [terminalHeight, setTerminalHeight] = useState(230);
  const dirty = !!document && text !== document.content;
  const report = useCallback((value: unknown) => setError(message(value)), []);
  const latest = useRef({ document, text, dirty, busy });
  latest.current = { document, text, dirty, busy };
  const refresh = useCallback(async () => {
    try {
      const state = await api.status();
      setRepo((current) => (current?.root === state.root ? state : current));
    } catch (error) {
      report(error);
    }
  }, [report]);
  const save = useCallback(async () => {
    const state = latest.current;
    if (!state.document || !state.dirty || state.busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.save({ ...state.document, content: state.text });
      setDocument(result);
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }, [refresh, report]);
  useEffect(() => {
    api.restore().then(setRepo, report);
    return api.onSave(() => {
      void save();
    });
  }, [save, report]);
  useEffect(() => {
    api.setDirty(dirty);
  }, [dirty]);
  useEffect(() => {
    if (!repo) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [repo?.root, refresh]);
  async function switchContent(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      if (dirty && !(await api.confirmDiscard())) return;
      setError("");
      await action();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function openRepository() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.openRepository();
      if (next) {
        setRepo(next);
        setDocument(null);
        setDiff(null);
        setText("");
        setQuery("");
        setRevision((value) => value + 1);
      }
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  function openFile(path: string) {
    void switchContent(async () => {
      const value = await api.read(path);
      setDocument(value);
      setText(value.content);
      setDiff(null);
    });
  }
  function openDiff(path: string, side: DiffSide) {
    void switchContent(async () => {
      const value = await api.diff(path, side);
      setDiff({ ...value, side });
      setDocument(null);
      setText("");
    });
  }
  function resize(event: React.PointerEvent, kind: "sidebar" | "terminal") {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = kind === "sidebar" ? event.clientX : event.clientY;
    const initial = kind === "sidebar" ? sidebarWidth : terminalHeight;
    const move = (next: PointerEvent) => {
      if (kind === "sidebar")
        setSidebarWidth(
          Math.max(210, Math.min(440, initial + next.clientX - start)),
        );
      else
        setTerminalHeight(
          Math.max(
            130,
            Math.min(window.innerHeight - 300, initial + start - next.clientY),
          ),
        );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  const changes = repo?.changes || [];
  return (
    <div className="application">
      <header className="app-header">
        <div className="brand">
          <Hammer size={19} strokeWidth={1.7} />
          <strong>Anvil</strong>
          <span className="preview-badge">Preview</span>
        </div>
        {repo && (
          <div className="repo-title">
            <Folder size={14} />
            <span>{repo.name}</span>
            <span className="header-divider" />
            <GitBranch size={14} />
            <span>{repo.branch}</span>
          </div>
        )}
        <button
          className="open-button"
          onClick={() => void openRepository()}
          disabled={busy}
        >
          <FolderOpen size={15} />
          Open repository
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {!repo ? (
        <main className="welcome">
          <div className="welcome-symbol">
            <Hammer size={38} strokeWidth={1.3} />
          </div>
          <h1>A workspace for the work.</h1>
          <p>
            Open a Git repository to explore your code,
            <br />
            review changes, and run your tools.
          </p>
          <button
            className="primary-button"
            onClick={() => void openRepository()}
            disabled={busy}
          >
            <FolderOpen size={16} />
            Open repository
          </button>
          <div className="welcome-capabilities">
            <span>
              <FileCode2 size={16} />
              Code
            </span>
            <span>
              <GitCompareArrows size={16} />
              Changes
            </span>
            <span>
              <TerminalSquare size={16} />
              Terminal
            </span>
          </div>
        </main>
      ) : (
        <div className="workspace">
          <aside className="sidebar" style={{ width: sidebarWidth }}>
            <div className="sidebar-tabs">
              <button
                className={view === "files" ? "active" : ""}
                onClick={() => setView("files")}
              >
                <Folder size={14} />
                Explorer
              </button>
              <button
                className={view === "changes" ? "active" : ""}
                onClick={() => setView("changes")}
              >
                <GitCompareArrows size={14} />
                Changes<span className="count">{changes.length}</span>
              </button>
            </div>
            <div className="sidebar-heading">
              <span title={repo.root}>{repo.name}</span>
              <button
                aria-label="Refresh repository"
                title="Refresh repository"
                onClick={() => {
                  void refresh();
                  setRevision((value) => value + 1);
                }}
              >
                <RefreshCw size={13} />
              </button>
            </div>
            {view === "files" ? (
              <>
                <div className="file-filter">
                  <Search size={13} />
                  <input
                    aria-label="Filter visible files"
                    placeholder="Filter visible files…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div className="sidebar-scroll">
                  <Tree
                    key={repo.root}
                    root={repo.root}
                    onOpen={openFile}
                    active={document?.path}
                    query={query}
                    revision={revision}
                    report={report}
                  />
                </div>
              </>
            ) : (
              <div className="sidebar-scroll changes-list">
                {(["worktree", "index"] as const).map((side) => {
                  const items = changes.filter((item) =>
                    side === "index"
                      ? item.index !== " " && item.index !== "?"
                      : item.worktree !== " ",
                  );
                  return (
                    <section key={side}>
                      <h2>
                        {side === "index"
                          ? "Staged changes"
                          : "Working changes"}
                        <span>{items.length}</span>
                      </h2>
                      {items.map((item) => (
                        <button
                          className={`change-row ${diff?.path === item.path && diff.side === side ? "selected" : ""}`}
                          key={item.path}
                          title={
                            item.originalPath
                              ? `${item.originalPath} → ${item.path}`
                              : item.path
                          }
                          onClick={() => openDiff(item.path, side)}
                        >
                          <FileCode2 size={14} />
                          <span>{item.path}</span>
                          <b
                            className={`change-code code-${side === "index" ? item.index : item.worktree}`}
                          >
                            {side === "index"
                              ? item.index
                              : item.worktree === "?"
                                ? "U"
                                : item.worktree}
                          </b>
                        </button>
                      ))}
                    </section>
                  );
                })}
                {changes.length === 0 && (
                  <div className="clean-state">
                    <GitCompareArrows size={24} />
                    <strong>Working tree clean</strong>
                    <p>File changes will appear here.</p>
                  </div>
                )}
                <p className="git-note">
                  Review changes here. Use the terminal to stage, commit, and
                  push.
                </p>
              </div>
            )}
          </aside>
          <div
            className="resize-column"
            role="separator"
            aria-label="Sidebar width"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={(event) => resize(event, "sidebar")}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft")
                setSidebarWidth((value) => Math.max(210, value - 20));
              if (event.key === "ArrowRight")
                setSidebarWidth((value) => Math.min(440, value + 20));
            }}
          />
          <main className="main-workspace">
            <div className="editor-area">
              <div className="editor-toolbar">
                <div className="file-tab">
                  {document || diff ? (
                    <>
                      <FileCode2 size={14} />
                      <span title={document?.path || diff?.path}>
                        {document?.path || diff?.path}
                      </span>
                      {dirty && (
                        <Circle
                          size={8}
                          fill="currentColor"
                          aria-label="Unsaved changes"
                        />
                      )}
                      {diff && (
                        <span className="diff-label">
                          {diff.side === "index"
                            ? "HEAD ↔ Index"
                            : "Index ↔ Working tree"}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">Workspace</span>
                  )}
                </div>
                <div className="editor-actions">
                  {document && (
                    <>
                      <button
                        title="Reload file from disk"
                        aria-label="Reload file"
                        disabled={busy}
                        onClick={() => openFile(document.path)}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        aria-label="Save file"
                        className="save-button"
                        disabled={!dirty || busy}
                        onClick={() => void save()}
                      >
                        <Save size={14} />
                        Save
                      </button>
                    </>
                  )}
                  <button
                    title="Toggle terminal"
                    aria-label="Toggle terminal"
                    onClick={() => setTerminalHidden((value) => !value)}
                  >
                    {terminalHidden ? (
                      <PanelBottomOpen size={15} />
                    ) : (
                      <PanelBottomClose size={15} />
                    )}
                  </button>
                </div>
              </div>
              {document ? (
                <CodeEditor
                  key={`${repo.root}:${document.path}`}
                  language={language(document.path)}
                  value={text}
                  onChange={setText}
                />
              ) : diff ? (
                <CodeDiff
                  original={diff.original}
                  modified={diff.modified}
                  language={language(diff.path)}
                />
              ) : (
                <div className="editor-empty">
                  <FileCode2 size={30} strokeWidth={1.2} />
                  <h1>{repo.name}</h1>
                  <p>Select a file to edit or a change to review.</p>
                  <div className="shortcut">
                    <kbd>
                      {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} S
                    </kbd>
                    <span>Save the current file</span>
                  </div>
                </div>
              )}
            </div>
            {!terminalHidden && (
              <div
                className="resize-row"
                role="separator"
                aria-label="Terminal height"
                aria-orientation="horizontal"
                tabIndex={0}
                onPointerDown={(event) => resize(event, "terminal")}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp")
                    setTerminalHeight((value) =>
                      Math.min(window.innerHeight - 300, value + 20),
                    );
                  if (event.key === "ArrowDown")
                    setTerminalHeight((value) => Math.max(130, value - 20));
                }}
              />
            )}
            <div
              className="terminal-container"
              style={{ height: terminalHidden ? 0 : terminalHeight }}
            >
              <TerminalPanel
                key={repo.root}
                root={repo.root}
                hidden={terminalHidden}
                onError={report}
              />
            </div>
          </main>
        </div>
      )}
      <footer className="status-bar">
        <span>
          {repo ? (
            <>
              <GitBranch size={12} />
              {repo.branch}
              <span className="status-separator" />
              {changes.length} changed {changes.length === 1 ? "file" : "files"}
            </>
          ) : (
            "Local coding workspace"
          )}
        </span>
        <span>
          {busy
            ? "Working…"
            : dirty
              ? "Unsaved changes"
              : document
                ? `${language(document.path)} · UTF-8`
                : "Anvil desktop preview"}
        </span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

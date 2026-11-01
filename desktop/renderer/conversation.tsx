import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Folder,
  Plus,
  TerminalSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Ellipsis,
  Search,
} from "lucide-react";
import type { RepoState, AgentTask, AcceptanceOptions } from "../shared/api";

type Draft = { id: string; text: string; acceptance?: AcceptanceOptions };
const fresh = (): Draft => ({ id: crypto.randomUUID(), text: "" });
const title = (draft: Draft) =>
  draft.text.trim().split("\n")[0].slice(0, 48) || "New conversation";

export function ConversationWorkspace({
  repo,
  tools,
  review,
  terminal,
  terminalOpen,
  onTerminal,
  onOpen,
  onSelectDirectory,
}: {
  repo: RepoState | null;
  tools: ReactNode;
  review: ReactNode;
  terminal: ReactNode;
  terminalOpen: boolean;
  onTerminal: () => void;
  onOpen: () => void;
  onSelectDirectory: (root: string) => void;
}) {
  const key = "anvil:conversations:v2";
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    try {
      const saved = localStorage.getItem(key);
      const data: unknown = saved
        ? JSON.parse(saved)
        : Object.keys(localStorage)
            .filter((name) => name.startsWith("anvil:drafts:"))
            .flatMap((name) => {
              try {
                const items = JSON.parse(localStorage.getItem(name) || "[]");
                return Array.isArray(items) ? items : [];
              } catch {
                return [];
              }
            });
      if (
        Array.isArray(data) &&
        data.length &&
        data.every(
          (value) =>
            typeof value?.id === "string" && typeof value?.text === "string",
        )
      )
        return data.filter(
          (item, index) =>
            data.findIndex((other) => other.id === item.id) === index,
        );
    } catch {
      /* A malformed local draft must not prevent the workspace opening. */
    }
    return [fresh()];
  });
  const [selected, setSelected] = useState(drafts[0].id);
  const [storageError, setStorageError] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [agentError, setAgentError] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("anvil:sidebar-collapsed") !== "true";
    } catch {
      return true;
    }
  });
  const [search, setSearch] = useState("");
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem("anvil:sidebar-collapsed", String(!sidebarOpen));
    } catch {
      /* Layout preferences are optional. */
    }
  }, [sidebarOpen]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!toolsMenu.current?.contains(event.target as Node))
        toolsMenu.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && toolsMenu.current?.open) {
        toolsMenu.current.open = false;
        toolsMenu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const conversationTasks = tasks.filter(
    (task) => task.conversationID === selected,
  );
  const running = tasks.find((task) => task.status === "running");
  useEffect(() => {
    if (!repo) return;
    let live = true;
    const merge = (incoming: AgentTask) =>
      setTasks((items) => {
        const existing = items.find((item) => item.id === incoming.id);
        if (existing && existing.updated > incoming.updated) return items;
        return existing
          ? items.map((item) => (item.id === incoming.id ? incoming : item))
          : [...items, incoming];
      });
    const unsubscribe = window.anvil.onTask(merge);
    void window.anvil
      .tasks()
      .then((items) => {
        if (!live) return;
        items.forEach(merge);
        setDrafts((drafts) => {
          const missing = [
            ...new Set(items.map((item) => item.conversationID)),
          ].filter((id) => !drafts.some((d) => d.id === id));
          return [...drafts, ...missing.map((id) => ({ id, text: "" }))];
        });
      })
      .catch((error) => {
        if (live) setAgentError(String(error));
      });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [repo?.root]);
  async function send() {
    setSending(true);
    setAgentError("");
    try {
      await window.anvil.startTask(
        selected,
        draft.text,
        draft.acceptance?.command.trim() ? draft.acceptance : undefined,
      );
      update("");
    } catch (error) {
      setAgentError(String(error));
    } finally {
      setSending(false);
    }
  }
  async function action(run: () => Promise<void>) {
    try {
      await run();
      setAgentError("");
    } catch (error) {
      setAgentError(String(error));
    }
  }
  const conversationTitle = (item: Draft) =>
    tasks
      .find((task) => task.conversationID === item.id)
      ?.prompt.slice(0, 48) || title(item);
  const input = useRef<HTMLTextAreaElement>(null);
  const draft = drafts.find((item) => item.id === selected)!;
  useEffect(() => {
    if (!repo) return;
    try {
      localStorage.setItem(key, JSON.stringify(drafts));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [drafts, key, repo?.root]);
  function update(text: string) {
    setDrafts((items) =>
      items.map((item) => (item.id === selected ? { ...item, text } : item)),
    );
  }
  function updateAcceptance(value: Partial<AcceptanceOptions>) {
    setDrafts((items) =>
      items.map((item) =>
        item.id === selected
          ? {
              ...item,
              acceptance: {
                command: "",
                directory: repo?.root || "",
                maxRepairs: 2,
                timeoutMs: 120000,
                ...item.acceptance,
                ...value,
              },
            }
          : item,
      ),
    );
  }
  function create() {
    const empty = drafts.find(
      (item) =>
        !item.text.trim() &&
        !tasks.some((task) => task.conversationID === item.id),
    );
    if (empty) setSelected(empty.id);
    else {
      const next = fresh();
      setDrafts((items) => [next, ...items]);
      setSelected(next.id);
    }
    input.current?.focus();
  }
  return (
    <div className="workspace conversation-workspace">
      {sidebarOpen && (
        <aside
          id="conversation-sidebar"
          className="conversation-sidebar"
          aria-label="Conversations"
        >
          <div className="sidebar-header">
            <strong>Anvil</strong>
            <button
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              aria-expanded={true}
              aria-controls="conversation-sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose size={19} />
            </button>
          </div>
          <button
            className="new-conversation"
            onClick={create}
            disabled={!repo}
          >
            <Plus size={16} />
            New conversation
          </button>
          <label className="conversation-search">
            <Search size={16} />
            <input
              aria-label="Search conversations"
              placeholder="Search conversations"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="project-heading">Conversations</div>
          <div className="draft-list">
            {repo ? (
              drafts
                .filter((item) =>
                  conversationTitle(item)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    className={`draft-item ${item.id === selected ? "selected" : ""}`}
                    onClick={() => setSelected(item.id)}
                  >
                    <span>{conversationTitle(item)}</span>
                    {tasks.some(
                      (task) =>
                        task.conversationID === item.id &&
                        task.status === "running",
                    ) && <span className="activity-dot" aria-label="Running" />}
                  </button>
                ))
            ) : (
              <p>Add working folders to get started.</p>
            )}
          </div>
          <section className="working-folders" aria-label="Working folders">
            <div className="folders-heading">
              <span>Working folders</span>
              <button
                aria-label="Add working folders"
                title="Add working folders"
                onClick={onOpen}
              >
                <Plus size={14} />
              </button>
            </div>
            {(repo?.directories || []).map((root) => (
              <button
                key={root}
                className={`folder-item ${repo?.root === root ? "selected" : ""}`}
                title={root}
                aria-pressed={repo?.root === root}
                onClick={() => onSelectDirectory(root)}
              >
                <Folder size={14} />
                <span>{root.split(/[\\/]/).filter(Boolean).pop()}</span>
              </button>
            ))}
            {!repo && <p>No folders added</p>}
          </section>
        </aside>
      )}
      <main
        className={`conversation-main ${conversationTasks.length === 0 ? "is-empty" : ""} ${terminalOpen ? "with-terminal" : ""}`}
        aria-label="Conversation"
      >
        <header className="conversation-toolbar">
          {!sidebarOpen && (
            <button
              aria-label="Expand sidebar"
              title="Expand sidebar"
              aria-expanded={false}
              aria-controls="conversation-sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen size={19} />
            </button>
          )}
          <span className="conversation-title">{conversationTitle(draft)}</span>
          <details className="tools-menu" ref={toolsMenu}>
            <summary
              aria-label="Workspace tools"
              title="Files, changes and terminal"
            >
              <Ellipsis size={20} />
            </summary>
            <div
              className="workspace-tools"
              onClick={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    "button:not(:disabled)",
                  ) &&
                  toolsMenu.current
                )
                  toolsMenu.current.open = false;
              }}
            >
              {tools}
              <button
                aria-label="Toggle terminal"
                aria-pressed={terminalOpen}
                title="Terminal"
                onClick={onTerminal}
                disabled={!repo}
              >
                <TerminalSquare size={16} />
                <span>Terminal</span>
              </button>
            </div>
          </details>
        </header>
        <section
          className={`conversation-body ${conversationTasks.length ? "has-tasks" : ""}`}
        >
          {conversationTasks.length === 0 && (
            <div className="conversation-intro">
              <h1>What are we working on?</h1>
              <p>
                {repo
                  ? "Ask about your code, plan a change, or start building."
                  : "Add working folders to start a conversation."}
              </p>
              {!repo && (
                <button className="primary-button" onClick={onOpen}>
                  Add folders
                </button>
              )}
            </div>
          )}
          {conversationTasks.map((task) => (
            <article className="agent-task" key={task.id}>
              <p className="agent-prompt">{task.prompt}</p>
              <div className="response-heading">Anvil</div>
              <div className="agent-response">
                {task.text ||
                  (task.status === "running" ? "Working…" : "No response")}
              </div>
              <small className={`task-state ${task.status}`} role="status">
                {task.status === "completed"
                  ? "Acceptance passed"
                  : task.status === "unverified"
                    ? "Finished · not verified"
                    : task.status === "running"
                      ? task.phase === "checking"
                        ? "Running acceptance check…"
                        : task.phase === "repairing"
                          ? `Repairing · attempt ${(task.round || 1) - 1} of ${task.acceptance?.maxRepairs}`
                          : task.phase === "stopping"
                            ? "Stopping…"
                            : "Working…"
                      : task.status === "limit"
                        ? "Limit reached"
                        : task.status}
              </small>
              {task.acceptance && (
                <details className="acceptance-results">
                  <summary>
                    Acceptance · {task.checks?.length || 0} run
                    {task.checks?.length === 1 ? "" : "s"}
                  </summary>
                  <code>{task.acceptance.command}</code>
                  <p>{task.acceptance.directory}</p>
                  {task.checks?.map((check) => (
                    <div className="acceptance-run" key={check.round}>
                      <strong>
                        Run {check.round} ·{" "}
                        {check.cancelled
                          ? "Cancelled"
                          : check.timedOut
                            ? "Timed out"
                            : check.error
                              ? "Could not run"
                              : `Exit ${check.exitCode}`}{" "}
                        · {(check.durationMs / 1000).toFixed(1)}s
                      </strong>
                      <pre>
                        {check.error || check.output || "(No output)"}
                        {check.truncated ? "\n[Output truncated]" : ""}
                      </pre>
                    </div>
                  ))}
                </details>
              )}
              {task.error && <p role="alert">{task.error}</p>}
              {task.permissions.map((permission) => (
                <section
                  className="agent-permission"
                  key={permission.id}
                  aria-label="Tool approval"
                >
                  <strong>Allow {permission.action}?</strong>
                  <pre>{permission.resources.join("\n")}</pre>
                  {permission.message && <p>{permission.message}</p>}
                  <button
                    className="permission-deny"
                    onClick={() =>
                      void action(() =>
                        window.anvil.replyPermission(
                          task.id,
                          permission.id,
                          false,
                        ),
                      )
                    }
                  >
                    Deny
                  </button>
                  <button
                    className="permission-allow"
                    onClick={() =>
                      void action(() =>
                        window.anvil.replyPermission(
                          task.id,
                          permission.id,
                          true,
                        ),
                      )
                    }
                  >
                    Allow once
                  </button>
                </section>
              ))}
            </article>
          ))}
        </section>
        <div className="composer-wrap">
          <details className="acceptance-settings">
            <summary>
              {draft.acceptance?.command.trim()
                ? "Acceptance check configured"
                : "Add acceptance check"}
            </summary>
            <div className="acceptance-fields">
              <label>
                Command
                <input
                  aria-label="Acceptance command"
                  placeholder="npm test"
                  value={draft.acceptance?.command || ""}
                  disabled={!!running || sending}
                  onChange={(event) =>
                    updateAcceptance({ command: event.target.value })
                  }
                />
              </label>
              <label>
                Run in
                <select
                  aria-label="Acceptance directory"
                  value={draft.acceptance?.directory || repo?.root || ""}
                  disabled={!!running || sending || !repo}
                  onChange={(event) =>
                    updateAcceptance({ directory: event.target.value })
                  }
                >
                  {(repo?.directories || [repo?.root].filter(Boolean)).map(
                    (root) => (
                      <option key={root} value={root}>
                        {root}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <div className="acceptance-limits">
                <label>
                  Repair attempts
                  <select
                    aria-label="Repair attempts"
                    value={draft.acceptance?.maxRepairs ?? 2}
                    disabled={!!running || sending}
                    onChange={(event) =>
                      updateAcceptance({
                        maxRepairs: Number(event.target.value),
                      })
                    }
                  >
                    {[0, 1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Check timeout
                  <select
                    aria-label="Check timeout"
                    value={draft.acceptance?.timeoutMs ?? 120000}
                    disabled={!!running || sending}
                    onChange={(event) =>
                      updateAcceptance({
                        timeoutMs: Number(event.target.value),
                      })
                    }
                  >
                    {[30000, 60000, 120000, 300000, 600000].map((value) => (
                      <option key={value} value={value}>
                        {value / 1000}s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p>
                Sending authorizes this command to run after each attempt in the
                selected folder. Task limit: 15 minutes. Leave the command blank
                to skip verification.
              </p>
            </div>
          </details>
          <div className="composer">
            <textarea
              ref={input}
              aria-label="Message Anvil"
              placeholder={
                repo
                  ? "Describe a task, ask about your code, or plan a change…"
                  : "Add a working folder to prepare a task…"
              }
              value={draft.text}
              onChange={(event) => update(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey) &&
                  !event.nativeEvent.isComposing &&
                  repo &&
                  draft.text.trim() &&
                  !running &&
                  !sending
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
              disabled={!repo}
              rows={2}
            />
            <div className="composer-footer">
              <button
                className="composer-context"
                onClick={onOpen}
                aria-label="Add folders"
                title="Add working folders"
              >
                <Plus size={17} />
                {repo
                  ? `${repo.directories?.length || 1} working folder${(repo.directories?.length || 1) > 1 ? "s" : ""}`
                  : "No folders"}
              </button>
              <span className="connection-status">
                {running ? "Working" : "DeepSeek"}
              </span>
              {running && (
                <button
                  onClick={() =>
                    void action(() => window.anvil.cancelTask(running.id))
                  }
                >
                  Cancel task
                </button>
              )}
              <button
                className="send-button"
                aria-label="Send message"
                title="Send task"
                onClick={() => void send()}
                disabled={!repo || !draft.text.trim() || !!running || sending}
              >
                <ArrowUp size={17} />
              </button>
            </div>
          </div>
          <p
            className={`draft-notice ${storageError ? "storage-error" : ""}`}
            role="status"
          >
            {storageError
              ? "Could not save this draft locally. Keep this window open to preserve it."
              : agentError || "Ctrl / ⌘ + Enter to send"}
          </p>
        </div>
        {terminal}
      </main>
      {review}
    </div>
  );
}

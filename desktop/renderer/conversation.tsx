import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Folder, Plus, TerminalSquare } from "lucide-react";
import type { RepoState, AgentTask } from "../shared/api";

type Draft = { id: string; text: string };
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
      await window.anvil.startTask(selected, draft.text);
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
      <aside className="conversation-sidebar" aria-label="Conversations">
        <button className="new-conversation" onClick={create} disabled={!repo}>
          <Plus size={16} />
          New conversation
        </button>
        <div className="project-heading">Conversations</div>
        <div className="draft-list">
          {repo ? (
            drafts.map((item) => (
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
      <main className="conversation-main" aria-label="Conversation">
        <header className="conversation-toolbar">
          <span className="conversation-title">{conversationTitle(draft)}</span>
          <div className="workspace-tools">
            {tools}
            <button
              aria-label="Toggle terminal"
              aria-pressed={terminalOpen}
              title="Terminal"
              onClick={onTerminal}
              disabled={!repo}
            >
              <TerminalSquare size={16} />
            </button>
          </div>
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
                {task.status}
              </small>
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
          {repo && conversationTasks.length === 0 && (
            <div className="task-suggestions">
              {[
                "Explore these folders",
                "Fix failing tests",
                "Review current changes",
              ].map((task) => (
                <button
                  key={task}
                  onClick={() => {
                    update(task);
                    input.current?.focus();
                  }}
                >
                  {task}
                </button>
              ))}
            </div>
          )}
        </section>
        <div className="composer-wrap">
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
              <span className="composer-context">
                <Folder size={13} />
                {repo
                  ? `${repo.directories?.length || 1} working folder${(repo.directories?.length || 1) > 1 ? "s" : ""}`
                  : "No folders"}
              </span>
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

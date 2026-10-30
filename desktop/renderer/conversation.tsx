import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Folder,
  GitBranch,
  MessageSquare,
  Plus,
  TerminalSquare,
} from "lucide-react";
import type { RepoState } from "../shared/api";

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
}: {
  repo: RepoState | null;
  tools: ReactNode;
  review: ReactNode;
  terminal: ReactNode;
  terminalOpen: boolean;
  onTerminal: () => void;
  onOpen: () => void;
}) {
  const key = `anvil:drafts:${repo?.root || "welcome"}`;
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    try {
      const data: unknown = JSON.parse(localStorage.getItem(key) || "null");
      if (
        Array.isArray(data) &&
        data.length &&
        data.every(
          (value) =>
            typeof value?.id === "string" && typeof value?.text === "string",
        )
      )
        return data;
    } catch {
      /* A malformed local draft must not prevent the workspace opening. */
    }
    return [fresh()];
  });
  const [selected, setSelected] = useState(drafts[0].id);
  const [storageError, setStorageError] = useState(false);
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
    const empty = drafts.find((item) => !item.text.trim());
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
        <div className="project-heading">
          <Folder size={14} />
          <span title={repo?.root}>{repo?.name || "No project open"}</span>
        </div>
        <div className="draft-list">
          {repo ? (
            drafts.map((item) => (
              <button
                key={item.id}
                className={`draft-item ${item.id === selected ? "selected" : ""}`}
                onClick={() => setSelected(item.id)}
              >
                <MessageSquare size={14} />
                <span>{title(item)}</span>
                <small>Draft</small>
              </button>
            ))
          ) : (
            <p>Open a repository to start a coding conversation.</p>
          )}
        </div>
        <p className="sidebar-footnote">
          Your conversations belong to your project.
        </p>
      </aside>
      <main className="conversation-main" aria-label="Conversation">
        <header className="conversation-toolbar">
          <span className="conversation-title">{title(draft)}</span>
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
        <section className="conversation-body">
          <div className="conversation-intro">
            <div className="conversation-mark">
              <MessageSquare size={24} strokeWidth={1.4} />
            </div>
            <h1>What are we working on?</h1>
            <p>
              {repo
                ? `Start with a task in ${repo.name}. Keep the conversation here and review code alongside it.`
                : "Open your project, describe the task, and work through it with Anvil."}
            </p>
            {!repo && (
              <button className="primary-button" onClick={onOpen}>
                Open repository
              </button>
            )}
          </div>
          {repo && (
            <div className="task-suggestions">
              {[
                "Explain this repository",
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
                  : "Open a repository to prepare a task…"
              }
              value={draft.text}
              onChange={(event) => update(event.target.value)}
              disabled={!repo}
              rows={3}
            />
            <div className="composer-footer">
              <span className="composer-context">
                <GitBranch size={13} />
                {repo?.branch || "No repository"}
              </span>
              <span className="connection-status">Agent not connected</span>
              <button
                className="send-button"
                aria-label="Send message"
                title="Agent execution is not connected yet"
                disabled
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
              : "Drafts are saved on this device. Sending will be available when the agent is connected."}
          </p>
        </div>
        {terminal}
      </main>
      {review}
    </div>
  );
}

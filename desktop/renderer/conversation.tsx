import { ModelPicker } from "./model-picker";
import { useComposerDraft } from "./composer-draft";
import type { ModelProfile, Attachment } from "../shared/api";
import { ReviewWorkspace } from "./review-workspace";
import { ConversationRow } from "./conversation-row";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Square,
  Shield,
  Paperclip,
  X,
  Folder,
  Plus,
  TerminalSquare,
  MessageSquare,
  GitPullRequest,
  Ellipsis,
} from "lucide-react";
import type {
  RepoState,
  AgentTask,
  PermissionMode,
  Conversation,
  ConversationPatch,
  ConversationGroup,
} from "../shared/api";
import {
  readLegacyDrafts,
  conversationTitle as getTitle,
  filterConversations,
} from "./conversation-data";

export function ConversationWorkspace({
  repo,
  sidebarOpen,
  tools,
  review,
  terminal,
  terminalOpen,
  onTerminal,
  onSelectDirectory,
}: {
  repo: RepoState | null;
  sidebarOpen: boolean;
  tools: ReactNode;
  review: ReactNode;
  terminal: ReactNode;
  terminalOpen: boolean;
  onTerminal: () => void;
  onOpen: () => void;
  onSelectDirectory: (root: string) => void;
}) {
  const [groups, setGroups] = useState<ConversationGroup[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [drafts, setDrafts] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState("");
  const composerDraft = useComposerDraft(selected);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [attaching, setAttaching] = useState(false);
  const selectedModel = models.find(
    (model) => model.id === composerDraft.modelID,
  );
  const imageMismatch =
    !selectedModel?.vision &&
    composerDraft.attachments.some((item) => item.mime.startsWith("image/"));
  async function attach(files?: File[]) {
    const target = selected;
    setAttaching(true);
    setAgentError("");
    try {
      if (files && files.length + composerDraft.attachments.length > 8)
        throw new Error("Select up to eight attachments.");
      const items: Attachment[] = [];
      if (files)
        for (const file of files) {
          if (file.size > 5 * 1024 * 1024)
            throw new Error("Each attachment must be at most 5 MB.");
          items.push(
            await window.anvil.uploadAttachment(
              file.name,
              new Uint8Array(await file.arrayBuffer()),
            ),
          );
        }
      else items.push(...(await window.anvil.pickAttachments()));
      if (
        items.length + composerDraft.attachments.length > 8 ||
        [...items, ...composerDraft.attachments].reduce(
          (sum, file) => sum + file.size,
          0,
        ) >
          10 * 1024 * 1024
      )
        throw new Error("Use up to eight attachments, 10 MB total.");
      composerDraft.add(items, target);
    } catch (e) {
      setAgentError(String(e));
    } finally {
      setAttaching(false);
    }
  }

  const [loaded, setLoaded] = useState(false);
  const [archived, setArchived] = useState(false);
  const [managing, setManaging] = useState(false);
  const pending = useRef(Promise.resolve());
  const deleted = useRef(new Set<string>());
  const [initialization, setInitialization] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [agentError, setAgentError] = useState("");
  const [sending, setSending] = useState(false);
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      document
        .querySelectorAll<HTMLDetailsElement>(".tools-menu[open]")
        .forEach((menu) => {
          if (!menu.contains(event.target as Node)) menu.open = false;
        });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        document
          .querySelectorAll<HTMLDetailsElement>(".tools-menu[open]")
          .forEach((menu) => {
            menu.open = false;
            menu.querySelector("summary")?.focus();
          });
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
    let live = true;
    async function load() {
      let state = await window.anvil.conversations();
      if (!state.legacyDraftsImported)
        state = await window.anvil.conversations(
          readLegacyDrafts(localStorage),
        );
      if (!live) return;
      if (!state.conversations.length) {
        const first = await window.anvil.createConversation();
        state.conversations = [first];
        state.selected = first.id;
      }
      if (!live) return;
      setGroups(state.groups);
      setDrafts(state.conversations);
      setSelected(state.selected);
      setArchived(
        !!state.conversations.find((item) => item.id === state.selected)
          ?.archived,
      );
      setLoaded(true);
      setAgentError("");
    }
    void load().catch((error) => {
      if (live) setAgentError(String(error));
    });
    return () => {
      live = false;
    };
  }, [initialization]);
  useEffect(() => {
    let live = true;
    const merge = (incoming: AgentTask) => {
      if (!live || deleted.current.has(incoming.conversationID)) return;
      setTasks((items) => {
        const existing = items.find((item) => item.id === incoming.id);
        if (existing && existing.updated > incoming.updated) return items;
        return existing
          ? items.map((item) => (item.id === incoming.id ? incoming : item))
          : [...items, incoming];
      });
    };
    const unsubscribe = window.anvil.onTask(merge);
    void window.anvil
      .tasks()
      .then((items) => {
        if (live) items.forEach(merge);
      })
      .catch((error) => {
        if (live) setAgentError(String(error));
      });
    // A newly selected folder may import history from an older, per-folder profile.
    if (loaded)
      void window.anvil
        .conversations()
        .then((state) => {
          if (live)
            setDrafts((items) => [
              ...items,
              ...state.conversations.filter(
                (c) =>
                  !items.some((item) => item.id === c.id) &&
                  !deleted.current.has(c.id),
              ),
            ]);
        })
        .catch((error) => {
          if (live) setAgentError(String(error));
        });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [repo?.root, loaded]);
  async function send() {
    setSending(true);
    setAgentError("");
    try {
      await pending.current;
      await window.anvil.updateConversation(selected, {
        text: draft.text,
      });
      await window.anvil.startTask(selected, draft.text, undefined, {
        modelID: composerDraft.modelID,
        attachmentIDs: composerDraft.attachments.map((item) => item.id),
      });
      composerDraft.update({ attachments: [] });
      await patchDraft(selected, { text: "" });
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
  const conversationTitle = (item: Conversation) => getTitle(item, tasks);
  const input = useRef<HTMLTextAreaElement>(null);
  const draft =
    drafts.find((item) => item.id === selected) ||
    ({
      id: "",
      title: "",
      text: "",
      archived: false,
      created: 0,
      updated: 0,
    } as Conversation);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 240)}px`;
    }
  }, [draft.text, selected]);
  const visible = filterConversations(drafts, tasks, "", archived).filter(
    (item) => !onlyPinned || item.pinned,
  );
  if (oldestFirst) visible.reverse();
  const pinned = visible.filter((item) => item.pinned);
  const unpinned = visible.filter((item) => !item.pinned);
  async function saveGroup(
    id: string,
    patch: { name?: string; collapsed?: boolean },
  ) {
    const result = await window.anvil.updateGroup(id, patch);
    setGroups((items) =>
      items.map((item) => (item.id === result.id ? result : item)),
    );
  }
  async function removeGroup(id: string) {
    await action(async () => {
      if (!(await window.anvil.deleteGroup(id))) return;
      setGroups((items) => items.filter((item) => item.id !== id));
      setDrafts((items) =>
        items.map((item) =>
          item.groupID === id ? { ...item, groupID: null } : item,
        ),
      );
    });
  }
  async function addGroup() {
    setGroupBusy(true);
    setGroupError("");
    try {
      const result = await window.anvil.createGroup(groupName);
      setGroups((items) => [...items, result]);
      setOnlyPinned(false);
      setArchived(false);
      setCreatingGroup(false);
      setGroupName("");
    } catch (error) {
      setGroupError(String(error));
    } finally {
      setGroupBusy(false);
    }
  }
  async function organizeConversation(
    id: string,
    patch: Pick<ConversationPatch, "pinned" | "groupID">,
  ) {
    await action(async () => {
      const result = await window.anvil.updateConversation(id, patch);
      setDrafts((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                pinned: result.pinned,
                groupID: result.groupID,
                updated: result.updated,
              }
            : item,
        ),
      );
    });
  }
  function renderConversation(item: Conversation) {
    return (
      <ConversationRow
        key={item.id}
        title={conversationTitle(item)}
        selected={item.id === selected}
        archived={item.archived}
        running={tasks.some(
          (task) =>
            task.conversationID === item.id && task.status === "running",
        )}
        disabled={managing || sending}
        onCreateGroup={async (name) => {
          const group = await window.anvil.createGroup(name, item.id);
          setGroups((items) => [...items, group]);
          setDrafts((items) =>
            items.map((chat) =>
              chat.id === item.id ? { ...chat, groupID: group.id } : chat,
            ),
          );
        }}
        groups={groups}
        groupID={item.groupID}
        pinned={item.pinned}
        onPin={() =>
          void organizeConversation(item.id, { pinned: !item.pinned })
        }
        onMove={(groupID) => void organizeConversation(item.id, { groupID })}
        onSelect={() => void action(() => choose(item.id))}
        onRename={(title) => patchDraft(item.id, { title })}
        onArchive={() => void archive(item)}
        onDelete={() => void remove(item.id)}
      />
    );
  }
  const readOnly = !loaded || !draft.id || draft.archived;
  function patchDraft(id: string, patch: ConversationPatch) {
    setDrafts((items) =>
      items.map((item) =>
        item.id === id ? { ...item, ...patch, updated: Date.now() } : item,
      ),
    );
    // Send immediately: updates are applied synchronously in IPC arrival order.
    // Do not leave recent keystrokes waiting in a renderer-only save queue.
    const operation = window.anvil.updateConversation(id, patch);
    pending.current = Promise.all([pending.current, operation]).then(
      () => {
        setStorageError(false);
      },
      () => {
        setStorageError(true);
      },
    );
    return operation;
  }
  function update(text: string) {
    void patchDraft(selected, { text }).catch(() => {});
  }
  async function changePermissionMode(mode: PermissionMode) {
    await action(async () => {
      const result = await window.anvil.setPermissionMode(selected, mode);
      if (result)
        setDrafts((items) =>
          items.map((item) =>
            item.id === result.id
              ? { ...item, permissionMode: result.permissionMode }
              : item,
          ),
        );
    });
  }
  async function addFolders() {
    await action(async () => {
      const result = await window.anvil.addConversationFolders(selected);
      if (!result) return;
      setDrafts((items) =>
        items.map((item) =>
          item.id === result.id ? { ...item, folders: result.folders } : item,
        ),
      );
      if (result.folders?.length) onSelectDirectory(result.folders[0]);
    });
  }
  async function revokeFolder(root: string) {
    await action(async () => {
      const result = await window.anvil.revokeConversationFolder(
        selected,
        root,
      );
      setDrafts((items) =>
        items.map((item) =>
          item.id === result.id ? { ...item, folders: result.folders } : item,
        ),
      );
    });
  }
  async function choose(id: string) {
    await window.anvil.selectConversation(id);
    setSelected(id);
  }
  async function create() {
    setManaging(true);
    await action(async () => {
      await pending.current;
      const next = await window.anvil.createConversation();
      setDrafts((items) => [next, ...items]);
      setSelected(next.id);
      setArchived(false);
      setOnlyPinned(false);
      input.current?.focus();
    });
    setManaging(false);
  }
  async function archive(target = draft) {
    setManaging(true);
    await action(async () => {
      await pending.current;
      const result = await window.anvil.updateConversation(target.id, {
        archived: !target.archived,
      });
      setDrafts((items) =>
        items.map((item) =>
          item.id === result.id
            ? { ...item, archived: result.archived, updated: result.updated }
            : item,
        ),
      );
      if (target.id === selected) setArchived(!target.archived);
    });
    setManaging(false);
  }
  async function remove(id = selected) {
    setManaging(true);
    await action(async () => {
      await pending.current;
      if (!(await window.anvil.deleteConversation(id))) return;
      deleted.current.add(id);
      setTasks((items) => items.filter((item) => item.conversationID !== id));
      const state = await window.anvil.conversations();
      if (!state.conversations.length) {
        const next = await window.anvil.createConversation();
        state.conversations = [next];
        state.selected = next.id;
      }
      setGroups(state.groups);
      setDrafts(state.conversations);
      if (id === selected) {
        setSelected(state.selected);
        setArchived(
          !!state.conversations.find((item) => item.id === state.selected)
            ?.archived,
        );
      }
    });
    setManaging(false);
  }
  const [reviewOpen, setReviewOpen] = useState(false);
  return (
    <div className="workspace-shell">
      <nav className="activity-rail" aria-label="Main navigation">
        <button
          title="Conversations"
          aria-label="Conversations"
          aria-pressed={!reviewOpen}
          onClick={() => setReviewOpen(false)}
        >
          <MessageSquare size={22} />
        </button>
        <button
          title="Code review"
          aria-label="Code review"
          aria-pressed={reviewOpen}
          onClick={() => setReviewOpen(true)}
        >
          <GitPullRequest size={22} />
        </button>
      </nav>
      <ReviewWorkspace
        roots={repo?.directories || (repo ? [repo.root] : [])}
        open={reviewOpen}
        sidebarOpen={sidebarOpen}
      >
        <div className="workspace conversation-workspace">
          {sidebarOpen && (
            <aside
              id="conversation-sidebar"
              className="conversation-sidebar"
              aria-label="Conversations"
            >
              <div className="sidebar-header">
                <strong>Anvil</strong>
              </div>
              <button
                className="new-conversation"
                onClick={() => void create()}
                disabled={!loaded || managing || sending}
              >
                <Plus size={16} />
                New conversation
              </button>
              <div className="sidebar-list-heading">
                <select
                  aria-label="Conversation filter"
                  value={archived ? "archived" : onlyPinned ? "pinned" : "all"}
                  onChange={(event) => {
                    setArchived(event.target.value === "archived");
                    setOnlyPinned(event.target.value === "pinned");
                  }}
                >
                  <option value="all">Chats and tasks</option>
                  <option value="pinned">Pinned</option>
                  <option value="archived">Archived</option>
                </select>
                <details className="tools-menu sidebar-list-options">
                  <summary aria-label="List options">
                    <Ellipsis size={17} />
                  </summary>
                  <div className="workspace-tools">
                    <button
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        setCreatingGroup(true);
                        setGroupError("");
                      }}
                    >
                      New group
                    </button>
                    <button
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        setOldestFirst((value) => !value);
                      }}
                    >
                      {oldestFirst
                        ? "Sort: newest first"
                        : "Sort: oldest first"}
                    </button>
                  </div>
                </details>
              </div>
              {creatingGroup && (
                <form
                  className="group-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addGroup();
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Group name"
                    placeholder="Group name"
                    maxLength={80}
                    value={groupName}
                    disabled={groupBusy}
                    onChange={(event) => setGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !groupBusy)
                        setCreatingGroup(false);
                    }}
                  />
                  <button disabled={!groupName.trim() || groupBusy}>
                    Create
                  </button>
                  <button
                    type="button"
                    disabled={groupBusy}
                    onClick={() => setCreatingGroup(false)}
                  >
                    Cancel
                  </button>
                  {groupError && <p role="alert">{groupError}</p>}
                </form>
              )}
              <div className="draft-list">
                {!!pinned.length && (
                  <>
                    <div className="group-label">Pinned</div>
                    {pinned.map(renderConversation)}
                  </>
                )}
                {!onlyPinned &&
                  groups.map((group) => (
                    <section
                      className="conversation-group"
                      key={group.id}
                      aria-label={group.name}
                    >
                      <ConversationRow
                        title={group.name}
                        selected={false}
                        archived={false}
                        running={false}
                        disabled={managing || sending}
                        collapsed={group.collapsed}
                        onSelect={() =>
                          void action(() =>
                            saveGroup(group.id, {
                              collapsed: !group.collapsed,
                            }),
                          )
                        }
                        onRename={(name) => saveGroup(group.id, { name })}
                        onDelete={() => void removeGroup(group.id)}
                      />
                      {!group.collapsed && (
                        <div className="group-conversations">
                          {unpinned
                            .filter((item) => item.groupID === group.id)
                            .map(renderConversation)}
                          {!unpinned.some(
                            (item) => item.groupID === group.id,
                          ) && (
                            <p className="group-empty">
                              Move a conversation here from its ⋯ menu.
                            </p>
                          )}
                        </div>
                      )}
                    </section>
                  ))}
                {!onlyPinned && (
                  <>
                    {!!groups.length && (
                      <div className="group-label">Ungrouped</div>
                    )}
                    {unpinned
                      .filter((item) => !item.groupID)
                      .map(renderConversation)}
                  </>
                )}
                {loaded && !visible.length && (
                  <p>
                    {archived
                      ? "No archived conversations"
                      : "No conversations"}
                  </p>
                )}
                {!loaded && <p>Loading conversations…</p>}
              </div>
            </aside>
          )}
          <main
            className={`conversation-main ${conversationTasks.length === 0 ? "is-empty" : ""} ${terminalOpen ? "with-terminal" : ""}`}
            aria-label="Conversation"
          >
            <header className="conversation-toolbar">
              <span className="conversation-title">
                {conversationTitle(draft)}
              </span>
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
                    {draft.folders?.length
                      ? "Ask about your code, plan a change, or start building."
                      : "Start a conversation, or add a folder to work on your code."}
                  </p>
                  {!draft.folders?.length && (
                    <button
                      className="primary-button"
                      disabled={!loaded}
                      onClick={() => void addFolders()}
                    >
                      Add folders (optional)
                    </button>
                  )}
                </div>
              )}
              {conversationTasks.map((task) => (
                <article className="agent-task" key={task.id}>
                  <div className="agent-prompt">
                    {task.prompt}
                    {!!task.attachments?.length && (
                      <div className="sent-attachments">
                        {task.attachments.map((file) => (
                          <span key={file.id}>
                            <Paperclip size={13} />
                            {file.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="response-heading">Anvil</div>
                  {task.text && (
                    <div className="agent-response">{task.text}</div>
                  )}
                  {task.status === "running" ? (
                    <div
                      className="agent-progress"
                      role="status"
                      aria-live="polite"
                    >
                      <span
                        className={`agent-progress-dot ${task.permissions.length || task.phase === "stopping" ? "paused" : ""}`}
                        aria-hidden="true"
                      />
                      <span>
                        {task.phase === "stopping"
                          ? "Stopping…"
                          : task.permissions.length
                            ? "Waiting for approval"
                            : task.phase === "checking"
                              ? "Checking…"
                              : task.phase === "repairing"
                                ? `Repairing · ${(task.round || 1) - 1}/${task.acceptance?.maxRepairs}`
                                : task.text
                                  ? "Continuing…"
                                  : "Working…"}
                      </span>
                    </div>
                  ) : (
                    <small
                      className={`task-state ${task.status}`}
                      role="status"
                    >
                      {task.status === "completed"
                        ? "Acceptance passed"
                        : task.status === "unverified"
                          ? "Finished · not verified"
                          : task.status === "limit"
                            ? "Limit reached"
                            : task.status}
                    </small>
                  )}
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
              {draft.archived && (
                <p className="archived-notice">
                  This conversation is archived.{" "}
                  <button onClick={() => void archive()} disabled={managing}>
                    Restore to continue
                  </button>
                </p>
              )}
              {!loaded && agentError && (
                <button onClick={() => setInitialization((value) => value + 1)}>
                  Retry loading history
                </button>
              )}
              <div
                className="composer"
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!readOnly && !sending && !attaching && !running)
                    void attach(Array.from(event.dataTransfer.files));
                }}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (
                    files.length &&
                    !readOnly &&
                    !sending &&
                    !attaching &&
                    !running
                  ) {
                    event.preventDefault();
                    void attach(files);
                  }
                }}
              >
                {(!!draft.folders?.length ||
                  !!composerDraft.attachments.length) && (
                  <div className="composer-attachments">
                    {(draft.folders || []).map((root) => (
                      <span className="attachment-chip" key={root}>
                        <button
                          title={root}
                          onClick={() => onSelectDirectory(root)}
                        >
                          <Folder size={14} />
                          {root.split(/[\\/]/).pop()}
                        </button>
                        <button
                          disabled={sending || !!running}
                          aria-label={`Remove folder ${root}`}
                          onClick={() => void revokeFolder(root)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    {composerDraft.attachments.map((file) => (
                      <span
                        className="attachment-chip"
                        key={file.id}
                        title={`${file.name} · ${Math.ceil(file.size / 1024)} KB`}
                      >
                        <Paperclip size={14} />
                        <span>{file.name}</span>
                        <button
                          disabled={sending}
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            composerDraft.update({
                              attachments: composerDraft.attachments.filter(
                                (item) => item.id !== file.id,
                              ),
                            })
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={input}
                  aria-label="Message Anvil"
                  placeholder="Work with Anvil"
                  value={draft.text}
                  onChange={(event) => update(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey) &&
                      !event.nativeEvent.isComposing &&
                      !readOnly &&
                      (draft.text.trim() ||
                        composerDraft.attachments.length > 0) &&
                      !attaching &&
                      !imageMismatch &&
                      !!selectedModel &&
                      !running &&
                      !sending &&
                      !managing
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  disabled={readOnly || sending}
                  rows={2}
                />
                <div className="composer-footer">
                  <details
                    className="tools-menu composer-menu"
                    key={`add-${selected}`}
                  >
                    <summary aria-label="Add context">
                      <Plus size={17} />
                    </summary>
                    <div className="context-popover">
                      <button
                        disabled={
                          readOnly ||
                          sending ||
                          managing ||
                          attaching ||
                          !!running
                        }
                        onClick={(event) => {
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                          void attach();
                        }}
                      >
                        <Paperclip size={16} /> Add files or images…
                      </button>
                      <button
                        onClick={(event) => {
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                          void addFolders();
                        }}
                        disabled={readOnly || sending || managing}
                      >
                        Add local folder…
                      </button>
                    </div>
                  </details>
                  <label
                    className={`permission-control ${draft.permissionMode === "full" ? "full-access" : ""}`}
                  >
                    <Shield size={17} />
                    <select
                      className="permission-mode"
                      aria-label="Permission mode"
                      title="Ask: confirm edits and commands. Auto: allow scoped file edits, ask for commands and unknown operations. Full access: approve all tools."
                      value={draft.permissionMode || "ask"}
                      disabled={readOnly || sending || !!running || managing}
                      onChange={(event) =>
                        void changePermissionMode(
                          event.target.value as PermissionMode,
                        )
                      }
                    >
                      <option value="ask">Ask each time</option>
                      <option value="auto">Auto</option>
                      <option value="full">Full access</option>
                    </select>
                  </label>
                  <ModelPicker
                    value={composerDraft.modelID}
                    onChange={(modelID) => composerDraft.update({ modelID })}
                    onModels={setModels}
                    disabled={readOnly || sending || !!running || managing}
                  />

                  <button
                    className={`send-button ${running ? "is-running" : ""}`}
                    aria-label={running ? "Stop task" : "Send message"}
                    title={running ? "Stop task" : "Send · Ctrl / ⌘ + Enter"}
                    onClick={() =>
                      running
                        ? void action(() => window.anvil.cancelTask(running.id))
                        : void send()
                    }
                    disabled={
                      running
                        ? running.phase === "stopping"
                        : readOnly ||
                          (!draft.text.trim() &&
                            !composerDraft.attachments.length) ||
                          sending ||
                          managing ||
                          attaching ||
                          imageMismatch ||
                          !selectedModel
                    }
                  >
                    {running ? (
                      <Square size={15} fill="currentColor" />
                    ) : (
                      <ArrowUp size={19} />
                    )}
                  </button>
                </div>
              </div>
              {(storageError ||
                composerDraft.storageError ||
                agentError ||
                imageMismatch ||
                attaching) && (
                <p className="draft-notice" role="status">
                  {storageError || composerDraft.storageError
                    ? "Could not save this draft locally. Keep this window open."
                    : attaching
                      ? "Adding attachments…"
                      : agentError ||
                        (imageMismatch
                          ? "This model does not support images. Choose an image-capable model or remove the image."
                          : "")}
                </p>
              )}
            </div>
            {terminal}
          </main>
          {review}
        </div>
      </ReviewWorkspace>
    </div>
  );
}

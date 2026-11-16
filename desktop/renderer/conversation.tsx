import { AnswerActions } from "./answer-actions";
import type { MemoryInput } from "../shared/memory";
import { MarkdownResponse } from "./markdown-response";
import { ContextDialog } from "./context-dialog";
import { AgentQuestions } from "./agent-questions";
import { codexModel } from "../shared/providers";
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
  conversationTitle as getTitle,
  filterConversations,
} from "./conversation-data";

export function ConversationWorkspace({
  repo,
  sidebarOpen,
  tools,
  review,
  panelToggle,
  terminalOpen,
  onTerminal,
  onSelectDirectory,
}: {
  repo: RepoState | null;
  sidebarOpen: boolean;
  tools: ReactNode;
  review: ReactNode;
  panelToggle: ReactNode;
  terminalOpen: boolean;
  onTerminal: () => void;
  onOpen: () => void;
  onSelectDirectory: (root: string) => void;
}) {
  const [memoryDraft, setMemoryDraft] = useState<MemoryInput>();
  const [contextOpen, setContextOpen] = useState(false);
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
  const [modelOpenRequest, setModelOpenRequest] = useState(0);
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
        throw new Error("最多选择 8 个附件。");
      const items: Attachment[] = [];
      if (files)
        for (const file of files) {
          if (file.size > 5 * 1024 * 1024)
            throw new Error("单个附件不得超过 5 MB。");
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
        throw new Error("最多使用 8 个附件，总大小不得超过 10 MB。");
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
  useEffect(
    () =>
      window.anvil.onAccountChange(() => {
        void window.anvil
          .conversations()
          .then((state) => {
            setGroups(state.groups);
            setDrafts((items) =>
              items.map((item) => ({
                ...item,
                groupID: state.conversations.find((c) => c.id === item.id)
                  ?.groupID,
              })),
            );
          })
          .catch((e) => setAgentError(String(e)));
      }),
    [],
  );
  const conversationTasks = tasks.filter(
    (task) => task.conversationID === selected,
  );
  const running = tasks.find((task) => task.status === "running");
  useEffect(() => {
    let live = true;
    async function load() {
      let state = await window.anvil.conversations();

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
  async function fork(task: AgentTask) {
    setManaging(true);
    await action(async () => {
      await pending.current;
      const next = await window.anvil.forkConversation(task.id);
      setTasks(await window.anvil.tasks());
      setDrafts((items) => [next, ...items]);
      composerDraft.update(
        { modelID: task.model?.id || composerDraft.modelID, attachments: [] },
        next.id,
      );
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
      <nav className="activity-rail" aria-label="主导航">
        <button
          title="聊天"
          aria-label="聊天"
          aria-pressed={!reviewOpen}
          onClick={() => setReviewOpen(false)}
        >
          <MessageSquare size={22} />
        </button>
        <button
          title="代码审查"
          aria-label="代码审查"
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
              aria-label="聊天"
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
                新聊天
              </button>
              <div className="sidebar-list-heading">
                <select
                  aria-label="聊天筛选"
                  value={archived ? "archived" : onlyPinned ? "pinned" : "all"}
                  onChange={(event) => {
                    setArchived(event.target.value === "archived");
                    setOnlyPinned(event.target.value === "pinned");
                  }}
                >
                  <option value="all">聊天与任务</option>
                  <option value="pinned">已置顶</option>
                  <option value="archived">已归档</option>
                </select>
                <details className="tools-menu sidebar-list-options">
                  <summary aria-label="列表选项">
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
                      新建分组
                    </button>
                    <button
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        setOldestFirst((value) => !value);
                      }}
                    >
                      {oldestFirst ? "排序：最新优先" : "排序：最早优先"}
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
                    aria-label="分组名称"
                    placeholder="分组名称"
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
                    创建
                  </button>
                  <button
                    type="button"
                    disabled={groupBusy}
                    onClick={() => setCreatingGroup(false)}
                  >
                    取消
                  </button>
                  {groupError && <p role="alert">{groupError}</p>}
                </form>
              )}
              <div className="draft-list">
                {!!pinned.length && (
                  <>
                    <div className="group-label">已置顶</div>
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
                              从聊天的 ⋯ 菜单将其移至此分组。
                            </p>
                          )}
                        </div>
                      )}
                    </section>
                  ))}
                {!onlyPinned && (
                  <>
                    {!!groups.length && (
                      <div className="group-label">未分组</div>
                    )}
                    {unpinned
                      .filter((item) => !item.groupID)
                      .map(renderConversation)}
                  </>
                )}
                {loaded && !visible.length && (
                  <p>{archived ? "暂无归档聊天" : "暂无聊天"}</p>
                )}
                {!loaded && <p>正在加载聊天…</p>}
              </div>
            </aside>
          )}
          <main
            className={`conversation-main ${conversationTasks.length === 0 ? "is-empty" : ""}`}
            aria-label="聊天"
          >
            {contextOpen && (
              <ContextDialog
                key={selected}
                conversationID={selected}
                disabled={!!running || sending}
                initialMemory={memoryDraft}
                onClose={() => {
                  setContextOpen(false);
                  setMemoryDraft(undefined);
                }}
              />
            )}
            <header className="conversation-toolbar">
              <span className="conversation-title">
                {conversationTitle(draft)}
              </span>
              <details className="tools-menu" ref={toolsMenu}>
                <summary aria-label="工作区工具" title="文件、变更和终端">
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
                  <button
                    disabled={!selected}
                    onClick={() => setContextOpen(true)}
                  >
                    记忆
                  </button>
                  {tools}
                  <button
                    aria-label="展开或收起终端"
                    aria-pressed={terminalOpen}
                    title="终端"
                    onClick={onTerminal}
                    disabled={!repo}
                  >
                    <TerminalSquare size={16} />
                    <span>终端</span>
                  </button>
                </div>
              </details>
              {panelToggle}
            </header>
            <section
              className={`conversation-body ${conversationTasks.length ? "has-tasks" : ""}`}
            >
              {conversationTasks.length === 0 && (
                <div className="conversation-intro">
                  <h1>今天想做些什么？</h1>
                  <p>
                    {draft.folders?.length
                      ? "了解代码、规划修改，或开始开发。"
                      : "开始聊天，或添加文件夹来处理代码。"}
                  </p>
                  {!draft.folders?.length && (
                    <button
                      className="primary-button"
                      disabled={!loaded}
                      onClick={() => void addFolders()}
                    >
                      添加文件夹（可选）
                    </button>
                  )}
                </div>
              )}
              {conversationTasks.map((task) => (
                <article
                  className="agent-task"
                  key={task.id}
                  id={`task-${task.id}`}
                >
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
                  {task.text && <MarkdownResponse text={task.text} />}
                  {task.questions?.map((group) => (
                    <AgentQuestions
                      key={group.id}
                      group={group}
                      disabled={readOnly || sending || (group.blocking ? task.status !== "running" : !!running) || managing}
                      onAnswer={async (values) => {
                        setSending(true);
                        try {
                          await window.anvil.answerQuestions(
                            task.id,
                            group.id,
                            values,
                          );
                        } finally {
                          setSending(false);
                        }
                      }}
                    />
                  ))}
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
                          ? "正在停止…"
                          : task.permissions.length
                            ? "等待授权"
                            : task.phase === "checking"
                              ? "正在检查…"
                              : task.phase === "repairing"
                                ? `正在修复 · ${(task.round || 1) - 1}/${task.acceptance?.maxRepairs}`
                                : task.activity ||
                                  (task.text ? "正在继续…" : "处理中…")}
                      </span>
                    </div>
                  ) : (
                    <small
                      className={`task-state ${task.status}`}
                      role="status"
                    >
                      {task.status === "completed"
                        ? "验收通过"
                        : task.status === "unverified"
                          ? task.questions?.some(
                              (group) => !group.answer && !group.readOnly,
                            )
                            ? "等待你的回答"
                            : task.questions?.length
                              ? "已结束"
                              : "已结束 · 未验证"
                          : task.status === "limit"
                            ? "已达到限制"
                            : task.status}
                    </small>
                  )}
                  {task.text && task.status !== "running" && (
                    <AnswerActions
                      text={task.text}
                      disabled={managing || sending || !!running}
                      onFork={() => void fork(task)}
                      onMemory={() => {
                        setMemoryDraft({
                          title: task.prompt.trim().slice(0, 120) || "回答记忆",
                          body: task.text.slice(0, 1200),
                          kind: "reference",
                          scope: null,
                          sourceTaskID: task.id,
                        });
                        setContextOpen(true);
                      }}
                    />
                  )}
                  {task.acceptance && (
                    <details className="acceptance-results">
                      <summary>
                        验收 · {task.checks?.length || 0} 运行
                        {task.checks?.length === 1 ? "" : "s"}
                      </summary>
                      <code>{task.acceptance.command}</code>
                      <p>{task.acceptance.directory}</p>
                      {task.checks?.map((check) => (
                        <div className="acceptance-run" key={check.round}>
                          <strong>
                            运行 {check.round} ·{" "}
                            {check.cancelled
                              ? "已取消"
                              : check.timedOut
                                ? "已超时"
                                : check.error
                                  ? "无法运行"
                                  : `退出码 ${check.exitCode}`}{" "}
                            · {(check.durationMs / 1000).toFixed(1)}s
                          </strong>
                          <pre>
                            {check.error || check.output || "（无输出）"}
                            {check.truncated ? "\n[输出已截断]" : ""}
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
                      aria-label="工具授权"
                    >
                      <strong>允许 {permission.action}?</strong>
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
                        拒绝
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
                        允许一次
                      </button>
                    </section>
                  ))}
                </article>
              ))}
            </section>
            <div className="composer-wrap">
              {draft.archived && (
                <p className="archived-notice">
                  此聊天已归档。{" "}
                  <button onClick={() => void archive()} disabled={managing}>
                    恢复后继续
                  </button>
                </p>
              )}
              {!loaded && agentError && (
                <button onClick={() => setInitialization((value) => value + 1)}>
                  重新加载历史
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
                          aria-label={`移除文件夹 ${root}`}
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
                          aria-label={`移除 ${file.name}`}
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
                {imageMismatch && (
                  <div className="composer-image-notice" role="status">
                    <span>
                      {selectedModel?.name || "所选模型"}{" "}
                      未启用图片功能，请选择支持图片的模型后发送此附件。
                    </span>
                    <button
                      type="button"
                      onClick={() => setModelOpenRequest((v) => v + 1)}
                    >
                      选择模型
                    </button>
                  </div>
                )}
                <textarea
                  ref={input}
                  aria-label="向 Anvil 发送消息"
                  placeholder="与 Anvil 一起工作"
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
                    <summary aria-label="添加上下文">
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
                        <Paperclip size={16} /> 添加文件或图片…
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
                        添加本地文件夹…
                      </button>
                    </div>
                  </details>
                  <label
                    className={`permission-control ${draft.permissionMode === "full" ? "full-access" : ""}`}
                  >
                    <Shield size={17} />
                    <select
                      className="permission-mode"
                      aria-label="权限模式"
                      title={
                        selectedModel?.id === codexModel.id
                          ? "Codex：逐次询问使用只读沙箱，额外权限需审批；自动模式允许沙箱内命令和工作区修改，额外权限需审批；完全访问不使用沙箱或审批。Codex 可能读取附加目录之外的文件。"
                          : "逐次询问：编辑和命令需确认。自动模式：允许授权范围内的文件修改，命令及未知操作需确认。完全访问：允许所有工具操作。"
                      }
                      value={draft.permissionMode || "ask"}
                      disabled={readOnly || sending || !!running || managing}
                      onChange={(event) =>
                        void changePermissionMode(
                          event.target.value as PermissionMode,
                        )
                      }
                    >
                      <option value="ask">逐次询问</option>
                      <option value="auto">自动</option>
                      <option value="full">完全访问</option>
                    </select>
                  </label>
                  <ModelPicker
                    openRequest={modelOpenRequest}
                    value={composerDraft.modelID}
                    onChange={(modelID) => composerDraft.update({ modelID })}
                    onModels={setModels}
                    disabled={readOnly || sending || !!running || managing}
                  />

                  <button
                    className={`send-button ${running ? "is-running" : ""}`}
                    aria-label={running ? "停止任务" : "发送消息"}
                    title={
                      running
                        ? "停止任务"
                        : imageMismatch
                          ? "请选择支持图片的模型后发送此附件"
                          : "发送 · Ctrl / ⌘ + Enter"
                    }
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
                attaching) && (
                <p className="draft-notice" role="status">
                  {storageError || composerDraft.storageError
                    ? "无法在本地保存草稿，请保持此窗口打开。"
                    : attaching
                      ? "正在添加附件…"
                      : agentError ||
                        (imageMismatch
                          ? "此模型不支持图片，请更换支持图片的模型或移除图片。"
                          : "")}
                </p>
              )}
            </div>
          </main>
          {review}
        </div>
      </ReviewWorkspace>
    </div>
  );
}
